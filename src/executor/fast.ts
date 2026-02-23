import { ASTNode, MatchProgram, RuleNode } from '../types/ast.js';
import { CHAR_CLASSES } from '../stdlib/stdlib.js';

const enum Op {
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

const enum FlatOp {
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

interface LitRepSeg {
  textBytes: Uint8Array;
  bitset: Uint32Array;
  min: number;
}

interface FlatStep {
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

interface CompiledOp {
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
}

const encoder = new TextEncoder();

function makeBitset(bytes: number[]): Uint32Array {
  const bs = new Uint32Array(8);
  for (const b of bytes) {
    bs[b >>> 5] |= 1 << (b & 31);
  }
  return bs;
}

function opToBitset(op: CompiledOp): Uint32Array | null {
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

function isSingleByteOp(op: CompiledOp): boolean {
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

function collectBytes(node: ASTNode): number[] | null {
  switch (node.type) {
    case 'named_char': return [node.byte];
    case 'quoted_literal': return [node.byte];
    case 'byte_literal': return [node.byte];
    case 'range': {
      const bytes: number[] = [];
      for (let i = node.low; i <= node.high; i++) bytes.push(i);
      return bytes.length <= 256 ? bytes : null;
    }
    case 'char_class': {
      const fn = CHAR_CLASSES[node.className];
      if (!fn) return null;
      const bytes: number[] = [];
      for (let b = 0; b < 256; b++) { if (fn(b)) bytes.push(b); }
      return bytes;
    }
    default: return null;
  }
}

function collectAllBytes(items: ASTNode[]): number[] | null {
  const all: number[] = [];
  for (const item of items) {
    const bytes = collectBytes(item);
    if (!bytes) return null;
    all.push(...bytes);
  }
  return all;
}

function classToOp(className: string): Op | null {
  switch (className) {
    case 'letter': return Op.CHAR_CLASS_LETTER;
    case 'digit': return Op.CHAR_CLASS_DIGIT;
    case 'printable': return Op.CHAR_CLASS_PRINTABLE;
    case 'visible': return Op.CHAR_CLASS_VISIBLE;
    case 'whitespace': return Op.CHAR_CLASS_WHITESPACE;
    case 'alphanumeric': return Op.CHAR_CLASS_ALPHANUM;
    case 'word character': return Op.CHAR_CLASS_WORD;
    case 'any character': return Op.CHAR_CLASS_ANY;
    case 'uppercase': return Op.CHAR_CLASS_UPPER;
    case 'lowercase': return Op.CHAR_CLASS_LOWER;
    case 'hex digit': return Op.CHAR_CLASS_HEX;
    default: return null;
  }
}

function opToFixedByte(op: CompiledOp): number | null {
  if (op.op === Op.BYTE) return op.byte!;
  return null;
}

function opLeadingBitset(op: CompiledOp): Uint32Array | null {
  if (isSingleByteOp(op)) return opToBitset(op);
  if (op.op === Op.FAST_SEQ2 || op.op === Op.FAST_SEQ3) return op.child ? opLeadingBitset(op.child) : null;
  if (op.op === Op.FAST_SEQ_FLAT && op.flatSteps && op.flatSteps.length > 0) {
    const fs = op.flatSteps[0];
    if (fs.fop === FlatOp.F_BYTE) return makeBitset([fs.byte!]);
    if (fs.fop === FlatOp.F_BITSET) return fs.bitset!;
    if (fs.fop === FlatOp.F_SEQ_BYTES && fs.textBytes && fs.textBytes.length > 0) return makeBitset([fs.textBytes[0]]);
    if (fs.fop === FlatOp.F_REPEAT_BITSET || fs.fop === FlatOp.F_EXACTLY_BITSET || fs.fop === FlatOp.F_BETWEEN_BITSET) return fs.bitset!;
    return null;
  }
  if (op.op === Op.SEQ && op.children && op.children.length > 0) return opLeadingBitset(op.children[0]);
  if (op.op === Op.FAST_SEQ_BYTES || op.op === Op.TEXT) {
    return op.textBytes && op.textBytes.length > 0 ? makeBitset([op.textBytes[0]]) : null;
  }
  if (op.op === Op.FAST_REPEAT_BITSET || op.op === Op.FAST_BETWEEN_BITSET || op.op === Op.FAST_EXACTLY_BITSET) {
    return op.bitset!;
  }
  if (op.op === Op.FAST_JOINED_BITSET_BYTE) return op.bitset!;
  if (op.op === Op.FAST_REP_BITSET_ALT) return op.bitset!;
  return null;
}

function tryFuseSeqToBytes(children: CompiledOp[]): Uint8Array | null {
  const bytes: number[] = [];
  for (const ch of children) {
    if (ch.op === Op.BYTE) {
      bytes.push(ch.byte!);
    } else if (ch.op === Op.TEXT) {
      for (let i = 0; i < ch.textBytes!.length; i++) bytes.push(ch.textBytes![i]);
    } else {
      return null;
    }
  }
  return bytes.length >= 2 ? new Uint8Array(bytes) : null;
}

export function compile(program: MatchProgram): CompiledProgram {
  const ruleNames: string[] = [];
  const ruleMap = new Map<string, number>();
  for (let i = 0; i < program.rules.length; i++) {
    ruleNames.push(program.rules[i].name);
    ruleMap.set(program.rules[i].name, i);
  }

  const refSites = new Map<number, number>();
  function countAstRefs(node: ASTNode) {
    if (node.type === 'rule_ref') {
      const idx = ruleMap.get(node.name);
      if (idx !== undefined) refSites.set(idx, (refSites.get(idx) ?? 0) + 1);
    }
    switch (node.type) {
      case 'sequence': node.elements.forEach(countAstRefs); break;
      case 'alternative': node.options.forEach(countAstRefs); break;
      case 'repeat': countAstRefs(node.child); break;
      case 'group': countAstRefs(node.child); break;
      case 'joined_by': countAstRefs(node.element); countAstRefs(node.separator); break;
      case 'until': countAstRefs(node.child); countAstRefs(node.terminator); break;
      case 'isnt': countAstRefs(node.child); countAstRefs(node.negated); break;
      case 'extract': countAstRefs(node.child); break;
      case 'any_of': case 'none_of': node.items.forEach(countAstRefs); break;
      case 'except': countAstRefs(node.base); node.exclusions.forEach(countAstRefs); break;
    }
  }
  program.rules.forEach(r => countAstRefs(r.body));

  function isInlinable(body: ASTNode): boolean {
    switch (body.type) {
      case 'named_char':
      case 'quoted_literal':
      case 'byte_literal':
      case 'char_class':
      case 'range':
        return true;
      case 'any_of': return collectAllBytes(body.items) !== null;
      case 'none_of': return collectAllBytes(body.items) !== null;
      case 'except': {
        const exclBytes = collectAllBytes(body.exclusions);
        const baseBytes = collectBytes(body.base);
        return exclBytes !== null && baseBytes !== null;
      }
      default:
        return false;
    }
  }

  function opSize(op: CompiledOp): number {
    let s = 1;
    if (op.child) s += opSize(op.child);
    if (op.child2) s += opSize(op.child2);
    if (op.child3) s += opSize(op.child3);
    if (op.children) for (const c of op.children) s += opSize(c);
    if (op.separator) s += opSize(op.separator);
    if (op.terminator) s += opSize(op.terminator);
    if (op.negated) s += opSize(op.negated);
    if (op.flatSteps) s += op.flatSteps.length;
    if (op.flatTail) for (const c of op.flatTail) s += opSize(c);
    return s;
  }

  function canDeepInline(ruleIdx: number): boolean {
    return (refSites.get(ruleIdx) ?? 0) <= 1;
  }

  function flattenSeqChildren(children: CompiledOp[]): CompiledOp[] {
    const flat: CompiledOp[] = [];
    for (const ch of children) {
      if (ch.op === Op.SEQ && ch.children) {
        flat.push(...ch.children);
      } else {
        flat.push(ch);
      }
    }
    return flat;
  }

  function toFlatStep(op: CompiledOp): FlatStep | null {
    switch (op.op) {
      case Op.BYTE: return { fop: FlatOp.F_BYTE, byte: op.byte };
      case Op.BITSET: return { fop: FlatOp.F_BITSET, bitset: op.bitset };
      case Op.NOT_BITSET: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.BYTE_RANGE: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.FAST_EXACTLY_BITSET: return { fop: FlatOp.F_EXACTLY_BITSET, bitset: op.bitset, min: op.min };
      case Op.TEXT:
      case Op.FAST_SEQ_BYTES: return { fop: FlatOp.F_SEQ_BYTES, textBytes: op.textBytes };
      case Op.FAST_BETWEEN_BITSET: return { fop: FlatOp.F_BETWEEN_BITSET, bitset: op.bitset, min: op.min, max: op.max };
      case Op.FAST_REPEAT_BITSET: return { fop: FlatOp.F_REPEAT_BITSET, bitset: op.bitset, min: op.min };
      case Op.CHAR_CLASS_LETTER: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_DIGIT: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_PRINTABLE: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_VISIBLE: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_WHITESPACE: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_ALPHANUM: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_WORD: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_UPPER: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_LOWER: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.CHAR_CLASS_HEX: return { fop: FlatOp.F_BITSET, bitset: opToBitset(op)! };
      case Op.FAST_JOINED_BITSET_BYTE:
        return { fop: FlatOp.F_JOINED_BITSET_BYTE, bitset: op.bitset, separator: op.byte };
      case Op.FAST_JOINED_BYTE:
        return { fop: FlatOp.F_JOINED_BYTE, child: op.child, separator: op.byte };
      case Op.FAST_ALT_BYTE_FIRST:
      case Op.FAST_ALT_LEAD_DISPATCH:
      case Op.FAST_REP_BITSET_ALT:
        return { fop: FlatOp.F_EXEC, child: op };
      case Op.REP_OPTIONAL: {
        const inner = op.child!;
        let lb: number | undefined;
        let lbs: Uint32Array | undefined;
        if (inner.op === Op.FAST_SEQ2 && inner.child && inner.child.op === Op.BYTE) lb = inner.child.byte;
        else if (inner.op === Op.FAST_SEQ3 && inner.child && inner.child.op === Op.BYTE) lb = inner.child.byte;
        else if (inner.op === Op.BYTE) lb = inner.byte;
        else if (inner.op === Op.FAST_SEQ_BYTES || inner.op === Op.TEXT) lb = inner.textBytes![0];
        else if (inner.op === Op.FAST_SEQ_FLAT && inner.flatSteps && inner.flatSteps.length > 0) {
          const fs0 = inner.flatSteps[0];
          if (fs0.fop === FlatOp.F_BYTE) lb = fs0.byte;
          else if (fs0.fop === FlatOp.F_BITSET) lbs = fs0.bitset;
          else if (fs0.fop === FlatOp.F_REPEAT_BITSET || fs0.fop === FlatOp.F_EXACTLY_BITSET || fs0.fop === FlatOp.F_BETWEEN_BITSET) lbs = fs0.bitset;
        }
        if (lb === undefined && !lbs) {
          const innerLbs = opLeadingBitset(inner);
          if (innerLbs) lbs = innerLbs;
        }
        return { fop: FlatOp.F_REP_OPTIONAL, child: inner, leadByte: lb, leadBitset: lbs };
      }
      default: return null;
    }
  }

  function pushFlatSteps(op: CompiledOp, out: FlatStep[]): boolean {
    const fs = toFlatStep(op);
    if (fs) { out.push(fs); return true; }
    if (op.op === Op.FAST_SEQ2) {
      return pushFlatSteps(op.child!, out) && pushFlatSteps(op.child2!, out);
    }
    if (op.op === Op.FAST_SEQ3) {
      return pushFlatSteps(op.child!, out) && pushFlatSteps(op.child2!, out) && pushFlatSteps(op.child3!, out);
    }
    return false;
  }

  function tryFlatSeq(ops: CompiledOp[]): CompiledOp | null {
    if (ops.length < 3) return null;
    const steps: FlatStep[] = [];
    const tail: CompiledOp[] = [];
    let flatDone = false;
    for (const op of ops) {
      if (!flatDone) {
        if (pushFlatSteps(op, steps)) continue;
        flatDone = true;
      }
      tail.push(op);
    }
    if (steps.length < 3) return null;
    return { op: Op.FAST_SEQ_FLAT, flatSteps: mergeFlatSteps(steps), flatTail: tail.length > 0 ? tail : undefined };
  }

  function mergeFlatSteps(steps: FlatStep[]): FlatStep[] {
    const out: FlatStep[] = [];
    let byteRun: number[] = [];
    function flush() {
      if (byteRun.length === 0) return;
      if (byteRun.length === 1) out.push({ fop: FlatOp.F_BYTE, byte: byteRun[0] });
      else out.push({ fop: FlatOp.F_SEQ_BYTES, textBytes: new Uint8Array(byteRun) });
      byteRun = [];
    }
    for (const s of steps) {
      if (s.fop === FlatOp.F_BYTE) {
        byteRun.push(s.byte!);
      } else if (s.fop === FlatOp.F_SEQ_BYTES) {
        const tb = s.textBytes!;
        for (let i = 0; i < tb.length; i++) byteRun.push(tb[i]);
      } else {
        flush();
        out.push(s);
      }
    }
    flush();
    const out2: FlatStep[] = [];
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      const next = i + 1 < out.length ? out[i + 1] : null;
      if (next && next.fop === FlatOp.F_REPEAT_BITSET && next.min! >= 1) {
        if (cur.fop === FlatOp.F_SEQ_BYTES) {
          out2.push({ fop: FlatOp.F_LITERAL_REPEAT_BS, textBytes: cur.textBytes, bitset: next.bitset, min: next.min });
          i++;
          continue;
        }
        if (cur.fop === FlatOp.F_BYTE) {
          out2.push({ fop: FlatOp.F_LITERAL_REPEAT_BS, textBytes: new Uint8Array([cur.byte!]), bitset: next.bitset, min: next.min });
          i++;
          continue;
        }
      }
      out2.push(cur);
    }
    const out3: FlatStep[] = [];
    let lrRun: LitRepSeg[] = [];
    function flushLR() {
      if (lrRun.length === 0) return;
      if (lrRun.length === 1) out3.push({ fop: FlatOp.F_LITERAL_REPEAT_BS, textBytes: lrRun[0].textBytes, bitset: lrRun[0].bitset, min: lrRun[0].min });
      else out3.push({ fop: FlatOp.F_MULTI_LITERAL_REPEAT_BS, segments: lrRun.slice() });
      lrRun = [];
    }
    for (const s of out2) {
      if (s.fop === FlatOp.F_LITERAL_REPEAT_BS) {
        lrRun.push({ textBytes: s.textBytes!, bitset: s.bitset!, min: s.min! });
      } else {
        flushLR();
        out3.push(s);
      }
    }
    flushLR();
    return out3;
  }

  function optimizeSeq(children: CompiledOp[]): CompiledOp {
    const flat = flattenSeqChildren(children);

    const fused = tryFuseSeqToBytes(flat);
    if (fused) return { op: Op.FAST_SEQ_BYTES, textBytes: fused };

    const merged = mergeAdjacentBytes(flat);

    if (merged.length === 1) return merged[0];
    if (merged.length === 2) return { op: Op.FAST_SEQ2, child: merged[0], child2: merged[1] };
    if (merged.length === 3) return { op: Op.FAST_SEQ3, child: merged[0], child2: merged[1], child3: merged[2] };

    const flatOp = tryFlatSeq(merged);
    if (flatOp) return flatOp;

    return { op: Op.SEQ, children: merged };
  }

  function mergeAdjacentBytes(ops: CompiledOp[]): CompiledOp[] {
    const result: CompiledOp[] = [];
    let byteRun: number[] = [];

    function flushBytes() {
      if (byteRun.length === 0) return;
      if (byteRun.length === 1) {
        result.push({ op: Op.BYTE, byte: byteRun[0] });
      } else {
        result.push({ op: Op.FAST_SEQ_BYTES, textBytes: new Uint8Array(byteRun) });
      }
      byteRun = [];
    }

    for (const op of ops) {
      if (op.op === Op.BYTE) {
        byteRun.push(op.byte!);
      } else if (op.op === Op.TEXT || op.op === Op.FAST_SEQ_BYTES) {
        for (let i = 0; i < op.textBytes!.length; i++) byteRun.push(op.textBytes![i]);
      } else {
        flushBytes();
        result.push(op);
      }
    }
    flushBytes();
    return result;
  }

  function compileNode(node: ASTNode): CompiledOp {
    switch (node.type) {
      case 'named_char': return { op: Op.BYTE, byte: node.byte };
      case 'quoted_literal': return { op: Op.BYTE, byte: node.byte };
      case 'byte_literal': return { op: Op.BYTE, byte: node.byte };

      case 'char_class': {
        const cop = classToOp(node.className);
        if (cop !== null) return { op: cop };
        const fn = CHAR_CLASSES[node.className];
        if (fn) {
          const bytes: number[] = [];
          for (let b = 0; b < 256; b++) { if (fn(b)) bytes.push(b); }
          return { op: Op.BITSET, bitset: makeBitset(bytes) };
        }
        return { op: Op.BITSET, bitset: new Uint32Array(8) };
      }

      case 'range': return { op: Op.BYTE_RANGE, low: node.low, high: node.high };

      case 'any_of': {
        const allBytes = collectAllBytes(node.items);
        if (allBytes) return { op: Op.BITSET, bitset: makeBitset(allBytes) };
        const compiled = node.items.map(compileNode);
        if (compiled.every(c => isSingleByteOp(c))) {
          const allB: number[] = [];
          let ok = true;
          for (const c of compiled) {
            const bs = opToBitset(c);
            if (!bs) { ok = false; break; }
            for (let w = 0; w < 8; w++) {
              for (let bit = 0; bit < 32; bit++) {
                if (bs[w] & (1 << bit)) allB.push(w * 32 + bit);
              }
            }
          }
          if (ok && allB.length > 0) return { op: Op.BITSET, bitset: makeBitset(allB) };
        }
        return { op: Op.ALT, children: compiled };
      }

      case 'none_of': {
        const allBytes = collectAllBytes(node.items);
        if (allBytes) return { op: Op.NOT_BITSET, bitset: makeBitset(allBytes) };
        return { op: Op.NONE_OF, children: node.items.map(compileNode) };
      }

      case 'except': {
        const exclBytes = collectAllBytes(node.exclusions);
        const baseBytes = collectBytes(node.base);
        if (exclBytes && baseBytes) {
          const exclSet = new Set(exclBytes);
          return { op: Op.BITSET, bitset: makeBitset(baseBytes.filter(b => !exclSet.has(b))) };
        }
        if (exclBytes) {
          return { op: Op.EXCEPT, child: compileNode(node.base), bitset: makeBitset(exclBytes) };
        }
        return { op: Op.EXCEPT, child: compileNode(node.base), children: node.exclusions.map(compileNode) };
      }

      case 'sequence': {
        if (node.elements.length === 1) return compileNode(node.elements[0]);
        const compiled = node.elements.map(compileNode);
        return optimizeSeq(compiled);
      }

      case 'alternative': {
        if (node.options.length === 1) return compileNode(node.options[0]);
        const compiled = node.options.map(compileNode);
        if (compiled.every(c => isSingleByteOp(c))) {
          const allBytes: number[] = [];
          let ok = true;
          for (const c of compiled) {
            const bs = opToBitset(c);
            if (!bs) { ok = false; break; }
            for (let w = 0; w < 8; w++) {
              for (let bit = 0; bit < 32; bit++) {
                if (bs[w] & (1 << bit)) allBytes.push(w * 32 + bit);
              }
            }
          }
          if (ok && allBytes.length > 0) return { op: Op.BITSET, bitset: makeBitset(allBytes) };
        }
        if (compiled.length >= 2) {
          let bIdx = -1;
          for (let ci = 0; ci < compiled.length; ci++) {
            if (opToBitset(compiled[ci])) { bIdx = ci; break; }
          }
          if (bIdx >= 0) {
            const bBs = opToBitset(compiled[bIdx])!;
            const rr: CompiledOp[] = [];
            for (let ci = 0; ci < compiled.length; ci++) if (ci !== bIdx) rr.push(compiled[ci]);
            const rrOp = rr.length === 1 ? rr[0] : { op: Op.ALT, children: rr };
            return { op: Op.FAST_ALT_BYTE_FIRST, bitset: bBs, child: rrOp };
          }
        }
        return { op: Op.ALT, children: compiled };
      }

      case 'repeat': {
        const child = compileNode(node.child);
        if ((node.mode === 'one_or_more' || node.mode === 'zero_or_more') && child.op !== Op.CHAR_CLASS_ANY) {
          const bs = opToBitset(child);
          if (bs) {
            return { op: Op.FAST_REPEAT_BITSET, bitset: bs, min: node.mode === 'one_or_more' ? 1 : 0 };
          }
          if (child.op === Op.ALT && child.children && child.children.length >= 2) {
            let bci = -1;
            for (let ci = 0; ci < child.children.length; ci++) {
              if (opToBitset(child.children[ci])) { bci = ci; break; }
            }
            if (bci >= 0) {
              const bbs = opToBitset(child.children[bci])!;
              const rr: CompiledOp[] = [];
              for (let ci = 0; ci < child.children.length; ci++) if (ci !== bci) rr.push(child.children[ci]);
              const rrOp = rr.length === 1 ? rr[0] : { op: Op.ALT, children: rr };
              return { op: Op.FAST_REP_BITSET_ALT, bitset: bbs, child: rrOp, min: node.mode === 'one_or_more' ? 1 : 0 };
            }
          }
          if (child.op === Op.FAST_ALT_BYTE_FIRST) {
            return { op: Op.FAST_REP_BITSET_ALT, bitset: child.bitset!, child: child.child!, min: node.mode === 'one_or_more' ? 1 : 0 };
          }
        }
        if (node.mode === 'exactly' && child.op !== Op.CHAR_CLASS_ANY) {
          const bs = opToBitset(child);
          if (bs) {
            return { op: Op.FAST_EXACTLY_BITSET, bitset: bs, min: node.min };
          }
        }
        if (node.mode === 'between' && child.op !== Op.CHAR_CLASS_ANY) {
          const bs = opToBitset(child);
          if (bs) {
            return { op: Op.FAST_BETWEEN_BITSET, bitset: bs, min: node.min, max: node.max };
          }
        }
        switch (node.mode) {
          case 'one_or_more': return { op: Op.REP_ONE_OR_MORE, child };
          case 'zero_or_more': return { op: Op.REP_ZERO_OR_MORE, child };
          case 'optional': return { op: Op.REP_OPTIONAL, child };
          case 'exactly': return { op: Op.REP_EXACTLY, child, min: node.min };
          case 'between': return { op: Op.REP_BETWEEN, child, min: node.min, max: node.max };
          default: return { op: Op.REP_ZERO_OR_MORE, child };
        }
      }

      case 'joined_by': {
        const element = compileNode(node.element);
        const separator = compileNode(node.separator);
        if (!node.lenient && separator.op === Op.BYTE) {
          const elemBs = opToBitset(element);
          if (elemBs) {
            return { op: Op.FAST_JOINED_BITSET_BYTE, bitset: elemBs, byte: separator.byte };
          }
          if (element.op === Op.ALT && element.children && element.children.length >= 2) {
            let bci = -1;
            for (let ci = 0; ci < element.children.length; ci++) {
              if (opToBitset(element.children[ci])) { bci = ci; break; }
            }
            if (bci >= 0) {
              const bbs = opToBitset(element.children[bci])!;
              const rr: CompiledOp[] = [];
              for (let ci = 0; ci < element.children.length; ci++) if (ci !== bci) rr.push(element.children[ci]);
              const rrOp = rr.length === 1 ? rr[0] : { op: Op.ALT, children: rr };
              return { op: Op.FAST_JOINED_BYTE, child: { op: Op.FAST_ALT_BYTE_FIRST, bitset: bbs, child: rrOp }, byte: separator.byte };
            }
          }
          if (element.op === Op.FAST_ALT_BYTE_FIRST) {
            return { op: Op.FAST_JOINED_BYTE, child: element, byte: separator.byte };
          }
          return { op: Op.FAST_JOINED_BYTE, child: element, byte: separator.byte };
        }
        return { op: node.lenient ? Op.JOINED_BY_LENIENT : Op.JOINED_BY, child: element, separator };
      }

      case 'text_block':
        return { op: Op.TEXT, textBytes: encoder.encode(node.text) };

      case 'rule_ref': {
        const idx = ruleMap.get(node.name);
        if (idx !== undefined) {
          if (isInlinable(program.rules[idx].body)) return compileNode(program.rules[idx].body);
          if (canDeepInline(idx)) return compileNode(program.rules[idx].body);
          return { op: Op.RULE_REF, ruleIdx: idx };
        }
        return { op: Op.RULE_REF, ruleIdx: -1 };
      }

      case 'group': return compileNode(node.child);
      case 'extract': return { op: Op.EXTRACT, child: compileNode(node.child) };

      case 'until':
        return { op: node.mode === 'including' ? Op.UNTIL_INCL : Op.UNTIL_EXCL, child: compileNode(node.child), terminator: compileNode(node.terminator) };

      case 'isnt':
        return { op: Op.ISNT, child: compileNode(node.child), negated: compileNode(node.negated) };

      default:
        return { op: Op.BITSET, bitset: new Uint32Array(8) };
    }
  }

  const rules = program.rules.map(r => compileNode(r.body));
  const entryIdx = ruleMap.get(program.entryPoint) ?? 0;

  const MAX_INLINE_SIZE = 16;
  const ruleSizes = rules.map(r => opSize(r));

  function inlineSmallRules(op: CompiledOp): CompiledOp {
    if (op.op === Op.RULE_REF && op.ruleIdx! >= 0 && ruleSizes[op.ruleIdx!] <= MAX_INLINE_SIZE) {
      return cloneOp(rules[op.ruleIdx!]);
    }
    if (op.child) op.child = inlineSmallRules(op.child);
    if (op.child2) op.child2 = inlineSmallRules(op.child2);
    if (op.child3) op.child3 = inlineSmallRules(op.child3);
    if (op.children) op.children = op.children.map(inlineSmallRules);
    if (op.separator) op.separator = inlineSmallRules(op.separator);
    if (op.terminator) op.terminator = inlineSmallRules(op.terminator);
    if (op.negated) op.negated = inlineSmallRules(op.negated);
    if (op.flatTail) op.flatTail = op.flatTail.map(inlineSmallRules);
    return op;
  }

  function cloneOp(op: CompiledOp): CompiledOp {
    const c: CompiledOp = { op: op.op };
    if (op.byte !== undefined) c.byte = op.byte;
    if (op.low !== undefined) c.low = op.low;
    if (op.high !== undefined) c.high = op.high;
    if (op.bitset) c.bitset = op.bitset;
    if (op.textBytes) c.textBytes = op.textBytes;
    if (op.min !== undefined) c.min = op.min;
    if (op.max !== undefined) c.max = op.max;
    if (op.ruleIdx !== undefined) c.ruleIdx = op.ruleIdx;
    if (op.child) c.child = cloneOp(op.child);
    if (op.child2) c.child2 = cloneOp(op.child2);
    if (op.child3) c.child3 = cloneOp(op.child3);
    if (op.children) c.children = op.children.map(cloneOp);
    if (op.separator) c.separator = cloneOp(op.separator);
    if (op.terminator) c.terminator = cloneOp(op.terminator);
    if (op.negated) c.negated = cloneOp(op.negated);
    if (op.flatSteps) c.flatSteps = op.flatSteps;
    if (op.flatTail) c.flatTail = op.flatTail.map(cloneOp);
    if (op.leadByte !== undefined) c.leadByte = op.leadByte;
    return c;
  }

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 0; i < rules.length; i++) {
      const before = rules[i];
      rules[i] = inlineSmallRules(rules[i]);
      if (rules[i] !== before) changed = true;
    }
    if (!changed) break;
    for (let i = 0; i < rules.length; i++) ruleSizes[i] = opSize(rules[i]);
  }

  function postOptimize(op: CompiledOp): CompiledOp {
    if (op.child) op.child = postOptimize(op.child);
    if (op.child2) op.child2 = postOptimize(op.child2);
    if (op.child3) op.child3 = postOptimize(op.child3);
    if (op.children) op.children = op.children.map(postOptimize);
    if (op.separator) op.separator = postOptimize(op.separator);
    if (op.terminator) op.terminator = postOptimize(op.terminator);
    if (op.negated) op.negated = postOptimize(op.negated);
    if (op.flatTail) op.flatTail = op.flatTail.map(postOptimize);
    if (op.flatSteps) {
      for (const fs of op.flatSteps) {
        if (fs.child) fs.child = postOptimize(fs.child);
        if (fs.fop === FlatOp.F_REP_OPTIONAL && fs.child && fs.leadByte === undefined && !fs.leadBitset) {
          const inner = fs.child;
          if (inner.op === Op.BYTE) fs.leadByte = inner.byte;
          else if ((inner.op === Op.FAST_SEQ2 || inner.op === Op.FAST_SEQ3) && inner.child && inner.child.op === Op.BYTE) fs.leadByte = inner.child.byte;
          else if ((inner.op === Op.FAST_SEQ_BYTES || inner.op === Op.TEXT) && inner.textBytes && inner.textBytes.length > 0) fs.leadByte = inner.textBytes[0];
          else if ((inner.op === Op.REP_ONE_OR_MORE || inner.op === Op.REP_ZERO_OR_MORE) && inner.leadByte !== undefined) fs.leadByte = inner.leadByte;
          else if ((inner.op === Op.REP_ONE_OR_MORE || inner.op === Op.REP_ZERO_OR_MORE) && inner.leadBitset) fs.leadBitset = inner.leadBitset;
          else if (inner.op === Op.FAST_SEQ_FLAT && inner.flatSteps && inner.flatSteps.length > 0) {
            const fs0 = inner.flatSteps[0];
            if (fs0.fop === FlatOp.F_BYTE) fs.leadByte = fs0.byte;
            else if (fs0.fop === FlatOp.F_BITSET) fs.leadBitset = fs0.bitset;
            else if (fs0.fop === FlatOp.F_REPEAT_BITSET || fs0.fop === FlatOp.F_EXACTLY_BITSET || fs0.fop === FlatOp.F_BETWEEN_BITSET) fs.leadBitset = fs0.bitset;
          }
          if (fs.leadByte === undefined && !fs.leadBitset) {
            const lbs = opLeadingBitset(inner);
            if (lbs) fs.leadBitset = lbs;
          }
        }
      }
    }
    if (op.op === Op.SEQ && op.children) {
      const flat = tryFlatSeq(op.children);
      if (flat) return flat;
    }
    if (op.op === Op.FAST_SEQ2) {
      const steps: FlatStep[] = [];
      if (pushFlatSteps(op, steps) && steps.length >= 4) {
        return { op: Op.FAST_SEQ_FLAT, flatSteps: mergeFlatSteps(steps) };
      }
    }
    if (op.op === Op.FAST_SEQ3) {
      const steps: FlatStep[] = [];
      if (pushFlatSteps(op, steps) && steps.length >= 4) {
        return { op: Op.FAST_SEQ_FLAT, flatSteps: mergeFlatSteps(steps) };
      }
    }
    if (op.op === Op.ALT && op.children && op.children.length >= 2) {
      if (op.children.every(c => isSingleByteOp(c))) {
        const allBytes: number[] = [];
        let ok = true;
        for (const c of op.children) {
          const bs = opToBitset(c);
          if (!bs) { ok = false; break; }
          for (let w = 0; w < 8; w++) for (let bit = 0; bit < 32; bit++) if (bs[w] & (1 << bit)) allBytes.push(w * 32 + bit);
        }
        if (ok && allBytes.length > 0) return { op: Op.BITSET, bitset: makeBitset(allBytes) };
      }
      let byteIdx = -1;
      for (let ci = 0; ci < op.children.length; ci++) {
        if (opToBitset(op.children[ci])) { byteIdx = ci; break; }
      }
      if (byteIdx >= 0) {
        const byteBs = opToBitset(op.children[byteIdx])!;
        const rest: CompiledOp[] = [];
        for (let ci = 0; ci < op.children.length; ci++) if (ci !== byteIdx) rest.push(op.children[ci]);
        const restOp = rest.length === 1 ? rest[0] : { op: Op.ALT, children: rest };
        return { op: Op.FAST_ALT_BYTE_FIRST, bitset: byteBs, child: restOp };
      }
      if (op.children.length === 2) {
        const lb0 = opLeadingBitset(op.children[0]);
        const lb1 = opLeadingBitset(op.children[1]);
        if (lb0 && lb1) {
          let disjoint = true;
          for (let w = 0; w < 8; w++) { if ((lb0[w] & lb1[w]) !== 0) { disjoint = false; break; } }
          if (disjoint) {
            return { op: Op.FAST_ALT_LEAD_DISPATCH, bitset: lb0, child: op.children[0], child2: op.children[1] };
          }
        }
      }
    }
    if ((op.op === Op.REP_ZERO_OR_MORE || op.op === Op.REP_ONE_OR_MORE || op.op === Op.REP_OPTIONAL) && op.child) {
      const ch = op.child;
      const rlb = opToFixedByte(ch) ?? opToFixedByte(ch.op === Op.FAST_SEQ2 || ch.op === Op.FAST_SEQ3 ? ch.child! : ch)
        ?? ((ch.op === Op.FAST_SEQ_BYTES || ch.op === Op.TEXT) && ch.textBytes!.length > 0 ? ch.textBytes![0] : null);
      if (rlb !== null) op.leadByte = rlb;
      else {
        const lbs = opLeadingBitset(ch);
        if (lbs) op.leadBitset = lbs;
      }
    }
    if ((op.op === Op.REP_ZERO_OR_MORE || op.op === Op.REP_ONE_OR_MORE) && op.child) {
      const bs = opToBitset(op.child);
      if (bs && op.child.op !== Op.CHAR_CLASS_ANY) {
        return { op: Op.FAST_REPEAT_BITSET, bitset: bs, min: op.op === Op.REP_ONE_OR_MORE ? 1 : 0 };
      }
      if (op.child.op === Op.ALT && op.child.children && op.child.children.length >= 2) {
        let bci2 = -1;
        for (let ci = 0; ci < op.child.children.length; ci++) {
          if (opToBitset(op.child.children[ci])) { bci2 = ci; break; }
        }
        if (bci2 >= 0) {
          const bbs2 = opToBitset(op.child.children[bci2])!;
          const rr2: CompiledOp[] = [];
          for (let ci = 0; ci < op.child.children.length; ci++) if (ci !== bci2) rr2.push(op.child.children[ci]);
          const rrOp2 = rr2.length === 1 ? rr2[0] : { op: Op.ALT, children: rr2 };
          return { op: Op.FAST_REP_BITSET_ALT, bitset: bbs2, child: rrOp2, min: op.op === Op.REP_ONE_OR_MORE ? 1 : 0 };
        }
      }
      if (op.child.op === Op.FAST_ALT_BYTE_FIRST) {
        return { op: Op.FAST_REP_BITSET_ALT, bitset: op.child.bitset!, child: op.child.child!, min: op.op === Op.REP_ONE_OR_MORE ? 1 : 0 };
      }
    }
    if (op.op === Op.FAST_SEQ_FLAT && op.flatSteps && op.flatSteps.length >= 3) {
      let fixedLen = 0;
      let fixedCount = 0;
      for (const fs of op.flatSteps) {
        if (fs.fop === FlatOp.F_BYTE) { fixedLen += 1; fixedCount++; }
        else if (fs.fop === FlatOp.F_EXACTLY_BITSET) { fixedLen += fs.min!; fixedCount++; }
        else if (fs.fop === FlatOp.F_SEQ_BYTES) { fixedLen += fs.textBytes!.length; fixedCount++; }
        else if (fs.fop === FlatOp.F_BITSET) { fixedLen += 1; fixedCount++; }
        else break;
      }
      if (fixedLen >= 4 && fixedCount >= 3) {
        const tpl = new Uint32Array(fixedLen * 8);
        let off = 0;
        for (let fi = 0; fi < fixedCount; fi++) {
          const fs = op.flatSteps[fi];
          if (fs.fop === FlatOp.F_BYTE) {
            tpl[off * 8 + (fs.byte! >>> 5)] |= 1 << (fs.byte! & 31);
            off++;
          } else if (fs.fop === FlatOp.F_BITSET) {
            const bs = fs.bitset!;
            for (let w = 0; w < 8; w++) tpl[off * 8 + w] = bs[w];
            off++;
          } else if (fs.fop === FlatOp.F_EXACTLY_BITSET) {
            const bs = fs.bitset!;
            const n = fs.min!;
            for (let i = 0; i < n; i++) {
              for (let w = 0; w < 8; w++) tpl[(off + i) * 8 + w] = bs[w];
            }
            off += n;
          } else if (fs.fop === FlatOp.F_SEQ_BYTES) {
            const tb = fs.textBytes!;
            for (let i = 0; i < tb.length; i++) {
              tpl[(off + i) * 8 + (tb[i] >>> 5)] |= 1 << (tb[i] & 31);
            }
            off += tb.length;
          }
        }
        op.fixedPrefix = tpl;
        op.fixedPrefixLen = fixedLen;
        op.fixedPrefixSteps = fixedCount;
      }
    }
    return op;
  }
  for (let i = 0; i < rules.length; i++) {
    rules[i] = postOptimize(rules[i]);
  }

  const refCounts = new Int32Array(ruleNames.length);
  function countRefs(op: CompiledOp) {
    if (op.op === Op.RULE_REF && op.ruleIdx! >= 0) refCounts[op.ruleIdx!]++;
    if (op.children) op.children.forEach(countRefs);
    if (op.child) countRefs(op.child);
    if (op.child2) countRefs(op.child2);
    if (op.child3) countRefs(op.child3);
    if (op.separator) countRefs(op.separator);
    if (op.terminator) countRefs(op.terminator);
    if (op.negated) countRefs(op.negated);
    if (op.flatTail) op.flatTail.forEach(countRefs);
  }
  rules.forEach(countRefs);
  const needsMemo = refCounts.some(c => c > 1);

  let hasExtract = false;
  function checkExtract(op: CompiledOp) {
    if (hasExtract) return;
    if (op.op === Op.EXTRACT) { hasExtract = true; return; }
    if (op.child) checkExtract(op.child);
    if (op.child2) checkExtract(op.child2);
    if (op.child3) checkExtract(op.child3);
    if (op.children) op.children.forEach(checkExtract);
    if (op.separator) checkExtract(op.separator);
    if (op.terminator) checkExtract(op.terminator);
    if (op.negated) checkExtract(op.negated);
    if (op.flatTail) op.flatTail.forEach(checkExtract);
    if (op.flatSteps) for (const fs of op.flatSteps) if (fs.child) checkExtract(fs.child);
  }
  rules.forEach(checkExtract);

  function isInlinableStep(s: FlatStep): boolean {
    if (s.fop === FlatOp.F_JOINED_BYTE) return false;
    if (s.fop === FlatOp.F_REP_OPTIONAL) {
      if (s.leadByte === undefined && !s.leadBitset) return false;
      const inner = s.child!;
      if (inner.op === Op.BYTE) return true;
      if (inner.op === Op.FAST_SEQ2 && inner.child!.op === Op.BYTE
          && (inner.child2!.op === Op.FAST_REPEAT_BITSET || inner.child2!.op === Op.FAST_BETWEEN_BITSET || inner.child2!.op === Op.FAST_EXACTLY_BITSET || inner.child2!.op === Op.FAST_JOINED_BITSET_BYTE)) return true;
      if (inner.op === Op.REP_ONE_OR_MORE && inner.child!.op === Op.FAST_SEQ2 && inner.child!.child!.op === Op.BYTE && inner.child!.child2!.op === Op.FAST_REPEAT_BITSET) return true;
      return false;
    }
    if (s.fop === FlatOp.F_EXEC) {
      const ec = s.child!;
      if (ec.op === Op.FAST_ALT_BYTE_FIRST) {
        const ecf = ec.child!;
        if (ecf.op === Op.FAST_SEQ_FLAT && ecf.fixedPrefix && ecf.fixedPrefixSteps === ecf.flatSteps!.length && (!ecf.flatTail || ecf.flatTail.length === 0)) return true;
        if (ecf.op === Op.BYTE || isSingleByteOp(ecf)) return true;
        return false;
      }
      if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
        const dc1 = ec.child!;
        const dc2 = ec.child2!;
        if ((dc1.op === Op.FAST_REPEAT_BITSET || isSingleByteOp(dc1)) &&
            (dc2.op === Op.FAST_REPEAT_BITSET || isSingleByteOp(dc2) ||
             (dc2.op === Op.FAST_SEQ3 && dc2.child!.op === Op.BYTE && dc2.child2!.op === Op.FAST_REPEAT_BITSET && dc2.child3!.op === Op.BYTE))) return true;
        return false;
      }
      return false;
    }
    return true;
  }
  function isInlinableFlatSeq(op: CompiledOp): boolean {
    if (op.op !== Op.FAST_SEQ_FLAT || !op.flatSteps) return false;
    if (op.flatTail && op.flatTail.length > 0) return false;
    return op.flatSteps.every(isInlinableStep);
  }
  let fullyFlat = false;
  const eop = rules[entryIdx];
  if (eop.op === Op.FAST_SEQ_FLAT && eop.flatSteps) {
    const noTail = !eop.flatTail || eop.flatTail.length === 0;
    const repTail = !noTail && eop.flatTail!.length === 1
      && (eop.flatTail![0].op === Op.REP_ZERO_OR_MORE || eop.flatTail![0].op === Op.REP_ONE_OR_MORE)
      && eop.flatTail![0].child!.op === Op.FAST_SEQ_FLAT
      && isInlinableFlatSeq(eop.flatTail![0].child!);
    if (noTail || repTail) {
      fullyFlat = eop.flatSteps.every(isInlinableStep);
    }
  }
  return { rules, ruleNames, entryIdx, entryPoint: program.entryPoint, source: program, needsMemo, hasExtract, fullyFlat };
}

export function fastMatch(cp: CompiledProgram, input: Uint8Array): number {
  const len = input.length;
  const rules = cp.rules;
  const entry = rules[cp.entryIdx];

  switch (entry.op) {
    case Op.TEXT:
    case Op.FAST_SEQ_BYTES: {
      const tb = entry.textBytes!;
      const tlen = tb.length;
      if (len !== tlen) return -1;
      for (let i = 0; i < tlen; i++) {
        if (input[i] !== tb[i]) return -1;
      }
      return tlen;
    }
    case Op.BYTE:
      return len === 1 && input[0] === entry.byte! ? 1 : -1;
    case Op.BITSET: {
      if (len !== 1) return -1;
      const bs = entry.bitset!; const b = input[0];
      return (bs[b >>> 5] & (1 << (b & 31))) !== 0 ? 1 : -1;
    }
    case Op.CHAR_CLASS_LETTER: {
      if (len !== 1) return -1;
      const c = input[0];
      return ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) ? 1 : -1;
    }
    case Op.CHAR_CLASS_DIGIT:
      return len === 1 && input[0] >= 0x30 && input[0] <= 0x39 ? 1 : -1;
    case Op.CHAR_CLASS_PRINTABLE:
      return len === 1 && input[0] >= 0x20 && input[0] <= 0x7E ? 1 : -1;
    case Op.CHAR_CLASS_VISIBLE:
      return len === 1 && input[0] >= 0x21 && input[0] <= 0x7E ? 1 : -1;
    case Op.CHAR_CLASS_ALPHANUM: {
      if (len !== 1) return -1;
      const c = input[0];
      return ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39)) ? 1 : -1;
    }
    case Op.CHAR_CLASS_WORD: {
      if (len !== 1) return -1;
      const c = input[0];
      return ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c === 0x5F) ? 1 : -1;
    }
    case Op.CHAR_CLASS_HEX: {
      if (len !== 1) return -1;
      const c = input[0];
      return ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)) ? 1 : -1;
    }
    case Op.CHAR_CLASS_ANY:
      if (len < 1) return -1;
      { const lb = input[0]; const step = lb < 0x80 ? 1 : lb < 0xE0 ? 2 : lb < 0xF0 ? 3 : 4; return step === len ? step : -1; }
    case Op.NOT_BITSET: {
      if (len !== 1) return -1;
      const bs = entry.bitset!; const b = input[0];
      return (bs[b >>> 5] & (1 << (b & 31))) === 0 ? 1 : -1;
    }
    case Op.BYTE_RANGE: {
      if (len !== 1) return -1;
      const b = input[0];
      return b >= entry.low! && b <= entry.high! ? 1 : -1;
    }
    case Op.FAST_REPEAT_BITSET: {
      const bs = entry.bitset!;
      let p = 0;
      while (p < len) {
        const b = input[p];
        if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
        p++;
      }
      return p >= entry.min! ? p : -1;
    }
    case Op.FAST_EXACTLY_BITSET: {
      const bs = entry.bitset!;
      const n = entry.min!;
      if (len < n) return -1;
      for (let i = 0; i < n; i++) {
        const b = input[i];
        if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
      }
      return n;
    }
    case Op.FAST_BETWEEN_BITSET: {
      const bs = entry.bitset!;
      const lo = entry.min!;
      const hi = entry.max!;
      let p = 0;
      let count = 0;
      while (p < len && count < hi) {
        const b = input[p];
        if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
        p++;
        count++;
      }
      return count >= lo ? p : -1;
    }
    case Op.FAST_JOINED_BITSET_BYTE: {
      const bs = entry.bitset!;
      const sep = entry.byte!;
      let p = 0;
      if (p >= len) return -1;
      let b = input[p];
      if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
      p++;
      while (p < len) {
        b = input[p];
        if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) { p++; continue; }
        if (b !== sep) break;
        if (p + 1 >= len) break;
        const nb = input[p + 1];
        if ((bs[nb >>> 5] & (1 << (nb & 31))) === 0) break;
        p += 2;
      }
      return p;
    }
    case Op.ALT: {
      const ch = entry.children!;
      for (let i = 0; i < ch.length; i++) {
        const alt = ch[i];
        if (alt.op === Op.TEXT || alt.op === Op.FAST_SEQ_BYTES) {
          const tb = alt.textBytes!;
          const tl = tb.length;
          if (len === tl) {
            let ok = true;
            for (let j = 0; j < tl; j++) { if (input[j] !== tb[j]) { ok = false; break; } }
            if (ok) return tl;
          }
        } else if (alt.op === Op.BYTE) {
          if (len === 1 && input[0] === alt.byte!) return 1;
        } else if (alt.op === Op.BITSET) {
          if (len === 1) {
            const bs = alt.bitset!; const b = input[0];
            if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) return 1;
          }
        } else {
          break;
        }
      }
      break;
    }
    case Op.FAST_ALT_LEAD_DISPATCH: {
      if (len < 1) break;
      const dbs = entry.bitset!; const db = input[0];
      const branch = (dbs[db >>> 5] & (1 << (db & 31))) !== 0 ? entry.child! : entry.child2!;
      if (branch.op === Op.TEXT || branch.op === Op.FAST_SEQ_BYTES) {
        const tb = branch.textBytes!; const tl = tb.length;
        if (len !== tl) break;
        for (let i = 0; i < tl; i++) { if (input[i] !== tb[i]) return -1; }
        return tl;
      }
      if (branch.op === Op.FAST_REPEAT_BITSET) {
        const bs = branch.bitset!;
        let p = 0;
        while (p < len) {
          const b = input[p];
          if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
          p++;
        }
        return p >= branch.min! ? p : -1;
      }
      break;
    }
    case Op.FAST_ALT_BYTE_FIRST: {
      if (len >= 1) {
        const bs = entry.bitset!; const b = input[0];
        if (len === 1 && (bs[b >>> 5] & (1 << (b & 31))) !== 0) return 1;
      }
      const fb = entry.child!;
      if (fb.op === Op.TEXT || fb.op === Op.FAST_SEQ_BYTES) {
        const tb = fb.textBytes!; const tl = tb.length;
        if (len !== tl) break;
        for (let i = 0; i < tl; i++) { if (input[i] !== tb[i]) return -1; }
        return tl;
      }
      if (fb.op === Op.ALT && fb.children) {
        for (let i = 0; i < fb.children.length; i++) {
          const alt = fb.children[i];
          if (alt.op === Op.TEXT || alt.op === Op.FAST_SEQ_BYTES) {
            const tb = alt.textBytes!; const tl = tb.length;
            if (len === tl) {
              let ok = true;
              for (let j = 0; j < tl; j++) { if (input[j] !== tb[j]) { ok = false; break; } }
              if (ok) return tl;
            }
          } else break;
        }
      }
      break;
    }
  }

  if (cp.fullyFlat) {
    {
      const steps = entry.flatSteps!;
      let p = 0;
      const fpx = entry.fixedPrefix;
      if (fpx) {
        const fpLen = entry.fixedPrefixLen!;
        if (fpLen > len) return -1;
        for (let i = 0; i < fpLen; i++) {
          const b = input[i];
          if ((fpx[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) return -1;
        }
        p = fpLen;
        if (entry.fixedPrefixSteps === steps.length) return p;
        for (let si = entry.fixedPrefixSteps!; si < steps.length; si++) {
          const st = steps[si];
          switch (st.fop) {
            case FlatOp.F_BYTE: if (p >= len || input[p] !== st.byte!) return -1; p++; break;
            case FlatOp.F_BITSET: { if (p >= len) return -1; const bs = st.bitset!; const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1; p++; break; }
            case FlatOp.F_EXACTLY_BITSET: { const bs = st.bitset!; const n = st.min!; if (p + n > len) return -1; for (let i = 0; i < n; i++) { const b = input[p + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1; } p += n; break; }
            case FlatOp.F_SEQ_BYTES: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) return -1; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; } p += tl; break; }
            case FlatOp.F_BETWEEN_BITSET: { const bs = st.bitset!; const lo = st.min!; const hi = st.max!; let cnt = 0; while (p < len && cnt < hi) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; } if (cnt < lo) return -1; break; }
            case FlatOp.F_REPEAT_BITSET: { const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) return -1; break; }
            case FlatOp.F_LITERAL_REPEAT_BS: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) return -1; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; } p += tl; const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) return -1; break; }
            case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = st.segments!; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (p + tl > len) return -1; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; } p += tl; const bs = sg.bitset; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < sg.min) return -1; } break; }
            case FlatOp.F_JOINED_BITSET_BYTE: { const jbs = st.bitset!; const jsep = st.separator!; if (p >= len) return -1; let jb = input[p]; if ((jbs[jb >>> 5] & (1 << (jb & 31))) === 0) return -1; p++; while (p < len) { jb = input[p]; if ((jbs[jb >>> 5] & (1 << (jb & 31))) !== 0) { p++; continue; } if (jb !== jsep || p + 1 >= len) break; const nb = input[p + 1]; if ((jbs[nb >>> 5] & (1 << (nb & 31))) === 0) break; p += 2; } break; }
            case FlatOp.F_REP_OPTIONAL: {
              if (st.leadByte !== undefined) { if (p >= len || input[p] !== st.leadByte) break; }
              else if (st.leadBitset) { if (p >= len) break; const lbs = st.leadBitset; const lb = input[p]; if ((lbs[lb >>> 5] & (1 << (lb & 31))) === 0) break; }
              const inner = st.child!;
              if (inner.op === Op.BYTE) { p++; }
              else if (inner.op === Op.FAST_SEQ2 && inner.child!.op === Op.BYTE) {
                const c2 = inner.child2!;
                if (c2.op === Op.FAST_REPEAT_BITSET) { const rbs = c2.bitset!; const rmi = c2.min!; const sp = p + 1; let rp = sp; while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; } if ((rp - sp) >= rmi) p = rp; }
                else if (c2.op === Op.FAST_BETWEEN_BITSET) { const rbs = c2.bitset!; const rmi = c2.min!; const rma = c2.max!; const sp = p + 1; let rp = sp; let rc = 0; while (rp < len && rc < rma) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; rc++; } if (rc >= rmi) p = rp; }
                else if (c2.op === Op.FAST_EXACTLY_BITSET) { const rbs = c2.bitset!; const rn = c2.min!; const sp = p + 1; if (sp + rn <= len) { let ok = true; for (let ri = 0; ri < rn; ri++) { const b = input[sp + ri]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) { ok = false; break; } } if (ok) p = sp + rn; } }
                else if (c2.op === Op.FAST_JOINED_BITSET_BYTE) { const jbs2 = c2.bitset!; const jsep2 = c2.byte!; const sp = p + 1; if (sp < len) { let jb2 = input[sp]; if ((jbs2[jb2 >>> 5] & (1 << (jb2 & 31))) !== 0) { let jp2 = sp + 1; while (jp2 < len) { jb2 = input[jp2]; if ((jbs2[jb2 >>> 5] & (1 << (jb2 & 31))) !== 0) { jp2++; continue; } if (jb2 !== jsep2 || jp2 + 1 >= len) break; const nb2 = input[jp2 + 1]; if ((jbs2[nb2 >>> 5] & (1 << (nb2 & 31))) === 0) break; jp2 += 2; } p = jp2; } } }
              }
              else if (inner.op === Op.REP_ONE_OR_MORE && inner.child!.op === Op.FAST_SEQ2 && inner.child!.child!.op === Op.BYTE && inner.child!.child2!.op === Op.FAST_REPEAT_BITSET) {
                const rlb = inner.child!.child!.byte!; const rbs = inner.child!.child2!.bitset!; const rmi = inner.child!.child2!.min!;
                let rp = p;
                if (rp < len && input[rp] === rlb) { rp++; const s0 = rp; while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; } if ((rp - s0) >= rmi) { while (rp < len && input[rp] === rlb) { rp++; const s1 = rp; while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; } if ((rp - s1) < rmi) { rp = s1 - 1; break; } } p = rp; } }
              }
              break;
            }
            case FlatOp.F_EXEC: {
              const ec = st.child!;
              if (ec.op === Op.FAST_ALT_BYTE_FIRST) {
                if (p < len) { const ebs = ec.bitset!; const eb = input[p]; if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; } }
                const ecf = ec.child!;
                if (ecf.op === Op.FAST_SEQ_FLAT && ecf.fixedPrefix) {
                  const efp = ecf.fixedPrefix; const efpLen = ecf.fixedPrefixLen!;
                  if (p + efpLen > len) return -1;
                  for (let i = 0; i < efpLen; i++) { const b = input[p + i]; if ((efp[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) return -1; }
                  p += efpLen;
                } else if (ecf.op === Op.BYTE) { if (p >= len || input[p] !== ecf.byte!) return -1; p++; }
                else { const ebs2 = opToBitset(ecf); if (ebs2) { if (p >= len) return -1; const eb2 = input[p]; if ((ebs2[eb2 >>> 5] & (1 << (eb2 & 31))) === 0) return -1; p++; } else return -1; }
              } else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                if (p >= len) return -1;
                const dbs = ec.bitset!; const db = input[p];
                if ((dbs[db >>> 5] & (1 << (db & 31))) !== 0) {
                  const dc = ec.child!;
                  if (dc.op === Op.FAST_REPEAT_BITSET) { const dcbs = dc.bitset!; const dcmi = dc.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) return -1; }
                  else if (isSingleByteOp(dc)) { const dcbs = opToBitset(dc)!; if ((dcbs[db >>> 5] & (1 << (db & 31))) === 0) return -1; p++; }
                  else return -1;
                } else {
                  const dc2 = ec.child2!;
                  if (dc2.op === Op.FAST_REPEAT_BITSET) { const dcbs = dc2.bitset!; const dcmi = dc2.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) return -1; }
                  else if (dc2.op === Op.FAST_SEQ3 && dc2.child!.op === Op.BYTE && dc2.child2!.op === Op.FAST_REPEAT_BITSET && dc2.child3!.op === Op.BYTE) {
                    if (p >= len || input[p] !== dc2.child!.byte!) return -1; p++;
                    const dcbs = dc2.child2!.bitset!; const dcmi = dc2.child2!.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) return -1;
                    if (p >= len || input[p] !== dc2.child3!.byte!) return -1; p++;
                  }
                  else if (isSingleByteOp(dc2)) { const dcbs = opToBitset(dc2)!; if ((dcbs[db >>> 5] & (1 << (db & 31))) === 0) return -1; p++; }
                  else return -1;
                }
              } else return -1;
              break;
            }
          }
        }
      } else {
        for (let si = 0; si < steps.length; si++) {
          const st = steps[si];
          switch (st.fop) {
            case FlatOp.F_BYTE: if (p >= len || input[p] !== st.byte!) return -1; p++; break;
            case FlatOp.F_BITSET: { if (p >= len) return -1; const bs = st.bitset!; const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1; p++; break; }
            case FlatOp.F_EXACTLY_BITSET: { const bs = st.bitset!; const n = st.min!; if (p + n > len) return -1; for (let i = 0; i < n; i++) { const b = input[p + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1; } p += n; break; }
            case FlatOp.F_SEQ_BYTES: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) return -1; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; } p += tl; break; }
            case FlatOp.F_BETWEEN_BITSET: { const bs = st.bitset!; const lo = st.min!; const hi = st.max!; let cnt = 0; while (p < len && cnt < hi) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; } if (cnt < lo) return -1; break; }
            case FlatOp.F_REPEAT_BITSET: { const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) return -1; break; }
            case FlatOp.F_LITERAL_REPEAT_BS: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) return -1; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; } p += tl; const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) return -1; break; }
            case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = st.segments!; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (p + tl > len) return -1; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; } p += tl; const bs = sg.bitset; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < sg.min) return -1; } break; }
            case FlatOp.F_JOINED_BITSET_BYTE: { const jbs = st.bitset!; const jsep = st.separator!; if (p >= len) return -1; let jb = input[p]; if ((jbs[jb >>> 5] & (1 << (jb & 31))) === 0) return -1; p++; while (p < len) { jb = input[p]; if ((jbs[jb >>> 5] & (1 << (jb & 31))) !== 0) { p++; continue; } if (jb !== jsep || p + 1 >= len) break; const nb = input[p + 1]; if ((jbs[nb >>> 5] & (1 << (nb & 31))) === 0) break; p += 2; } break; }
            case FlatOp.F_REP_OPTIONAL: {
              if (st.leadByte !== undefined) { if (p >= len || input[p] !== st.leadByte) break; }
              else if (st.leadBitset) { if (p >= len) break; const lbs = st.leadBitset; const lb = input[p]; if ((lbs[lb >>> 5] & (1 << (lb & 31))) === 0) break; }
              const inner = st.child!;
              if (inner.op === Op.BYTE) { p++; }
              else if (inner.op === Op.FAST_SEQ2 && inner.child!.op === Op.BYTE) {
                const c2 = inner.child2!;
                if (c2.op === Op.FAST_REPEAT_BITSET) { const rbs = c2.bitset!; const rmi = c2.min!; const sp = p + 1; let rp = sp; while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; } if ((rp - sp) >= rmi) p = rp; }
                else if (c2.op === Op.FAST_BETWEEN_BITSET) { const rbs = c2.bitset!; const rmi = c2.min!; const rma = c2.max!; const sp = p + 1; let rp = sp; let rc = 0; while (rp < len && rc < rma) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; rc++; } if (rc >= rmi) p = rp; }
                else if (c2.op === Op.FAST_EXACTLY_BITSET) { const rbs = c2.bitset!; const rn = c2.min!; const sp = p + 1; if (sp + rn <= len) { let ok = true; for (let ri = 0; ri < rn; ri++) { const b = input[sp + ri]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) { ok = false; break; } } if (ok) p = sp + rn; } }
                else if (c2.op === Op.FAST_JOINED_BITSET_BYTE) { const jbs2 = c2.bitset!; const jsep2 = c2.byte!; const sp = p + 1; if (sp < len) { let jb2 = input[sp]; if ((jbs2[jb2 >>> 5] & (1 << (jb2 & 31))) !== 0) { let jp2 = sp + 1; while (jp2 < len) { jb2 = input[jp2]; if ((jbs2[jb2 >>> 5] & (1 << (jb2 & 31))) !== 0) { jp2++; continue; } if (jb2 !== jsep2 || jp2 + 1 >= len) break; const nb2 = input[jp2 + 1]; if ((jbs2[nb2 >>> 5] & (1 << (nb2 & 31))) === 0) break; jp2 += 2; } p = jp2; } } }
              }
              else if (inner.op === Op.REP_ONE_OR_MORE && inner.child!.op === Op.FAST_SEQ2 && inner.child!.child!.op === Op.BYTE && inner.child!.child2!.op === Op.FAST_REPEAT_BITSET) {
                const rlb = inner.child!.child!.byte!; const rbs = inner.child!.child2!.bitset!; const rmi = inner.child!.child2!.min!;
                let rp = p;
                if (rp < len && input[rp] === rlb) { rp++; const s0 = rp; while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; } if ((rp - s0) >= rmi) { while (rp < len && input[rp] === rlb) { rp++; const s1 = rp; while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; } if ((rp - s1) < rmi) { rp = s1 - 1; break; } } p = rp; } }
              }
              break;
            }
            case FlatOp.F_EXEC: {
              const ec = st.child!;
              if (ec.op === Op.FAST_ALT_BYTE_FIRST) {
                if (p < len) { const ebs = ec.bitset!; const eb = input[p]; if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; } }
                const ecf = ec.child!;
                if (ecf.op === Op.FAST_SEQ_FLAT && ecf.fixedPrefix) {
                  const efp = ecf.fixedPrefix; const efpLen = ecf.fixedPrefixLen!;
                  if (p + efpLen > len) return -1;
                  for (let i = 0; i < efpLen; i++) { const b = input[p + i]; if ((efp[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) return -1; }
                  p += efpLen;
                } else if (ecf.op === Op.BYTE) { if (p >= len || input[p] !== ecf.byte!) return -1; p++; }
                else { const ebs2 = opToBitset(ecf); if (ebs2) { if (p >= len) return -1; const eb2 = input[p]; if ((ebs2[eb2 >>> 5] & (1 << (eb2 & 31))) === 0) return -1; p++; } else return -1; }
              } else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                if (p >= len) return -1;
                const dbs = ec.bitset!; const db = input[p];
                if ((dbs[db >>> 5] & (1 << (db & 31))) !== 0) {
                  const dc = ec.child!;
                  if (dc.op === Op.FAST_REPEAT_BITSET) { const dcbs = dc.bitset!; const dcmi = dc.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) return -1; }
                  else if (isSingleByteOp(dc)) { const dcbs = opToBitset(dc)!; if ((dcbs[db >>> 5] & (1 << (db & 31))) === 0) return -1; p++; }
                  else return -1;
                } else {
                  const dc2 = ec.child2!;
                  if (dc2.op === Op.FAST_REPEAT_BITSET) { const dcbs = dc2.bitset!; const dcmi = dc2.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) return -1; }
                  else if (dc2.op === Op.FAST_SEQ3 && dc2.child!.op === Op.BYTE && dc2.child2!.op === Op.FAST_REPEAT_BITSET && dc2.child3!.op === Op.BYTE) {
                    if (p >= len || input[p] !== dc2.child!.byte!) return -1; p++;
                    const dcbs = dc2.child2!.bitset!; const dcmi = dc2.child2!.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) return -1;
                    if (p >= len || input[p] !== dc2.child3!.byte!) return -1; p++;
                  }
                  else if (isSingleByteOp(dc2)) { const dcbs = opToBitset(dc2)!; if ((dcbs[db >>> 5] & (1 << (db & 31))) === 0) return -1; p++; }
                  else return -1;
                }
              } else return -1;
              break;
            }
          }
        }
      }
      const ft = entry.flatTail;
      if (ft && ft.length === 1 && (ft[0].op === Op.REP_ZERO_OR_MORE || ft[0].op === Op.REP_ONE_OR_MORE)) {
        const repBody = ft[0].child!;
        const repMin = ft[0].op === Op.REP_ONE_OR_MORE ? 1 : 0;
        if (repBody.op === Op.FAST_SEQ_FLAT && repBody.flatSteps && (!repBody.flatTail || repBody.flatTail.length === 0)) {
          const rSteps = repBody.flatSteps;
          const rLen = rSteps.length;
          const rLbs = ft[0].leadBitset;
          let repCount = 0;
          ff_rep: while (p < len) {
            if (rLbs) { const lb = input[p]; if ((rLbs[lb >>> 5] & (1 << (lb & 31))) === 0) break; }
            const sp = p;
            for (let ri = 0; ri < rLen; ri++) {
              const rst = rSteps[ri];
              switch (rst.fop) {
                case FlatOp.F_BYTE: if (p >= len || input[p] !== rst.byte!) { p = sp; break ff_rep; } p++; break;
                case FlatOp.F_BITSET: { if (p >= len) { p = sp; break ff_rep; } const bs = rst.bitset!; const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = sp; break ff_rep; } p++; break; }
                case FlatOp.F_EXACTLY_BITSET: { const bs = rst.bitset!; const n = rst.min!; if (p + n > len) { p = sp; break ff_rep; } for (let i = 0; i < n; i++) { const b = input[p + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = sp; break ff_rep; } } p += n; break; }
                case FlatOp.F_SEQ_BYTES: { const tb = rst.textBytes!; const tl = tb.length; if (p + tl > len) { p = sp; break ff_rep; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = sp; break ff_rep; } } p += tl; break; }
                case FlatOp.F_BETWEEN_BITSET: { const bs = rst.bitset!; const lo = rst.min!; const hi = rst.max!; let cnt = 0; while (p < len && cnt < hi) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; } if (cnt < lo) { p = sp; break ff_rep; } break; }
                case FlatOp.F_REPEAT_BITSET: { const bs = rst.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < rst.min!) { p = sp; break ff_rep; } break; }
                case FlatOp.F_LITERAL_REPEAT_BS: { const tb = rst.textBytes!; const tl = tb.length; if (p + tl > len) { p = sp; break ff_rep; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = sp; break ff_rep; } } p += tl; const bs = rst.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < rst.min!) { p = sp; break ff_rep; } break; }
                case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = rst.segments!; let ok2 = true; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (p + tl > len) { ok2 = false; break; } let m = true; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { m = false; break; } } if (!m) { ok2 = false; break; } p += tl; const bs = sg.bitset; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < sg.min) { ok2 = false; break; } } if (!ok2) { p = sp; break ff_rep; } break; }
                case FlatOp.F_EXEC: {
                  const ec = rst.child!;
                  if (ec.op === Op.FAST_ALT_BYTE_FIRST) {
                    if (p < len) { const ebs = ec.bitset!; const eb = input[p]; if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; } }
                    const ecf = ec.child!;
                    if (ecf.op === Op.FAST_SEQ_FLAT && ecf.fixedPrefix) { const efp = ecf.fixedPrefix; const efpLen = ecf.fixedPrefixLen!; if (p + efpLen > len) { p = sp; break ff_rep; } for (let i = 0; i < efpLen; i++) { const b = input[p + i]; if ((efp[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) { p = sp; break ff_rep; } } p += efpLen; }
                    else if (ecf.op === Op.BYTE) { if (p >= len || input[p] !== ecf.byte!) { p = sp; break ff_rep; } p++; }
                    else { p = sp; break ff_rep; }
                  } else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                    if (p >= len) { p = sp; break ff_rep; }
                    const dbs = ec.bitset!; const db = input[p];
                    if ((dbs[db >>> 5] & (1 << (db & 31))) !== 0) {
                      const dc = ec.child!;
                      if (dc.op === Op.FAST_REPEAT_BITSET) { const dcbs = dc.bitset!; const dcmi = dc.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) { p = sp; break ff_rep; } }
                      else { p = sp; break ff_rep; }
                    } else {
                      const dc2 = ec.child2!;
                      if (dc2.op === Op.FAST_SEQ3 && dc2.child!.op === Op.BYTE && dc2.child2!.op === Op.FAST_REPEAT_BITSET && dc2.child3!.op === Op.BYTE) {
                        if (p >= len || input[p] !== dc2.child!.byte!) { p = sp; break ff_rep; } p++;
                        const dcbs = dc2.child2!.bitset!; const dcmi = dc2.child2!.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) { p = sp; break ff_rep; }
                        if (p >= len || input[p] !== dc2.child3!.byte!) { p = sp; break ff_rep; } p++;
                      } else if (dc2.op === Op.FAST_REPEAT_BITSET) { const dcbs = dc2.bitset!; const dcmi = dc2.min!; const dcs = p; while (p < len) { const b2 = input[p]; if ((dcbs[b2 >>> 5] & (1 << (b2 & 31))) === 0) break; p++; } if ((p - dcs) < dcmi) { p = sp; break ff_rep; } }
                      else { p = sp; break ff_rep; }
                    }
                  } else { p = sp; break ff_rep; }
                  break;
                }
                case FlatOp.F_REP_OPTIONAL: { const r = -1; if (r >= 0) p = r; break; }
              }
            }
            if (p === sp) break;
            repCount++;
          }
          if (repCount < repMin) return -1;
        }
      }
      return p;
    }
  }
  _execInput = input;
  _execLen = len;
  _execRules = rules;
  _execStride = len + 1;
  _execMemo = null;
  _execUseMemo = cp.needsMemo;

  return _exec(rules[cp.entryIdx], 0);
}

let _execInput: Uint8Array;
let _execLen: number;
let _execRules: CompiledOp[];
let _execStride: number;
let _execMemo: Int32Array | null;
let _execUseMemo: boolean;

function _exec(op_: CompiledOp, pos_: number): number {
  const input = _execInput;
  const len = _execLen;
  let op = op_, pos = pos_;
  for (;;) {
    switch (op.op) {
      case Op.BYTE:
        return pos < len && input[pos] === op.byte! ? pos + 1 : -1;

      case Op.BYTE_RANGE: {
        if (pos >= len) return -1;
        const b = input[pos];
        return b >= op.low! && b <= op.high! ? pos + 1 : -1;
      }

      case Op.BITSET:
        if (pos >= len) return -1;
        { const bs = op.bitset!; const b = input[pos]; return (bs[b >>> 5] & (1 << (b & 31))) !== 0 ? pos + 1 : -1; }

      case Op.NOT_BITSET:
        if (pos >= len) return -1;
        { const bs = op.bitset!; const b = input[pos]; return (bs[b >>> 5] & (1 << (b & 31))) === 0 ? pos + 1 : -1; }

      case Op.TEXT:
      case Op.FAST_SEQ_BYTES: {
        const tb = op.textBytes!;
        const tlen = tb.length;
        if (pos + tlen > len) return -1;
        for (let i = 0; i < tlen; i++) {
          if (input[pos + i] !== tb[i]) return -1;
        }
        return pos + tlen;
      }

      case Op.CHAR_CLASS_LETTER: {
        if (pos >= len) return -1;
        const c = input[pos];
        return ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) ? pos + 1 : -1;
      }
      case Op.CHAR_CLASS_DIGIT:
        return pos < len && input[pos] >= 0x30 && input[pos] <= 0x39 ? pos + 1 : -1;
      case Op.CHAR_CLASS_PRINTABLE:
        return pos < len && input[pos] >= 0x20 && input[pos] <= 0x7E ? pos + 1 : -1;
      case Op.CHAR_CLASS_VISIBLE:
        return pos < len && input[pos] >= 0x21 && input[pos] <= 0x7E ? pos + 1 : -1;
      case Op.CHAR_CLASS_WHITESPACE:
        if (pos >= len) return -1;
        { const c = input[pos]; return (c === 0x20 || c === 0x09 || c === 0x0A || c === 0x0D) ? pos + 1 : -1; }
      case Op.CHAR_CLASS_ALPHANUM: {
        if (pos >= len) return -1;
        const c = input[pos];
        return ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39)) ? pos + 1 : -1;
      }
      case Op.CHAR_CLASS_WORD: {
        if (pos >= len) return -1;
        const c = input[pos];
        return ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || (c >= 0x30 && c <= 0x39) || c === 0x5F) ? pos + 1 : -1;
      }
      case Op.CHAR_CLASS_ANY:
        if (pos >= len) return -1;
        { const lb = input[pos]; const step = lb < 0x80 ? 1 : lb < 0xE0 ? 2 : lb < 0xF0 ? 3 : 4; return pos + step <= len ? pos + step : -1; }
      case Op.CHAR_CLASS_UPPER:
        return pos < len && input[pos] >= 0x41 && input[pos] <= 0x5A ? pos + 1 : -1;
      case Op.CHAR_CLASS_LOWER:
        return pos < len && input[pos] >= 0x61 && input[pos] <= 0x7A ? pos + 1 : -1;
      case Op.CHAR_CLASS_HEX: {
        if (pos >= len) return -1;
        const c = input[pos];
        return ((c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)) ? pos + 1 : -1;
      }

      case Op.FAST_SEQ2: {
        const p = _exec(op.child!, pos);
        if (p < 0) return -1;
        op = op.child2!; pos = p; continue;
      }

      case Op.FAST_SEQ3: {
        let p = _exec(op.child!, pos);
        if (p < 0) return -1;
        p = _exec(op.child2!, p);
        if (p < 0) return -1;
        op = op.child3!; pos = p; continue;
      }

      case Op.FAST_SEQ_FLAT: {
        const steps = op.flatSteps!;
        let p = pos;
        const fpx = op.fixedPrefix;
        if (fpx) {
          const fpLen = op.fixedPrefixLen!;
          if (p + fpLen > len) return -1;
          for (let i = 0; i < fpLen; i++) {
            const b = input[p + i];
            if ((fpx[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) return -1;
          }
          p += fpLen;
          const fpSteps = op.fixedPrefixSteps!;
          if (fpSteps === steps.length) {
            const tail = op.flatTail;
            if (!tail || tail.length === 0) return p;
            if (tail.length === 1) { op = tail[0]; pos = p; continue; }
            for (let i = 0; i < tail.length - 1; i++) {
              p = _exec(tail[i], p);
              if (p < 0) return -1;
            }
            op = tail[tail.length - 1]; pos = p; continue;
          }
          for (let si = fpSteps; si < steps.length; si++) {
            const st = steps[si];
            switch (st.fop) {
              case FlatOp.F_BYTE:
                if (p >= len || input[p] !== st.byte!) return -1;
                p++;
                break;
              case FlatOp.F_BITSET: {
                if (p >= len) return -1;
                const bs = st.bitset!; const b = input[p];
                if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
                p++;
                break;
              }
              case FlatOp.F_EXACTLY_BITSET: {
                const bs = st.bitset!;
                const n = st.min!;
                if (p + n > len) return -1;
                for (let i = 0; i < n; i++) {
                  const b = input[p + i];
                  if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
                }
                p += n;
                break;
              }
              case FlatOp.F_SEQ_BYTES: {
                const tb = st.textBytes!;
                const tl = tb.length;
                if (p + tl > len) return -1;
                for (let i = 0; i < tl; i++) {
                  if (input[p + i] !== tb[i]) return -1;
                }
                p += tl;
                break;
              }
              case FlatOp.F_BETWEEN_BITSET: {
                const bs = st.bitset!;
                const lo = st.min!;
                const hi = st.max!;
                let cnt = 0;
                while (p < len && cnt < hi) {
                  const b = input[p];
                  if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
                  p++;
                  cnt++;
                }
                if (cnt < lo) return -1;
                break;
              }
              case FlatOp.F_REPEAT_BITSET: {
                const bs = st.bitset!;
                const startP = p;
                while (p < len) {
                  const b = input[p];
                  if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
                  p++;
                }
                if ((p - startP) < st.min!) return -1;
                break;
              }
              case FlatOp.F_LITERAL_REPEAT_BS: {
                const tb = st.textBytes!;
                const tl = tb.length;
                if (p + tl > len) return -1;
                for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; }
                p += tl;
                const bs = st.bitset!;
                const startP = p;
                while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
                if ((p - startP) < st.min!) return -1;
                break;
              }
              case FlatOp.F_MULTI_LITERAL_REPEAT_BS: {
                const segs = st.segments!;
                for (let si2 = 0; si2 < segs.length; si2++) {
                  const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length;
                  if (p + tl > len) return -1;
                  for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; }
                  p += tl;
                  const bs = sg.bitset; const startP = p;
                  while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
                  if ((p - startP) < sg.min) return -1;
                }
                break;
              }
              case FlatOp.F_EXEC: {
                const ec = st.child!;
                if (ec.op === Op.FAST_ALT_BYTE_FIRST) {
                  if (p < len) {
                    const ebs = ec.bitset!; const eb = input[p];
                    if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; }
                  }
                  const ecf = ec.child!;
                  if (ecf.op === Op.FAST_SEQ_FLAT && ecf.fixedPrefix && ecf.fixedPrefixSteps === ecf.flatSteps!.length
                      && (!ecf.flatTail || ecf.flatTail.length === 0)) {
                    const fpx = ecf.fixedPrefix; const fpLen = ecf.fixedPrefixLen!;
                    if (p + fpLen > len) return -1;
                    for (let i = 0; i < fpLen; i++) { const b = input[p + i]; if ((fpx[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) return -1; }
                    p += fpLen;
                  } else {
                    const r = _exec(ecf, p);
                    if (r < 0) return -1;
                    p = r;
                  }
                } else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                  if (p >= len) return -1;
                  const ebs = ec.bitset!; const eb = input[p];
                  const r = (ebs[eb >>> 5] & (1 << (eb & 31))) !== 0 ? _exec(ec.child!, p) : _exec(ec.child2!, p);
                  if (r < 0) return -1;
                  p = r;
                } else {
                  const r = _exec(ec, p);
                  if (r < 0) return -1;
                  p = r;
                }
                break;
              }
              case FlatOp.F_REP_OPTIONAL: {
                const inner = st.child!;
                if (st.leadByte !== undefined) {
                  if (p < len && input[p] === st.leadByte) {
                    const r = _exec(inner, p);
                    if (r >= 0) p = r;
                  }
                } else if (st.leadBitset) {
                  if (p < len) {
                    const lbs = st.leadBitset; const lb = input[p];
                    if ((lbs[lb >>> 5] & (1 << (lb & 31))) !== 0) {
                      const r = _exec(inner, p);
                      if (r >= 0) p = r;
                    }
                  }
                } else {
                  const r = _exec(inner, p);
                  if (r >= 0) p = r;
                }
                break;
              }
            }
          }
          const tail = op.flatTail;
          if (!tail || tail.length === 0) return p;
          if (tail.length === 1) { op = tail[0]; pos = p; continue; }
          for (let i = 0; i < tail.length - 1; i++) {
            p = _exec(tail[i], p);
            if (p < 0) return -1;
          }
          op = tail[tail.length - 1]; pos = p; continue;
        }
        for (let si = 0; si < steps.length; si++) {
          const st = steps[si];
          switch (st.fop) {
            case FlatOp.F_BYTE:
              if (p >= len || input[p] !== st.byte!) return -1;
              p++;
              break;
            case FlatOp.F_BITSET: {
              if (p >= len) return -1;
              const bs = st.bitset!; const b = input[p];
              if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
              p++;
              break;
            }
            case FlatOp.F_EXACTLY_BITSET: {
              const bs = st.bitset!;
              const n = st.min!;
              if (p + n > len) return -1;
              for (let i = 0; i < n; i++) {
                const b = input[p + i];
                if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
              }
              p += n;
              break;
            }
            case FlatOp.F_SEQ_BYTES: {
              const tb = st.textBytes!;
              const tl = tb.length;
              if (p + tl > len) return -1;
              for (let i = 0; i < tl; i++) {
                if (input[p + i] !== tb[i]) return -1;
              }
              p += tl;
              break;
            }
            case FlatOp.F_BETWEEN_BITSET: {
              const bs = st.bitset!;
              const lo = st.min!;
              const hi = st.max!;
              let cnt = 0;
              while (p < len && cnt < hi) {
                const b = input[p];
                if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
                p++;
                cnt++;
              }
              if (cnt < lo) return -1;
              break;
            }
            case FlatOp.F_REPEAT_BITSET: {
              const bs = st.bitset!;
              const startP = p;
              while (p < len) {
                const b = input[p];
                if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
                p++;
              }
              if ((p - startP) < st.min!) return -1;
              break;
            }
            case FlatOp.F_LITERAL_REPEAT_BS: {
              const tb = st.textBytes!;
              const tl = tb.length;
              if (p + tl > len) return -1;
              for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; }
              p += tl;
              const bs = st.bitset!;
              const startP = p;
              while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
              if ((p - startP) < st.min!) return -1;
              break;
            }
            case FlatOp.F_MULTI_LITERAL_REPEAT_BS: {
              const segs = st.segments!;
              for (let si2 = 0; si2 < segs.length; si2++) {
                const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length;
                if (p + tl > len) return -1;
                for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) return -1; }
                p += tl;
                const bs = sg.bitset; const startP = p;
                while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
                if ((p - startP) < sg.min) return -1;
              }
              break;
            }
            case FlatOp.F_EXEC: {
              const ec = st.child!;
              if (ec.op === Op.FAST_ALT_BYTE_FIRST) {
                if (p < len) {
                  const ebs = ec.bitset!; const eb = input[p];
                  if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; }
                }
                const ecf = ec.child!;
                if (ecf.op === Op.FAST_SEQ_FLAT && ecf.fixedPrefix && ecf.fixedPrefixSteps === ecf.flatSteps!.length
                    && (!ecf.flatTail || ecf.flatTail.length === 0)) {
                  const fpx = ecf.fixedPrefix; const fpLen = ecf.fixedPrefixLen!;
                  if (p + fpLen > len) return -1;
                  for (let i = 0; i < fpLen; i++) { const b = input[p + i]; if ((fpx[(i << 3) + (b >>> 5)] & (1 << (b & 31))) === 0) return -1; }
                  p += fpLen;
                } else {
                  const r = _exec(ecf, p);
                  if (r < 0) return -1;
                  p = r;
                }
              } else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                if (p >= len) return -1;
                const ebs = ec.bitset!; const eb = input[p];
                const r = (ebs[eb >>> 5] & (1 << (eb & 31))) !== 0 ? _exec(ec.child!, p) : _exec(ec.child2!, p);
                if (r < 0) return -1;
                p = r;
              } else {
                const r = _exec(ec, p);
                if (r < 0) return -1;
                p = r;
              }
              break;
            }
            case FlatOp.F_REP_OPTIONAL: {
              const inner = st.child!;
              if (st.leadByte !== undefined) {
                if (p < len && input[p] === st.leadByte) {
                  if (inner.op === Op.FAST_SEQ2 && (inner.child2!.op === Op.FAST_REPEAT_BITSET || inner.child2!.op === Op.FAST_BETWEEN_BITSET)) {
                    const c2 = inner.child2!;
                    const rbs = c2.bitset!;
                    const rmi = c2.min!;
                    const rma = c2.op === Op.FAST_BETWEEN_BITSET ? c2.max! : 0x7FFFFFFF;
                    const sp = p + 1;
                    let rp = sp;
                    let rc = 0;
                    while (rp < len && rc < rma) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; rc++; }
                    if (rc >= rmi) p = rp;
                  } else if (inner.op === Op.FAST_SEQ2 && inner.child2!.op === Op.FAST_EXACTLY_BITSET) {
                    const c2 = inner.child2!;
                    const rbs = c2.bitset!;
                    const rn = c2.min!;
                    const sp = p + 1;
                    if (sp + rn <= len) {
                      let ok = true;
                      for (let ri = 0; ri < rn; ri++) { const b = input[sp + ri]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) { ok = false; break; } }
                      if (ok) p = sp + rn;
                    }
                  } else if (inner.op === Op.FAST_SEQ2 && inner.child2!.op === Op.FAST_JOINED_BYTE && inner.child2!.child!.op === Op.FAST_REPEAT_BITSET) {
                    const jElem = inner.child2!.child!;
                    const jbs = jElem.bitset!;
                    const jmi = jElem.min!;
                    const jsep = inner.child2!.byte!;
                    const sp = p + 1;
                    let jp = sp;
                    while (jp < len) { const b = input[jp]; if ((jbs[b >>> 5] & (1 << (b & 31))) === 0) break; jp++; }
                    if ((jp - sp) >= jmi) {
                      while (jp < len && input[jp] === jsep) {
                        const s2 = jp + 1;
                        let jp2 = s2;
                        while (jp2 < len) { const b = input[jp2]; if ((jbs[b >>> 5] & (1 << (b & 31))) === 0) break; jp2++; }
                        if ((jp2 - s2) < jmi) break;
                        jp = jp2;
                      }
                      p = jp;
                    }
                  } else if (inner.op === Op.FAST_SEQ2 && inner.child2!.op === Op.FAST_JOINED_BITSET_BYTE) {
                    const jbs = inner.child2!.bitset!;
                    const jsep = inner.child2!.byte!;
                    const sp = p + 1;
                    if (sp < len) {
                      let jb = input[sp];
                      if ((jbs[jb >>> 5] & (1 << (jb & 31))) !== 0) {
                        let jp = sp + 1;
                        while (jp < len) {
                          jb = input[jp];
                          if ((jbs[jb >>> 5] & (1 << (jb & 31))) !== 0) { jp++; continue; }
                          if (jb !== jsep || jp + 1 >= len) break;
                          const nb = input[jp + 1];
                          if ((jbs[nb >>> 5] & (1 << (nb & 31))) === 0) break;
                          jp += 2;
                        }
                        p = jp;
                      }
                    }
                  } else if (inner.op === Op.REP_ONE_OR_MORE && inner.child!.op === Op.FAST_SEQ2
                      && inner.child!.child!.op === Op.BYTE && inner.child!.child2!.op === Op.FAST_REPEAT_BITSET) {
                    const rlb = inner.child!.child!.byte!;
                    const rbs = inner.child!.child2!.bitset!;
                    const rmi = inner.child!.child2!.min!;
                    let rp = p;
                    if (rp < len && input[rp] === rlb) {
                      rp++;
                      const s0 = rp;
                      while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; }
                      if ((rp - s0) >= rmi) {
                        while (rp < len && input[rp] === rlb) {
                          rp++;
                          const s1 = rp;
                          while (rp < len) { const b = input[rp]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; rp++; }
                          if ((rp - s1) < rmi) { rp = s1 - 1; break; }
                        }
                        p = rp;
                      }
                    }
                  } else {
                    const r = _exec(inner, p);
                    if (r >= 0) p = r;
                  }
                }
              } else if (st.leadBitset) {
                if (p < len) {
                  const lbs = st.leadBitset; const lb = input[p];
                  if ((lbs[lb >>> 5] & (1 << (lb & 31))) !== 0) {
                    if (inner.op === Op.FAST_SEQ3
                        && inner.child!.op === Op.FAST_REPEAT_BITSET
                        && inner.child2!.op === Op.REP_OPTIONAL && inner.child2!.leadByte !== undefined
                        && inner.child2!.child!.op === Op.FAST_SEQ2 && inner.child2!.child!.child2!.op === Op.FAST_REPEAT_BITSET
                        && inner.child3!.op === Op.BYTE) {
                      const abs = inner.child!.bitset!;
                      const ami = inner.child!.min!;
                      const olb = inner.child2!.leadByte!;
                      const obs = inner.child2!.child!.child2!.bitset!;
                      const omi = inner.child2!.child!.child2!.min!;
                      const abyte = inner.child3!.byte!;
                      let ap = p;
                      const as0 = ap;
                      while (ap < len) { const b = input[ap]; if ((abs[b >>> 5] & (1 << (b & 31))) === 0) break; ap++; }
                      if ((ap - as0) >= ami) {
                        if (ap < len && input[ap] === olb) {
                          const os = ap + 1; let op2 = os;
                          while (op2 < len) { const b = input[op2]; if ((obs[b >>> 5] & (1 << (b & 31))) === 0) break; op2++; }
                          if ((op2 - os) >= omi) ap = op2;
                        }
                        if (ap < len && input[ap] === abyte) p = ap + 1;
                      }
                    } else {
                      const r = _exec(inner, p);
                      if (r >= 0) p = r;
                    }
                  }
                }
              } else {
                const r = _exec(inner, p);
                if (r >= 0) p = r;
              }
              break;
            }
            case FlatOp.F_JOINED_BITSET_BYTE: {
              const jbs = st.bitset!;
              const jsep = st.separator!;
              if (p >= len) return -1;
              let jb = input[p];
              if ((jbs[jb >>> 5] & (1 << (jb & 31))) === 0) return -1;
              p++;
              while (p < len) {
                jb = input[p];
                if ((jbs[jb >>> 5] & (1 << (jb & 31))) !== 0) { p++; continue; }
                if (jb !== jsep || p + 1 >= len) break;
                const nb = input[p + 1];
                if ((jbs[nb >>> 5] & (1 << (nb & 31))) === 0) break;
                p += 2;
              }
              break;
            }
            case FlatOp.F_JOINED_BYTE: {
              const jelem = st.child!;
              const jsep = st.separator!;
              if (jelem.op === Op.FAST_ALT_BYTE_FIRST) {
                const jbs = jelem.bitset!;
                const jfb = jelem.child!;
                let jp: number;
                if (p < len) { const jb = input[p]; jp = (jbs[jb >>> 5] & (1 << (jb & 31))) !== 0 ? p + 1 : _exec(jfb, p); }
                else jp = -1;
                if (jp < 0) return -1;
                while (jp < len && input[jp] === jsep) {
                  const np = jp + 1;
                  let ep: number;
                  if (np < len) { const jb = input[np]; ep = (jbs[jb >>> 5] & (1 << (jb & 31))) !== 0 ? np + 1 : _exec(jfb, np); }
                  else ep = -1;
                  if (ep < 0) break;
                  jp = ep;
                }
                p = jp;
              } else {
                let jp = _exec(jelem, p);
                if (jp < 0) return -1;
                while (jp < len && input[jp] === jsep) {
                  const ep = _exec(jelem, jp + 1);
                  if (ep < 0) break;
                  jp = ep;
                }
                p = jp;
              }
              break;
            }
          }
        }
        const tail = op.flatTail;
        if (!tail || tail.length === 0) return p;
        if (tail.length === 1) { op = tail[0]; pos = p; continue; }
        for (let i = 0; i < tail.length - 1; i++) {
          p = _exec(tail[i], p);
          if (p < 0) return -1;
        }
        op = tail[tail.length - 1]; pos = p; continue;
      }

      case Op.SEQ: {
        const ch = op.children!;
        const last = ch.length - 1;
        let p = pos;
        for (let i = 0; i < last; i++) {
          p = _exec(ch[i], p);
          if (p < 0) return -1;
        }
        op = ch[last]; pos = p; continue;
      }

      case Op.ALT: {
        const ch = op.children!;
        const last = ch.length - 1;
        for (let i = 0; i < last; i++) {
          const r = _exec(ch[i], pos);
          if (r >= 0) return r;
        }
        op = ch[last]; continue;
      }

      case Op.FAST_ALT_BYTE_FIRST: {
        if (pos < len) {
          const bs = op.bitset!; const b = input[pos];
          if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) return pos + 1;
        }
        op = op.child!; continue;
      }

      case Op.FAST_ALT_LEAD_DISPATCH: {
        if (pos < len) {
          const bs = op.bitset!; const b = input[pos];
          if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) { op = op.child!; continue; }
        }
        op = op.child2!; continue;
      }

      case Op.FAST_REPEAT_BITSET: {
        const bs = op.bitset!;
        let p = pos;
        while (p < len) {
          const b = input[p];
          if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
          p++;
        }
        return (p - pos) >= op.min! ? p : -1;
      }

      case Op.FAST_EXACTLY_BITSET: {
        const bs = op.bitset!;
        const n = op.min!;
        if (pos + n > len) return -1;
        for (let i = 0; i < n; i++) {
          const b = input[pos + i];
          if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
        }
        return pos + n;
      }

      case Op.FAST_BETWEEN_BITSET: {
        const bs = op.bitset!;
        const lo = op.min!;
        const hi = op.max!;
        let p = pos;
        let count = 0;
        while (p < len && count < hi) {
          const b = input[p];
          if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break;
          p++;
          count++;
        }
        return count >= lo ? p : -1;
      }

      case Op.FAST_REP_BITSET_ALT: {
        const bs = op.bitset!;
        const fallback = op.child!;
        let p = pos;
        let count = 0;
        const fbIsSeqBytes = fallback.op === Op.FAST_SEQ_BYTES || fallback.op === Op.TEXT;
        const fbBytes = fbIsSeqBytes ? fallback.textBytes! : null;
        const fbLen = fbBytes ? fbBytes.length : 0;
        while (p < len) {
          const b = input[p];
          if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) {
            p++;
            count++;
            continue;
          }
          if (fbBytes) {
            if (p + fbLen <= len) {
              let match = true;
              for (let fi = 0; fi < fbLen; fi++) {
                if (input[p + fi] !== fbBytes[fi]) { match = false; break; }
              }
              if (match) { p += fbLen; count++; continue; }
            }
            break;
          }
          const r = _exec(fallback, p);
          if (r < 0 || r === p) break;
          p = r;
          count++;
        }
        return count >= op.min! ? p : -1;
      }

      case Op.FAST_JOINED_BYTE: {
        const elem = op.child!;
        const sep = op.byte!;
        if (elem.op === Op.FAST_EXACTLY_BITSET) {
          const ebs = elem.bitset!;
          const en = elem.min!;
          let p = pos;
          if (p + en > len) return -1;
          for (let i = 0; i < en; i++) { const b = input[p + i]; if ((ebs[b >>> 5] & (1 << (b & 31))) === 0) return -1; }
          p += en;
          while (p < len && input[p] === sep) {
            if (p + 1 + en > len) break;
            let ok = true;
            for (let i = 0; i < en; i++) { const b = input[p + 1 + i]; if ((ebs[b >>> 5] & (1 << (b & 31))) === 0) { ok = false; break; } }
            if (!ok) break;
            p += 1 + en;
          }
          return p;
        }
        if (elem.op === Op.FAST_BETWEEN_BITSET) {
          const ebs = elem.bitset!;
          const elo = elem.min!;
          const ehi = elem.max!;
          let p = pos;
          let cnt = 0;
          while (p < len && cnt < ehi) { const b = input[p]; if ((ebs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; }
          if (cnt < elo) return -1;
          while (p < len && input[p] === sep) {
            let p2 = p + 1;
            let cnt2 = 0;
            while (p2 < len && cnt2 < ehi) { const b = input[p2]; if ((ebs[b >>> 5] & (1 << (b & 31))) === 0) break; p2++; cnt2++; }
            if (cnt2 < elo) break;
            p = p2;
          }
          return p;
        }
        if (elem.op === Op.FAST_REPEAT_BITSET) {
          const ebs = elem.bitset!;
          const emi = elem.min!;
          let p = pos;
          const start0 = p;
          while (p < len) { const b = input[p]; if ((ebs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
          if ((p - start0) < emi) return -1;
          while (p < len && input[p] === sep) {
            const start2 = p + 1;
            let p2 = start2;
            while (p2 < len) { const b = input[p2]; if ((ebs[b >>> 5] & (1 << (b & 31))) === 0) break; p2++; }
            if ((p2 - start2) < emi) break;
            p = p2;
          }
          return p;
        }
        if (elem.op === Op.FAST_ALT_BYTE_FIRST) {
          const ebs = elem.bitset!;
          const fallback = elem.child!;
          let p = pos;
          if (p < len) { const b = input[p]; if ((ebs[b >>> 5] & (1 << (b & 31))) !== 0) { p++; } else { p = _exec(fallback, p); if (p < 0) return -1; } }
          else return -1;
          while (p < len && input[p] === sep) {
            const np = p + 1;
            if (np < len) { const b = input[np]; if ((ebs[b >>> 5] & (1 << (b & 31))) !== 0) { p = np + 1; continue; } }
            const ep = _exec(fallback, np);
            if (ep < 0) break;
            p = ep;
          }
          return p;
        }
        if (elem.op === Op.FAST_ALT_LEAD_DISPATCH) {
          const dbs = elem.bitset!;
          const dch1 = elem.child!;
          const dch2 = elem.child2!;
          if (dch1.op === Op.FAST_SEQ3 && dch1.child!.op === Op.BYTE && dch1.child3!.op === Op.BYTE
              && dch1.child2!.op === Op.FAST_REP_BITSET_ALT && dch2.op === Op.FAST_REPEAT_BITSET) {
            const qOpen = dch1.child!.byte!;
            const qClose = dch1.child3!.byte!;
            const rba = dch1.child2!;
            const rbaBS = rba.bitset!;
            const rbaFb = rba.child!;
            const rbaFbIsSeq = rbaFb.op === Op.FAST_SEQ_BYTES || rbaFb.op === Op.TEXT;
            const rbaFbBytes = rbaFbIsSeq ? rbaFb.textBytes! : null;
            const rbaFbLen = rbaFbBytes ? rbaFbBytes.length : 0;
            const d2BS = dch2.bitset!;
            const d2Mi = dch2.min!;
            const execQuoted = (sp: number): number => {
              if (sp >= len || input[sp] !== qOpen) return -1;
              let qp = sp + 1;
              while (qp < len) {
                const qb = input[qp];
                if ((rbaBS[qb >>> 5] & (1 << (qb & 31))) !== 0) { qp++; continue; }
                if (rbaFbBytes) {
                  if (qp + rbaFbLen <= len) {
                    let m = true;
                    for (let fi = 0; fi < rbaFbLen; fi++) { if (input[qp + fi] !== rbaFbBytes[fi]) { m = false; break; } }
                    if (m) { qp += rbaFbLen; continue; }
                  }
                } else {
                  const fr = _exec(rbaFb, qp);
                  if (fr > qp) { qp = fr; continue; }
                }
                break;
              }
              if (qp >= len || input[qp] !== qClose) return -1;
              return qp + 1;
            };
            const execPlain = (sp: number): number => {
              const s0 = sp;
              let pp = sp;
              while (pp < len) { const pb = input[pp]; if ((d2BS[pb >>> 5] & (1 << (pb & 31))) === 0) break; pp++; }
              return (pp - s0) >= d2Mi ? pp : -1;
            };
            let p: number;
            if (pos >= len) return -1;
            { const b = input[pos]; p = (dbs[b >>> 5] & (1 << (b & 31))) !== 0 ? execQuoted(pos) : execPlain(pos); }
            if (p < 0) return -1;
            while (p < len && input[p] === sep) {
              const np = p + 1;
              if (np >= len) break;
              const b = input[np];
              const ep = (dbs[b >>> 5] & (1 << (b & 31))) !== 0 ? execQuoted(np) : execPlain(np);
              if (ep < 0) break;
              p = ep;
            }
            return p;
          }
          let p: number;
          if (pos < len) { const b = input[pos]; p = (dbs[b >>> 5] & (1 << (b & 31))) !== 0 ? _exec(dch1, pos) : _exec(dch2, pos); }
          else return -1;
          if (p < 0) return -1;
          while (p < len && input[p] === sep) {
            const np = p + 1;
            if (np >= len) break;
            const b = input[np];
            const ep = (dbs[b >>> 5] & (1 << (b & 31))) !== 0 ? _exec(dch1, np) : _exec(dch2, np);
            if (ep < 0) break;
            p = ep;
          }
          return p;
        }
        if (elem.op === Op.FAST_SEQ3) {
          const c1 = elem.child!;
          const c2 = elem.child2!;
          const c3 = elem.child3!;
          if (c1.op === Op.FAST_REPEAT_BITSET && c2.op === Op.BYTE && c3.op === Op.FAST_REPEAT_BITSET) {
            const bs1 = c1.bitset!; const mi1 = c1.min!;
            const mb = c2.byte!;
            const bs3 = c3.bitset!; const mi3 = c3.min!;
            let p = pos;
            let s0 = p;
            while (p < len) { const b = input[p]; if ((bs1[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
            if ((p - s0) < mi1) return -1;
            if (p >= len || input[p] !== mb) return -1;
            p++;
            s0 = p;
            while (p < len) { const b = input[p]; if ((bs3[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
            if ((p - s0) < mi3) return -1;
            while (p < len && input[p] === sep) {
              let ep = p + 1;
              const es0 = ep;
              while (ep < len) { const b = input[ep]; if ((bs1[b >>> 5] & (1 << (b & 31))) === 0) break; ep++; }
              if ((ep - es0) < mi1) break;
              if (ep >= len || input[ep] !== mb) break;
              ep++;
              const es3 = ep;
              while (ep < len) { const b = input[ep]; if ((bs3[b >>> 5] & (1 << (b & 31))) === 0) break; ep++; }
              if ((ep - es3) < mi3) break;
              p = ep;
            }
            return p;
          }
          let p = _exec(c1, pos);
          if (p < 0) return -1;
          p = _exec(c2, p);
          if (p < 0) return -1;
          p = _exec(c3, p);
          if (p < 0) return -1;
          while (p < len && input[p] === sep) {
            let ep = _exec(c1, p + 1);
            if (ep < 0) break;
            ep = _exec(c2, ep);
            if (ep < 0) break;
            ep = _exec(c3, ep);
            if (ep < 0) break;
            p = ep;
          }
          return p;
        }
        if (elem.op === Op.FAST_SEQ2) {
          const c1 = elem.child!;
          const c2 = elem.child2!;
          let p = _exec(c1, pos);
          if (p < 0) return -1;
          p = _exec(c2, p);
          if (p < 0) return -1;
          while (p < len && input[p] === sep) {
            let ep = _exec(c1, p + 1);
            if (ep < 0) break;
            ep = _exec(c2, ep);
            if (ep < 0) break;
            p = ep;
          }
          return p;
        }
        if (elem.op === Op.FAST_SEQ_FLAT && elem.flatSteps && (!elem.flatTail || elem.flatTail.length === 0)) {
          const fsteps = elem.flatSteps;
          const fsLen = fsteps.length;
          let p = pos;
          jb_flat_first: {
            for (let si = 0; si < fsLen; si++) {
              const st = fsteps[si];
              switch (st.fop) {
                case FlatOp.F_BYTE: if (p >= len || input[p] !== st.byte!) { p = -1; break jb_flat_first; } p++; break;
                case FlatOp.F_BITSET: { if (p >= len) { p = -1; break jb_flat_first; } const bs = st.bitset!; const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = -1; break jb_flat_first; } p++; break; }
                case FlatOp.F_EXACTLY_BITSET: { const bs = st.bitset!; const n = st.min!; if (p + n > len) { p = -1; break jb_flat_first; } for (let i = 0; i < n; i++) { const b = input[p + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = -1; break jb_flat_first; } } p += n; break; }
                case FlatOp.F_SEQ_BYTES: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) { p = -1; break jb_flat_first; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = -1; break jb_flat_first; } } p += tl; break; }
                case FlatOp.F_BETWEEN_BITSET: { const bs = st.bitset!; const lo = st.min!; const hi = st.max!; let cnt = 0; while (p < len && cnt < hi) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; } if (cnt < lo) { p = -1; break jb_flat_first; } break; }
                case FlatOp.F_REPEAT_BITSET: { const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) { p = -1; break jb_flat_first; } break; }
                case FlatOp.F_LITERAL_REPEAT_BS: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) { p = -1; break jb_flat_first; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = -1; break jb_flat_first; } } p += tl; const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) { p = -1; break jb_flat_first; } break; }
                case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = st.segments!; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (p + tl > len) { p = -1; break jb_flat_first; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = -1; break jb_flat_first; } } p += tl; const bs = sg.bitset; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < sg.min) { p = -1; break jb_flat_first; } } break; }
                case FlatOp.F_REP_OPTIONAL: { const r = _exec(st.child!, p); if (r >= 0) p = r; break; }
                case FlatOp.F_EXEC: { const r = _exec(st.child!, p); if (r < 0) { p = -1; break jb_flat_first; } p = r; break; }
              }
            }
          }
          if (p < 0) return -1;
          jb_flat_rest:
          while (p < len && input[p] === sep) {
            let ep = p + 1;
            for (let si = 0; si < fsLen; si++) {
              const st = fsteps[si];
              switch (st.fop) {
                case FlatOp.F_BYTE: if (ep >= len || input[ep] !== st.byte!) break jb_flat_rest; ep++; break;
                case FlatOp.F_BITSET: { if (ep >= len) break jb_flat_rest; const bs = st.bitset!; const b = input[ep]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break jb_flat_rest; ep++; break; }
                case FlatOp.F_EXACTLY_BITSET: { const bs = st.bitset!; const n = st.min!; if (ep + n > len) break jb_flat_rest; for (let i = 0; i < n; i++) { const b = input[ep + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break jb_flat_rest; } ep += n; break; }
                case FlatOp.F_SEQ_BYTES: { const tb = st.textBytes!; const tl = tb.length; if (ep + tl > len) break jb_flat_rest; for (let i = 0; i < tl; i++) { if (input[ep + i] !== tb[i]) break jb_flat_rest; } ep += tl; break; }
                case FlatOp.F_BETWEEN_BITSET: { const bs = st.bitset!; const lo = st.min!; const hi = st.max!; let cnt = 0; while (ep < len && cnt < hi) { const b = input[ep]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; ep++; cnt++; } if (cnt < lo) break jb_flat_rest; break; }
                case FlatOp.F_REPEAT_BITSET: { const bs = st.bitset!; const startP = ep; while (ep < len) { const b = input[ep]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; ep++; } if ((ep - startP) < st.min!) break jb_flat_rest; break; }
                case FlatOp.F_LITERAL_REPEAT_BS: { const tb = st.textBytes!; const tl = tb.length; if (ep + tl > len) break jb_flat_rest; for (let i = 0; i < tl; i++) { if (input[ep + i] !== tb[i]) break jb_flat_rest; } ep += tl; const bs = st.bitset!; const startP = ep; while (ep < len) { const b = input[ep]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; ep++; } if ((ep - startP) < st.min!) break jb_flat_rest; break; }
                case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = st.segments!; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (ep + tl > len) break jb_flat_rest; for (let i = 0; i < tl; i++) { if (input[ep + i] !== tb[i]) break jb_flat_rest; } ep += tl; const bs = sg.bitset; const startP = ep; while (ep < len) { const b = input[ep]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; ep++; } if ((ep - startP) < sg.min) break jb_flat_rest; } break; }
                case FlatOp.F_REP_OPTIONAL: { const r = _exec(st.child!, ep); if (r >= 0) ep = r; break; }
                case FlatOp.F_EXEC: { const r = _exec(st.child!, ep); if (r < 0) break jb_flat_rest; ep = r; break; }
              }
            }
            p = ep;
          }
          return p;
        }
        let p = _exec(elem, pos);
        if (p < 0) return -1;
        while (p < len && input[p] === sep) {
          const ep = _exec(elem, p + 1);
          if (ep < 0) break;
          p = ep;
        }
        return p;
      }

      case Op.FAST_JOINED_BITSET_BYTE: {
        const bs = op.bitset!;
        const sep = op.byte!;
        let p = pos;
        if (p >= len) return -1;
        let b = input[p];
        if ((bs[b >>> 5] & (1 << (b & 31))) === 0) return -1;
        p++;
        while (p < len) {
          b = input[p];
          if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) { p++; continue; }
          if (b !== sep) break;
          if (p + 1 >= len) break;
          const nb = input[p + 1];
          if ((bs[nb >>> 5] & (1 << (nb & 31))) === 0) break;
          p += 2;
        }
        return p;
      }

      case Op.REP_ONE_OR_MORE: {
        const child = op.child!;
        if (child.op === Op.FAST_SEQ_FLAT && child.flatSteps && (!child.flatTail || child.flatTail.length === 0)) {
          const rSteps = child.flatSteps;
          const rSLen = rSteps.length;
          const rLbs = op.leadBitset;
          let p = pos;
          let count = 0;
          rep1_flat_loop:
          while (p < len) {
            if (rLbs) { const lb = input[p]; if ((rLbs[lb >>> 5] & (1 << (lb & 31))) === 0) break; }
            const sp = p;
            for (let si = 0; si < rSLen; si++) {
              const st = rSteps[si];
              switch (st.fop) {
                case FlatOp.F_BYTE: if (p >= len || input[p] !== st.byte!) { p = sp; break rep1_flat_loop; } p++; break;
                case FlatOp.F_BITSET: { if (p >= len) { p = sp; break rep1_flat_loop; } const bs = st.bitset!; const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = sp; break rep1_flat_loop; } p++; break; }
                case FlatOp.F_EXACTLY_BITSET: { const bs = st.bitset!; const n = st.min!; if (p + n > len) { p = sp; break rep1_flat_loop; } for (let i = 0; i < n; i++) { const b = input[p + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = sp; break rep1_flat_loop; } } p += n; break; }
                case FlatOp.F_SEQ_BYTES: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) { p = sp; break rep1_flat_loop; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = sp; break rep1_flat_loop; } } p += tl; break; }
                case FlatOp.F_BETWEEN_BITSET: { const bs = st.bitset!; const lo = st.min!; const hi = st.max!; let cnt = 0; while (p < len && cnt < hi) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; } if (cnt < lo) { p = sp; break rep1_flat_loop; } break; }
                case FlatOp.F_REPEAT_BITSET: { const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) { p = sp; break rep1_flat_loop; } break; }
                case FlatOp.F_LITERAL_REPEAT_BS: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) { p = sp; break rep1_flat_loop; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = sp; break rep1_flat_loop; } } p += tl; const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) { p = sp; break rep1_flat_loop; } break; }
                case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = st.segments!; let ok2 = true; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (p + tl > len) { ok2 = false; break; } let m = true; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { m = false; break; } } if (!m) { ok2 = false; break; } p += tl; const bs = sg.bitset; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < sg.min) { ok2 = false; break; } } if (!ok2) { p = sp; break rep1_flat_loop; } break; }
                case FlatOp.F_REP_OPTIONAL: { const r = _exec(st.child!, p); if (r >= 0) p = r; break; }
                case FlatOp.F_EXEC: {
                  const ec = st.child!; let r: number;
                  if (ec.op === Op.FAST_ALT_BYTE_FIRST) { if (p < len) { const ebs = ec.bitset!; const eb = input[p]; if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; } } r = _exec(ec.child!, p); }
                  else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                    if (p >= len) { p = sp; break rep1_flat_loop; }
                    const ebs = ec.bitset!; const eb = input[p];
                    if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) {
                      const dc = ec.child!;
                      if (dc.op === Op.FAST_REPEAT_BITSET) { const dbs = dc.bitset!; const dmi = dc.min!; const dp = p; while (p < len) { const db = input[p]; if ((dbs[db >>> 5] & (1 << (db & 31))) === 0) break; p++; } if ((p - dp) < dmi) { p = sp; break rep1_flat_loop; } break; }
                      r = _exec(dc, p);
                    } else {
                      const dc2 = ec.child2!;
                      if (dc2.op === Op.FAST_SEQ3 && dc2.child!.op === Op.BYTE && dc2.child2!.op === Op.FAST_REPEAT_BITSET && dc2.child3!.op === Op.BYTE) {
                        if (input[p] !== dc2.child!.byte!) { p = sp; break rep1_flat_loop; }
                        p++;
                        const dbs = dc2.child2!.bitset!; const dmi = dc2.child2!.min!; const dp = p;
                        while (p < len) { const db = input[p]; if ((dbs[db >>> 5] & (1 << (db & 31))) === 0) break; p++; }
                        if ((p - dp) < dmi || p >= len || input[p] !== dc2.child3!.byte!) { p = sp; break rep1_flat_loop; }
                        p++; break;
                      }
                      r = _exec(dc2, p);
                    }
                  } else { r = _exec(ec, p); }
                  if (r < 0) { p = sp; break rep1_flat_loop; } p = r; break;
                }
              }
            }
            if (p === sp) break;
            count++;
          }
          return count >= 1 ? p : -1;
        }
        if (child.op === Op.FAST_SEQ2 && child.child!.op === Op.BYTE && child.child2!.op === Op.FAST_REPEAT_BITSET) {
          const lbyte = child.child!.byte!;
          const rbs = child.child2!.bitset!;
          const rmi = child.child2!.min!;
          let p = pos;
          if (p >= len || input[p] !== lbyte) return -1;
          p++;
          const s0 = p;
          while (p < len) { const b = input[p]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
          if ((p - s0) < rmi) return -1;
          while (p < len && input[p] === lbyte) {
            p++;
            const s1 = p;
            while (p < len) { const b = input[p]; if ((rbs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; }
            if ((p - s1) < rmi) { p = s1 - 1; break; }
          }
          return p;
        }
        let p = _exec(child, pos);
        if (p < 0) return -1;
        if (op.leadByte !== undefined) {
          const lb = op.leadByte;
          while (p < len && input[p] === lb) {
            const r = _exec(child, p);
            if (r < 0 || r === p) break;
            p = r;
          }
        } else if (op.leadBitset) {
          const lbs = op.leadBitset;
          while (p < len) {
            const lb = input[p];
            if ((lbs[lb >>> 5] & (1 << (lb & 31))) === 0) break;
            const r = _exec(child, p);
            if (r < 0 || r === p) break;
            p = r;
          }
        } else {
          for (;;) {
            const r = _exec(child, p);
            if (r < 0 || r === p) break;
            p = r;
          }
        }
        return p;
      }

      case Op.REP_ZERO_OR_MORE: {
        const child = op.child!;
        let p = pos;
        if (child.op === Op.FAST_SEQ_FLAT && child.flatSteps && (!child.flatTail || child.flatTail.length === 0)) {
          const rSteps = child.flatSteps;
          const rSLen = rSteps.length;
          const rLbs = op.leadBitset;
          rep_flat_loop:
          while (p < len) {
            if (rLbs) { const lb = input[p]; if ((rLbs[lb >>> 5] & (1 << (lb & 31))) === 0) break; }
            const sp = p;
            for (let si = 0; si < rSLen; si++) {
              const st = rSteps[si];
              switch (st.fop) {
                case FlatOp.F_BYTE: if (p >= len || input[p] !== st.byte!) { p = sp; break rep_flat_loop; } p++; break;
                case FlatOp.F_BITSET: { if (p >= len) { p = sp; break rep_flat_loop; } const bs = st.bitset!; const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = sp; break rep_flat_loop; } p++; break; }
                case FlatOp.F_EXACTLY_BITSET: { const bs = st.bitset!; const n = st.min!; if (p + n > len) { p = sp; break rep_flat_loop; } for (let i = 0; i < n; i++) { const b = input[p + i]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) { p = sp; break rep_flat_loop; } } p += n; break; }
                case FlatOp.F_SEQ_BYTES: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) { p = sp; break rep_flat_loop; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = sp; break rep_flat_loop; } } p += tl; break; }
                case FlatOp.F_BETWEEN_BITSET: { const bs = st.bitset!; const lo = st.min!; const hi = st.max!; let cnt = 0; while (p < len && cnt < hi) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; cnt++; } if (cnt < lo) { p = sp; break rep_flat_loop; } break; }
                case FlatOp.F_REPEAT_BITSET: { const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) { p = sp; break rep_flat_loop; } break; }
                case FlatOp.F_LITERAL_REPEAT_BS: { const tb = st.textBytes!; const tl = tb.length; if (p + tl > len) { p = sp; break rep_flat_loop; } for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { p = sp; break rep_flat_loop; } } p += tl; const bs = st.bitset!; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < st.min!) { p = sp; break rep_flat_loop; } break; }
                case FlatOp.F_MULTI_LITERAL_REPEAT_BS: { const segs = st.segments!; let ok2 = true; for (let si2 = 0; si2 < segs.length; si2++) { const sg = segs[si2]; const tb = sg.textBytes; const tl = tb.length; if (p + tl > len) { ok2 = false; break; } let m = true; for (let i = 0; i < tl; i++) { if (input[p + i] !== tb[i]) { m = false; break; } } if (!m) { ok2 = false; break; } p += tl; const bs = sg.bitset; const startP = p; while (p < len) { const b = input[p]; if ((bs[b >>> 5] & (1 << (b & 31))) === 0) break; p++; } if ((p - startP) < sg.min) { ok2 = false; break; } } if (!ok2) { p = sp; break rep_flat_loop; } break; }
                case FlatOp.F_REP_OPTIONAL: { const r = _exec(st.child!, p); if (r >= 0) p = r; break; }
                case FlatOp.F_EXEC: {
                  const ec = st.child!; let r: number;
                  if (ec.op === Op.FAST_ALT_BYTE_FIRST) { if (p < len) { const ebs = ec.bitset!; const eb = input[p]; if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) { p++; break; } } r = _exec(ec.child!, p); }
                  else if (ec.op === Op.FAST_ALT_LEAD_DISPATCH) {
                    if (p >= len) { p = sp; break rep_flat_loop; }
                    const ebs = ec.bitset!; const eb = input[p];
                    if ((ebs[eb >>> 5] & (1 << (eb & 31))) !== 0) {
                      const dc = ec.child!;
                      if (dc.op === Op.FAST_REPEAT_BITSET) { const dbs = dc.bitset!; const dmi = dc.min!; const dp = p; while (p < len) { const db = input[p]; if ((dbs[db >>> 5] & (1 << (db & 31))) === 0) break; p++; } if ((p - dp) < dmi) { p = sp; break rep_flat_loop; } break; }
                      r = _exec(dc, p);
                    } else {
                      const dc2 = ec.child2!;
                      if (dc2.op === Op.FAST_SEQ3 && dc2.child!.op === Op.BYTE && dc2.child2!.op === Op.FAST_REPEAT_BITSET && dc2.child3!.op === Op.BYTE) {
                        if (input[p] !== dc2.child!.byte!) { p = sp; break rep_flat_loop; }
                        p++;
                        const dbs = dc2.child2!.bitset!; const dmi = dc2.child2!.min!; const dp = p;
                        while (p < len) { const db = input[p]; if ((dbs[db >>> 5] & (1 << (db & 31))) === 0) break; p++; }
                        if ((p - dp) < dmi || p >= len || input[p] !== dc2.child3!.byte!) { p = sp; break rep_flat_loop; }
                        p++; break;
                      }
                      r = _exec(dc2, p);
                    }
                  } else { r = _exec(ec, p); }
                  if (r < 0) { p = sp; break rep_flat_loop; } p = r; break;
                }
              }
            }
            if (p === sp) break;
          }
        } else if (op.leadByte !== undefined) {
          const lb = op.leadByte;
          while (p < len && input[p] === lb) {
            const r = _exec(child, p);
            if (r < 0 || r === p) break;
            p = r;
          }
        } else if (op.leadBitset) {
          const lbs = op.leadBitset;
          while (p < len) {
            const lb = input[p];
            if ((lbs[lb >>> 5] & (1 << (lb & 31))) === 0) break;
            const r = _exec(child, p);
            if (r < 0 || r === p) break;
            p = r;
          }
        } else {
          for (;;) {
            const r = _exec(child, p);
            if (r < 0 || r === p) break;
            p = r;
          }
        }
        return p;
      }

      case Op.REP_OPTIONAL: {
        if (op.leadByte !== undefined) {
          if (pos >= len || input[pos] !== op.leadByte) return pos;
        } else if (op.leadBitset) {
          if (pos >= len) return pos;
          const lbs = op.leadBitset; const lb = input[pos];
          if ((lbs[lb >>> 5] & (1 << (lb & 31))) === 0) return pos;
        }
        const r = _exec(op.child!, pos);
        return r >= 0 ? r : pos;
      }

      case Op.REP_EXACTLY: {
        const child = op.child!;
        const n = op.min!;
        let p = pos;
        for (let i = 0; i < n; i++) {
          p = _exec(child, p);
          if (p < 0) return -1;
        }
        return p;
      }

      case Op.REP_BETWEEN: {
        const child = op.child!;
        const lo = op.min!;
        const hi = op.max!;
        let p = pos;
        let count = 0;
        for (let i = 0; i < hi; i++) {
          const r = _exec(child, p);
          if (r < 0 || r === p) break;
          p = r;
          count++;
        }
        return count >= lo ? p : -1;
      }

      case Op.JOINED_BY: {
        const elem = op.child!;
        const sep = op.separator!;
        let p = _exec(elem, pos);
        if (p < 0) return -1;
        for (;;) {
          const sp = _exec(sep, p);
          if (sp < 0) break;
          const ep = _exec(elem, sp);
          if (ep < 0) break;
          p = ep;
        }
        return p;
      }

      case Op.JOINED_BY_LENIENT: {
        const elem = op.child!;
        const sep = op.separator!;
        let p = _exec(elem, pos);
        if (p < 0) return -1;
        for (;;) {
          const sp = _exec(sep, p);
          if (sp < 0) break;
          const ep = _exec(elem, sp);
          if (ep < 0) { p = sp; break; }
          p = ep;
        }
        return p;
      }

      case Op.RULE_REF: {
        const ri = op.ruleIdx!;
        if (ri < 0) return -1;
        if (_execUseMemo) {
          const rules = _execRules;
          if (!_execMemo) _execMemo = new Int32Array(rules.length * _execStride).fill(-2);
          const mk = ri * _execStride + pos;
          if (_execMemo[mk] !== -2) return _execMemo[mk];
          const r = _exec(rules[ri], pos);
          _execMemo[mk] = r;
          return r;
        }
        op = _execRules[ri]; continue;
      }

      case Op.EXCEPT: {
        if (pos >= len) return -1;
        if (op.bitset) {
          const bs = op.bitset; const b = input[pos];
          if ((bs[b >>> 5] & (1 << (b & 31))) !== 0) return -1;
        } else if (op.children) {
          for (let i = 0; i < op.children.length; i++) {
            if (_exec(op.children[i], pos) >= 0) return -1;
          }
        }
        op = op.child!; continue;
      }

      case Op.NONE_OF: {
        if (pos >= len) return -1;
        const ch = op.children!;
        for (let i = 0; i < ch.length; i++) {
          if (_exec(ch[i], pos) >= 0) return -1;
        }
        const lb = input[pos];
        const step = lb < 0x80 ? 1 : lb < 0xE0 ? 2 : lb < 0xF0 ? 3 : 4;
        return pos + step <= len ? pos + step : -1;
      }

      case Op.EXTRACT:
        op = op.child!; continue;

      case Op.UNTIL_INCL: {
        const child = op.child!;
        const term = op.terminator!;
        let p = pos;
        for (;;) {
          const tr = _exec(term, p);
          if (tr >= 0) return tr;
          const cr = _exec(child, p);
          if (cr < 0 || cr === p) return -1;
          p = cr;
        }
      }

      case Op.UNTIL_EXCL: {
        const child = op.child!;
        const term = op.terminator!;
        let p = pos;
        for (;;) {
          const tr = _exec(term, p);
          if (tr >= 0) return p;
          const cr = _exec(child, p);
          if (cr < 0 || cr === p) return -1;
          p = cr;
        }
      }

      case Op.ISNT: {
        if (_exec(op.negated!, pos) >= 0) return -1;
        op = op.child!; continue;
      }

      default:
        return -1;
    }
  }
}

const WASM_OP_BYTE = 0;
const WASM_OP_BYTE_RANGE = 1;
const WASM_OP_BITSET = 2;
const WASM_OP_NOT_BITSET = 3;
const WASM_OP_TEXT = 4;
const WASM_OP_CHAR_CLASS_LETTER = 5;
const WASM_OP_CHAR_CLASS_DIGIT = 6;
const WASM_OP_CHAR_CLASS_PRINTABLE = 7;
const WASM_OP_CHAR_CLASS_VISIBLE = 8;
const WASM_OP_CHAR_CLASS_WHITESPACE = 9;
const WASM_OP_CHAR_CLASS_ALPHANUM = 10;
const WASM_OP_CHAR_CLASS_WORD = 11;
const WASM_OP_CHAR_CLASS_ANY = 12;
const WASM_OP_CHAR_CLASS_UPPER = 13;
const WASM_OP_CHAR_CLASS_LOWER = 14;
const WASM_OP_CHAR_CLASS_HEX = 15;
const WASM_OP_SEQ = 16;
const WASM_OP_ALT = 17;
const WASM_OP_REP_ONE_OR_MORE = 18;
const WASM_OP_REP_ZERO_OR_MORE = 19;
const WASM_OP_REP_OPTIONAL = 20;
const WASM_OP_REP_EXACTLY = 21;
const WASM_OP_REP_BETWEEN = 22;
const WASM_OP_JOINED_BY = 23;
const WASM_OP_JOINED_BY_LENIENT = 24;
const WASM_OP_RULE_REF = 25;
const WASM_OP_EXCEPT = 26;
const WASM_OP_NONE_OF = 27;
const WASM_OP_FAST_REPEAT_BITSET = 28;
const WASM_OP_FAST_EXACTLY_BITSET = 29;
const WASM_OP_FAST_BETWEEN_BITSET = 30;
const WASM_OP_FAST_JOINED_BYTE = 31;
const WASM_OP_EXTRACT = 32;
const WASM_OP_UNTIL_INCL = 33;
const WASM_OP_UNTIL_EXCL = 34;
const WASM_OP_ISNT = 35;
const WASM_OP_FAST_SEQ_BYTES = 36;
const WASM_OP_FAST_SEQ2 = 37;
const WASM_OP_FAST_SEQ3 = 38;
const WASM_OP_FAST_SEQ_FLAT = 39;
const WASM_OP_FAST_JOINED_BITSET_BYTE = 40;
const WASM_OP_FAST_REP_BITSET_ALT = 41;
const WASM_OP_FAST_ALT_BYTE_FIRST = 42;
const WASM_OP_FAST_ALT_LEAD_DISPATCH = 43;

const WASM_FOP_BYTE = 0;
const WASM_FOP_BITSET = 1;
const WASM_FOP_EXACTLY_BITSET = 2;
const WASM_FOP_SEQ_BYTES = 3;
const WASM_FOP_BETWEEN_BITSET = 4;
const WASM_FOP_REPEAT_BITSET = 5;
const WASM_FOP_REP_OPTIONAL = 6;
const WASM_FOP_EXEC = 7;
const WASM_FOP_JOINED_BITSET_BYTE = 8;
const WASM_FOP_JOINED_BYTE = 9;
const WASM_FOP_LITERAL_REPEAT_BS = 10;
const WASM_FOP_MULTI_LITERAL_REPEAT_BS = 11;

const OP_TO_WASM: Record<number, number> = {
  [Op.BYTE]: WASM_OP_BYTE,
  [Op.BYTE_RANGE]: WASM_OP_BYTE_RANGE,
  [Op.BITSET]: WASM_OP_BITSET,
  [Op.NOT_BITSET]: WASM_OP_NOT_BITSET,
  [Op.TEXT]: WASM_OP_TEXT,
  [Op.CHAR_CLASS_LETTER]: WASM_OP_CHAR_CLASS_LETTER,
  [Op.CHAR_CLASS_DIGIT]: WASM_OP_CHAR_CLASS_DIGIT,
  [Op.CHAR_CLASS_PRINTABLE]: WASM_OP_CHAR_CLASS_PRINTABLE,
  [Op.CHAR_CLASS_VISIBLE]: WASM_OP_CHAR_CLASS_VISIBLE,
  [Op.CHAR_CLASS_WHITESPACE]: WASM_OP_CHAR_CLASS_WHITESPACE,
  [Op.CHAR_CLASS_ALPHANUM]: WASM_OP_CHAR_CLASS_ALPHANUM,
  [Op.CHAR_CLASS_WORD]: WASM_OP_CHAR_CLASS_WORD,
  [Op.CHAR_CLASS_ANY]: WASM_OP_CHAR_CLASS_ANY,
  [Op.CHAR_CLASS_UPPER]: WASM_OP_CHAR_CLASS_UPPER,
  [Op.CHAR_CLASS_LOWER]: WASM_OP_CHAR_CLASS_LOWER,
  [Op.CHAR_CLASS_HEX]: WASM_OP_CHAR_CLASS_HEX,
  [Op.SEQ]: WASM_OP_SEQ,
  [Op.ALT]: WASM_OP_ALT,
  [Op.REP_ONE_OR_MORE]: WASM_OP_REP_ONE_OR_MORE,
  [Op.REP_ZERO_OR_MORE]: WASM_OP_REP_ZERO_OR_MORE,
  [Op.REP_OPTIONAL]: WASM_OP_REP_OPTIONAL,
  [Op.REP_EXACTLY]: WASM_OP_REP_EXACTLY,
  [Op.REP_BETWEEN]: WASM_OP_REP_BETWEEN,
  [Op.JOINED_BY]: WASM_OP_JOINED_BY,
  [Op.JOINED_BY_LENIENT]: WASM_OP_JOINED_BY_LENIENT,
  [Op.RULE_REF]: WASM_OP_RULE_REF,
  [Op.EXCEPT]: WASM_OP_EXCEPT,
  [Op.NONE_OF]: WASM_OP_NONE_OF,
  [Op.FAST_REPEAT_BITSET]: WASM_OP_FAST_REPEAT_BITSET,
  [Op.FAST_EXACTLY_BITSET]: WASM_OP_FAST_EXACTLY_BITSET,
  [Op.FAST_BETWEEN_BITSET]: WASM_OP_FAST_BETWEEN_BITSET,
  [Op.FAST_JOINED_BYTE]: WASM_OP_FAST_JOINED_BYTE,
  [Op.EXTRACT]: WASM_OP_EXTRACT,
  [Op.UNTIL_INCL]: WASM_OP_UNTIL_INCL,
  [Op.UNTIL_EXCL]: WASM_OP_UNTIL_EXCL,
  [Op.ISNT]: WASM_OP_ISNT,
  [Op.FAST_SEQ_BYTES]: WASM_OP_FAST_SEQ_BYTES,
  [Op.FAST_SEQ2]: WASM_OP_FAST_SEQ2,
  [Op.FAST_SEQ3]: WASM_OP_FAST_SEQ3,
  [Op.FAST_SEQ_FLAT]: WASM_OP_FAST_SEQ_FLAT,
  [Op.FAST_JOINED_BITSET_BYTE]: WASM_OP_FAST_JOINED_BITSET_BYTE,
  [Op.FAST_REP_BITSET_ALT]: WASM_OP_FAST_REP_BITSET_ALT,
  [Op.FAST_ALT_BYTE_FIRST]: WASM_OP_FAST_ALT_BYTE_FIRST,
  [Op.FAST_ALT_LEAD_DISPATCH]: WASM_OP_FAST_ALT_LEAD_DISPATCH,
};

export function compileToWasmBuffer(cp: CompiledProgram): ArrayBuffer {
  let capacity = 4096;
  let buf = new ArrayBuffer(capacity);
  let u8 = new Uint8Array(buf);
  let dv = new DataView(buf);
  let pos = 0;

  function ensure(need: number) {
    while (pos + need > capacity) {
      capacity *= 2;
      const nb = new ArrayBuffer(capacity);
      new Uint8Array(nb).set(u8);
      buf = nb;
      u8 = new Uint8Array(buf);
      dv = new DataView(buf);
    }
  }

  function w32(v: number) { ensure(4); dv.setUint32(pos, v, true); pos += 4; }
  function w8(v: number) { ensure(1); u8[pos++] = v; }
  function wBitset(bs: Uint32Array) {
    ensure(32);
    for (let i = 0; i < 8; i++) dv.setUint32(pos + i * 4, bs[i], true);
    pos += 32;
  }
  function wBytes(data: Uint8Array) {
    w32(data.length);
    ensure(data.length);
    u8.set(data, pos);
    pos += data.length;
    const pad = (4 - (data.length & 3)) & 3;
    for (let i = 0; i < pad; i++) u8[pos++] = 0;
  }
  function align4() {
    const pad = (4 - (pos & 3)) & 3;
    for (let i = 0; i < pad; i++) u8[pos++] = 0;
  }

  const nodeOffsets = new Map<CompiledOp, number>();

  function serializeFlatSteps(steps: FlatStep[]): number {
    const off = pos;
    for (const st of steps) {
      switch (st.fop) {
        case FlatOp.F_BYTE:
          w32(WASM_FOP_BYTE);
          w32(st.byte!);
          break;
        case FlatOp.F_BITSET:
          w32(WASM_FOP_BITSET);
          wBitset(st.bitset!);
          break;
        case FlatOp.F_EXACTLY_BITSET:
          w32(WASM_FOP_EXACTLY_BITSET);
          wBitset(st.bitset!);
          w32(st.min!);
          break;
        case FlatOp.F_SEQ_BYTES:
          w32(WASM_FOP_SEQ_BYTES);
          wBytes(st.textBytes!);
          break;
        case FlatOp.F_BETWEEN_BITSET:
          w32(WASM_FOP_BETWEEN_BITSET);
          wBitset(st.bitset!);
          w32(st.min!);
          w32(st.max!);
          break;
        case FlatOp.F_REPEAT_BITSET:
          w32(WASM_FOP_REPEAT_BITSET);
          wBitset(st.bitset!);
          w32(st.min!);
          break;
        case FlatOp.F_REP_OPTIONAL: {
          w32(WASM_FOP_REP_OPTIONAL);
          const childOff = serializeNode(st.child!);
          const patchPos = pos;
          w32(childOff);
          w32(st.leadByte !== undefined ? st.leadByte : 0xFFFFFFFF);
          if (st.leadBitset) {
            w32(1);
            wBitset(st.leadBitset);
          } else {
            w32(0);
          }
          break;
        }
        case FlatOp.F_EXEC: {
          w32(WASM_FOP_EXEC);
          const childOff = serializeNode(st.child!);
          w32(childOff);
          break;
        }
        case FlatOp.F_JOINED_BITSET_BYTE:
          w32(WASM_FOP_JOINED_BITSET_BYTE);
          wBitset(st.bitset!);
          w32(st.separator!);
          break;
        case FlatOp.F_JOINED_BYTE: {
          w32(WASM_FOP_JOINED_BYTE);
          const childOff = serializeNode(st.child!);
          w32(childOff);
          w32(st.separator!);
          break;
        }
        case FlatOp.F_LITERAL_REPEAT_BS:
          w32(WASM_FOP_LITERAL_REPEAT_BS);
          wBytes(st.textBytes!);
          wBitset(st.bitset!);
          w32(st.min!);
          break;
        case FlatOp.F_MULTI_LITERAL_REPEAT_BS: {
          w32(WASM_FOP_MULTI_LITERAL_REPEAT_BS);
          w32(st.segments!.length);
          for (const seg of st.segments!) {
            wBytes(seg.textBytes);
            wBitset(seg.bitset);
            w32(seg.min);
          }
          break;
        }
      }
    }
    return off;
  }

  function serializeNode(op: CompiledOp): number {
    const cached = nodeOffsets.get(op);
    if (cached !== undefined) return cached;

    const wasmOp = OP_TO_WASM[op.op];
    if (wasmOp === undefined) throw new Error(`Unknown op: ${op.op}`);

    switch (op.op) {
      case Op.BYTE: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(op.byte!);
        return off;
      }
      case Op.BYTE_RANGE: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(op.low!);
        w32(op.high!);
        return off;
      }
      case Op.BITSET: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        return off;
      }
      case Op.NOT_BITSET: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        return off;
      }
      case Op.TEXT:
      case Op.FAST_SEQ_BYTES: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBytes(op.textBytes!);
        return off;
      }
      case Op.CHAR_CLASS_LETTER:
      case Op.CHAR_CLASS_DIGIT:
      case Op.CHAR_CLASS_PRINTABLE:
      case Op.CHAR_CLASS_VISIBLE:
      case Op.CHAR_CLASS_WHITESPACE:
      case Op.CHAR_CLASS_ALPHANUM:
      case Op.CHAR_CLASS_WORD:
      case Op.CHAR_CLASS_ANY:
      case Op.CHAR_CLASS_UPPER:
      case Op.CHAR_CLASS_LOWER:
      case Op.CHAR_CLASS_HEX: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        return off;
      }
      case Op.FAST_SEQ2: {
        const c1 = serializeNode(op.child!);
        const c2 = serializeNode(op.child2!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(c1);
        w32(c2);
        return off;
      }
      case Op.FAST_SEQ3: {
        const c1 = serializeNode(op.child!);
        const c2 = serializeNode(op.child2!);
        const c3 = serializeNode(op.child3!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(c1);
        w32(c2);
        w32(c3);
        return off;
      }
      case Op.SEQ: {
        const childOffs = op.children!.map(c => serializeNode(c));
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOffs.length);
        for (const co of childOffs) w32(co);
        return off;
      }
      case Op.ALT: {
        const childOffs = op.children!.map(c => serializeNode(c));
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOffs.length);
        for (const co of childOffs) w32(co);
        return off;
      }
      case Op.FAST_ALT_BYTE_FIRST: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(childOff);
        return off;
      }
      case Op.FAST_ALT_LEAD_DISPATCH: {
        const c1 = serializeNode(op.child!);
        const c2 = serializeNode(op.child2!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(c1);
        w32(c2);
        return off;
      }
      case Op.FAST_REPEAT_BITSET: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(op.min!);
        return off;
      }
      case Op.FAST_EXACTLY_BITSET: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(op.min!);
        return off;
      }
      case Op.FAST_BETWEEN_BITSET: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(op.min!);
        w32(op.max!);
        return off;
      }
      case Op.FAST_JOINED_BITSET_BYTE: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(op.byte!);
        return off;
      }
      case Op.FAST_REP_BITSET_ALT: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        wBitset(op.bitset!);
        w32(childOff);
        w32(op.min!);
        return off;
      }
      case Op.FAST_JOINED_BYTE: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        w32(op.byte!);
        return off;
      }
      case Op.REP_ONE_OR_MORE:
      case Op.REP_ZERO_OR_MORE:
      case Op.REP_OPTIONAL: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        w32(op.leadByte !== undefined ? op.leadByte : 0xFFFFFFFF);
        if (op.leadBitset) {
          w32(1);
          wBitset(op.leadBitset);
        } else {
          w32(0);
        }
        return off;
      }
      case Op.REP_EXACTLY: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        w32(op.min!);
        return off;
      }
      case Op.REP_BETWEEN: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        w32(op.min!);
        w32(op.max!);
        return off;
      }
      case Op.JOINED_BY:
      case Op.JOINED_BY_LENIENT: {
        const elemOff = serializeNode(op.child!);
        const sepOff = serializeNode(op.separator!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(elemOff);
        w32(sepOff);
        return off;
      }
      case Op.RULE_REF: {
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(op.ruleIdx! >= 0 ? op.ruleIdx! : 0xFFFFFFFF);
        return off;
      }
      case Op.EXCEPT: {
        const childOff = serializeNode(op.child!);
        let exclOffs: number[] = [];
        if (!op.bitset && op.children) {
          exclOffs = op.children.map(c => serializeNode(c));
        }
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        if (op.bitset) {
          w32(1);
          wBitset(op.bitset);
          w32(0);
        } else {
          w32(0);
          w32(exclOffs.length);
          for (const eo of exclOffs) w32(eo);
        }
        return off;
      }
      case Op.NONE_OF: {
        const childOffs = op.children!.map(c => serializeNode(c));
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOffs.length);
        for (const co of childOffs) w32(co);
        return off;
      }
      case Op.EXTRACT: {
        const childOff = serializeNode(op.child!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        return off;
      }
      case Op.UNTIL_INCL:
      case Op.UNTIL_EXCL: {
        const childOff = serializeNode(op.child!);
        const termOff = serializeNode(op.terminator!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        w32(termOff);
        return off;
      }
      case Op.ISNT: {
        const childOff = serializeNode(op.child!);
        const negOff = serializeNode(op.negated!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(childOff);
        w32(negOff);
        return off;
      }
      case Op.FAST_SEQ_FLAT: {
        const tailOffs = op.flatTail ? op.flatTail.map(c => serializeNode(c)) : [];
        const stepsOff = serializeFlatSteps(op.flatSteps!);
        const off = pos;
        nodeOffsets.set(op, off);
        w32(wasmOp);
        w32(op.flatSteps!.length);
        w32(stepsOff);
        w32(tailOffs.length);
        for (const to of tailOffs) w32(to);
        if (op.fixedPrefix) {
          w32(1);
          w32(op.fixedPrefixLen!);
          w32(op.fixedPrefixSteps!);
          const fpxBytes = new Uint8Array(op.fixedPrefix.buffer, op.fixedPrefix.byteOffset, op.fixedPrefixLen! * 32);
          ensure(fpxBytes.length);
          u8.set(fpxBytes, pos);
          pos += fpxBytes.length;
        } else {
          w32(0);
        }
        return off;
      }
      default:
        throw new Error(`Unhandled op in serializer: ${op.op}`);
    }
  }

  pos = 16;
  const ruleOffsetsPos = pos;
  pos += cp.rules.length * 4;

  const ruleOffsets: number[] = [];
  for (const rule of cp.rules) {
    ruleOffsets.push(serializeNode(rule));
  }

  const finalBuf = buf.slice(0, pos);
  const finalDv = new DataView(finalBuf);
  const finalU8 = new Uint8Array(finalBuf);

  finalDv.setUint32(0, cp.rules.length, true);
  finalDv.setUint32(4, cp.entryIdx, true);
  let flags = 0;
  if (cp.fullyFlat) flags |= 1;
  if (cp.needsMemo) flags |= 2;
  if (cp.hasExtract) flags |= 4;
  finalU8[8] = flags;
  finalU8[9] = 0; finalU8[10] = 0; finalU8[11] = 0;
  finalDv.setUint32(12, pos, true);

  for (let i = 0; i < ruleOffsets.length; i++) {
    finalDv.setUint32(16 + i * 4, ruleOffsets[i], true);
  }

  return finalBuf;
}
