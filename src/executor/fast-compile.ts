import { ASTNode, MatchProgram, RuleNode } from '../types/ast.js';
import { CHAR_CLASSES } from '../stdlib/stdlib.js';
import { Op, FlatOp, CompiledOp, CompiledProgram, FlatStep, LitRepSeg, makeBitset, opToBitset, isSingleByteOp } from './fast-types.js';

const encoder = new TextEncoder();

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

  function canMatchEmpty(op: CompiledOp): boolean {
    switch (op.op) {
      case Op.REP_ZERO_OR_MORE:
      case Op.REP_OPTIONAL:
        return true;
      case Op.FAST_REPEAT_BITSET:
      case Op.FAST_BETWEEN_BITSET:
        return op.min === 0;
      case Op.SEQ:
        return !!op.children && op.children.every(canMatchEmpty);
      case Op.ALT:
        return !!op.children && op.children.some(canMatchEmpty);
      case Op.FAST_SEQ2:
        return canMatchEmpty(op.child!) && canMatchEmpty(op.child2!);
      case Op.FAST_SEQ3:
        return canMatchEmpty(op.child!) && canMatchEmpty(op.child2!) && canMatchEmpty(op.child3!);
      default:
        return false;
    }
  }

  let preserveRuleRefs = false;

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
        if ((node.mode === 'zero_or_more' || node.mode === 'one_or_more') && canMatchEmpty(child)) {
          return child.op === Op.REP_OPTIONAL ? { op: Op.REP_ZERO_OR_MORE, child: child.child! } : child;
        }
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
          if (!preserveRuleRefs) {
            if (isInlinable(program.rules[idx].body)) return compileNode(program.rules[idx].body);
            if (canDeepInline(idx)) return compileNode(program.rules[idx].body);
          }
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

  preserveRuleRefs = true;
  const treeRules = program.rules.map(r => compileNode(r.body));
  preserveRuleRefs = false;

  const MAX_INLINE_SIZE = 16;
  const ruleSizes = rules.map(r => opSize(r));

  function inlineSmallRules(op: CompiledOp): CompiledOp {
    if (op.op === Op.RULE_REF && op.ruleIdx! >= 0 && ruleSizes[op.ruleIdx!] <= MAX_INLINE_SIZE) {
      const c = cloneOp(rules[op.ruleIdx!]);
      c.inlinedRuleIdx = op.ruleIdx!;
      return c;
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
    if (op.inlinedRuleIdx !== undefined) c.inlinedRuleIdx = op.inlinedRuleIdx;
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
  return { rules, ruleNames, entryIdx, entryPoint: program.entryPoint, source: program, needsMemo, hasExtract, fullyFlat, treeRules };
}