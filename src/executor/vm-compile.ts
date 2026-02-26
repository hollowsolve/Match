import { Op, FlatOp, CompiledOp, CompiledProgram, opToBitset, isSingleByteOp, FlatStep } from './fast-types.js';

export const enum VmOp {
  BYTE,
  BITSET,
  NOT_BITSET,
  TEXT,
  ANY,
  RANGE,
  CHOICE,
  COMMIT,
  FAIL,
  JUMP,
  CALL,
  RET,
  MATCH,
  REP_BITSET,
  REP_BYTE,
  REP_RANGE,
  JOINED_BYTE_BITSET,
  PARTIAL_COMMIT,
  BACK_COMMIT,
  SPAN_BITSET,
  RULE_ENTER,
  RULE_EXIT,
  EXTRACT_ENTER,
  EXTRACT_EXIT,
}

const HEADER_SIZE = 4;

class BytecodeWriter {
  buf: number[] = [];
  dataSegs: Uint8Array[] = [];
  dataOff = 0;
  bsCache = new Map<string, number>();
  litCache = new Map<string, { idx: number; len: number }>();
  ruleOffsets = new Map<number, number>();
  patches: { pos: number; target: () => number }[] = [];

  emit8(v: number) { this.buf.push(v & 0xFF); }
  emit16(v: number) { this.buf.push(v & 0xFF, (v >>> 8) & 0xFF); }
  emit32(v: number) { this.buf.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }
  emitS32(v: number) { this.emit32(v | 0); }

  pos() { return this.buf.length; }

  patch32(at: number, v: number) {
    this.buf[at] = v & 0xFF;
    this.buf[at + 1] = (v >>> 8) & 0xFF;
    this.buf[at + 2] = (v >>> 16) & 0xFF;
    this.buf[at + 3] = (v >>> 24) & 0xFF;
  }

  allocBitset(bs: Uint32Array): number {
    const key = Array.from(bs).join(',');
    let idx = this.bsCache.get(key);
    if (idx !== undefined) return idx;
    idx = this.dataOff;
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const w = bs[i];
      bytes[i * 4] = w & 0xFF;
      bytes[i * 4 + 1] = (w >>> 8) & 0xFF;
      bytes[i * 4 + 2] = (w >>> 16) & 0xFF;
      bytes[i * 4 + 3] = (w >>> 24) & 0xFF;
    }
    this.dataSegs.push(bytes);
    this.dataOff += 32;
    this.bsCache.set(key, idx);
    return idx;
  }

  allocLiteral(tb: Uint8Array): { idx: number; len: number } {
    const key = Array.from(tb).join(',');
    let cached = this.litCache.get(key);
    if (cached) return cached;
    const idx = this.dataOff;
    this.dataSegs.push(new Uint8Array(tb));
    this.dataOff += tb.length;
    const pad = (4 - (tb.length % 4)) % 4;
    if (pad > 0) {
      this.dataSegs.push(new Uint8Array(pad));
      this.dataOff += pad;
    }
    cached = { idx, len: tb.length };
    this.litCache.set(key, cached);
    return cached;
  }

  emitByte(val: number) {
    this.emit8(VmOp.BYTE);
    this.emit8(val);
  }

  emitBitset(bs: Uint32Array) {
    const idx = this.allocBitset(bs);
    this.emit8(VmOp.BITSET);
    this.emit16(idx);
  }

  emitNotBitset(bs: Uint32Array) {
    const inverted = new Uint32Array(8);
    const src = bs;
    for (let i = 0; i < 8; i++) inverted[i] = ~src[i];
    inverted[0] &= ~1;
    const idx = this.allocBitset(inverted);
    this.emit8(VmOp.NOT_BITSET);
    this.emit16(idx);
  }

  emitText(tb: Uint8Array) {
    const { idx, len } = this.allocLiteral(tb);
    this.emit8(VmOp.TEXT);
    this.emit16(idx);
    this.emit16(len);
  }

  emitAny() {
    this.emit8(VmOp.ANY);
  }

  emitRange(lo: number, hi: number) {
    this.emit8(VmOp.RANGE);
    this.emit8(lo);
    this.emit8(hi);
  }

  emitChoice(): number {
    this.emit8(VmOp.CHOICE);
    const patchPos = this.pos();
    this.emit32(0);
    return patchPos;
  }

  emitCommit(): number {
    this.emit8(VmOp.COMMIT);
    const patchPos = this.pos();
    this.emit32(0);
    return patchPos;
  }

  emitPartialCommit(): number {
    this.emit8(VmOp.PARTIAL_COMMIT);
    const patchPos = this.pos();
    this.emit32(0);
    return patchPos;
  }

  emitBackCommit(): number {
    this.emit8(VmOp.BACK_COMMIT);
    const patchPos = this.pos();
    this.emit32(0);
    return patchPos;
  }

  emitFail() {
    this.emit8(VmOp.FAIL);
  }

  emitJump(): number {
    this.emit8(VmOp.JUMP);
    const patchPos = this.pos();
    this.emit32(0);
    return patchPos;
  }

  emitCall(ruleIdx: number): number {
    this.emit8(VmOp.CALL);
    const patchPos = this.pos();
    this.emit32(ruleIdx);
    return patchPos;
  }

  emitRet() {
    this.emit8(VmOp.RET);
  }

  emitMatch() {
    this.emit8(VmOp.MATCH);
  }

  emitRepBitset(bs: Uint32Array, min: number, max: number) {
    const idx = this.allocBitset(bs);
    this.emit8(VmOp.REP_BITSET);
    this.emit16(idx);
    this.emit16(min);
    this.emit16(max);
  }

  emitRepByte(val: number, min: number, max: number) {
    this.emit8(VmOp.REP_BYTE);
    this.emit8(val);
    this.emit16(min);
    this.emit16(max);
  }

  emitRepRange(lo: number, hi: number, min: number, max: number) {
    this.emit8(VmOp.REP_RANGE);
    this.emit8(lo);
    this.emit8(hi);
    this.emit16(min);
    this.emit16(max);
  }

  emitJoinedByteBitset(bs: Uint32Array, sep: number, min: number) {
    const idx = this.allocBitset(bs);
    this.emit8(VmOp.JOINED_BYTE_BITSET);
    this.emit16(idx);
    this.emit8(sep);
    this.emit16(min);
  }

  emitSpanBitset(bs: Uint32Array) {
    const idx = this.allocBitset(bs);
    this.emit8(VmOp.SPAN_BITSET);
    this.emit16(idx);
  }

  emitRuleEnter(ruleIdx: number) {
    this.emit8(VmOp.RULE_ENTER);
    this.emit16(ruleIdx);
  }

  emitRuleExit() {
    this.emit8(VmOp.RULE_EXIT);
  }

  emitExtractEnter() {
    this.emit8(VmOp.EXTRACT_ENTER);
  }

  emitExtractExit() {
    this.emit8(VmOp.EXTRACT_EXIT);
  }
}

function bsToRanges(bs: Uint32Array): [number, number][] {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < 256; i++) {
    const set = (bs[i >>> 5] & (1 << (i & 31))) !== 0;
    if (set && start < 0) start = i;
    else if (!set && start >= 0) { ranges.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, 255]);
  return ranges;
}

function emitSingleByteOp(w: BytecodeWriter, op: CompiledOp): void {
  switch (op.op) {
    case Op.BYTE: w.emitByte(op.byte!); return;
    case Op.BYTE_RANGE: w.emitRange(op.low!, op.high!); return;
    case Op.BITSET: w.emitBitset(op.bitset!); return;
    case Op.NOT_BITSET: {
      const inverted = opToBitset(op)!;
      w.emitBitset(inverted);
      return;
    }
    case Op.CHAR_CLASS_ANY: w.emitAny(); return;
    default: {
      const bs = opToBitset(op);
      if (bs) { w.emitBitset(bs); return; }
      w.emitFail();
    }
  }
}

function emitRepeatChild(w: BytecodeWriter, child: CompiledOp, min: number, max: number): boolean {
  if (child.op === Op.BYTE) {
    w.emitRepByte(child.byte!, min, max);
    return true;
  }
  if (child.op === Op.BYTE_RANGE) {
    w.emitRepRange(child.low!, child.high!, min, max);
    return true;
  }
  const bs = opToBitset(child);
  if (bs) {
    w.emitRepBitset(bs, min, max);
    return true;
  }
  return false;
}

function emitOp(w: BytecodeWriter, op: CompiledOp, rules: CompiledOp[], cp: CompiledProgram, callableRules: Set<number>, treeMode = false): void {
  switch (op.op) {
    case Op.BYTE:
    case Op.BYTE_RANGE:
    case Op.BITSET:
    case Op.NOT_BITSET:
    case Op.CHAR_CLASS_LETTER:
    case Op.CHAR_CLASS_DIGIT:
    case Op.CHAR_CLASS_PRINTABLE:
    case Op.CHAR_CLASS_VISIBLE:
    case Op.CHAR_CLASS_WHITESPACE:
    case Op.CHAR_CLASS_ALPHANUM:
    case Op.CHAR_CLASS_WORD:
    case Op.CHAR_CLASS_UPPER:
    case Op.CHAR_CLASS_LOWER:
    case Op.CHAR_CLASS_HEX:
    case Op.CHAR_CLASS_ANY:
      emitSingleByteOp(w, op);
      break;

    case Op.TEXT:
    case Op.FAST_SEQ_BYTES:
      w.emitText(op.textBytes!);
      break;

    case Op.SEQ:
      for (const ch of op.children!) emitOp(w, ch, rules, cp, callableRules, treeMode);
      break;

    case Op.FAST_SEQ2:
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      emitOp(w, op.child2!, rules, cp, callableRules, treeMode);
      break;

    case Op.FAST_SEQ3:
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      emitOp(w, op.child2!, rules, cp, callableRules, treeMode);
      emitOp(w, op.child3!, rules, cp, callableRules, treeMode);
      break;

    case Op.ALT:
    case Op.FAST_ALT_BYTE_FIRST:
    case Op.FAST_ALT_LEAD_DISPATCH: {
      if (op.op === Op.ALT) {
        const alts = op.children!;
        if (alts.length === 1) {
          emitOp(w, alts[0], rules, cp, callableRules, treeMode);
          break;
        }
        const commitPatches: number[] = [];
        for (let i = 0; i < alts.length - 1; i++) {
          const choicePatch = w.emitChoice();
          emitOp(w, alts[i], rules, cp, callableRules, treeMode);
          commitPatches.push(w.emitCommit());
          w.patch32(choicePatch, w.pos());
        }
        emitOp(w, alts[alts.length - 1], rules, cp, callableRules, treeMode);
        const afterAll = w.pos();
        for (const cp2 of commitPatches) w.patch32(cp2, afterAll);
      } else if (op.op === Op.FAST_ALT_BYTE_FIRST) {
        const byteChild: CompiledOp = { op: Op.BITSET, bitset: op.bitset! };
        const choicePatch = w.emitChoice();
        emitSingleByteOp(w, byteChild);
        const commitPatch = w.emitCommit();
        w.patch32(choicePatch, w.pos());
        emitOp(w, op.child!, rules, cp, callableRules, treeMode);
        w.patch32(commitPatch, w.pos());
      } else {
        const choicePatch = w.emitChoice();
        emitOp(w, op.child!, rules, cp, callableRules, treeMode);
        const commitPatch = w.emitCommit();
        w.patch32(choicePatch, w.pos());
        emitOp(w, op.child2!, rules, cp, callableRules, treeMode);
        w.patch32(commitPatch, w.pos());
      }
      break;
    }

    case Op.REP_ONE_OR_MORE:
    case Op.REP_ZERO_OR_MORE: {
      const child = op.child!;
      const min = op.op === Op.REP_ONE_OR_MORE ? 1 : 0;
      if (emitRepeatChild(w, child, min, 0xFFFF)) break;
      if (min === 1) emitOp(w, child, rules, cp, callableRules, treeMode);
      const loopTop = w.pos();
      const choicePatch = w.emitChoice();
      emitOp(w, child, rules, cp, callableRules, treeMode);
      const pcPatch = w.emitPartialCommit();
      w.patch32(pcPatch, loopTop);
      w.patch32(choicePatch, w.pos());
      break;
    }

    case Op.REP_OPTIONAL: {
      const choicePatch = w.emitChoice();
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      const commitPatch = w.emitCommit();
      w.patch32(choicePatch, w.pos());
      w.patch32(commitPatch, w.pos());
      break;
    }

    case Op.REP_EXACTLY: {
      const n = op.min!;
      const child = op.child!;
      if (emitRepeatChild(w, child, n, n)) break;
      for (let i = 0; i < n; i++) emitOp(w, child, rules, cp, callableRules, treeMode);
      break;
    }

    case Op.REP_BETWEEN: {
      const lo = op.min!;
      const hi = op.max!;
      const child = op.child!;
      if (emitRepeatChild(w, child, lo, hi)) break;
      for (let i = 0; i < lo; i++) emitOp(w, child, rules, cp, callableRules, treeMode);
      for (let i = lo; i < hi; i++) {
        const choicePatch = w.emitChoice();
        emitOp(w, child, rules, cp, callableRules, treeMode);
        const commitPatch = w.emitCommit();
        w.patch32(choicePatch, w.pos());
        w.patch32(commitPatch, w.pos());
      }
      break;
    }

    case Op.FAST_REPEAT_BITSET:
      w.emitRepBitset(op.bitset!, op.min!, 0xFFFF);
      break;

    case Op.FAST_EXACTLY_BITSET:
      w.emitRepBitset(op.bitset!, op.min!, op.min!);
      break;

    case Op.FAST_BETWEEN_BITSET:
      w.emitRepBitset(op.bitset!, op.min!, op.max!);
      break;

    case Op.JOINED_BY:
    case Op.JOINED_BY_LENIENT: {
      const child = op.child!;
      const sep = op.separator!;
      emitOp(w, child, rules, cp, callableRules, treeMode);
      const loopTop = w.pos();
      const choicePatch = w.emitChoice();
      emitOp(w, sep, rules, cp, callableRules, treeMode);
      emitOp(w, child, rules, cp, callableRules, treeMode);
      const pcPatch = w.emitPartialCommit();
      w.patch32(pcPatch, loopTop);
      w.patch32(choicePatch, w.pos());
      break;
    }

    case Op.FAST_JOINED_BYTE: {
      const sep = op.byte!;
      const child = op.child!;
      if (child.op === Op.FAST_REPEAT_BITSET) {
        w.emitJoinedByteBitset(child.bitset!, sep, child.min!);
      } else if (child.op === Op.FAST_EXACTLY_BITSET) {
        w.emitJoinedByteBitset(child.bitset!, sep, child.min!);
      } else if (child.op === Op.FAST_BETWEEN_BITSET) {
        w.emitJoinedByteBitset(child.bitset!, sep, child.min!);
      } else {
        emitOp(w, child, rules, cp, callableRules, treeMode);
        const loopTop = w.pos();
        const choicePatch = w.emitChoice();
        w.emitByte(sep);
        emitOp(w, child, rules, cp, callableRules, treeMode);
        const pcPatch = w.emitPartialCommit();
        w.patch32(pcPatch, loopTop);
        w.patch32(choicePatch, w.pos());
      }
      break;
    }

    case Op.FAST_JOINED_BITSET_BYTE: {
      w.emitJoinedByteBitset(op.bitset!, op.byte!, 1);
      break;
    }

    case Op.FAST_REP_BITSET_ALT: {
      const bs = op.bitset!;
      const min = op.min!;
      const child = op.child!;
      const loopTop = w.pos();
      const choicePatch = w.emitChoice();
      const innerChoice = w.emitChoice();
      w.emitBitset(bs);
      const innerCommit = w.emitCommit();
      w.patch32(innerChoice, w.pos());
      emitOp(w, child, rules, cp, callableRules, treeMode);
      w.patch32(innerCommit, w.pos());
      const pcPatch = w.emitPartialCommit();
      w.patch32(pcPatch, loopTop);
      w.patch32(choicePatch, w.pos());
      break;
    }

    case Op.RULE_REF: {
      const idx = op.ruleIdx!;
      if (idx < 0) { w.emitFail(); break; }
      if (treeMode) w.emitRuleEnter(idx);
      if (callableRules.has(idx)) {
        w.emitCall(idx);
      } else {
        emitOp(w, rules[idx], rules, cp, callableRules, treeMode);
      }
      if (treeMode) w.emitRuleExit();
      break;
    }

    case Op.EXTRACT:
      if (treeMode) w.emitExtractEnter();
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      if (treeMode) w.emitExtractExit();
      break;

    case Op.EXCEPT: {
      if (op.bitset) {
        const inverted = new Uint32Array(8);
        const src = op.bitset;
        for (let i = 0; i < 8; i++) inverted[i] = ~src[i];
        inverted[0] &= ~1;
        w.emitBitset(inverted);
        break;
      }
      if (op.children) {
        for (const ch of op.children) {
          const choicePatch = w.emitChoice();
          emitOp(w, ch, rules, cp, callableRules, treeMode);
          const bcPatch = w.emitBackCommit();
          w.patch32(choicePatch, w.pos());
          const jumpPatch = w.emitJump();
          w.patch32(bcPatch, w.pos());
          w.emitFail();
          w.patch32(jumpPatch, w.pos());
        }
      }
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      break;
    }

    case Op.NONE_OF: {
      if (op.children) {
        for (const ch of op.children) {
          const choicePatch = w.emitChoice();
          emitOp(w, ch, rules, cp, callableRules, treeMode);
          const bcPatch = w.emitBackCommit();
          w.patch32(choicePatch, w.pos());
          const jumpPatch = w.emitJump();
          w.patch32(bcPatch, w.pos());
          w.emitFail();
          w.patch32(jumpPatch, w.pos());
        }
      }
      w.emitAny();
      break;
    }

    case Op.UNTIL_INCL: {
      const loopTop = w.pos();
      const choicePatch = w.emitChoice();
      emitOp(w, op.terminator!, rules, cp, callableRules, treeMode);
      const commitPatch = w.emitCommit();
      w.patch32(choicePatch, w.pos());
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      const jumpPatch = w.emitJump();
      w.patch32(jumpPatch, loopTop);
      w.patch32(commitPatch, w.pos());
      break;
    }

    case Op.UNTIL_EXCL: {
      const loopTop = w.pos();
      const notChoice = w.emitChoice();
      emitOp(w, op.terminator!, rules, cp, callableRules, treeMode);
      const notBc = w.emitBackCommit();
      w.patch32(notChoice, w.pos());
      const jumpToEnd = w.emitJump();
      w.patch32(notBc, w.pos());
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      const jumpBack = w.emitJump();
      w.patch32(jumpBack, loopTop);
      w.patch32(jumpToEnd, w.pos());
      break;
    }

    case Op.ISNT: {
      const notChoice = w.emitChoice();
      emitOp(w, op.negated!, rules, cp, callableRules, treeMode);
      const notBc = w.emitBackCommit();
      w.patch32(notChoice, w.pos());
      const jumpOver = w.emitJump();
      w.patch32(notBc, w.pos());
      w.emitFail();
      w.patch32(jumpOver, w.pos());
      emitOp(w, op.child!, rules, cp, callableRules, treeMode);
      break;
    }

    case Op.FAST_SEQ_FLAT: {
      if (op.flatSteps) {
        for (const st of op.flatSteps) emitFlatStep(w, st, rules, cp, callableRules, treeMode);
      }
      if (op.flatTail) {
        for (const t of op.flatTail) emitOp(w, t, rules, cp, callableRules, treeMode);
      }
      break;
    }

    default:
      w.emitFail();
      break;
  }
}

function emitFlatStep(w: BytecodeWriter, st: FlatStep, rules: CompiledOp[], cp: CompiledProgram, callableRules: Set<number>, treeMode = false): void {
  switch (st.fop) {
    case FlatOp.F_BYTE:
      w.emitByte(st.byte!);
      break;
    case FlatOp.F_BITSET:
      w.emitBitset(st.bitset!);
      break;
    case FlatOp.F_EXACTLY_BITSET:
      w.emitRepBitset(st.bitset!, st.min!, st.min!);
      break;
    case FlatOp.F_SEQ_BYTES:
      w.emitText(st.textBytes!);
      break;
    case FlatOp.F_BETWEEN_BITSET:
      w.emitRepBitset(st.bitset!, st.min!, st.max!);
      break;
    case FlatOp.F_REPEAT_BITSET:
      w.emitRepBitset(st.bitset!, st.min!, 0xFFFF);
      break;
    case FlatOp.F_REP_OPTIONAL: {
      const choicePatch = w.emitChoice();
      emitOp(w, st.child!, rules, cp, callableRules, treeMode);
      const commitPatch = w.emitCommit();
      w.patch32(choicePatch, w.pos());
      w.patch32(commitPatch, w.pos());
      break;
    }
    case FlatOp.F_EXEC:
      emitOp(w, st.child!, rules, cp, callableRules, treeMode);
      break;
    case FlatOp.F_JOINED_BITSET_BYTE:
      w.emitJoinedByteBitset(st.bitset!, st.separator!, 1);
      break;
    case FlatOp.F_JOINED_BYTE: {
      if (st.child) {
        const fake: CompiledOp = { op: Op.FAST_JOINED_BYTE, child: st.child, byte: st.separator };
        emitOp(w, fake, rules, cp, callableRules, treeMode);
      }
      break;
    }
    case FlatOp.F_LITERAL_REPEAT_BS: {
      w.emitText(st.textBytes!);
      w.emitRepBitset(st.bitset!, st.min!, 0xFFFF);
      break;
    }
    case FlatOp.F_MULTI_LITERAL_REPEAT_BS: {
      if (st.segments) {
        for (const seg of st.segments) {
          w.emitText(new Uint8Array(seg.textBytes));
          w.emitRepBitset(seg.bitset, seg.min, 0xFFFF);
        }
      }
      break;
    }
  }
}

function findCallableRules(rules: CompiledOp[], entryIdx: number): Set<number> {
  const refs = new Set<number>();
  function scan(op: CompiledOp) {
    if (op.op === Op.RULE_REF && op.ruleIdx !== undefined && op.ruleIdx >= 0) refs.add(op.ruleIdx);
    if (op.child) scan(op.child);
    if (op.child2) scan(op.child2);
    if (op.child3) scan(op.child3);
    if (op.children) for (const c of op.children) scan(c);
    if (op.separator) scan(op.separator);
    if (op.terminator) scan(op.terminator);
    if (op.negated) scan(op.negated);
    if (op.flatTail) for (const c of op.flatTail) scan(c);
    if (op.flatSteps) for (const s of op.flatSteps) { if (s.child) scan(s.child); }
  }
  for (const r of rules) scan(r);
  const callable = new Set<number>();
  for (const idx of refs) {
    if (idx !== entryIdx) callable.add(idx);
  }
  return callable;
}

export interface VmProgram {
  bytecode: Uint8Array;
  data: Uint8Array;
  entryOffset: number;
  ruleOffsets: Map<number, number>;
}

export function vmCompile(cp: CompiledProgram): VmProgram {
  const w = new BytecodeWriter();
  const rules = cp.rules;
  const callableRules = findCallableRules(rules, cp.entryIdx);

  const ruleBodyWriters = new Map<number, BytecodeWriter>();
  for (const idx of callableRules) {
    const rw = new BytecodeWriter();
    rw.bsCache = w.bsCache;
    rw.litCache = w.litCache;
    rw.dataSegs = w.dataSegs;
    rw.dataOff = w.dataOff;
    emitOp(rw, rules[idx], rules, cp, callableRules);
    rw.emitRet();
    w.dataSegs = rw.dataSegs;
    w.dataOff = rw.dataOff;
    w.bsCache = rw.bsCache;
    w.litCache = rw.litCache;
    ruleBodyWriters.set(idx, rw);
  }

  emitOp(w, rules[cp.entryIdx], rules, cp, callableRules);
  w.emitMatch();

  const entryLen = w.buf.length;
  let totalLen = entryLen;
  const ruleOffsets = new Map<number, number>();
  for (const [idx, rw] of ruleBodyWriters) {
    ruleOffsets.set(idx, totalLen);
    totalLen += rw.buf.length;
  }

  const bytecode = new Uint8Array(totalLen);
  bytecode.set(w.buf, 0);
  for (const [idx, rw] of ruleBodyWriters) {
    const off = ruleOffsets.get(idx)!;
    bytecode.set(rw.buf, off);
  }

  for (let i = 0; i < bytecode.length; i++) {
    if (bytecode[i] === VmOp.CALL) {
      const ruleIdx = bytecode[i + 1] | (bytecode[i + 2] << 8) | (bytecode[i + 3] << 16) | (bytecode[i + 4] << 24);
      const target = ruleOffsets.get(ruleIdx);
      if (target !== undefined) {
        bytecode[i + 1] = target & 0xFF;
        bytecode[i + 2] = (target >>> 8) & 0xFF;
        bytecode[i + 3] = (target >>> 16) & 0xFF;
        bytecode[i + 4] = (target >>> 24) & 0xFF;
      }
    }
  }

  let dataLen = 0;
  for (const seg of w.dataSegs) dataLen += seg.length;
  const data = new Uint8Array(dataLen);
  let off = 0;
  for (const seg of w.dataSegs) {
    data.set(seg, off);
    off += seg.length;
  }

  return { bytecode, data, entryOffset: 0, ruleOffsets };
}

export function vmCompileTree(cp: CompiledProgram): VmProgram {
  const w = new BytecodeWriter();
  const rules = cp.rules;
  const callableRules = findCallableRules(rules, cp.entryIdx);

  const ruleBodyWriters = new Map<number, BytecodeWriter>();
  for (const idx of callableRules) {
    const rw = new BytecodeWriter();
    rw.bsCache = w.bsCache;
    rw.litCache = w.litCache;
    rw.dataSegs = w.dataSegs;
    rw.dataOff = w.dataOff;
    emitOp(rw, rules[idx], rules, cp, callableRules, true);
    rw.emitRet();
    w.dataSegs = rw.dataSegs;
    w.dataOff = rw.dataOff;
    w.bsCache = rw.bsCache;
    w.litCache = rw.litCache;
    ruleBodyWriters.set(idx, rw);
  }

  w.emitRuleEnter(cp.entryIdx);
  emitOp(w, rules[cp.entryIdx], rules, cp, callableRules, true);
  w.emitRuleExit();
  w.emitMatch();

  const entryLen = w.buf.length;
  let totalLen = entryLen;
  const ruleOffsets = new Map<number, number>();
  for (const [idx, rw] of ruleBodyWriters) {
    ruleOffsets.set(idx, totalLen);
    totalLen += rw.buf.length;
  }

  const bytecode = new Uint8Array(totalLen);
  bytecode.set(w.buf, 0);
  for (const [idx, rw] of ruleBodyWriters) {
    const off = ruleOffsets.get(idx)!;
    bytecode.set(rw.buf, off);
  }

  for (let i = 0; i < bytecode.length; i++) {
    if (bytecode[i] === VmOp.CALL) {
      const ruleIdx = bytecode[i + 1] | (bytecode[i + 2] << 8) | (bytecode[i + 3] << 16) | (bytecode[i + 4] << 24);
      const target = ruleOffsets.get(ruleIdx);
      if (target !== undefined) {
        bytecode[i + 1] = target & 0xFF;
        bytecode[i + 2] = (target >>> 8) & 0xFF;
        bytecode[i + 3] = (target >>> 16) & 0xFF;
        bytecode[i + 4] = (target >>> 24) & 0xFF;
      }
    }
  }

  let dataLen = 0;
  for (const seg of w.dataSegs) dataLen += seg.length;
  const data = new Uint8Array(dataLen);
  let off = 0;
  for (const seg of w.dataSegs) {
    data.set(seg, off);
    off += seg.length;
  }

  return { bytecode, data, entryOffset: 0, ruleOffsets };
}
