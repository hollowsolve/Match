import { Op, FlatOp, CompiledOp, CompiledProgram, opToBitset, isSingleByteOp, FlatStep, makeBitset } from './fast-types.js';

const I32 = 0x7F;
const I32_CONST = 0x41;
const I32_ADD = 0x6A;
const I32_SUB = 0x6B;
const I32_AND = 0x71;
const I32_SHL = 0x74;
const I32_SHR_U = 0x76;
const I32_EQ = 0x46;
const I32_NE = 0x47;
const I32_LT_S = 0x48;
const I32_LT_U = 0x49;
const I32_GT_S = 0x4A;
const I32_LE_S = 0x4C;
const I32_GE_S = 0x4E;
const LOCAL_GET = 0x20;
const LOCAL_SET = 0x21;
const LOCAL_TEE = 0x22;
const I32_LOAD = 0x28;
const I32_LOAD8_U = 0x2D;
const BLOCK = 0x02;
const LOOP = 0x03;
const BR = 0x0C;
const BR_IF = 0x0D;
const IF = 0x04;
const ELSE = 0x05;
const END = 0x0B;
const RETURN = 0x0F;
const CALL = 0x10;
const VOID = 0x40;
const I32_LOAD16_U = 0x2F;
const I32_STORE = 0x36;
const I32_OR = 0x72;
const I32_XOR = 0x73;
const I32_GE_U = 0x4F;
const I32_GT_U = 0x4B;
const I32_LE_U = 0x4D;

const V128 = 0x7B;
const SIMD_PREFIX = 0xFD;
const V128_LOAD = 0;
const V128_CONST = 12;
const I8X16_EXTRACT_LANE_S = 21;
const I8X16_SPLAT = 15;
const I8X16_SWIZZLE = 14;
const V128_AND = 80;
const V128_OR = 81;
const I8X16_ALL_TRUE = 99;
const I8X16_SUB = 113;
const I8X16_LE_U = 42;
const I8X16_EQ = 35;
const I32X4_EXTRACT_LANE = 27;
const I8X16_NE = 36;
const I8X16_SHR_U = 109;
const V128_ANY_TRUE = 83;
const I8X16_BITMASK = 0x64;
const I32_CTZ = 0x68;

const L_PTR = 0;
const L_LEN = 1;
const L_POS = 2;
const L_TMP = 3;
const L_TMP2 = 4;
const L_CNT = 5;
const L_SAV = 6;

const INPUT_BASE = 65536;

class E {
  buf: number[] = [];
  segs: { off: number; data: number[] }[] = [];
  dOff = 0;
  depth = 0;
  bsCache = new Map<string, number>();
  simd = false;
  b(v: number) { this.buf.push(v & 0xFF); }
  u(v: number) { do { let b = v & 0x7F; v >>>= 7; if (v) b |= 0x80; this.buf.push(b); } while (v); }
  s(v: number) { let m = true; while (m) { let b = v & 0x7F; v >>= 7; if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) m = false; else b |= 0x80; this.buf.push(b); } }
  alloc(data: number[]): number { const o = this.dOff; this.segs.push({ off: o, data }); this.dOff += data.length; return o; }
  allocBs(bs: Uint32Array): number {
    const key = bs[0] + ',' + bs[1] + ',' + bs[2] + ',' + bs[3] + ',' + bs[4] + ',' + bs[5] + ',' + bs[6] + ',' + bs[7];
    let off = this.bsCache.get(key);
    if (off !== undefined) return off;
    off = this.alloc(bsBytes(bs));
    this.bsCache.set(key, off);
    return off;
  }
}

function bsBytes(bs: Uint32Array): number[] {
  const o: number[] = [];
  for (let i = 0; i < 8; i++) { const w = bs[i]; o.push(w & 0xFF, (w >>> 8) & 0xFF, (w >>> 16) & 0xFF, (w >>> 24) & 0xFF); }
  return o;
}

function lget(w: E, l: number) { w.b(LOCAL_GET); w.u(l); }
function lset(w: E, l: number) { w.b(LOCAL_SET); w.u(l); }
function ltee(w: E, l: number) { w.b(LOCAL_TEE); w.u(l); }
function iconst(w: E, v: number) { w.b(I32_CONST); w.s(v); }
function load8(w: E, posL: number) { lget(w, L_PTR); lget(w, posL); w.b(I32_ADD); w.b(I32_LOAD8_U); w.u(0); w.u(0); }
function load8off(w: E, posL: number, off: number) { lget(w, L_PTR); lget(w, posL); w.b(I32_ADD); iconst(w, off); w.b(I32_ADD); w.b(I32_LOAD8_U); w.u(0); w.u(0); }
function load32off(w: E, posL: number, off: number) { lget(w, L_PTR); lget(w, posL); w.b(I32_ADD); iconst(w, off); w.b(I32_ADD); w.b(I32_LOAD); w.u(0); w.u(0); }
function load16off(w: E, posL: number, off: number) { lget(w, L_PTR); lget(w, posL); w.b(I32_ADD); iconst(w, off); w.b(I32_ADD); w.b(I32_LOAD16_U); w.u(0); w.u(0); }

function emitLiteralCheck(w: E, tb: Uint8Array | number[], posL: number, fd: number | null) {
  if (tb.length <= 1) {
    if (tb.length === 1) {
      load8off(w, posL, 0); iconst(w, tb[0]); w.b(I32_NE);
      w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
    }
    return;
  }
  const ifd = fd !== null ? fd + 1 : null;
  w.b(BLOCK); w.b(VOID);
  let i = 0;
  while (i + 4 <= tb.length) {
    const v = tb[i] | (tb[i + 1] << 8) | (tb[i + 2] << 16) | ((tb[i + 3] << 24) >>> 0);
    load32off(w, posL, i); iconst(w, v); w.b(I32_NE);
    w.b(IF); w.b(VOID); fail(w, ifd); w.b(END);
    i += 4;
  }
  if (i + 2 <= tb.length) {
    const v = tb[i] | (tb[i + 1] << 8);
    load16off(w, posL, i); iconst(w, v); w.b(I32_NE);
    w.b(IF); w.b(VOID); fail(w, ifd); w.b(END);
    i += 2;
  }
  while (i < tb.length) {
    load8off(w, posL, i); iconst(w, tb[i]); w.b(I32_NE);
    w.b(IF); w.b(VOID); fail(w, ifd); w.b(END);
    i++;
  }
  w.b(END);
}

function bsToRanges(bs: Uint32Array): [number, number][] | null {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < 256; i++) {
    const set = (bs[i >>> 5] & (1 << (i & 31))) !== 0;
    if (set && start < 0) start = i;
    else if (!set && start >= 0) { ranges.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, 255]);
  if (ranges.length >= 1 && ranges.length <= 2) return ranges;
  return null;
}

function simdOp(w: E, op: number) { w.b(SIMD_PREFIX); w.u(op); }

function v128const(w: E, bytes: number[]) {
  simdOp(w, V128_CONST);
  for (let i = 0; i < 16; i++) w.b(bytes[i] || 0);
}

function buildBsNibbleTables(bs: Uint32Array): { lo: number[]; hi: number[] } {
  const lo = new Array(16).fill(0);
  const hi = new Array(16).fill(0);
  for (let c = 0; c < 256; c++) {
    if ((bs[c >>> 5] & (1 << (c & 31))) !== 0) {
      const ln = c & 0xF;
      const hn = (c >>> 4) & 0xF;
      lo[ln] |= (1 << hn);
      hi[hn] |= (1 << ln);
    }
  }
  return { lo, hi };
}

function v128lget(w: E, l: number) { w.b(LOCAL_GET); w.u(l); }
function v128lset(w: E, l: number) { w.b(LOCAL_SET); w.u(l); }
function v128ltee(w: E, l: number) { w.b(LOCAL_TEE); w.u(l); }

function emitSimdOneRange(w: E, lo: number, hi: number) {
  v128const(w, new Array(16).fill(lo));
  simdOp(w, I8X16_SUB);
  v128const(w, new Array(16).fill(hi - lo));
  simdOp(w, I8X16_LE_U);
}

function emitSimdCaseFold(w: E, r2: [number, number]) {
  v128const(w, new Array(16).fill(0x20));
  simdOp(w, V128_OR);
  v128const(w, new Array(16).fill(r2[0]));
  simdOp(w, I8X16_SUB);
  v128const(w, new Array(16).fill(r2[1] - r2[0]));
  simdOp(w, I8X16_LE_U);
}

function bsToRangesExt(bs: Uint32Array): [number, number][] | null {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < 256; i++) {
    const set = (bs[i >>> 5] & (1 << (i & 31))) !== 0;
    if (set && start < 0) start = i;
    else if (!set && start >= 0) { ranges.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, 255]);
  if (ranges.length >= 1 && ranges.length <= 4) return ranges;
  return null;
}

function emitSimdBsCheck16(w: E, bs: Uint32Array) {
  const ranges = bsToRangesExt(bs);
  if (ranges) {
    const used = new Array(ranges.length).fill(false);
    const parts: (() => void)[] = [];
    for (let i = 0; i < ranges.length; i++) {
      if (used[i]) continue;
      let paired = false;
      for (let j = i + 1; j < ranges.length; j++) {
        if (!used[j] && isCaseFold(ranges[i], ranges[j])) {
          const r2 = ranges[j];
          parts.push(() => emitSimdCaseFold(w, r2));
          used[i] = used[j] = true; paired = true; break;
        }
      }
      if (!paired) {
        const [lo, hi] = ranges[i];
        parts.push(() => emitSimdOneRange(w, lo, hi));
        used[i] = true;
      }
    }
    if (parts.length === 1) {
      parts[0]();
    } else {
      v128ltee(w, L_VEC);
      parts[0]();
      for (let i = 1; i < parts.length; i++) {
        v128lget(w, L_VEC);
        parts[i]();
        simdOp(w, V128_OR);
      }
    }
    return;
  }
  const { lo, hi } = buildBsNibbleTables(bs);
  v128ltee(w, L_VEC);
  v128const(w, new Array(16).fill(0x0F));
  simdOp(w, V128_AND);
  v128const(w, hi);
  simdOp(w, I8X16_SWIZZLE);
  v128lget(w, L_VEC);
  iconst(w, 4);
  simdOp(w, I8X16_SHR_U);
  v128const(w, new Array(16).fill(0x0F));
  simdOp(w, V128_AND);
  v128const(w, lo);
  simdOp(w, I8X16_SWIZZLE);
  simdOp(w, V128_AND);
  v128const(w, new Array(16).fill(0));
  simdOp(w, I8X16_NE);
}

const L_VEC = 7;

function needsSimd(op: CompiledOp): boolean {
  switch (op.op) {
    case Op.FAST_REPEAT_BITSET: return true;
    case Op.FAST_BETWEEN_BITSET: return true;
  }
  if (op.child && needsSimd(op.child)) return true;
  if (op.child2 && needsSimd(op.child2)) return true;
  if (op.child3 && needsSimd(op.child3)) return true;
  if (op.children) for (const c of op.children) if (needsSimd(c)) return true;
  if (op.separator && needsSimd(op.separator)) return true;
  if (op.terminator && needsSimd(op.terminator)) return true;
  if (op.negated && needsSimd(op.negated)) return true;
  if (op.flatTail) for (const c of op.flatTail) if (needsSimd(c)) return true;
  if (op.flatSteps) for (const s of op.flatSteps) {
    if (s.fop === FlatOp.F_REPEAT_BITSET || s.fop === FlatOp.F_BETWEEN_BITSET) return true;
    if (s.child && needsSimd(s.child)) return true;
  }
  return false;
}

function emitOneRange(w: E, lo: number, hi: number, byteL: number) {
  if (lo === hi) { lget(w, byteL); iconst(w, lo); w.b(I32_EQ); }
  else { lget(w, byteL); iconst(w, lo); w.b(I32_SUB); iconst(w, hi - lo); w.b(I32_LE_U); }
}

function isCaseFold(r1: [number, number], r2: [number, number]): boolean {
  return r1[1] - r1[0] === r2[1] - r2[0] && r2[0] - r1[0] === 0x20;
}

function emitCaseFold(w: E, r1: [number, number], r2: [number, number], byteL: number) {
  lget(w, byteL); iconst(w, 0x20); w.b(I32_OR); iconst(w, r2[0]); w.b(I32_SUB); iconst(w, r2[1] - r2[0]); w.b(I32_LE_U);
}

function emitRangeCheck(w: E, ranges: [number, number][], byteL: number) {
  if (ranges.length === 1) {
    emitOneRange(w, ranges[0][0], ranges[0][1], byteL);
    return;
  }
  if (ranges.length === 2 && isCaseFold(ranges[0], ranges[1])) {
    emitCaseFold(w, ranges[0], ranges[1], byteL);
    return;
  }
  const used = new Array(ranges.length).fill(false);
  let count = 0;
  for (let i = 0; i < ranges.length; i++) {
    if (used[i]) continue;
    let paired = false;
    for (let j = i + 1; j < ranges.length; j++) {
      if (!used[j] && isCaseFold(ranges[i], ranges[j])) {
        emitCaseFold(w, ranges[i], ranges[j], byteL);
        used[i] = used[j] = true; paired = true; count++; break;
      }
    }
    if (!paired) { emitOneRange(w, ranges[i][0], ranges[i][1], byteL); used[i] = true; count++; }
  }
  for (let i = 1; i < count; i++) w.b(I32_OR);
}

function bsCheck(w: E, e: E, bs: Uint32Array, byteL: number) {
  const ranges = bsToRanges(bs);
  if (ranges) {
    emitRangeCheck(w, ranges, byteL);
    return;
  }
  const d = e.allocBs(bs);
  lget(w, byteL); iconst(w, 5); w.b(I32_SHR_U); iconst(w, 2); w.b(I32_SHL); iconst(w, d); w.b(I32_ADD);
  w.b(I32_LOAD); w.u(2); w.u(0);
  iconst(w, 1); lget(w, byteL); iconst(w, 31); w.b(I32_AND); w.b(I32_SHL);
  w.b(I32_AND);
}

function bsToRangesShort(bs: Uint32Array): [number, number][] | null {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < 256; i++) {
    const set = (bs[i >>> 5] & (1 << (i & 31))) !== 0;
    if (set && start < 0) start = i;
    else if (!set && start >= 0) { ranges.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, 255]);
  if (ranges.length >= 1 && ranges.length <= 2) return ranges;
  return null;
}

function emitUnrolled4xBody(w: E, lo: number, span: number, ptrL: number): void {
  lget(w, ptrL); w.b(I32_LOAD8_U); w.u(0); w.u(0); iconst(w, lo); w.b(I32_SUB); iconst(w, span); w.b(I32_GT_U);
  lget(w, ptrL); w.b(I32_LOAD8_U); w.u(0); w.u(1); iconst(w, lo); w.b(I32_SUB); iconst(w, span); w.b(I32_GT_U);
  w.b(I32_OR);
  lget(w, ptrL); w.b(I32_LOAD8_U); w.u(0); w.u(2); iconst(w, lo); w.b(I32_SUB); iconst(w, span); w.b(I32_GT_U);
  w.b(I32_OR);
  lget(w, ptrL); w.b(I32_LOAD8_U); w.u(0); w.u(3); iconst(w, lo); w.b(I32_SUB); iconst(w, span); w.b(I32_GT_U);
  w.b(I32_OR);
}

function emitUnrolled4x(w: E, bs: Uint32Array, ptrL: number, limitL: number): boolean {
  const ranges = bsToRangesShort(bs);
  if (!ranges || ranges.length !== 1) return false;
  const [lo, hi] = ranges[0];
  const span = hi - lo;
  lget(w, limitL); iconst(w, 4); w.b(I32_SUB); lset(w, L_TMP);
  w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
  lget(w, ptrL); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
  emitUnrolled4xBody(w, lo, span, ptrL);
  w.b(BR_IF); w.u(1);
  lget(w, ptrL); iconst(w, 4); w.b(I32_ADD); lset(w, ptrL);
  w.b(BR); w.u(0); w.b(END); w.b(END);
  return true;
}

function emitUnrolled4xCounted(w: E, bs: Uint32Array, ptrL: number, ptrLimitL: number, cntL: number, maxCnt: number): boolean {
  const ranges = bsToRangesShort(bs);
  if (!ranges || ranges.length !== 1 || maxCnt < 8) return false;
  const [lo, hi] = ranges[0];
  const span = hi - lo;
  lget(w, ptrLimitL); iconst(w, 4); w.b(I32_SUB); lset(w, L_TMP);
  w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
  lget(w, ptrL); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
  lget(w, cntL); iconst(w, maxCnt - 3); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
  emitUnrolled4xBody(w, lo, span, ptrL);
  w.b(BR_IF); w.u(1);
  lget(w, ptrL); iconst(w, 4); w.b(I32_ADD); lset(w, ptrL);
  lget(w, cntL); iconst(w, 4); w.b(I32_ADD); lset(w, cntL);
  w.b(BR); w.u(0); w.b(END); w.b(END);
  return true;
}

function emitInlineLoopCheck(w: E, e: E, bs: Uint32Array, ptrL: number, tmpL: number): void {
  const ranges = bsToRangesShort(bs);
  if (ranges) {
    lget(w, ptrL); w.b(I32_LOAD8_U); w.u(0); w.u(0);
    if (ranges.length === 1) {
      const [lo, hi] = ranges[0];
      if (lo === hi) { iconst(w, lo); w.b(I32_NE); }
      else { iconst(w, lo); w.b(I32_SUB); iconst(w, hi - lo); w.b(I32_GT_U); }
    } else {
      lset(w, tmpL);
      emitRangeCheck(w, ranges, tmpL);
      iconst(w, 0); w.b(I32_EQ);
    }
  } else {
    lget(w, ptrL); w.b(I32_LOAD8_U); w.u(0); w.u(0); lset(w, tmpL); bsCheck(w, e, bs, tmpL);
    iconst(w, 0); w.b(I32_EQ);
  }
}

function fail(w: E, fd: number | null) {
  iconst(w, -1); lset(w, L_POS);
  if (fd !== null) { w.b(BR); w.u(fd); } else { iconst(w, -1); w.b(RETURN); }
}

function failGuard(w: E, fd: number) {
  lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(fd);
}

function boundsCheck(w: E, posL: number, fd: number | null) {
  lget(w, posL); lget(w, L_LEN); w.b(I32_GE_S);
  w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
}

function failIfNeg(w: E, fd: number | null) {
  lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S);
  w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
}

function emitOp(w: E, e: E, op: CompiledOp, rules: CompiledOp[], rfi: Map<number, number>, cp: CompiledProgram, fd: number | null): void {
  switch (op.op) {
    case Op.BYTE: {
      if (fd !== null) {
        w.b(BLOCK); w.b(VOID);
        boundsCheck(w, L_POS, fd + 1);
        load8(w, L_POS); iconst(w, op.byte!); w.b(I32_NE); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        w.b(END);
      } else {
        boundsCheck(w, L_POS, fd);
        load8(w, L_POS); iconst(w, op.byte!); w.b(I32_NE); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      }
      break;
    }
    case Op.BYTE_RANGE: {
      if (fd !== null) {
        w.b(BLOCK); w.b(VOID);
        boundsCheck(w, L_POS, fd + 1);
        load8(w, L_POS); ltee(w, L_TMP);
        iconst(w, op.low!); w.b(I32_LT_U); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END);
        lget(w, L_TMP); iconst(w, op.high!); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        w.b(END);
      } else {
        boundsCheck(w, L_POS, fd);
        load8(w, L_POS); ltee(w, L_TMP);
        iconst(w, op.low!); w.b(I32_LT_U); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        lget(w, L_TMP); iconst(w, op.high!); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      }
      break;
    }
    case Op.BITSET:
    case Op.NOT_BITSET: {
      const bs = opToBitset(op)!;
      if (fd !== null) {
        w.b(BLOCK); w.b(VOID);
        boundsCheck(w, L_POS, fd + 1);
        load8(w, L_POS); lset(w, L_TMP);
        bsCheck(w, e, bs, L_TMP);
        if (op.op === Op.NOT_BITSET) { w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END); }
        else { iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END); }
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        w.b(END);
      } else {
        boundsCheck(w, L_POS, fd);
        load8(w, L_POS); lset(w, L_TMP);
        bsCheck(w, e, bs, L_TMP);
        if (op.op === Op.NOT_BITSET) { w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
        else { iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      }
      break;
    }
    case Op.TEXT:
    case Op.FAST_SEQ_BYTES: {
      const tb = op.textBytes!;
      if (fd !== null) {
        w.b(BLOCK); w.b(VOID);
        const tfd = fd + 1;
        lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S);
        w.b(IF); w.b(VOID); fail(w, tfd); w.b(END);
        emitLiteralCheck(w, tb, L_POS, tfd);
        lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lset(w, L_POS);
        w.b(END);
      } else {
        lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S);
        w.b(IF); w.b(VOID); fail(w, null); w.b(END);
        emitLiteralCheck(w, tb, L_POS, null);
        lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lset(w, L_POS);
      }
      break;
    }
    case Op.CHAR_CLASS_LETTER: case Op.CHAR_CLASS_DIGIT: case Op.CHAR_CLASS_PRINTABLE:
    case Op.CHAR_CLASS_VISIBLE: case Op.CHAR_CLASS_WHITESPACE: case Op.CHAR_CLASS_ALPHANUM:
    case Op.CHAR_CLASS_WORD: case Op.CHAR_CLASS_UPPER: case Op.CHAR_CLASS_LOWER:
    case Op.CHAR_CLASS_HEX: case Op.CHAR_CLASS_ANY: {
      if (op.op === Op.CHAR_CLASS_ANY) {
        boundsCheck(w, L_POS, fd);
        load8(w, L_POS); ltee(w, L_TMP);
        iconst(w, 0x80); w.b(I32_LT_U);
        w.b(IF); w.b(VOID);
          lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        w.b(ELSE);
          lget(w, L_TMP); iconst(w, 0xE0); w.b(I32_LT_U);
          w.b(IF); w.b(VOID); lget(w, L_POS); iconst(w, 2); w.b(I32_ADD); lset(w, L_POS);
          w.b(ELSE); lget(w, L_TMP); iconst(w, 0xF0); w.b(I32_LT_U);
            w.b(IF); w.b(VOID); lget(w, L_POS); iconst(w, 3); w.b(I32_ADD); lset(w, L_POS);
            w.b(ELSE); lget(w, L_POS); iconst(w, 4); w.b(I32_ADD); lset(w, L_POS);
            w.b(END);
          w.b(END);
        w.b(END);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      } else {
        const bs = opToBitset(op)!;
        if (fd !== null) {
          w.b(BLOCK); w.b(VOID);
          boundsCheck(w, L_POS, fd + 1);
          load8(w, L_POS); lset(w, L_TMP);
          bsCheck(w, e, bs, L_TMP);
          iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END);
          lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
          w.b(END);
        } else {
          boundsCheck(w, L_POS, fd);
          load8(w, L_POS); lset(w, L_TMP);
          bsCheck(w, e, bs, L_TMP);
          iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
          lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        }
      }
      break;
    }
    case Op.FAST_REPEAT_BITSET: {
      const bs = op.bitset!; const min = op.min!;
      lget(w, L_POS); lset(w, L_SAV);
      lget(w, L_PTR); lget(w, L_LEN); w.b(I32_ADD); lset(w, L_CNT);
      lget(w, L_PTR); lget(w, L_POS); w.b(I32_ADD); lset(w, L_TMP2);
      if (e.simd) {
        lget(w, L_CNT); iconst(w, 16); w.b(I32_SUB); lset(w, L_TMP);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_TMP2); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); simdOp(w, V128_LOAD); w.u(2); w.u(0);
        emitSimdBsCheck16(w, bs);
        simdOp(w, I8X16_ALL_TRUE); iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); iconst(w, 16); w.b(I32_ADD); lset(w, L_TMP2);
        w.b(BR); w.u(0); w.b(END); w.b(END);
      }
      emitUnrolled4x(w, bs, L_TMP2, L_CNT);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_TMP2); lget(w, L_CNT); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      emitInlineLoopCheck(w, e, bs, L_TMP2, L_TMP);
      w.b(BR_IF); w.u(1);
      lget(w, L_TMP2); iconst(w, 1); w.b(I32_ADD); lset(w, L_TMP2);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      lget(w, L_TMP2); lget(w, L_PTR); w.b(I32_SUB); lset(w, L_POS);
      if (min > 0) { lget(w, L_POS); lget(w, L_SAV); w.b(I32_SUB); iconst(w, min); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case Op.FAST_EXACTLY_BITSET: {
      const bs = op.bitset!; const n = op.min!;
      if (fd !== null) {
        w.b(BLOCK); w.b(VOID);
        lget(w, L_POS); iconst(w, n); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END);
        for (let i = 0; i < n; i++) {
          load8off(w, L_POS, i); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
          iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd + 1); w.b(END);
        }
        lget(w, L_POS); iconst(w, n); w.b(I32_ADD); lset(w, L_POS);
        w.b(END);
      } else {
        lget(w, L_POS); iconst(w, n); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        for (let i = 0; i < n; i++) {
          load8off(w, L_POS, i); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
          iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        }
        lget(w, L_POS); iconst(w, n); w.b(I32_ADD); lset(w, L_POS);
      }
      break;
    }
    case Op.FAST_BETWEEN_BITSET: {
      const bs = op.bitset!; const lo = op.min!; const hi = op.max!;
      iconst(w, 0); lset(w, L_CNT);
      lget(w, L_PTR); lget(w, L_LEN); w.b(I32_ADD); lset(w, L_SAV);
      lget(w, L_PTR); lget(w, L_POS); w.b(I32_ADD); lset(w, L_TMP2);
      if (e.simd && hi >= 16) {
        lget(w, L_SAV); iconst(w, 16); w.b(I32_SUB); lset(w, L_TMP);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_TMP2); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
        lget(w, L_CNT); iconst(w, hi - 15); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); simdOp(w, V128_LOAD); w.u(2); w.u(0);
        emitSimdBsCheck16(w, bs);
        simdOp(w, I8X16_ALL_TRUE); iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); iconst(w, 16); w.b(I32_ADD); lset(w, L_TMP2);
        lget(w, L_CNT); iconst(w, 16); w.b(I32_ADD); lset(w, L_CNT);
        w.b(BR); w.u(0); w.b(END); w.b(END);
      }
      emitUnrolled4xCounted(w, bs, L_TMP2, L_SAV, L_CNT, hi);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_TMP2); lget(w, L_SAV); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      lget(w, L_CNT); iconst(w, hi); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      emitInlineLoopCheck(w, e, bs, L_TMP2, L_TMP);
      w.b(BR_IF); w.u(1);
      lget(w, L_TMP2); iconst(w, 1); w.b(I32_ADD); lset(w, L_TMP2);
      lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      lget(w, L_TMP2); lget(w, L_PTR); w.b(I32_SUB); lset(w, L_POS);
      if (lo > 0) { lget(w, L_CNT); iconst(w, lo); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case Op.FAST_JOINED_BITSET_BYTE: {
      const bs = op.bitset!; const sep = op.byte!;
      boundsCheck(w, L_POS, fd);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_NE);
      w.b(IF); w.b(VOID);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS); w.b(BR); w.u(1);
      w.b(END);
      lget(w, L_TMP); iconst(w, sep); w.b(I32_NE); w.b(BR_IF); w.u(1);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      load8off(w, L_POS, 1); lset(w, L_TMP2); bsCheck(w, e, bs, L_TMP2);
      iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
      lget(w, L_POS); iconst(w, 2); w.b(I32_ADD); lset(w, L_POS);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      break;
    }
    case Op.FAST_SEQ2: {
      emitOp(w, e, op.child!, rules, rfi, cp, fd);
      emitOp(w, e, op.child2!, rules, rfi, cp, fd);
      break;
    }
    case Op.FAST_SEQ3: {
      emitOp(w, e, op.child!, rules, rfi, cp, fd);
      emitOp(w, e, op.child2!, rules, rfi, cp, fd);
      emitOp(w, e, op.child3!, rules, rfi, cp, fd);
      break;
    }
    case Op.SEQ: { for (const ch of op.children!) emitOp(w, e, ch, rules, rfi, cp, fd); break; }
    case Op.ALT: {
      const alts = op.children!;
      let allText = true;
      for (const a of alts) { if (a.op !== Op.TEXT && a.op !== Op.FAST_SEQ_BYTES) { allText = false; break; } }
      if (allText && alts.length >= 2) {
        w.b(BLOCK); w.b(VOID);
        for (let i = 0; i < alts.length; i++) {
          const tb = alts[i].textBytes!;
          w.b(BLOCK); w.b(VOID);
          lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(BR_IF); w.u(0);
          emitLiteralCheck(w, tb, L_POS, 0);
          lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lset(w, L_POS);
          w.b(BR); w.u(1);
          w.b(END);
        }
        fail(w, fd);
        w.b(END);
      } else {
        w.b(BLOCK); w.b(VOID);
        for (let i = 0; i < alts.length; i++) {
          if (i < alts.length - 1) {
            lget(w, L_POS); lset(w, L_SAV);
            w.b(BLOCK); w.b(VOID);
            emitOp(w, e, alts[i], rules, rfi, cp, 0);
            failGuard(w, 0);
            w.b(BR); w.u(1);
            w.b(END);
            lget(w, L_SAV); lset(w, L_POS);
          } else {
            emitOp(w, e, alts[i], rules, rfi, cp, fd);
          }
        }
        w.b(END);
      }
      break;
    }
    case Op.FAST_ALT_BYTE_FIRST: {
      const bs = op.bitset!;
      w.b(BLOCK); w.b(VOID);
      w.b(BLOCK); w.b(VOID);
      lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(0);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(0);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      w.b(BR); w.u(1);
      w.b(END);
      const bfFd = fd !== null ? fd + 1 : fd;
      emitOp(w, e, op.child!, rules, rfi, cp, bfFd);
      w.b(END);
      break;
    }
    case Op.FAST_ALT_LEAD_DISPATCH: {
      const bs = op.bitset!;
      boundsCheck(w, L_POS, fd);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_NE);
      w.b(IF); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, fd);
      w.b(ELSE);
      emitOp(w, e, op.child2!, rules, rfi, cp, fd);
      w.b(END);
      break;
    }
    case Op.REP_ONE_OR_MORE:
    case Op.REP_ZERO_OR_MORE: {
      const min = op.op === Op.REP_ONE_OR_MORE ? 1 : 0;
      iconst(w, 0); lset(w, L_CNT);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, 0);
      lget(w, L_POS); lget(w, L_SAV); w.b(I32_EQ); w.b(BR_IF); w.u(0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
      lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
      w.b(BR); w.u(1);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      w.b(END); w.b(END);
      if (min > 0) { lget(w, L_CNT); iconst(w, min); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case Op.REP_OPTIONAL: {
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S); w.b(BR_IF); w.u(0);
      lget(w, L_SAV); lset(w, L_POS);
      w.b(END);
      break;
    }
    case Op.REP_EXACTLY: {
      const n = op.min!;
      for (let i = 0; i < n; i++) emitOp(w, e, op.child!, rules, rfi, cp, fd);
      break;
    }
    case Op.REP_BETWEEN: {
      const lo = op.min!; const hi = op.max!;
      for (let i = 0; i < lo; i++) emitOp(w, e, op.child!, rules, rfi, cp, fd);
      if (hi > lo) {
        iconst(w, lo); lset(w, L_CNT);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_CNT); iconst(w, hi); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        lget(w, L_POS); lset(w, L_SAV);
        w.b(BLOCK); w.b(VOID);
        emitOp(w, e, op.child!, rules, rfi, cp, 0);
        lget(w, L_POS); lget(w, L_SAV); w.b(I32_EQ); w.b(BR_IF); w.u(0);
        lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
        lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
        w.b(BR); w.u(1);
        w.b(END);
        lget(w, L_SAV); lset(w, L_POS);
        w.b(END); w.b(END);
      }
      break;
    }
    case Op.JOINED_BY:
    case Op.JOINED_BY_LENIENT: {
      emitOp(w, e, op.child!, rules, rfi, cp, fd);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.separator!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
      lget(w, L_POS); lset(w, L_TMP2);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
      lget(w, L_POS); lget(w, L_TMP2); w.b(I32_EQ); w.b(BR_IF); w.u(0);
      w.b(BR); w.u(2);
      w.b(END);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      w.b(END); w.b(END);
      break;
    }
    case Op.FAST_JOINED_BYTE: {
      const sep = op.byte!;
      const jbChild = op.child!;
      if (jbChild.op === Op.FAST_REPEAT_BITSET) {
        const jbBs = jbChild.bitset!; const jbMin = jbChild.min!;
        lget(w, L_POS); lset(w, L_SAV);
        lget(w, L_PTR); lget(w, L_LEN); w.b(I32_ADD); lset(w, L_CNT);
        lget(w, L_PTR); lget(w, L_POS); w.b(I32_ADD); lset(w, L_TMP2);
        if (e.simd) {
          lget(w, L_CNT); iconst(w, 16); w.b(I32_SUB); lset(w, L_TMP);
          w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
          lget(w, L_TMP2); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
          lget(w, L_TMP2); simdOp(w, V128_LOAD); w.u(2); w.u(0);
          emitSimdBsCheck16(w, jbBs);
          simdOp(w, I8X16_ALL_TRUE); iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
          lget(w, L_TMP2); iconst(w, 16); w.b(I32_ADD); lset(w, L_TMP2);
          w.b(BR); w.u(0); w.b(END); w.b(END);
        }
        emitUnrolled4x(w, jbBs, L_TMP2, L_CNT);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_TMP2); lget(w, L_CNT); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        emitInlineLoopCheck(w, e, jbBs, L_TMP2, L_TMP);
        w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); iconst(w, 1); w.b(I32_ADD); lset(w, L_TMP2);
        w.b(BR); w.u(0); w.b(END); w.b(END);
        lget(w, L_TMP2); lget(w, L_PTR); w.b(I32_SUB); lset(w, L_POS);
        if (jbMin > 0) { lget(w, L_POS); lget(w, L_SAV); w.b(I32_SUB); iconst(w, jbMin); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        load8(w, L_POS); iconst(w, sep); w.b(I32_NE); w.b(BR_IF); w.u(1);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        lget(w, L_POS); lset(w, L_SAV);
        lget(w, L_PTR); lget(w, L_POS); w.b(I32_ADD); lset(w, L_TMP2);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_TMP2); lget(w, L_CNT); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        emitInlineLoopCheck(w, e, jbBs, L_TMP2, L_TMP);
        w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); iconst(w, 1); w.b(I32_ADD); lset(w, L_TMP2);
        w.b(BR); w.u(0); w.b(END); w.b(END);
        lget(w, L_TMP2); lget(w, L_PTR); w.b(I32_SUB); lset(w, L_POS);
        lget(w, L_POS); lget(w, L_SAV); w.b(I32_SUB); iconst(w, jbMin); w.b(I32_LT_S);
        w.b(IF); w.b(VOID);
          lget(w, L_SAV); iconst(w, 1); w.b(I32_SUB); lset(w, L_POS);
          w.b(BR); w.u(2);
        w.b(END);
        w.b(BR); w.u(0);
        w.b(END); w.b(END);
      } else if (jbChild.op === Op.FAST_EXACTLY_BITSET) {
        const jbBs = jbChild.bitset!; const jbN = jbChild.min!;
        lget(w, L_POS); iconst(w, jbN); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S);
        w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        for (let i = 0; i < jbN; i++) {
          load8off(w, L_POS, i); lset(w, L_TMP); bsCheck(w, e, jbBs, L_TMP);
          iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        }
        lget(w, L_POS); iconst(w, jbN); w.b(I32_ADD); lset(w, L_POS);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        load8(w, L_POS); iconst(w, sep); w.b(I32_NE); w.b(BR_IF); w.u(1);
        lget(w, L_POS); iconst(w, 1 + jbN); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
        w.b(BLOCK); w.b(VOID);
        for (let i = 0; i < jbN; i++) {
          load8off(w, L_POS, 1 + i); lset(w, L_TMP); bsCheck(w, e, jbBs, L_TMP);
          iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(0);
        }
        lget(w, L_POS); iconst(w, 1 + jbN); w.b(I32_ADD); lset(w, L_POS);
        w.b(BR); w.u(1);
        w.b(END);
        w.b(END); w.b(END);
      } else if (jbChild.op === Op.FAST_BETWEEN_BITSET) {
        const jbBs = jbChild.bitset!; const jbLo = jbChild.min!; const jbHi = jbChild.max!;
        iconst(w, 0); lset(w, L_CNT);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        lget(w, L_CNT); iconst(w, jbHi); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, jbBs, L_TMP);
        iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
        w.b(BR); w.u(0); w.b(END); w.b(END);
        lget(w, L_CNT); iconst(w, jbLo); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        load8(w, L_POS); iconst(w, sep); w.b(I32_NE); w.b(BR_IF); w.u(1);
        lget(w, L_POS); lset(w, L_SAV);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        iconst(w, 0); lset(w, L_CNT);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        lget(w, L_CNT); iconst(w, jbHi); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, jbBs, L_TMP);
        iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
        w.b(BR); w.u(0); w.b(END); w.b(END);
        lget(w, L_CNT); iconst(w, jbLo); w.b(I32_LT_S);
        w.b(IF); w.b(VOID);
          lget(w, L_SAV); lset(w, L_POS);
          w.b(BR); w.u(2);
        w.b(END);
        w.b(BR); w.u(0);
        w.b(END); w.b(END);
      } else {
        emitOp(w, e, jbChild, rules, rfi, cp, fd);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        load8(w, L_POS); iconst(w, sep); w.b(I32_NE); w.b(BR_IF); w.u(1);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        lget(w, L_POS); lset(w, L_SAV);
        w.b(BLOCK); w.b(VOID);
        emitOp(w, e, jbChild, rules, rfi, cp, 0);
        lget(w, L_POS); lget(w, L_SAV); w.b(I32_EQ); w.b(BR_IF); w.u(0);
        lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
        w.b(BR); w.u(1);
        w.b(END);
        lget(w, L_SAV); iconst(w, 1); w.b(I32_SUB); lset(w, L_POS);
        w.b(END); w.b(END);
      }
      break;
    }
    case Op.FAST_REP_BITSET_ALT: {
      const bs = op.bitset!; const min = op.min!;
      iconst(w, 0); lset(w, L_CNT);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_NE);
      w.b(IF); w.b(VOID);
        lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
        lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
        w.b(BR); w.u(1);
      w.b(END);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, 0);
      lget(w, L_POS); lget(w, L_SAV); w.b(I32_EQ); w.b(BR_IF); w.u(0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
      lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
      w.b(BR); w.u(2);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      w.b(END); w.b(END);
      if (min > 0) { lget(w, L_CNT); iconst(w, min); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case Op.RULE_REF: {
      const idx = op.ruleIdx!;
      if (idx < 0) { fail(w, fd); break; }
      const fi = rfi.get(idx);
      if (fi !== undefined) {
        lget(w, L_PTR); lget(w, L_LEN); lget(w, L_POS);
        w.b(CALL); w.u(fi);
        lset(w, L_POS);
        lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S);
        w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      } else {
        emitOp(w, e, rules[idx], rules, rfi, cp, fd);
      }
      break;
    }
    case Op.EXTRACT: { emitOp(w, e, op.child!, rules, rfi, cp, fd); break; }
    case Op.EXCEPT: {
      boundsCheck(w, L_POS, fd);
      if (op.bitset) {
        load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, op.bitset, L_TMP);
        iconst(w, 0); w.b(I32_NE); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      } else if (op.children) {
        for (const ch of op.children) {
          lget(w, L_POS); lset(w, L_SAV);
          w.b(BLOCK); w.b(VOID);
          emitOp(w, e, ch, rules, rfi, cp, 0);
          lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S);
          w.b(IF); w.b(VOID); lget(w, L_SAV); lset(w, L_POS); fail(w, fd); w.b(END);
          w.b(END);
          lget(w, L_SAV); lset(w, L_POS);
        }
      }
      emitOp(w, e, op.child!, rules, rfi, cp, fd);
      break;
    }
    case Op.NONE_OF: {
      boundsCheck(w, L_POS, fd);
      if (op.children) {
        for (const ch of op.children) {
          lget(w, L_POS); lset(w, L_SAV);
          w.b(BLOCK); w.b(VOID);
          emitOp(w, e, ch, rules, rfi, cp, 0);
          lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S);
          w.b(IF); w.b(VOID); lget(w, L_SAV); lset(w, L_POS); fail(w, fd); w.b(END);
          w.b(END);
          lget(w, L_SAV); lset(w, L_POS);
        }
      }
      load8(w, L_POS); ltee(w, L_TMP);
      iconst(w, 0x80); w.b(I32_LT_U);
      w.b(IF); w.b(VOID); lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      w.b(ELSE); lget(w, L_TMP); iconst(w, 0xE0); w.b(I32_LT_U);
        w.b(IF); w.b(VOID); lget(w, L_POS); iconst(w, 2); w.b(I32_ADD); lset(w, L_POS);
        w.b(ELSE); lget(w, L_TMP); iconst(w, 0xF0); w.b(I32_LT_U);
          w.b(IF); w.b(VOID); lget(w, L_POS); iconst(w, 3); w.b(I32_ADD); lset(w, L_POS);
          w.b(ELSE); lget(w, L_POS); iconst(w, 4); w.b(I32_ADD); lset(w, L_POS);
          w.b(END); w.b(END); w.b(END);
      break;
    }
    case Op.UNTIL_INCL: {
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.terminator!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S); w.b(BR_IF); w.u(2);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, 0);
      lget(w, L_POS); lget(w, L_SAV); w.b(I32_EQ); w.b(BR_IF); w.u(0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
      w.b(BR); w.u(1);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      fail(w, fd);
      w.b(END); w.b(END);
      break;
    }
    case Op.UNTIL_EXCL: {
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.terminator!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S);
      w.b(IF); w.b(VOID); lget(w, L_SAV); lset(w, L_POS); w.b(BR); w.u(3); w.b(END);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.child!, rules, rfi, cp, 0);
      lget(w, L_POS); lget(w, L_SAV); w.b(I32_EQ); w.b(BR_IF); w.u(0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_LT_S); w.b(BR_IF); w.u(0);
      w.b(BR); w.u(1);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      fail(w, fd);
      w.b(END); w.b(END);
      break;
    }
    case Op.ISNT: {
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, op.negated!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S);
      w.b(IF); w.b(VOID); lget(w, L_SAV); lset(w, L_POS); fail(w, fd); w.b(END);
      w.b(END);
      lget(w, L_SAV); lset(w, L_POS);
      emitOp(w, e, op.child!, rules, rfi, cp, fd);
      break;
    }
    case Op.FAST_SEQ_FLAT: {
      if (op.flatSteps) for (const st of op.flatSteps) emitFlat(w, e, st, rules, rfi, cp, fd);
      if (op.flatTail) for (const t of op.flatTail) emitOp(w, e, t, rules, rfi, cp, fd);
      break;
    }
    default: { fail(w, fd); break; }
  }
}

function emitFlat(w: E, e: E, st: FlatStep, rules: CompiledOp[], rfi: Map<number, number>, cp: CompiledProgram, fd: number | null): void {
  switch (st.fop) {
    case FlatOp.F_BYTE: {
      boundsCheck(w, L_POS, fd);
      load8(w, L_POS); iconst(w, st.byte!); w.b(I32_NE); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      break;
    }
    case FlatOp.F_BITSET: {
      boundsCheck(w, L_POS, fd);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, st.bitset!, L_TMP);
      iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      break;
    }
    case FlatOp.F_EXACTLY_BITSET: {
      const n = st.min!;
      lget(w, L_POS); iconst(w, n); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      for (let i = 0; i < n; i++) {
        load8off(w, L_POS, i); lset(w, L_TMP); bsCheck(w, e, st.bitset!, L_TMP);
        iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      }
      lget(w, L_POS); iconst(w, n); w.b(I32_ADD); lset(w, L_POS);
      break;
    }
    case FlatOp.F_SEQ_BYTES: {
      const tb = st.textBytes!;
      lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      emitLiteralCheck(w, tb, L_POS, fd);
      lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lset(w, L_POS);
      break;
    }
    case FlatOp.F_BETWEEN_BITSET: {
      const bs = st.bitset!; const lo = st.min!; const hi = st.max!;
      iconst(w, 0); lset(w, L_CNT);
      lget(w, L_PTR); lget(w, L_POS); w.b(I32_ADD); lset(w, L_TMP2);
      lget(w, L_PTR); lget(w, L_LEN); w.b(I32_ADD); lset(w, L_SAV);
      if (e.simd && hi >= 16) {
        lget(w, L_SAV); iconst(w, 16); w.b(I32_SUB); lset(w, L_TMP);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_TMP2); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
        lget(w, L_CNT); iconst(w, hi - 15); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); simdOp(w, V128_LOAD); w.u(2); w.u(0);
        emitSimdBsCheck16(w, bs);
        simdOp(w, I8X16_ALL_TRUE); iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); iconst(w, 16); w.b(I32_ADD); lset(w, L_TMP2);
        lget(w, L_CNT); iconst(w, 16); w.b(I32_ADD); lset(w, L_CNT);
        w.b(BR); w.u(0); w.b(END); w.b(END);
      }
      emitUnrolled4xCounted(w, bs, L_TMP2, L_SAV, L_CNT, hi);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_TMP2); lget(w, L_SAV); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      lget(w, L_CNT); iconst(w, hi); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      emitInlineLoopCheck(w, e, bs, L_TMP2, L_TMP);
      w.b(BR_IF); w.u(1);
      lget(w, L_TMP2); iconst(w, 1); w.b(I32_ADD); lset(w, L_TMP2);
      lget(w, L_CNT); iconst(w, 1); w.b(I32_ADD); lset(w, L_CNT);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      lget(w, L_TMP2); lget(w, L_PTR); w.b(I32_SUB); lset(w, L_POS);
      if (lo > 0) { lget(w, L_CNT); iconst(w, lo); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case FlatOp.F_REPEAT_BITSET: {
      const bs = st.bitset!; const min = st.min!;
      lget(w, L_POS); lset(w, L_SAV);
      lget(w, L_PTR); lget(w, L_LEN); w.b(I32_ADD); lset(w, L_CNT);
      lget(w, L_PTR); lget(w, L_POS); w.b(I32_ADD); lset(w, L_TMP2);
      if (e.simd) {
        lget(w, L_CNT); iconst(w, 16); w.b(I32_SUB); lset(w, L_TMP);
        w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
        lget(w, L_TMP2); lget(w, L_TMP); w.b(I32_GT_S); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); simdOp(w, V128_LOAD); w.u(2); w.u(0);
        emitSimdBsCheck16(w, bs);
        simdOp(w, I8X16_ALL_TRUE); iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
        lget(w, L_TMP2); iconst(w, 16); w.b(I32_ADD); lset(w, L_TMP2);
        w.b(BR); w.u(0); w.b(END); w.b(END);
      }
      emitUnrolled4x(w, bs, L_TMP2, L_CNT);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_TMP2); lget(w, L_CNT); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      emitInlineLoopCheck(w, e, bs, L_TMP2, L_TMP);
      w.b(BR_IF); w.u(1);
      lget(w, L_TMP2); iconst(w, 1); w.b(I32_ADD); lset(w, L_TMP2);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      lget(w, L_TMP2); lget(w, L_PTR); w.b(I32_SUB); lset(w, L_POS);
      if (min > 0) { lget(w, L_POS); lget(w, L_SAV); w.b(I32_SUB); iconst(w, min); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case FlatOp.F_REP_OPTIONAL: {
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID);
      emitOp(w, e, st.child!, rules, rfi, cp, 0);
      lget(w, L_POS); iconst(w, 0); w.b(I32_GE_S); w.b(BR_IF); w.u(0);
      lget(w, L_SAV); lset(w, L_POS);
      w.b(END);
      break;
    }
    case FlatOp.F_EXEC: { emitOp(w, e, st.child!, rules, rfi, cp, fd); break; }
    case FlatOp.F_JOINED_BITSET_BYTE: {
      const bs = st.bitset!; const sep = st.separator!;
      boundsCheck(w, L_POS, fd);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_EQ); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_NE);
      w.b(IF); w.b(VOID); lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS); w.b(BR); w.u(1); w.b(END);
      lget(w, L_TMP); iconst(w, sep); w.b(I32_NE); w.b(BR_IF); w.u(1);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      load8off(w, L_POS, 1); lset(w, L_TMP2); bsCheck(w, e, bs, L_TMP2);
      iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
      lget(w, L_POS); iconst(w, 2); w.b(I32_ADD); lset(w, L_POS);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      break;
    }
    case FlatOp.F_JOINED_BYTE: {
      if (st.child) {
        const fake: CompiledOp = { op: Op.FAST_JOINED_BYTE, child: st.child, byte: st.separator };
        emitOp(w, e, fake, rules, rfi, cp, fd);
      }
      break;
    }
    case FlatOp.F_LITERAL_REPEAT_BS: {
      const tb = st.textBytes!; const bs = st.bitset!; const min = st.min!;
      lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lget(w, L_LEN); w.b(I32_GT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END);
      emitLiteralCheck(w, tb, L_POS, fd);
      lget(w, L_POS); iconst(w, tb.length); w.b(I32_ADD); lset(w, L_POS);
      lget(w, L_POS); lset(w, L_SAV);
      w.b(BLOCK); w.b(VOID); w.b(LOOP); w.b(VOID);
      lget(w, L_POS); lget(w, L_LEN); w.b(I32_GE_S); w.b(BR_IF); w.u(1);
      load8(w, L_POS); lset(w, L_TMP); bsCheck(w, e, bs, L_TMP);
      iconst(w, 0); w.b(I32_EQ); w.b(BR_IF); w.u(1);
      lget(w, L_POS); iconst(w, 1); w.b(I32_ADD); lset(w, L_POS);
      w.b(BR); w.u(0); w.b(END); w.b(END);
      if (min > 0) { lget(w, L_POS); lget(w, L_SAV); w.b(I32_SUB); iconst(w, min); w.b(I32_LT_S); w.b(IF); w.b(VOID); fail(w, fd); w.b(END); }
      break;
    }
    case FlatOp.F_MULTI_LITERAL_REPEAT_BS: {
      if (st.segments) for (const seg of st.segments) {
        emitFlat(w, e, { fop: FlatOp.F_LITERAL_REPEAT_BS, textBytes: new Uint8Array(seg.textBytes), bitset: seg.bitset, min: seg.min }, rules, rfi, cp, fd);
      }
      break;
    }
  }
}

function uleb(v: number): number[] { const o: number[] = []; do { let b = v & 0x7F; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; }
function sleb(v: number): number[] { const o: number[] = []; let m = true; while (m) { let b = v & 0x7F; v >>= 7; if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) m = false; else b |= 0x80; o.push(b); } return o; }
function sec(id: number, c: number[]): number[] { return [id, ...uleb(c.length), ...c]; }

const S_PTR = 0;
const S_LEN = 1;
const S_OUT = 2;
const S_POS = 3;
const S_CNT = 4;
const S_RES = 5;
const S_TMP = 6;
const S_VEC = 7;

interface SecondaryAnchor {
  byte: number;
  minOff: number;
  maxOff: number;
}

interface SepAnchorPattern {
  sepByte: number;
  segCount: number;
  segments: { bitset: Uint32Array; min: number; max: number }[];
}

function detectSepAnchorPattern(op: CompiledOp, cp: CompiledProgram): SepAnchorPattern | null {
  let root = op;
  if (root.op === Op.RULE_REF && root.ruleIdx !== undefined && root.ruleIdx >= 0 && root.ruleIdx < cp.rules.length) {
    root = cp.rules[root.ruleIdx];
  }
  if (root.op !== Op.FAST_SEQ_FLAT || !root.flatSteps || root.flatSteps.length < 3) return null;
  const steps = root.flatSteps;
  if (steps.length % 2 !== 1) return null;
  const segCount = (steps.length + 1) / 2;
  if (segCount < 2 || segCount > 8) return null;
  let sepByte: number | undefined;
  const segments: { bitset: Uint32Array; min: number; max: number }[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (i % 2 === 0) {
      const s = steps[i];
      if (s.fop === FlatOp.F_BETWEEN_BITSET && s.bitset && s.min !== undefined && s.max !== undefined) {
        segments.push({ bitset: s.bitset, min: s.min, max: s.max });
      } else if (s.fop === FlatOp.F_REPEAT_BITSET && s.bitset) {
        segments.push({ bitset: s.bitset, min: s.min ?? 1, max: s.max ?? 255 });
      } else if (s.fop === FlatOp.F_EXACTLY_BITSET && s.bitset && s.min !== undefined) {
        segments.push({ bitset: s.bitset, min: s.min, max: s.min });
      } else {
        return null;
      }
    } else {
      const s = steps[i];
      if (s.fop !== FlatOp.F_BYTE || s.byte === undefined) return null;
      if (sepByte === undefined) sepByte = s.byte;
      else if (s.byte !== sepByte) return null;
    }
  }
  if (sepByte === undefined) return null;
  const maxTotalLen = segments.reduce((a, s) => a + s.max, 0) + segCount - 1;
  if (maxTotalLen > 64) return null;
  return { sepByte, segCount, segments };
}

function emitSepAnchorScanBody(
  e: E, pat: SepAnchorPattern,
): number[] {
  const sw = new E();
  sw.simd = e.simd;

  const S_VPOS = 7;
  sw.u(1); sw.u(5); sw.b(I32);

  iconst(sw, 0); lset(sw, S_POS);
  iconst(sw, 0); lset(sw, S_CNT);

  // block $exit
  //   loop $main
  //     ... find sep byte (SIMD or scalar) → S_POS points at sep byte
  //     ... quick-reject: byte before sep must be in seg0 bitset
  //     block $fail           ← br 0 = reject, advance pos+1, continue main
  //       ... inline verify all segments
  //       ... on success: store result, advance past match, br $main
  //     end $fail
  //     pos++; br $main
  //   end $main
  // end $exit

  const seg0 = pat.segments[0];
  const bs0ranges = bsToRanges(seg0.bitset);
  if (!bs0ranges || bs0ranges.length !== 1) {
    sw.b(BLOCK); sw.b(VOID); sw.b(LOOP); sw.b(VOID);
    lget(sw, S_POS); lget(sw, S_LEN); sw.b(I32_GE_S); sw.b(BR_IF); sw.u(1);
    lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(BR); sw.u(0);
    sw.b(END); sw.b(END);
    lget(sw, S_CNT); sw.b(END);
    return sw.buf;
  }
  const [lo, hi] = bs0ranges[0];

  // S_TMP = current bitmask (0 = need new SIMD load)
  iconst(sw, 0); lset(sw, S_TMP);

  // block $exit
  //   loop $outer — SIMD chunk scan
  //     loop $inner — process bits in current bitmask
  //       ... verify one period position
  //       ... clear bit, continue $inner if more bits
  //     end $inner
  //     advance to next 16B chunk, br $outer
  //   end $outer
  // end $exit

  sw.b(BLOCK); sw.b(VOID); // $exit
  sw.b(LOOP); sw.b(VOID);  // $outer

  lget(sw, S_POS); lget(sw, S_LEN); sw.b(I32_GE_S);
  sw.b(BR_IF); sw.u(1); // br $exit

  if (e.simd) {
    lget(sw, S_POS); iconst(sw, 16); sw.b(I32_ADD); lget(sw, S_LEN); sw.b(I32_GT_S);
    sw.b(IF); sw.b(VOID);
    // Tail: use scalar approach — set S_TMP = 0 to flag scalar mode
    iconst(sw, 0); lset(sw, S_TMP);
    sw.b(ELSE);
    // SIMD: load 16 bytes, check for separator
    lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
    simdOp(sw, V128_LOAD); sw.u(2); sw.u(0);
    v128const(sw, new Array(16).fill(pat.sepByte));
    simdOp(sw, I8X16_EQ);
    simdOp(sw, I8X16_BITMASK);
    lset(sw, S_TMP);
    lget(sw, S_TMP); iconst(sw, 0); sw.b(I32_EQ);
    sw.b(IF); sw.b(VOID);
    lget(sw, S_POS); iconst(sw, 16); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(BR); sw.u(2); // br $outer
    sw.b(END);
    sw.b(END);

    lget(sw, S_TMP); iconst(sw, 0); sw.b(I32_EQ);
    sw.b(IF); sw.b(VOID);
    // Scalar tail: find next period byte by byte
    sw.b(BLOCK); sw.b(VOID);
    sw.b(LOOP); sw.b(VOID);
    lget(sw, S_POS); lget(sw, S_LEN); sw.b(I32_GE_S); sw.b(BR_IF); sw.u(1);
    lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
    sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
    iconst(sw, pat.sepByte); sw.b(I32_EQ);
    sw.b(IF); sw.b(VOID);
    iconst(sw, 1); lset(sw, S_TMP);
    sw.b(BR); sw.u(2);
    sw.b(END);
    lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(BR); sw.u(0);
    sw.b(END); sw.b(END);
    // If we exit without finding a period, exit
    lget(sw, S_TMP); iconst(sw, 0); sw.b(I32_EQ);
    sw.b(BR_IF); sw.u(2); // br $exit
    sw.b(END);
  } else {
    // Scalar: find next separator
    sw.b(BLOCK); sw.b(VOID);
    sw.b(LOOP); sw.b(VOID);
    lget(sw, S_POS); lget(sw, S_LEN); sw.b(I32_GE_S); sw.b(BR_IF); sw.u(3);
    lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
    sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
    iconst(sw, pat.sepByte); sw.b(I32_EQ);
    sw.b(IF); sw.b(VOID);
    iconst(sw, 1); lset(sw, S_TMP);
    sw.b(BR); sw.u(2);
    sw.b(END);
    lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(BR); sw.u(0);
    sw.b(END); sw.b(END);
  }

  // S_TMP = bitmask with period bits (SIMD) or 1 (scalar, at period pos)
  // S_POS = chunk start (SIMD) or period position (scalar)
  // Now process period positions from bitmask

  sw.b(LOOP); sw.b(VOID); // $inner — process bits

  if (e.simd) {
    // Extract first set bit position
    lget(sw, S_POS); lget(sw, S_TMP); sw.b(I32_CTZ); sw.b(I32_ADD);
    lset(sw, S_VPOS); // S_VPOS = absolute period position
  } else {
    lget(sw, S_POS); lset(sw, S_VPOS);
  }

  // S_VPOS = period position. Verify candidate.
  sw.b(BLOCK); sw.b(VOID); // $fail — br 0 = reject this candidate

  // Quick check: pos > 0 and byte at pos-1 is a digit
  lget(sw, S_VPOS); iconst(sw, 0); sw.b(I32_EQ);
  sw.b(BR_IF); sw.u(0);
  lget(sw, S_PTR); lget(sw, S_VPOS); sw.b(I32_ADD); iconst(sw, 1); sw.b(I32_SUB);
  sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
  iconst(sw, lo); sw.b(I32_SUB); iconst(sw, hi - lo); sw.b(I32_GT_U);
  sw.b(BR_IF); sw.u(0);

  // block $fail — any br 0 inside this block = reject candidate
  sw.b(BLOCK); sw.b(VOID);
  // depth from here: br 0 = $fail, br 1 = $main(loop), br 2 = $exit

  // Find start of first segment by unrolled backward check
  // We know byte at pos-1 is a digit. Check pos-2, pos-3 etc.
  // seg0.max is small (typically 3), so fully unroll.
  lget(sw, S_VPOS); lset(sw, S_RES); // S_RES = tentative start (will walk backward)

  // We already checked vpos-1 is a digit. Count = 1.
  lget(sw, S_RES); iconst(sw, 1); sw.b(I32_SUB); lset(sw, S_RES); // start = vpos-1

  // Check further back (pos-2, pos-3, ...) up to seg0.max
  for (let d = 1; d < seg0.max; d++) {
    lget(sw, S_RES); iconst(sw, 0); sw.b(I32_EQ);
    sw.b(IF); sw.b(VOID); sw.b(ELSE);
    lget(sw, S_PTR); lget(sw, S_RES); sw.b(I32_ADD); iconst(sw, 1); sw.b(I32_SUB);
    sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
    iconst(sw, lo); sw.b(I32_SUB); iconst(sw, hi - lo); sw.b(I32_LE_U);
    sw.b(IF); sw.b(VOID);
    lget(sw, S_RES); iconst(sw, 1); sw.b(I32_SUB); lset(sw, S_RES);
    sw.b(END);
    sw.b(END);
  }

  // Check first segment length: len = vpos - start
  lget(sw, S_VPOS); lget(sw, S_RES); sw.b(I32_SUB); lset(sw, S_TMP);
  lget(sw, S_TMP); iconst(sw, seg0.min); sw.b(I32_LT_S);
  sw.b(BR_IF); sw.u(0); // br $fail

  // S_RES = match start, advance VPOS past first separator
  lget(sw, S_VPOS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_VPOS);

  // Verify remaining segments (seg 1 .. segCount-1)
  for (let seg = 1; seg < pat.segCount; seg++) {
    const s = pat.segments[seg];
    const sRanges = bsToRanges(s.bitset);
    const [slo, shi] = sRanges && sRanges.length === 1 ? sRanges[0] : [lo, hi];

    // Check at least min digits
    for (let d = 0; d < s.min; d++) {
      lget(sw, S_VPOS); lget(sw, S_LEN); sw.b(I32_GE_S);
      sw.b(BR_IF); sw.u(0); // br $fail
      lget(sw, S_PTR); lget(sw, S_VPOS); sw.b(I32_ADD);
      sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
      iconst(sw, slo); sw.b(I32_SUB); iconst(sw, shi - slo); sw.b(I32_GT_U);
      sw.b(BR_IF); sw.u(0); // br $fail
      lget(sw, S_VPOS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_VPOS);
    }

    // Consume up to max - min more digits
    if (s.max > s.min) {
      for (let d = s.min; d < s.max; d++) {
        lget(sw, S_VPOS); lget(sw, S_LEN); sw.b(I32_GE_S);
        sw.b(IF); sw.b(VOID); sw.b(ELSE);
        lget(sw, S_PTR); lget(sw, S_VPOS); sw.b(I32_ADD);
        sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
        iconst(sw, slo); sw.b(I32_SUB); iconst(sw, shi - slo); sw.b(I32_LE_U);
        sw.b(IF); sw.b(VOID);
        lget(sw, S_VPOS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_VPOS);
        sw.b(END);
        sw.b(END);
      }
    }

    // After the last segment, don't check for separator
    if (seg < pat.segCount - 1) {
      lget(sw, S_VPOS); lget(sw, S_LEN); sw.b(I32_GE_S);
      sw.b(BR_IF); sw.u(0); // br $fail
      lget(sw, S_PTR); lget(sw, S_VPOS); sw.b(I32_ADD);
      sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
      iconst(sw, pat.sepByte); sw.b(I32_NE);
      sw.b(BR_IF); sw.u(0); // br $fail
      lget(sw, S_VPOS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_VPOS);
    }
  }

  // Match succeeded: store [start, end]
  lget(sw, S_OUT); lget(sw, S_CNT); iconst(sw, 3); sw.b(I32_SHL); sw.b(I32_ADD);
  lget(sw, S_RES);
  sw.b(I32_STORE); sw.u(2); sw.u(0);
  lget(sw, S_OUT); lget(sw, S_CNT); iconst(sw, 3); sw.b(I32_SHL); sw.b(I32_ADD);
  lget(sw, S_VPOS);
  sw.b(I32_STORE); sw.u(2); sw.u(4);
  lget(sw, S_CNT); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_CNT);

  // For SIMD: clear ALL bits up to and including match end in the bitmask
  // (match may span past current chunk — simpler to just clear all bits, restart SIMD)
  lget(sw, S_VPOS); lset(sw, S_POS);
  iconst(sw, 0); lset(sw, S_TMP);
  sw.b(BR); sw.u(3); // br $outer — restart scan from new position

  sw.b(END); // end $fail (inner verification block)

  sw.b(END); // end $fail (outer digit check block)

  // Reject: clear current bit from bitmask, process next bit
  if (e.simd) {
    // Clear lowest set bit: tmp = tmp & (tmp - 1)
    lget(sw, S_TMP); lget(sw, S_TMP); iconst(sw, 1); sw.b(I32_SUB); sw.b(I32_AND);
    lset(sw, S_TMP);
    lget(sw, S_TMP); iconst(sw, 0); sw.b(I32_NE);
    sw.b(BR_IF); sw.u(0); // br $inner — more bits to process
  }

  // No more bits: advance to next chunk
  // For scalar (and scalar tail): advance by 1
  // For SIMD with full chunk: advance by 16
  if (e.simd) {
    // If pos + 16 <= len, we processed a full SIMD chunk → advance 16
    // Otherwise (tail), advance by 1
    lget(sw, S_POS); iconst(sw, 16); sw.b(I32_ADD); lget(sw, S_LEN); sw.b(I32_LE_S);
    sw.b(IF); sw.b(VOID);
    lget(sw, S_POS); iconst(sw, 16); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(ELSE);
    lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(END);
  } else {
    lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
  }

  sw.b(END); // end $inner loop
  sw.b(BR); sw.u(0); // br $outer
  sw.b(END); // end $outer loop
  sw.b(END); // end $exit block

  lget(sw, S_CNT);
  sw.b(END); // end function

  return sw.buf;
}

function extractSecondaryAnchor(op: CompiledOp, cp: CompiledProgram): SecondaryAnchor | null {
  if (op.op === Op.FAST_SEQ_FLAT && op.flatSteps && op.flatSteps.length >= 2) {
    const s0 = op.flatSteps[0];
    const s1 = op.flatSteps[1];
    let minOff = 0, maxOff = 0;
    if (s0.fop === FlatOp.F_BETWEEN_BITSET || s0.fop === FlatOp.F_REPEAT_BITSET) {
      minOff = s0.min ?? 1;
      maxOff = s0.max ?? 255;
    } else if (s0.fop === FlatOp.F_EXACTLY_BITSET) {
      minOff = maxOff = s0.min ?? 1;
    } else if (s0.fop === FlatOp.F_BITSET || s0.fop === FlatOp.F_BYTE) {
      minOff = maxOff = 1;
    } else {
      return null;
    }
    if (s1.fop === FlatOp.F_BYTE && s1.byte !== undefined && maxOff <= 16) {
      return { byte: s1.byte, minOff, maxOff };
    }
    if (s1.fop === FlatOp.F_SEQ_BYTES && s1.textBytes && s1.textBytes.length > 0 && maxOff <= 16) {
      return { byte: s1.textBytes[0], minOff, maxOff };
    }
  }
  if (op.op === Op.FAST_SEQ2 || op.op === Op.FAST_SEQ3) {
    const c0 = op.child!;
    const c1 = op.child2!;
    let minOff = 0, maxOff = 0;
    if (c0.op === Op.FAST_BETWEEN_BITSET || c0.op === Op.FAST_REPEAT_BITSET) {
      minOff = c0.min ?? 1;
      maxOff = c0.max ?? 255;
    } else if (c0.op === Op.FAST_EXACTLY_BITSET) {
      minOff = maxOff = c0.min ?? 1;
    } else if (isSingleByteOp(c0)) {
      minOff = maxOff = 1;
    } else {
      return null;
    }
    if (c1.op === Op.BYTE && c1.byte !== undefined && maxOff <= 16) {
      return { byte: c1.byte, minOff, maxOff };
    }
    if (c1.op === Op.TEXT && c1.textBytes && c1.textBytes.length > 0 && maxOff <= 16) {
      return { byte: c1.textBytes[0], minOff, maxOff };
    }
  }
  if (op.op === Op.RULE_REF && op.ruleIdx !== undefined && op.ruleIdx >= 0 && op.ruleIdx < cp.rules.length) {
    return extractSecondaryAnchor(cp.rules[op.ruleIdx], cp);
  }
  return null;
}

function emitScanBody(
  e: E, cp: CompiledProgram, rules: CompiledOp[], ei: number, rfi: Map<number, number>,
): number[] {
  const sepPat = detectSepAnchorPattern(rules[ei], cp);
  // @ts-ignore — disabled for debugging
  if (false && sepPat) return emitSepAnchorScanBody(e, sepPat);

  const sw = new E();
  sw.simd = e.simd;

  const lead = opLeadBitset(rules[ei], cp);
  let leadOff = -1;
  if (lead) leadOff = e.allocBs(lead);
  const anchor = extractSecondaryAnchor(rules[ei], cp);
  const useScanSimd = e.simd && lead !== null;

  if (useScanSimd) {
    sw.u(2); sw.u(4); sw.b(I32); sw.u(1); sw.b(V128);
  } else {
    sw.u(1); sw.u(4); sw.b(I32);
  }

  iconst(sw, 0); lset(sw, S_POS);
  iconst(sw, 0); lset(sw, S_CNT);

  sw.b(BLOCK); sw.b(VOID);
  sw.b(LOOP); sw.b(VOID);

  lget(sw, S_POS); lget(sw, S_LEN); sw.b(I32_GE_S);
  sw.b(BR_IF); sw.u(1);

  if (lead && leadOff >= 0) {
    if (useScanSimd) {
      sw.b(BLOCK); sw.b(VOID);
      sw.b(LOOP); sw.b(VOID);
      lget(sw, S_POS); iconst(sw, 16); sw.b(I32_ADD); lget(sw, S_LEN); sw.b(I32_GT_S);
      sw.b(BR_IF); sw.u(1);
      lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
      simdOp(sw, V128_LOAD); sw.u(2); sw.u(0);
      emitSimdBsCheck16(sw, lead);
      simdOp(sw, I8X16_BITMASK);
      lset(sw, S_TMP);
      lget(sw, S_TMP); iconst(sw, 0); sw.b(I32_EQ);
      sw.b(IF); sw.b(VOID);
      lget(sw, S_POS); iconst(sw, 16); sw.b(I32_ADD); lset(sw, S_POS);
      sw.b(BR); sw.u(1);
      sw.b(END);
      lget(sw, S_POS); lget(sw, S_TMP); sw.b(I32_CTZ); sw.b(I32_ADD); lset(sw, S_POS);
      sw.b(END);
      sw.b(END);

      lget(sw, S_POS); lget(sw, S_LEN); sw.b(I32_GE_S);
      sw.b(BR_IF); sw.u(1);
    } else {
      lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
      sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
      lset(sw, S_RES);

      lget(sw, S_RES); iconst(sw, 5); sw.b(I32_SHR_U); iconst(sw, 2); sw.b(I32_SHL);
      iconst(sw, leadOff); sw.b(I32_ADD);
      sw.b(I32_LOAD); sw.u(2); sw.u(0);
      iconst(sw, 1); lget(sw, S_RES); iconst(sw, 31); sw.b(I32_AND); sw.b(I32_SHL);
      sw.b(I32_AND);

      iconst(sw, 0); sw.b(I32_EQ);
      sw.b(IF); sw.b(VOID);
      lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
      sw.b(BR); sw.u(1);
      sw.b(END);
    }
  }

  if (anchor) {
    iconst(sw, 0); lset(sw, S_TMP);
    for (let off = anchor.minOff; off <= anchor.maxOff; off++) {
      lget(sw, S_POS); iconst(sw, off); sw.b(I32_ADD); lget(sw, S_LEN); sw.b(I32_GE_S);
      sw.b(IF); sw.b(VOID);
      sw.b(ELSE);
      lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
      iconst(sw, off); sw.b(I32_ADD);
      sw.b(I32_LOAD8_U); sw.u(0); sw.u(0);
      iconst(sw, anchor.byte); sw.b(I32_EQ);
      lget(sw, S_TMP); sw.b(I32_OR); lset(sw, S_TMP);
      sw.b(END);
    }
    lget(sw, S_TMP); iconst(sw, 0); sw.b(I32_EQ);
    sw.b(IF); sw.b(VOID);
    lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);
    sw.b(BR); sw.u(1);
    sw.b(END);
  }

  lget(sw, S_PTR); lget(sw, S_POS); sw.b(I32_ADD);
  lget(sw, S_LEN); lget(sw, S_POS); sw.b(I32_SUB);
  sw.b(CALL); sw.u(0);
  lset(sw, S_RES);

  lget(sw, S_RES); iconst(sw, 0); sw.b(I32_GT_S);
  sw.b(IF); sw.b(VOID);

  lget(sw, S_OUT); lget(sw, S_CNT); iconst(sw, 3); sw.b(I32_SHL); sw.b(I32_ADD);
  lget(sw, S_POS);
  sw.b(I32_STORE); sw.u(2); sw.u(0);

  lget(sw, S_OUT); lget(sw, S_CNT); iconst(sw, 3); sw.b(I32_SHL); sw.b(I32_ADD);
  lget(sw, S_POS); lget(sw, S_RES); sw.b(I32_ADD);
  sw.b(I32_STORE); sw.u(2); sw.u(4);

  lget(sw, S_CNT); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_CNT);
  lget(sw, S_POS); lget(sw, S_RES); sw.b(I32_ADD); lset(sw, S_POS);

  sw.b(ELSE);

  lget(sw, S_POS); iconst(sw, 1); sw.b(I32_ADD); lset(sw, S_POS);

  sw.b(END);

  sw.b(BR); sw.u(0);
  sw.b(END);
  sw.b(END);

  lget(sw, S_CNT);
  sw.b(END);

  return sw.buf;
}

let _simdSupported: boolean | null = null;
function simdSupported(): boolean {
  if (_simdSupported !== null) return _simdSupported;
  try {
    const test = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,5,1,1,102,0,0,10,25,1,23,0,253,12,42,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,27,0,11]);
    new WebAssembly.Module(test);
    _simdSupported = true;
  } catch { _simdSupported = false; }
  return _simdSupported;
}

let _simdMatchSafe: boolean | null = null;
function simdMatchSafe(): boolean {
  if (_simdMatchSafe !== null) return _simdMatchSafe;
  _simdMatchSafe = false;
  return _simdMatchSafe;
}

export function emitWasmBinary(cp: CompiledProgram, useSimd?: boolean): Uint8Array {
  const e = new E();
  const rules = cp.rules;
  const ei = cp.entryIdx;

  const wantSimdMatch = useSimd ?? simdMatchSafe();
  let anyNeedsSimd = false;
  if (wantSimdMatch) {
    for (const r of rules) if (needsSimd(r)) { anyNeedsSimd = true; break; }
  }
  const sepPat = detectSepAnchorPattern(rules[ei], cp);
  const wantSimdScan = useSimd ?? simdSupported();
  if (sepPat && wantSimdScan) anyNeedsSimd = true;
  e.simd = anyNeedsSimd;

  const refs = new Set<number>();
  function scan(op: CompiledOp) {
    if (op.op === Op.RULE_REF && op.ruleIdx !== undefined && op.ruleIdx >= 0) refs.add(op.ruleIdx);
    if (op.child) scan(op.child); if (op.child2) scan(op.child2); if (op.child3) scan(op.child3);
    if (op.children) for (const c of op.children) scan(c);
    if (op.separator) scan(op.separator); if (op.terminator) scan(op.terminator); if (op.negated) scan(op.negated);
    if (op.flatTail) for (const c of op.flatTail) scan(c);
    if (op.flatSteps) for (const s of op.flatSteps) { if (s.child) scan(s.child); }
  }
  for (const r of rules) scan(r);

  const rfi = new Map<number, number>();
  let fc = 1;
  for (let i = 0; i < rules.length; i++) { if (refs.has(i) && i !== ei) rfi.set(i, fc++); }

  const matchSimd = wantSimdMatch && anyNeedsSimd;
  const bodies: number[][] = [];

  const mw = new E();
  mw.simd = matchSimd;
  if (matchSimd) {
    mw.u(2); mw.u(5); mw.b(I32); mw.u(1); mw.b(V128);
  } else {
    mw.u(1); mw.u(5); mw.b(I32);
  }
  iconst(mw, 0); lset(mw, L_POS);
  emitOp(mw, e, rules[ei], rules, rfi, cp, null);
  lget(mw, L_POS); mw.b(END);
  bodies.push(mw.buf);

  for (let i = 0; i < rules.length; i++) {
    if (rfi.has(i)) {
      const rw = new E();
      rw.simd = matchSimd;
      if (matchSimd) {
        rw.u(2); rw.u(4); rw.b(I32); rw.u(1); rw.b(V128);
      } else {
        rw.u(1); rw.u(4); rw.b(I32);
      }
      emitOp(rw, e, rules[i], rules, rfi, cp, null);
      lget(rw, L_POS); rw.b(END);
      bodies.push(rw.buf);
    }
  }

  const scanBody = emitScanBody(e, cp, rules, ei, rfi);
  bodies.push(scanBody);
  const scanFnIdx = fc;
  fc++;

  const ts: number[] = [2, 0x60, 2, I32, I32, 1, I32, 0x60, 3, I32, I32, I32, 1, I32];
  const fs: number[] = [fc]; fs.push(0); for (let i = 1; i < fc - 1; i++) fs.push(1); fs.push(1);
  const es: number[] = [3,
    5, 0x6D, 0x61, 0x74, 0x63, 0x68, 0x00, 0,
    4, 0x73, 0x63, 0x61, 0x6E, 0x00, scanFnIdx,
    6, 0x6D, 0x65, 0x6D, 0x6F, 0x72, 0x79, 0x02, 0];
  const pages = Math.max(1, Math.ceil(e.dOff / 65536) + 2);
  const ms: number[] = [1, 0x01, ...uleb(pages), ...uleb(1024)];

  const cs: number[] = [bodies.length];
  for (const b of bodies) cs.push(...uleb(b.length), ...b);

  const out: number[] = [0x00, 0x61, 0x73, 0x6D, 0x01, 0x00, 0x00, 0x00];
  out.push(...sec(1, ts), ...sec(3, fs), ...sec(5, ms), ...sec(7, es), ...sec(10, cs));
  if (e.segs.length > 0) {
    const merged = new Array(e.dOff).fill(0);
    for (const s of e.segs) for (let i = 0; i < s.data.length; i++) merged[s.off + i] = s.data[i];
    const ds: number[] = [1, 0, I32_CONST, ...sleb(0), END, ...uleb(merged.length), ...merged];
    out.push(...sec(11, ds));
  }
  return new Uint8Array(out);
}

export function jitCompile(cp: CompiledProgram): { module: WebAssembly.Module; instance: WebAssembly.Instance } {
  const binary = emitWasmBinary(cp);
  const mod = new WebAssembly.Module(binary as BufferSource);
  const inst = new WebAssembly.Instance(mod);
  return { module: mod, instance: inst };
}

interface JitCached {
  memory: WebAssembly.Memory;
  matchFn: (ptr: number, len: number) => number;
  scanFn: (ptr: number, len: number, outPtr: number) => number;
  view: Uint8Array;
  inputView: Uint8Array;
  bufLen: number;
  lastScanBuf: Uint8Array | null;
  lastScanLen: number;
}

const jitCache = new WeakMap<CompiledProgram, JitCached>();
const jitEnc = new TextEncoder();

function ensureJit(cp: CompiledProgram): JitCached | null {
  let cached = (cp as any)._jit as JitCached | undefined;
  if (cached) return cached;
  cached = jitCache.get(cp);
  if (!cached) {
    try {
      const { instance } = jitCompile(cp);
      const memory = instance.exports.memory as WebAssembly.Memory;
      const matchFn = instance.exports.match as (ptr: number, len: number) => number;
      const scanFn = instance.exports.scan as (ptr: number, len: number, outPtr: number) => number;
      const view = new Uint8Array(memory.buffer);
      const inputView = view.subarray(INPUT_BASE);
      cached = { memory, matchFn, scanFn, view, inputView, bufLen: memory.buffer.byteLength, lastScanBuf: null, lastScanLen: 0 };
      jitCache.set(cp, cached);
    } catch {
      return null;
    }
  }
  try { (cp as any)._jit = cached; } catch {}
  return cached;
}

function ensureCapacity(cached: JitCached, bytes: number): boolean {
  const needed = INPUT_BASE + bytes + 16;
  if (needed > cached.bufLen) {
    try { cached.memory.grow(Math.ceil((needed - cached.bufLen) / 65536) + 1); } catch { return false; }
    cached.view = new Uint8Array(cached.memory.buffer);
    cached.inputView = cached.view.subarray(INPUT_BASE);
    cached.bufLen = cached.memory.buffer.byteLength;
  }
  return true;
}

export function jitMatch(cp: CompiledProgram, input: Uint8Array): number {
  const cached = ensureJit(cp);
  if (!cached) return -2;
  const len = input.length;
  if (!ensureCapacity(cached, len)) return -2;
  cached.lastScanBuf = null;
  cached.view.set(input, INPUT_BASE);
  return cached.matchFn(INPUT_BASE, len);
}

export function jitMatchString(cp: CompiledProgram, input: string): number {
  const cached = ensureJit(cp);
  if (!cached) return -2;
  const slen = input.length;
  if (!ensureCapacity(cached, slen * 3)) return -2;
  cached.lastScanBuf = null;
  const { written } = jitEnc.encodeInto(input, cached.inputView);
  const consumed = cached.matchFn(INPUT_BASE, written!);
  if (consumed === written) return slen;
  if (consumed < 0) return consumed;
  return consumed;
}

export interface ScanMatch {
  start: number;
  end: number;
  text: string;
  tree?: import('../types/result.js').RuleMatch;
}

const SCAN_OUT_BASE = 32;

export function jitScan(cp: CompiledProgram, input: Uint8Array, inputStr: string): ScanMatch[] | null {
  const cached = ensureJit(cp);
  if (!cached) return null;
  const len = input.length;
  const maxResults = Math.min(len, 1000000);
  const outBytes = maxResults * 8;
  if (!ensureCapacity(cached, len + outBytes)) return null;
  cached.view.set(input, INPUT_BASE);
  const outPtr = INPUT_BASE + len + 16;
  const count = cached.scanFn(INPUT_BASE, len, outPtr);
  const ascii = len === inputStr.length;
  const charOffsets = ascii ? null : buildByteToCharOffset(inputStr, input);
  const dv = new DataView(cached.memory.buffer);
  const results: ScanMatch[] = [];
  for (let i = 0; i < count; i++) {
    const base = outPtr + i * 8;
    const byteStart = dv.getInt32(base, true);
    const byteEnd = dv.getInt32(base + 4, true);
    const charStart = charOffsets ? charOffsets[byteStart] : byteStart;
    const charEnd = charOffsets ? charOffsets[byteEnd] : byteEnd;
    results.push({ start: charStart, end: charEnd, text: inputStr.slice(charStart, charEnd) });
  }
  return results;
}

export function jitScanString(cp: CompiledProgram, inputStr: string): ScanMatch[] | null {
  const cached = ensureJit(cp);
  if (!cached) return null;
  const slen = inputStr.length;
  if (!ensureCapacity(cached, slen * 3 + 800016)) return null;
  const { written } = jitEnc.encodeInto(inputStr, cached.inputView);
  const len = written!;
  const outPtr = INPUT_BASE + len + 16;
  const count = cached.scanFn(INPUT_BASE, len, outPtr);
  const ascii = len === slen;
  const dv = new DataView(cached.memory.buffer);
  const results: ScanMatch[] = [];
  if (ascii) {
    for (let i = 0; i < count; i++) {
      const base = outPtr + i * 8;
      const s = dv.getInt32(base, true);
      const e = dv.getInt32(base + 4, true);
      results.push({ start: s, end: e, text: inputStr.slice(s, e) });
    }
  } else if (count > 0) {
    const offsets = new Int32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const base = outPtr + i * 8;
      offsets[i * 2] = dv.getInt32(base, true);
      offsets[i * 2 + 1] = dv.getInt32(base + 4, true);
    }
    const charMap = resolveByteOffsets(inputStr, offsets);
    for (let i = 0; i < count; i++) {
      const charStart = charMap[i * 2];
      const charEnd = charMap[i * 2 + 1];
      results.push({ start: charStart, end: charEnd, text: inputStr.slice(charStart, charEnd) });
    }
  }
  return results;
}

export interface ByteScanMatch {
  start: number;
  end: number;
  tree?: import('../types/result.js').RuleMatch;
}

export function jitScanBytes(cp: CompiledProgram, input: Uint8Array): ByteScanMatch[] | null {
  const cached = ensureJit(cp);
  if (!cached) return null;
  const len = input.length;
  const outBytes = Math.min(len, 1000000) * 8;
  if (!ensureCapacity(cached, len + outBytes)) return null;
  const sameBuf = cached.lastScanBuf === input && cached.lastScanLen === len;
  if (!sameBuf) {
    cached.view.set(input, INPUT_BASE);
    cached.lastScanBuf = input;
    cached.lastScanLen = len;
  }
  const outPtr = INPUT_BASE + len + 16;
  const count = cached.scanFn(INPUT_BASE, len, outPtr);
  const dv = new DataView(cached.memory.buffer);
  const results: ByteScanMatch[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const base = outPtr + i * 8;
    results[i] = { start: dv.getInt32(base, true), end: dv.getInt32(base + 4, true) };
  }
  return results;
}

function extractLeadBitset(cp: CompiledProgram): Uint32Array | null {
  return opLeadBitset(cp.rules[cp.entryIdx], cp);
}

function canMatchEmpty(op: CompiledOp, cp: CompiledProgram): boolean {
  switch (op.op) {
    case Op.REP_ZERO_OR_MORE: case Op.REP_OPTIONAL: return true;
    case Op.REP_BETWEEN: case Op.FAST_BETWEEN_BITSET: return (op.min ?? 0) === 0;
    case Op.SEQ: return (op.children ?? []).every(c => canMatchEmpty(c, cp));
    case Op.FAST_SEQ2: return canMatchEmpty(op.child!, cp) && canMatchEmpty(op.child2!, cp);
    case Op.FAST_SEQ3: return canMatchEmpty(op.child!, cp) && canMatchEmpty(op.child2!, cp) && canMatchEmpty(op.child3!, cp);
    case Op.ALT: case Op.FAST_ALT_BYTE_FIRST: case Op.FAST_ALT_LEAD_DISPATCH:
      return (op.children ?? []).some(c => canMatchEmpty(c, cp));
    case Op.RULE_REF:
      if (op.ruleIdx !== undefined && op.ruleIdx >= 0 && op.ruleIdx < cp.rules.length)
        return canMatchEmpty(cp.rules[op.ruleIdx], cp);
      return false;
    case Op.EXTRACT: return op.child ? canMatchEmpty(op.child, cp) : false;
    case Op.FAST_REPEAT_BITSET: return (op.min ?? 0) === 0;
    default: return false;
  }
}

function seqLeadBitset(elements: CompiledOp[], cp: CompiledProgram): Uint32Array | null {
  const merged = new Uint32Array(8);
  for (const el of elements) {
    const bs = opLeadBitset(el, cp);
    if (!bs) return null;
    for (let i = 0; i < 8; i++) merged[i] |= bs[i];
    if (!canMatchEmpty(el, cp)) return merged;
  }
  return merged;
}

function opLeadBitset(op: CompiledOp, cp: CompiledProgram): Uint32Array | null {
  const bs = opToBitset(op);
  if (bs) return bs;
  switch (op.op) {
    case Op.SEQ:
    case Op.FAST_SEQ2:
    case Op.FAST_SEQ3:
    case Op.FAST_SEQ_FLAT: {
      if (op.op === Op.FAST_SEQ2 || op.op === Op.FAST_SEQ3) {
        const els = [op.child!, op.child2!];
        if (op.op === Op.FAST_SEQ3) els.push(op.child3!);
        return seqLeadBitset(els, cp);
      }
      if (op.op === Op.FAST_SEQ_FLAT) {
        const flatEls: CompiledOp[] = [];
        if (op.flatSteps) for (const st of op.flatSteps) {
          if (st.child) flatEls.push(st.child);
          else if (st.bitset) flatEls.push({ op: Op.BITSET, bitset: st.bitset } as CompiledOp);
          else if (st.textBytes && st.textBytes.length > 0) flatEls.push({ op: Op.TEXT, textBytes: st.textBytes } as CompiledOp);
          else if (st.byte !== undefined) flatEls.push({ op: Op.BYTE, byte: st.byte } as CompiledOp);
          else return null;
        }
        if (op.flatTail) flatEls.push(...op.flatTail);
        if (flatEls.length > 0) return seqLeadBitset(flatEls, cp);
      }
      if (op.children && op.children.length > 0) return seqLeadBitset(op.children, cp);
      return null;
    }
    case Op.REP_ONE_OR_MORE:
    case Op.REP_ZERO_OR_MORE:
    case Op.REP_OPTIONAL:
    case Op.REP_EXACTLY:
    case Op.REP_BETWEEN:
      return opLeadBitset(op.child!, cp);
    case Op.FAST_REPEAT_BITSET:
    case Op.FAST_EXACTLY_BITSET:
    case Op.FAST_BETWEEN_BITSET:
      return op.bitset || null;
    case Op.FAST_JOINED_BITSET_BYTE:
    case Op.FAST_JOINED_BYTE:
      return op.bitset || (op.child ? opLeadBitset(op.child, cp) : null);
    case Op.JOINED_BY:
    case Op.JOINED_BY_LENIENT:
      return op.child ? opLeadBitset(op.child, cp) : null;
    case Op.ALT:
    case Op.FAST_ALT_BYTE_FIRST:
    case Op.FAST_ALT_LEAD_DISPATCH: {
      if (op.bitset) return op.bitset;
      if (op.children) {
        const merged = new Uint32Array(8);
        for (const c of op.children) {
          const cb = opLeadBitset(c, cp);
          if (!cb) return null;
          for (let i = 0; i < 8; i++) merged[i] |= cb[i];
        }
        return merged;
      }
      return null;
    }
    case Op.RULE_REF: {
      if (op.ruleIdx !== undefined && op.ruleIdx >= 0 && op.ruleIdx < cp.rules.length) {
        return opLeadBitset(cp.rules[op.ruleIdx], cp);
      }
      return null;
    }
    case Op.TEXT:
    case Op.FAST_SEQ_BYTES:
      if (op.textBytes && op.textBytes.length > 0) return makeBitset([op.textBytes[0]]);
      return null;
    case Op.EXTRACT:
      return op.child ? opLeadBitset(op.child, cp) : null;
    case Op.FAST_REP_BITSET_ALT:
      return op.bitset || null;
  }
  return null;
}

function resolveByteOffsets(str: string, byteOffsets: Int32Array): Int32Array {
  const n = byteOffsets.length;
  const sorted = new Int32Array(n);
  for (let i = 0; i < n; i++) sorted[i] = i;
  sorted.sort((a, b) => byteOffsets[a] - byteOffsets[b]);
  const result = new Int32Array(n);
  let bi = 0;
  let ci = 0;
  let si = 0;
  while (si < n && byteOffsets[sorted[si]] <= 0) {
    result[sorted[si]] = 0;
    si++;
  }
  for (; ci < str.length && si < n; ci++) {
    const code = str.charCodeAt(ci);
    if (code < 0x80) bi += 1;
    else if (code < 0x800) bi += 2;
    else if (code >= 0xD800 && code <= 0xDBFF) { bi += 4; ci++; }
    else bi += 3;
    while (si < n && byteOffsets[sorted[si]] <= bi) {
      result[sorted[si]] = ci + 1;
      si++;
    }
  }
  while (si < n) {
    result[sorted[si]] = str.length;
    si++;
  }
  return result;
}

function buildByteToCharOffset(str: string, bytes: Uint8Array): Uint32Array {
  const map = new Uint32Array(bytes.length + 1);
  let bi = 0;
  for (let ci = 0; ci < str.length; ci++) {
    map[bi] = ci;
    const code = str.charCodeAt(ci);
    if (code < 0x80) bi += 1;
    else if (code < 0x800) bi += 2;
    else if (code >= 0xD800 && code <= 0xDBFF) { bi += 4; ci++; }
    else bi += 3;
  }
  map[bi] = str.length;
  return map;
}
