import { MatchProgram } from '../types/ast.js';

export const enum Op {
  BYTE,
  BYTE_RANGE,
  BITSET,
  NOT_BITSET,
  TEXT,
  CHAR_CLASS_LETTER,
  CHAR_CLASS_DIGIT,
  CHAR_CLASS_PRINTABLE,
  CHAR_CLASS_VISIBLE,
  CHAR_CLASS_WHITESPACE,
  CHAR_CLASS_ALPHANUM,
  CHAR_CLASS_WORD,
  CHAR_CLASS_ANY,
  CHAR_CLASS_UPPER,
  CHAR_CLASS_LOWER,
  CHAR_CLASS_HEX,
  SEQ,
  ALT,
  REP_ONE_OR_MORE,
  REP_ZERO_OR_MORE,
  REP_OPTIONAL,
  REP_EXACTLY,
  REP_BETWEEN,
  JOINED_BY,
  JOINED_BY_LENIENT,
  RULE_REF,
  EXCEPT,
  NONE_OF,
  FAST_REPEAT_BITSET,
  FAST_EXACTLY_BITSET,
  FAST_BETWEEN_BITSET,
  FAST_JOINED_BYTE,
  EXTRACT,
  UNTIL_INCL,
  UNTIL_EXCL,
  ISNT,
  FAST_SEQ_BYTES,
  FAST_JOINED_BITSET_BYTE,
  FAST_SEQ2,
  FAST_SEQ3,
  FAST_REP_BITSET_ALT,
  FAST_SEQ_FLAT,
  FAST_ALT_BYTE_FIRST,
  FAST_ALT_LEAD_DISPATCH,
}

export const enum FlatOp {
  F_BYTE,
  F_BITSET,
  F_EXACTLY_BITSET,
  F_SEQ_BYTES,
  F_BETWEEN_BITSET,
  F_REPEAT_BITSET,
  F_REP_OPTIONAL,
  F_EXEC,
  F_JOINED_BITSET_BYTE,
  F_JOINED_BYTE,
  F_LITERAL_REPEAT_BS,
  F_MULTI_LITERAL_REPEAT_BS,
}

export interface LitRepSeg {
  textBytes: Uint8Array;
  bitset: Uint32Array;
  min: number;
}

export interface FlatStep {
  fop: FlatOp;
  byte?: number;
  bitset?: Uint32Array;
  textBytes?: Uint8Array;
  min?: number;
  max?: number;
  child?: CompiledOp;
  leadByte?: number;
  leadBitset?: Uint32Array;
  separator?: number;
  segments?: LitRepSeg[];
}

export interface CompiledOp {
  op: Op;
  byte?: number;
  low?: number;
  high?: number;
  bitset?: Uint32Array;
  textBytes?: Uint8Array;
  children?: CompiledOp[];
  child?: CompiledOp;
  child2?: CompiledOp;
  child3?: CompiledOp;
  separator?: CompiledOp;
  terminator?: CompiledOp;
  negated?: CompiledOp;
  ruleIdx?: number;
  min?: number;
  max?: number;
  flatSteps?: FlatStep[];
  flatTail?: CompiledOp[];
  leadByte?: number;
  leadBitset?: Uint32Array;
  fixedPrefix?: Uint32Array;
  fixedPrefixLen?: number;
  fixedPrefixSteps?: number;
  inlinedRuleIdx?: number;
}

export interface CompiledProgram {
  rules: CompiledOp[];
  ruleNames: string[];
  entryIdx: number;
  entryPoint: string;
  source: MatchProgram;
  needsMemo: boolean;
  hasExtract: boolean;
  fullyFlat?: boolean;
  treeRules?: CompiledOp[];
}

export function makeBitset(bytes: number[]): Uint32Array {
  const bs = new Uint32Array(8);
  for (const b of bytes) {
    bs[b >>> 5] |= 1 << (b & 31);
  }
  return bs;
}

export function opToBitset(op: CompiledOp): Uint32Array | null {
  if (op.op === Op.BITSET && op.bitset) return op.bitset;
  switch (op.op) {
    case Op.BYTE: return makeBitset([op.byte!]);
    case Op.BYTE_RANGE: {
      const bytes: number[] = [];
      for (let i = op.low!; i <= op.high!; i++) bytes.push(i);
      return makeBitset(bytes);
    }
    case Op.BITSET: return op.bitset!;
    case Op.CHAR_CLASS_LETTER: {
      const b: number[] = [];
      for (let i = 0x41; i <= 0x5A; i++) b.push(i);
      for (let i = 0x61; i <= 0x7A; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_DIGIT: {
      const b: number[] = [];
      for (let i = 0x30; i <= 0x39; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_PRINTABLE: {
      const b: number[] = [];
      for (let i = 0x20; i <= 0x7E; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_VISIBLE: {
      const b: number[] = [];
      for (let i = 0x21; i <= 0x7E; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_WHITESPACE: return makeBitset([0x20, 0x09, 0x0A, 0x0D]);
    case Op.CHAR_CLASS_ALPHANUM: {
      const b: number[] = [];
      for (let i = 0x41; i <= 0x5A; i++) b.push(i);
      for (let i = 0x61; i <= 0x7A; i++) b.push(i);
      for (let i = 0x30; i <= 0x39; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_WORD: {
      const b: number[] = [];
      for (let i = 0x41; i <= 0x5A; i++) b.push(i);
      for (let i = 0x61; i <= 0x7A; i++) b.push(i);
      for (let i = 0x30; i <= 0x39; i++) b.push(i);
      b.push(0x5F);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_UPPER: {
      const b: number[] = [];
      for (let i = 0x41; i <= 0x5A; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_LOWER: {
      const b: number[] = [];
      for (let i = 0x61; i <= 0x7A; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.CHAR_CLASS_HEX: {
      const b: number[] = [];
      for (let i = 0x30; i <= 0x39; i++) b.push(i);
      for (let i = 0x41; i <= 0x46; i++) b.push(i);
      for (let i = 0x61; i <= 0x66; i++) b.push(i);
      return makeBitset(b);
    }
    case Op.NOT_BITSET: {
      const inverted = new Uint32Array(8);
      const src = op.bitset!;
      for (let i = 0; i < 8; i++) inverted[i] = ~src[i];
      inverted[0] &= ~1;
      return inverted;
    }
    default: return null;
  }
}

export function isSingleByteOp(op: CompiledOp): boolean {
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
      return true;
    default:
      return false;
  }
}