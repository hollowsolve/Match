import { Op, FlatOp, CompiledOp, CompiledProgram, opToBitset, isSingleByteOp, FlatStep } from './fast-types.js';

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

let _simdSupported: boolean | null = null;
function simdSupported(): boolean {
  if (_simdSupported !== null) return _simdSupported;
  try {
    const test = new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,127,3,2,1,0,7,5,1,1,102,0,0,10,18,1,16,0,253,12,42,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,21,0,11]);
    new WebAssembly.Module(test);
    _simdSupported = true;
  } catch { _simdSupported = false; }
  return _simdSupported;
}

export function emitWasmBinary(cp: CompiledProgram, useSimd?: boolean): Uint8Array {
  const e = new E();
  const rules = cp.rules;
  const ei = cp.entryIdx;

  const wantSimd = useSimd ?? simdSupported();
  let anyNeedsSimd = false;
  if (wantSimd) {
    for (const r of rules) if (needsSimd(r)) { anyNeedsSimd = true; break; }
  }
  e.simd = wantSimd && anyNeedsSimd;

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

  const bodies: number[][] = [];

  const mw = new E();
  mw.simd = e.simd;
  if (e.simd) {
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
      rw.simd = e.simd;
      if (e.simd) {
        rw.u(2); rw.u(4); rw.b(I32); rw.u(1); rw.b(V128);
      } else {
        rw.u(1); rw.u(4); rw.b(I32);
      }
      emitOp(rw, e, rules[i], rules, rfi, cp, null);
      lget(rw, L_POS); rw.b(END);
      bodies.push(rw.buf);
    }
  }

  const ts: number[] = [2, 0x60, 2, I32, I32, 1, I32, 0x60, 3, I32, I32, I32, 1, I32];
  const fs: number[] = [fc]; fs.push(0); for (let i = 1; i < fc; i++) fs.push(1);
  const es: number[] = [2, 5, 0x6D, 0x61, 0x74, 0x63, 0x68, 0x00, 0, 6, 0x6D, 0x65, 0x6D, 0x6F, 0x72, 0x79, 0x02, 0];
  const pages = Math.max(1, Math.ceil(e.dOff / 65536) + 2);
  const ms: number[] = [1, 0x01, ...uleb(pages), ...uleb(256)];

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
  view: Uint8Array;
  inputView: Uint8Array;
  bufLen: number;
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
      const view = new Uint8Array(memory.buffer);
      const inputView = view.subarray(INPUT_BASE);
      cached = { memory, matchFn, view, inputView, bufLen: memory.buffer.byteLength };
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
  cached.view.set(input, INPUT_BASE);
  return cached.matchFn(INPUT_BASE, len);
}

export function jitMatchString(cp: CompiledProgram, input: string): number {
  const cached = ensureJit(cp);
  if (!cached) return -2;
  const slen = input.length;
  if (!ensureCapacity(cached, slen * 3)) return -2;
  const { written } = jitEnc.encodeInto(input, cached.inputView);
  const consumed = cached.matchFn(INPUT_BASE, written!);
  if (consumed === written) return slen;
  if (consumed < 0) return consumed;
  return consumed;
}
