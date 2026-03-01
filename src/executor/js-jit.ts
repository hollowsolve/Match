import { Op, FlatOp, CompiledOp, CompiledProgram, opToBitset } from './fast-types.js';

type MatchFn = (input: Uint8Array, len: number) => number;
type StrMatchFn = (input: string, len: number) => number;

const jitJsCache = new WeakMap<CompiledProgram, MatchFn | null>();
const jitJsStrCache = new WeakMap<CompiledProgram, StrMatchFn | null>();

export function jsJitMatch(cp: CompiledProgram, input: Uint8Array): number {
  let fn = (cp as any)._jsJit as MatchFn | null | undefined;
  if (fn === undefined) {
    fn = jitJsCache.get(cp) ?? undefined;
    if (fn === undefined) {
      fn = compileJs(cp);
      jitJsCache.set(cp, fn);
    }
    try { (cp as any)._jsJit = fn; } catch {}
  }
  if (!fn) return -2;
  return fn(input, input.length);
}

export function jsJitMatchStr(cp: CompiledProgram, input: string): number {
  let fn = (cp as any)._jsJitStr as StrMatchFn | null | undefined;
  if (fn === undefined) {
    fn = jitJsStrCache.get(cp) ?? undefined;
    if (fn === undefined) {
      fn = compileJsStr(cp);
      jitJsStrCache.set(cp, fn);
    }
    try { (cp as any)._jsJitStr = fn; } catch {}
  }
  if (!fn) return -2;
  return fn(input, input.length);
}

function buildJsSrc(cp: CompiledProgram): { src: string; args: CapturedArg[] } | null {
  const entry = cp.rules[cp.entryIdx];
  const ctx = new Ctx();
  const refs = new Set<number>();
  scanRefs(entry, refs);
  let changed = true;
  while (changed) {
    changed = false;
    for (const ri of refs) {
      const before = refs.size;
      scanRefs(cp.rules[ri], refs);
      if (refs.size > before) changed = true;
    }
  }
  if (cp.needsMemo) return null;
  const ruleFns = new Map<number, string>();
  for (const ri of refs) {
    if (ri < 0 || ri >= cp.rules.length) continue;
    const fnName = `_r${ri}`;
    ruleFns.set(ri, fnName);
  }
  ctx.ruleFns = ruleFns;
  let ruleSrc = '';
  for (const [ri, fnName] of ruleFns) {
    const ruleBody = emitPosOp(ctx, cp.rules[ri], cp);
    if (ruleBody === null) return null;
    ruleSrc += `function ${fnName}(d,l,p){${ruleBody}return p;}\n`;
  }
  const body = emitEntry(ctx, entry, cp);
  if (body === null) return null;
  const src = `return function(d,l){${ruleSrc}${ctx.altFns}${body}}`;
  return { src, args: ctx.args };
}

function compileJs(cp: CompiledProgram): MatchFn | null {
  try {
    const result = buildJsSrc(cp);
    if (!result) return null;
    const { src, args } = result;
    const argNames = args.map((_, i) => `_${i}`);
    const factory = new Function(...argNames, src);
    return factory(...args.map(a => a.value));
  } catch {
    return null;
  }
}

function byteSrcToStrSrc(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === 'd' && i + 1 < src.length && src[i + 1] === '[' && (i === 0 || !isIdChar(src[i - 1]))) {
      out += 'd.charCodeAt(';
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') { depth--; if (depth === 0) { out += ')'; i++; break; } }
        out += src[i++];
      }
    } else {
      out += src[i++];
    }
  }
  return out;
}

function isIdChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || (c >= '0' && c <= '9');
}

function compileJsStr(cp: CompiledProgram): StrMatchFn | null {
  try {
    const result = buildJsSrc(cp);
    if (!result) return null;
    const { src, args } = result;
    const strSrc = byteSrcToStrSrc(src);
    const argNames = args.map((_, i) => `_${i}`);
    const factory = new Function(...argNames, strSrc);
    return factory(...args.map(a => a.value));
  } catch {
    return null;
  }
}

function scanRefs(op: CompiledOp, refs: Set<number>): void {
  if (op.op === Op.RULE_REF && op.ruleIdx !== undefined && op.ruleIdx >= 0) refs.add(op.ruleIdx);
  if (op.child) scanRefs(op.child, refs);
  if (op.child2) scanRefs(op.child2, refs);
  if (op.child3) scanRefs(op.child3, refs);
  if (op.children) for (const c of op.children) scanRefs(c, refs);
  if (op.separator) scanRefs(op.separator, refs);
  if (op.terminator) scanRefs(op.terminator, refs);
  if (op.negated) scanRefs(op.negated, refs);
  if (op.flatTail) for (const c of op.flatTail) scanRefs(c, refs);
  if (op.flatSteps) for (const s of op.flatSteps) { if (s.child) scanRefs(s.child, refs); }
}

interface CapturedArg { value: any }

class Ctx {
  args: CapturedArg[] = [];
  ruleFns: Map<number, string> = new Map();
  altFns = '';
  altFnCount = 0;
  inlining = new Set<number>();
  capture(val: any): string {
    const i = this.args.length;
    this.args.push({ value: val });
    return `_${i}`;
  }
}

function emitLitCheck(tb: Uint8Array, base: string, failCode: string): string {
  let s = '';
  let i = 0;
  while (i + 4 <= tb.length) {
    const w = (tb[i]) | (tb[i + 1] << 8) | (tb[i + 2] << 16) | (tb[i + 3] << 24);
    s += `if((d[${base}${i ? '+' + i : ''}]|(d[${base}+${i + 1}]<<8)|(d[${base}+${i + 2}]<<16)|(d[${base}+${i + 3}]<<24))!==${w | 0})${failCode}`;
    i += 4;
  }
  for (; i < tb.length; i++) {
    s += `if(d[${base}${i ? '+' + i : ''}]!==${tb[i]})${failCode}`;
  }
  return s;
}

function bsToRangesJs(bs: Uint32Array): [number, number][] | null {
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < 256; i++) {
    const set = (bs[i >>> 5] & (1 << (i & 31))) !== 0;
    if (set && start < 0) start = i;
    else if (!set && start >= 0) { ranges.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) ranges.push([start, 255]);
  if (ranges.length >= 1 && ranges.length <= 3) return ranges;
  return null;
}

function rangeExpr(ranges: [number, number][], byteExpr: string): string {
  const parts: string[] = [];
  const used = new Array(ranges.length).fill(false);
  for (let i = 0; i < ranges.length; i++) {
    if (used[i]) continue;
    let paired = false;
    for (let j = i + 1; j < ranges.length; j++) {
      if (!used[j] && ranges[i][1] - ranges[i][0] === ranges[j][1] - ranges[j][0] && ranges[j][0] - ranges[i][0] === 0x20) {
        const span = ranges[j][1] - ranges[j][0];
        if (span === 0) parts.push(`(${byteExpr}|32)===${ranges[j][0]}`);
        else parts.push(`((${byteExpr}|32)-${ranges[j][0]}>>>0)<=${span}`);
        used[i] = used[j] = true; paired = true; break;
      }
    }
    if (!paired) {
      const [lo, hi] = ranges[i];
      if (lo === hi) parts.push(`${byteExpr}===${lo}`);
      else if (lo === 0) parts.push(`${byteExpr}<=${hi}`);
      else parts.push(`(${byteExpr}-${lo}>>>0)<=${hi - lo}`);
      used[i] = true;
    }
  }
  return parts.length === 1 ? parts[0] : `(${parts.join('||')})`;
}

function bsExpr(ctx: Ctx, bs: Uint32Array, byteExpr: string): string {
  const ranges = bsToRangesJs(bs);
  if (ranges) return rangeExpr(ranges, byteExpr);
  const name = ctx.capture(bs);
  return `(${name}[${byteExpr}>>>5]&(1<<(${byteExpr}&31)))!==0`;
}

function emitEntry(ctx: Ctx, entry: CompiledOp, cp: CompiledProgram): string | null {
  switch (entry.op) {
    case Op.TEXT:
    case Op.FAST_SEQ_BYTES: {
      const tb = entry.textBytes!;
      if (tb.length >= 4) {
        let s = `if(l!==${tb.length})return -1;`;
        s += emitLitCheck(tb, '0', 'return -1;');
        s += `return ${tb.length};`;
        return s;
      }
      const name = ctx.capture(tb);
      let s = `if(l!==${tb.length})return -1;`;
      s += `for(var i=0;i<${tb.length};i++)if(d[i]!==${name}[i])return -1;`;
      s += `return ${tb.length};`;
      return s;
    }
    case Op.BYTE:
      return `return l===1&&d[0]===${entry.byte!}?1:-1;`;
    case Op.BITSET: {
      const e = bsExpr(ctx, entry.bitset!, 'd[0]');
      return `if(l!==1)return -1;return ${e}?1:-1;`;
    }
    case Op.CHAR_CLASS_LETTER:
      return `if(l!==1)return -1;var c=d[0];return(c>=65&&c<=90||c>=97&&c<=122)?1:-1;`;
    case Op.CHAR_CLASS_DIGIT:
      return `return l===1&&d[0]>=48&&d[0]<=57?1:-1;`;
    case Op.CHAR_CLASS_WORD:
      return `if(l!==1)return -1;var c=d[0];return(c>=65&&c<=90||c>=97&&c<=122||c>=48&&c<=57||c===95)?1:-1;`;
    case Op.CHAR_CLASS_HEX:
      return `if(l!==1)return -1;var c=d[0];return(c>=48&&c<=57||c>=65&&c<=70||c>=97&&c<=102)?1:-1;`;
    case Op.CHAR_CLASS_ALPHANUM:
      return `if(l!==1)return -1;var c=d[0];return(c>=65&&c<=90||c>=97&&c<=122||c>=48&&c<=57)?1:-1;`;
    case Op.CHAR_CLASS_PRINTABLE:
      return `if(l!==1)return -1;return d[0]>=32&&d[0]<=126?1:-1;`;
    case Op.CHAR_CLASS_VISIBLE:
      return `if(l!==1)return -1;return d[0]>=33&&d[0]<=126?1:-1;`;
    case Op.CHAR_CLASS_WHITESPACE: {
      const bs = opToBitset(entry)!;
      const e = bsExpr(ctx, bs, 'd[0]');
      return `if(l!==1)return -1;return ${e}?1:-1;`;
    }
    case Op.CHAR_CLASS_UPPER:
      return `if(l!==1)return -1;return d[0]>=65&&d[0]<=90?1:-1;`;
    case Op.CHAR_CLASS_LOWER:
      return `if(l!==1)return -1;return d[0]>=97&&d[0]<=122?1:-1;`;
    case Op.NOT_BITSET: {
      const e = bsExpr(ctx, entry.bitset!, 'd[0]');
      return `if(l!==1)return -1;return ${e}?-1:1;`;
    }
    case Op.BYTE_RANGE:
      return `if(l!==1)return -1;var b=d[0];return b>=${entry.low!}&&b<=${entry.high!}?1:-1;`;
    case Op.FAST_REPEAT_BITSET: {
      const e = bsExpr(ctx, entry.bitset!, 'b');
      return `var p=0;while(p<l){var b=d[p];if(!(${e}))break;p++;}return p>=${entry.min!}?p:-1;`;
    }
    case Op.FAST_EXACTLY_BITSET: {
      const n = entry.min!;
      const e = bsExpr(ctx, entry.bitset!, 'b');
      return `if(l<${n})return -1;for(var i=0;i<${n};i++){var b=d[i];if(!(${e}))return -1;}return ${n};`;
    }
    case Op.FAST_BETWEEN_BITSET: {
      const lo = entry.min!; const hi = entry.max!;
      const e = bsExpr(ctx, entry.bitset!, 'b');
      return `var p=0,c=0;while(p<l&&c<${hi}){var b=d[p];if(!(${e}))break;p++;c++;}return c>=${lo}?p:-1;`;
    }
    case Op.FAST_JOINED_BITSET_BYTE: {
      const sep = entry.byte!;
      const e = bsExpr(ctx, entry.bitset!, 'b');
      let s = `var p=0;if(p>=l)return -1;var b=d[p];if(!(${e}))return -1;p++;`;
      s += `while(p<l){b=d[p];if(${e}){p++;continue;}`;
      s += `if(b!==${sep})break;if(p+1>=l)break;b=d[p+1];if(!(${e}))break;p+=2;}`;
      s += `return p;`;
      return s;
    }
    case Op.ALT: {
      const ch = entry.children!;
      let s = '';
      for (const alt of ch) {
        if (alt.op === Op.TEXT || alt.op === Op.FAST_SEQ_BYTES) {
          const tb = alt.textBytes!;
          const name = ctx.capture(tb);
          s += `if(l===${tb.length}){var ok=true;for(var i=0;i<${tb.length};i++)if(d[i]!==${name}[i]){ok=false;break;}if(ok)return ${tb.length};}`;
        } else if (alt.op === Op.BYTE) {
          s += `if(l===1&&d[0]===${alt.byte!})return 1;`;
        } else if (alt.op === Op.BITSET) {
          const e = bsExpr(ctx, alt.bitset!, 'd[0]');
          s += `if(l===1&&${e})return 1;`;
        } else {
          return null;
        }
      }
      s += `return -1;`;
      return s;
    }
    case Op.FAST_ALT_BYTE_FIRST: {
      const e = bsExpr(ctx, entry.bitset!, 'd[0]');
      let s = `if(l===1&&${e})return 1;`;
      const fb = entry.child!;
      const inner = emitAltChild(ctx, fb);
      if (inner === null) return null;
      s += inner;
      return s;
    }
    case Op.FAST_ALT_LEAD_DISPATCH: {
      const e = bsExpr(ctx, entry.bitset!, 'd[0]');
      let s = `if(l<1)return -1;`;
      s += `if(${e}){`;
      const c1 = emitAltChild(ctx, entry.child!);
      if (c1 === null) return null;
      s += c1;
      s += `}else{`;
      const c2 = emitAltChild(ctx, entry.child2!);
      if (c2 === null) return null;
      s += c2;
      s += `}`;
      return s;
    }
    case Op.FAST_SEQ2: {
      const c1 = entry.child!;
      const c2 = entry.child2!;
      const body = emitPosOp(ctx, c1, cp);
      if (body === null) return null;
      const body2 = emitPosOp(ctx, c2, cp);
      if (body2 === null) return null;
      return `var p=0;${body}${body2}return p;`;
    }
    case Op.FAST_SEQ3: {
      const c1 = entry.child!;
      const c2 = entry.child2!;
      const c3 = entry.child3!;
      const b1 = emitPosOp(ctx, c1, cp);
      if (b1 === null) return null;
      const b2 = emitPosOp(ctx, c2, cp);
      if (b2 === null) return null;
      const b3 = emitPosOp(ctx, c3, cp);
      if (b3 === null) return null;
      return `var p=0;${b1}${b2}${b3}return p;`;
    }
    case Op.SEQ: {
      const ch = entry.children!;
      let s = 'var p=0;';
      for (const c of ch) {
        const code = emitPosOp(ctx, c, cp);
        if (code === null) return null;
        s += code;
      }
      s += 'return p;';
      return s;
    }
    case Op.FAST_SEQ_FLAT: {
      return emitFlat(ctx, entry, cp);
    }
    case Op.REP_OPTIONAL: {
      const inner = entry.child!;
      const bs = opToBitset(inner);
      if (bs) {
        const e = bsExpr(ctx, bs, 'd[0]');
        return `if(l===0)return 0;if(l===1&&${e})return 1;return -1;`;
      }
      if (inner.op === Op.TEXT || inner.op === Op.FAST_SEQ_BYTES) {
        const tb = inner.textBytes!;
        const name = ctx.capture(tb);
        let s = `if(l===0)return 0;if(l===${tb.length}){`;
        s += `for(var i=0;i<${tb.length};i++)if(d[i]!==${name}[i])return -1;return ${tb.length};}return -1;`;
        return s;
      }
      return null;
    }
  }
  const posBody = emitPosOp(ctx, entry, cp);
  if (posBody !== null) return `var p=0;${posBody}return p;`;
  return null;
}

function emitPosOp(ctx: Ctx, op: CompiledOp, cp: CompiledProgram): string | null {
  switch (op.op) {
    case Op.BYTE:
      return `if(p>=l||d[p]!==${op.byte!})return -1;p++;`;
    case Op.BYTE_RANGE:
      return `if(p>=l)return -1;var _br=d[p];if(_br<${op.low!}||_br>${op.high!})return -1;p++;`;
    case Op.BITSET: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      return `if(p>=l||!(${e}))return -1;p++;`;
    }
    case Op.NOT_BITSET: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      return `if(p>=l||${e})return -1;p++;`;
    }
    case Op.TEXT:
    case Op.FAST_SEQ_BYTES: {
      const tb = op.textBytes!;
      if (tb.length >= 4) {
        let s = `if(p+${tb.length}>l)return -1;`;
        s += emitLitCheck(tb, 'p', 'return -1;');
        s += `p+=${tb.length};`;
        return s;
      }
      const name = ctx.capture(tb);
      return `if(p+${tb.length}>l)return -1;for(var i=0;i<${tb.length};i++)if(d[p+i]!==${name}[i])return -1;p+=${tb.length};`;
    }
    case Op.CHAR_CLASS_DIGIT:
      return `if(p>=l)return -1;var _cd=d[p];if(_cd<48||_cd>57)return -1;p++;`;
    case Op.CHAR_CLASS_LETTER:
      return `if(p>=l)return -1;var _cl=d[p];if(!(_cl>=65&&_cl<=90||_cl>=97&&_cl<=122))return -1;p++;`;
    case Op.CHAR_CLASS_WORD:
      return `if(p>=l)return -1;var _cw=d[p];if(!(_cw>=65&&_cw<=90||_cw>=97&&_cw<=122||_cw>=48&&_cw<=57||_cw===95))return -1;p++;`;
    case Op.CHAR_CLASS_HEX:
      return `if(p>=l)return -1;var _ch=d[p];if(!(_ch>=48&&_ch<=57||_ch>=65&&_ch<=70||_ch>=97&&_ch<=102))return -1;p++;`;
    case Op.CHAR_CLASS_ALPHANUM:
      return `if(p>=l)return -1;var _ca=d[p];if(!(_ca>=65&&_ca<=90||_ca>=97&&_ca<=122||_ca>=48&&_ca<=57))return -1;p++;`;
    case Op.CHAR_CLASS_UPPER:
      return `if(p>=l)return -1;var _cu=d[p];if(_cu<65||_cu>90)return -1;p++;`;
    case Op.CHAR_CLASS_LOWER:
      return `if(p>=l)return -1;var _clw=d[p];if(_clw<97||_clw>122)return -1;p++;`;
    case Op.CHAR_CLASS_PRINTABLE:
      return `if(p>=l)return -1;var _cp=d[p];if(_cp<32||_cp>126)return -1;p++;`;
    case Op.CHAR_CLASS_VISIBLE:
      return `if(p>=l)return -1;var _cv=d[p];if(_cv<33||_cv>126)return -1;p++;`;
    case Op.CHAR_CLASS_WHITESPACE: {
      const bs = opToBitset(op)!;
      const e = bsExpr(ctx, bs, 'd[p]');
      return `if(p>=l||!(${e}))return -1;p++;`;
    }
    case Op.FAST_REPEAT_BITSET: {
      const e = bsExpr(ctx, op.bitset!, 'b');
      return `var _rs=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-_rs<${op.min!})return -1;`;
    }
    case Op.FAST_EXACTLY_BITSET: {
      const n = op.min!;
      const e = bsExpr(ctx, op.bitset!, 'b');
      return `if(p+${n}>l)return -1;for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e}))return -1;}p+=${n};`;
    }
    case Op.FAST_BETWEEN_BITSET: {
      const lo = op.min!; const hi = op.max!;
      const e = bsExpr(ctx, op.bitset!, 'b');
      return `var _bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo})return -1;`;
    }
    case Op.FAST_JOINED_BITSET_BYTE: {
      const sep = op.byte!;
      const e = bsExpr(ctx, op.bitset!, 'b');
      let s = `if(p>=l)return -1;var b=d[p];if(!(${e}))return -1;p++;`;
      s += `while(p<l){b=d[p];if(${e}){p++;continue;}`;
      s += `if(b!==${sep}||p+1>=l)break;b=d[p+1];if(!(${e}))break;p+=2;}`;
      return s;
    }
    case Op.FAST_SEQ2: {
      const b1 = emitPosOp(ctx, op.child!, cp);
      if (b1 === null) return null;
      const b2 = emitPosOp(ctx, op.child2!, cp);
      if (b2 === null) return null;
      return b1 + b2;
    }
    case Op.FAST_SEQ3: {
      const b1 = emitPosOp(ctx, op.child!, cp);
      if (b1 === null) return null;
      const b2 = emitPosOp(ctx, op.child2!, cp);
      if (b2 === null) return null;
      const b3 = emitPosOp(ctx, op.child3!, cp);
      if (b3 === null) return null;
      return b1 + b2 + b3;
    }
    case Op.SEQ: {
      let s = '';
      for (const c of op.children!) {
        const code = emitPosOp(ctx, c, cp);
        if (code === null) return null;
        s += code;
      }
      return s;
    }
    case Op.ALT: {
      const alts = op.children!;
      const codes: string[] = [];
      for (const a of alts) {
        const code = emitInline(ctx, a, cp);
        if (code === null) return null;
        codes.push(code);
      }
      let s = `var _ap=p;${codes[0]}`;
      for (let i = 1; i < codes.length; i++) {
        s += `if(p<0){p=_ap;${codes[i]}}`;
      }
      s += `if(p<0)return -1;`;
      return s;
    }
    case Op.FAST_ALT_BYTE_FIRST: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      const inner = emitPosOp(ctx, op.child!, cp);
      if (inner === null) return null;
      return `if(p<l&&${e}){p++;}else{${inner}}`;
    }
    case Op.FAST_ALT_LEAD_DISPATCH: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      const c1 = emitPosOp(ctx, op.child!, cp);
      if (c1 === null) return null;
      const c2 = emitPosOp(ctx, op.child2!, cp);
      if (c2 === null) return null;
      return `if(p>=l)return -1;if(${e}){${c1}}else{${c2}}`;
    }
    case Op.REP_ONE_OR_MORE:
    case Op.REP_ZERO_OR_MORE: {
      const min = op.op === Op.REP_ONE_OR_MORE ? 1 : 0;
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = `var _rc=0;while(p>=0){var _rp=p;${inner}if(p<0||p===_rp){p=_rp;break;}_rc++;}`;
      if (min > 0) s += `if(_rc<${min})return -1;`;
      return s;
    }
    case Op.REP_OPTIONAL: {
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      return `var _op=p;${inner}if(p<0)p=_op;`;
    }
    case Op.REP_EXACTLY: {
      const n = op.min!;
      const inner = emitPosOp(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = '';
      for (let i = 0; i < n; i++) s += inner;
      return s;
    }
    case Op.REP_BETWEEN: {
      const lo = op.min!; const hi = op.max!;
      const inner = emitPosOp(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = '';
      for (let i = 0; i < lo; i++) s += inner;
      if (hi > lo) {
        const innerI = emitInline(ctx, op.child!, cp);
        if (innerI === null) return null;
        s += `var _brc=${lo};while(_brc<${hi}){var _bp=p;${innerI}if(p<0||p===_bp){p=_bp;break;}_brc++;}`;
      }
      return s;
    }
    case Op.RULE_REF: {
      const idx = op.ruleIdx!;
      if (idx < 0) return `return -1;`;
      if (ctx.inlining.has(idx)) {
        const fnName = ctx.ruleFns.get(idx);
        if (fnName) return `p=${fnName}(d,l,p);if(p<0)return -1;`;
        return null;
      }
      ctx.inlining.add(idx);
      const code = emitPosOp(ctx, cp.rules[idx], cp);
      ctx.inlining.delete(idx);
      if (code === null) {
        const fnName = ctx.ruleFns.get(idx);
        if (fnName) return `p=${fnName}(d,l,p);if(p<0)return -1;`;
        return null;
      }
      return code;
    }
    case Op.FAST_SEQ_FLAT: {
      const steps = op.flatSteps;
      if (!steps) return null;
      let s = '';
      for (const st of steps) {
        const code = emitFlatStep(ctx, st, cp);
        if (code === null) return null;
        s += code;
      }
      const ft = op.flatTail;
      if (ft && ft.length > 0) {
        for (const t of ft) {
          const code = emitPosOp(ctx, t, cp);
          if (code === null) return null;
          s += code;
        }
      }
      return s;
    }
    case Op.FAST_JOINED_BYTE: {
      const sep = op.byte!;
      const child = op.child!;
      if (child.op === Op.FAST_REPEAT_BITSET) {
        const e = bsExpr(ctx, child.bitset!, 'b');
        const min = child.min!;
        let s = `var _js=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-_js<${min})return -1;`;
        s += `while(p<l&&d[p]===${sep}){var _jp=p;p++;_js=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-_js<${min}){p=_jp;break;}}`;
        return s;
      }
      if (child.op === Op.FAST_EXACTLY_BITSET) {
        const n = child.min!;
        const e = bsExpr(ctx, child.bitset!, 'b');
        let s = `if(p+${n}>l)return -1;for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e}))return -1;}p+=${n};`;
        s += `while(p<l&&d[p]===${sep}){if(p+1+${n}>l)break;var _ok=true;for(var i=0;i<${n};i++){var b=d[p+1+i];if(!(${e})){_ok=false;break;}}if(!_ok)break;p+=1+${n};}`;
        return s;
      }
      if (child.op === Op.FAST_BETWEEN_BITSET) {
        const lo = child.min!; const hi = child.max!;
        const e = bsExpr(ctx, child.bitset!, 'b');
        let s = `var _bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo})return -1;`;
        s += `while(p<l&&d[p]===${sep}){var _jp=p;p++;_bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo}){p=_jp;break;}}`;
        return s;
      }
      const inner = emitInline(ctx, child, cp);
      if (inner === null) return null;
      let s = `${inner}if(p<0)return -1;`;
      s += `while(p<l&&d[p]===${sep}){p++;${inner}if(p<0){p--;break;}}`;
      return s;
    }
    case Op.JOINED_BY:
    case Op.JOINED_BY_LENIENT: {
      const body = emitInline(ctx, op.child!, cp);
      if (body === null) return null;
      const sepOp = op.separator!;
      const sepCode = emitInline(ctx, sepOp, cp);
      if (sepCode === null) return null;
      let s = `${body}if(p<0)return -1;`;
      s += `for(;;){var _jb=p;${sepCode}if(p<0){p=_jb;break;}${body}if(p<0){p=_jb;break;}}`;
      return s;
    }
    case Op.EXTRACT: return emitPosOp(ctx, op.child!, cp);
    case Op.FAST_REP_BITSET_ALT: {
      const bs = op.bitset!; const min = op.min!;
      const e = bsExpr(ctx, bs, 'd[p]');
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = `var _rac=0;while(p>=0&&p<l){if(${e}){p++;_rac++;continue;}var _rap=p;${inner}if(p<0||p===_rap){p=_rap;break;}_rac++;}`;
      if (min > 0) s += `if(_rac<${min})return -1;`;
      return s;
    }
  }
  const bs = opToBitset(op);
  if (bs) {
    const e = bsExpr(ctx, bs, 'd[p]');
    return `if(p>=l||!(${e}))return -1;p++;`;
  }
  return null;
}

function emitInline(ctx: Ctx, op: CompiledOp, cp: CompiledProgram): string | null {
  switch (op.op) {
    case Op.BYTE:
      return `if(p>=l||d[p]!==${op.byte!})p=-1;else p++;`;
    case Op.BYTE_RANGE:
      return `if(p>=l||d[p]<${op.low!}||d[p]>${op.high!})p=-1;else p++;`;
    case Op.BITSET: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      return `if(p>=l||!(${e}))p=-1;else p++;`;
    }
    case Op.NOT_BITSET: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      return `if(p>=l||${e})p=-1;else p++;`;
    }
    case Op.TEXT:
    case Op.FAST_SEQ_BYTES: {
      const tb = op.textBytes!;
      let s = `if(p+${tb.length}>l)p=-1;else{`;
      s += emitLitCheck(tb, 'p', '{p=-1;}');
      s += `if(p>=0)p+=${tb.length};}`;
      return s;
    }
    case Op.CHAR_CLASS_DIGIT:
      return `if(p>=l||d[p]<48||d[p]>57)p=-1;else p++;`;
    case Op.CHAR_CLASS_LETTER:
      return `if(p>=l)p=-1;else{var _cl=d[p];if(_cl>=65&&_cl<=90||_cl>=97&&_cl<=122)p++;else p=-1;}`;
    case Op.CHAR_CLASS_WORD:
      return `if(p>=l)p=-1;else{var _cw=d[p];if(_cw>=65&&_cw<=90||_cw>=97&&_cw<=122||_cw>=48&&_cw<=57||_cw===95)p++;else p=-1;}`;
    case Op.CHAR_CLASS_HEX:
      return `if(p>=l)p=-1;else{var _ch=d[p];if(_ch>=48&&_ch<=57||_ch>=65&&_ch<=70||_ch>=97&&_ch<=102)p++;else p=-1;}`;
    case Op.CHAR_CLASS_ALPHANUM:
      return `if(p>=l)p=-1;else{var _ca=d[p];if(_ca>=65&&_ca<=90||_ca>=97&&_ca<=122||_ca>=48&&_ca<=57)p++;else p=-1;}`;
    case Op.CHAR_CLASS_UPPER:
      return `if(p>=l||d[p]<65||d[p]>90)p=-1;else p++;`;
    case Op.CHAR_CLASS_LOWER:
      return `if(p>=l||d[p]<97||d[p]>122)p=-1;else p++;`;
    case Op.CHAR_CLASS_PRINTABLE:
      return `if(p>=l||d[p]<32||d[p]>126)p=-1;else p++;`;
    case Op.CHAR_CLASS_VISIBLE:
      return `if(p>=l||d[p]<33||d[p]>126)p=-1;else p++;`;
    case Op.CHAR_CLASS_WHITESPACE: {
      const bs = opToBitset(op)!;
      const e = bsExpr(ctx, bs, 'd[p]');
      return `if(p>=l||!(${e}))p=-1;else p++;`;
    }
    case Op.FAST_REPEAT_BITSET: {
      const e = bsExpr(ctx, op.bitset!, 'b');
      return `var _rs=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-_rs<${op.min!})p=-1;`;
    }
    case Op.FAST_EXACTLY_BITSET: {
      const n = op.min!;
      const e = bsExpr(ctx, op.bitset!, 'b');
      return `if(p+${n}>l)p=-1;else{for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e})){p=-1;break;}}if(p>=0)p+=${n};}`;
    }
    case Op.FAST_BETWEEN_BITSET: {
      const lo = op.min!; const hi = op.max!;
      const e = bsExpr(ctx, op.bitset!, 'b');
      return `var _bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo})p=-1;`;
    }
    case Op.FAST_JOINED_BITSET_BYTE: {
      const sep = op.byte!;
      const e = bsExpr(ctx, op.bitset!, 'b');
      let s = `if(p>=l){p=-1;}else{var b=d[p];if(!(${e})){p=-1;}else{p++;`;
      s += `while(p<l){b=d[p];if(${e}){p++;continue;}`;
      s += `if(b!==${sep}||p+1>=l)break;b=d[p+1];if(!(${e}))break;p+=2;}}}`;
      return s;
    }
    case Op.FAST_SEQ2: {
      const b1 = emitInline(ctx, op.child!, cp);
      if (b1 === null) return null;
      const b2 = emitInline(ctx, op.child2!, cp);
      if (b2 === null) return null;
      return `${b1}if(p>=0){${b2}}`;
    }
    case Op.FAST_SEQ3: {
      const b1 = emitInline(ctx, op.child!, cp);
      if (b1 === null) return null;
      const b2 = emitInline(ctx, op.child2!, cp);
      if (b2 === null) return null;
      const b3 = emitInline(ctx, op.child3!, cp);
      if (b3 === null) return null;
      return `${b1}if(p>=0){${b2}}if(p>=0){${b3}}`;
    }
    case Op.SEQ: {
      const ch = op.children!;
      if (ch.length === 0) return '';
      const first = emitInline(ctx, ch[0], cp);
      if (first === null) return null;
      let s = first;
      for (let i = 1; i < ch.length; i++) {
        const code = emitInline(ctx, ch[i], cp);
        if (code === null) return null;
        s += `if(p>=0){${code}}`;
      }
      return s;
    }
    case Op.FAST_SEQ_FLAT: {
      const steps = op.flatSteps;
      if (!steps || steps.length === 0) return '';
      let s = '';
      for (const st of steps) {
        const code = emitFlatStepInline(ctx, st, cp);
        if (code === null) return null;
        if (s) s += `if(p>=0){${code}}`;
        else s = code;
      }
      const ft = op.flatTail;
      if (ft && ft.length > 0) {
        for (const t of ft) {
          const code = emitInline(ctx, t, cp);
          if (code === null) return null;
          s += `if(p>=0){${code}}`;
        }
      }
      return s;
    }
    case Op.ALT: {
      const alts = op.children!;
      let allSimple = true;
      for (const a of alts) {
        if (a.op !== Op.TEXT && a.op !== Op.FAST_SEQ_BYTES && a.op !== Op.BYTE && !opToBitset(a)) { allSimple = false; break; }
      }
      if (allSimple) {
        let s = 'p=-1;';
        for (const a of alts) {
          const code = emitInline(ctx, a, cp);
          if (code === null) return null;
          s = `${code}if(p<0){p=_ap;${s}}`;
        }
        return `var _ap=p;${s}`;
      }
      const fns: string[] = [];
      for (const a of alts) {
        const code = emitPosOp(ctx, a, cp);
        if (code === null) return null;
        const fn = `_af${ctx.altFnCount++}`;
        ctx.altFns += `function ${fn}(d,l,p){${code}return p;}\n`;
        fns.push(fn);
      }
      let s = `var _ap=p;`;
      for (let i = 0; i < fns.length; i++) {
        if (i > 0) s += 'p=_ap;';
        s += `p=${fns[i]}(d,l,p);`;
        if (i < fns.length - 1) s += `if(p>=0){}else{`;
      }
      for (let i = 0; i < fns.length - 1; i++) s += '}';
      return s;
    }
    case Op.FAST_ALT_BYTE_FIRST: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      return `if(p<l&&${e}){p++;}else{${inner}}`;
    }
    case Op.FAST_ALT_LEAD_DISPATCH: {
      const e = bsExpr(ctx, op.bitset!, 'd[p]');
      const c1 = emitInline(ctx, op.child!, cp);
      if (c1 === null) return null;
      const c2 = emitInline(ctx, op.child2!, cp);
      if (c2 === null) return null;
      return `if(p>=l)p=-1;else if(${e}){${c1}}else{${c2}}`;
    }
    case Op.REP_ONE_OR_MORE:
    case Op.REP_ZERO_OR_MORE: {
      const min = op.op === Op.REP_ONE_OR_MORE ? 1 : 0;
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = `var _rc=0;while(p>=0){var _rp=p;${inner}if(p<0||p===_rp){p=_rp;break;}_rc++;}`;
      if (min > 0) s += `if(_rc<${min})p=-1;`;
      return s;
    }
    case Op.REP_OPTIONAL: {
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      return `var _op=p;${inner}if(p<0)p=_op;`;
    }
    case Op.REP_EXACTLY: {
      const n = op.min!;
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = inner;
      for (let i = 1; i < n; i++) s += `if(p>=0){${inner}}`;
      return s;
    }
    case Op.REP_BETWEEN: {
      const lo = op.min!; const hi = op.max!;
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = inner;
      for (let i = 1; i < lo; i++) s += `if(p>=0){${inner}}`;
      if (hi > lo) {
        s += `if(p>=0){var _brc=${lo};while(_brc<${hi}){var _bp=p;${inner}if(p<0||p===_bp){p=_bp;break;}_brc++;}}`;
      }
      return s;
    }
    case Op.RULE_REF: {
      const idx = op.ruleIdx!;
      if (idx < 0) return `p=-1;`;
      if (ctx.inlining.has(idx)) {
        const fnName = ctx.ruleFns.get(idx);
        if (fnName) return `p=${fnName}(d,l,p);`;
        return null;
      }
      ctx.inlining.add(idx);
      const code = emitInline(ctx, cp.rules[idx], cp);
      ctx.inlining.delete(idx);
      if (code === null) {
        const fnName = ctx.ruleFns.get(idx);
        if (fnName) return `p=${fnName}(d,l,p);`;
        return null;
      }
      return code;
    }
    case Op.FAST_JOINED_BYTE: {
      const sep = op.byte!;
      const child = op.child!;
      if (child.op === Op.FAST_REPEAT_BITSET) {
        const e = bsExpr(ctx, child.bitset!, 'b');
        const min = child.min!;
        let s = `var _js=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-_js<${min})p=-1;`;
        s += `if(p>=0){while(p<l&&d[p]===${sep}){var _jp=p;p++;_js=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-_js<${min}){p=_jp;break;}}}`;
        return s;
      }
      if (child.op === Op.FAST_EXACTLY_BITSET) {
        const n = child.min!;
        const e = bsExpr(ctx, child.bitset!, 'b');
        let s = `if(p+${n}>l)p=-1;else{for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e})){p=-1;break;}}if(p>=0)p+=${n};}`;
        s += `if(p>=0){while(p<l&&d[p]===${sep}){if(p+1+${n}>l)break;var _ok=true;for(var i=0;i<${n};i++){var b=d[p+1+i];if(!(${e})){_ok=false;break;}}if(!_ok)break;p+=1+${n};}}`;
        return s;
      }
      if (child.op === Op.FAST_BETWEEN_BITSET) {
        const lo = child.min!; const hi = child.max!;
        const e = bsExpr(ctx, child.bitset!, 'b');
        let s = `var _bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo})p=-1;`;
        s += `if(p>=0){while(p<l&&d[p]===${sep}){var _jp=p;p++;_bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo}){p=_jp;break;}}}`;
        return s;
      }
      const inner = emitInline(ctx, child, cp);
      if (inner === null) return null;
      let s = inner;
      s += `if(p>=0){while(p<l&&d[p]===${sep}){p++;${inner}if(p<0){p--;break;}}}`;
      return s;
    }
    case Op.JOINED_BY:
    case Op.JOINED_BY_LENIENT: {
      const body = emitInline(ctx, op.child!, cp);
      if (body === null) return null;
      const sepOp = op.separator!;
      const sepLen = sepOp.op === Op.BYTE ? 1 : (sepOp.op === Op.TEXT || sepOp.op === Op.FAST_SEQ_BYTES) ? sepOp.textBytes!.length : null;
      const sepCode = emitInline(ctx, sepOp, cp);
      if (sepCode === null) return null;
      let s = body;
      if (sepLen !== null) {
        s += `if(p>=0){for(;;){var _jb=p;${sepCode}if(p<0){p=_jb;break;}${body}if(p<0){p=_jb;break;}}}`;
      } else {
        s += `if(p>=0){for(;;){var _jb=p;${sepCode}if(p<0){p=_jb;break;}var _ja=p;${body}if(p<0){p=_jb;break;}}}`;
      }
      return s;
    }
    case Op.EXTRACT: return emitInline(ctx, op.child!, cp);
    case Op.FAST_REP_BITSET_ALT: {
      const bs = op.bitset!; const min = op.min!;
      const e = bsExpr(ctx, bs, 'd[p]');
      const inner = emitInline(ctx, op.child!, cp);
      if (inner === null) return null;
      let s = `var _rac=0;while(p>=0&&p<l){if(${e}){p++;_rac++;continue;}var _rap=p;${inner}if(p<0||p===_rap){p=_rap;break;}_rac++;}`;
      if (min > 0) s += `if(_rac<${min})p=-1;`;
      return s;
    }
    case Op.CHAR_CLASS_ANY:
      return `if(p>=l)p=-1;else p++;`;
  }
  const bs = opToBitset(op);
  if (bs) {
    const e = bsExpr(ctx, bs, 'd[p]');
    return `if(p>=l||!(${e}))p=-1;else p++;`;
  }
  return null;
}

function emitFlatStepInline(ctx: Ctx, st: import('./fast-types.js').FlatStep, cp: CompiledProgram): string | null {
  switch (st.fop) {
    case FlatOp.F_BYTE:
      return `if(p>=l||d[p]!==${st.byte!})p=-1;else p++;`;
    case FlatOp.F_BITSET: {
      const e = bsExpr(ctx, st.bitset!, 'd[p]');
      return `if(p>=l||!(${e}))p=-1;else p++;`;
    }
    case FlatOp.F_EXACTLY_BITSET: {
      const n = st.min!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `if(p+${n}>l)p=-1;else{for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e})){p=-1;break;}}if(p>=0)p+=${n};}`;
    }
    case FlatOp.F_SEQ_BYTES: {
      const tb = st.textBytes!;
      let s = `if(p+${tb.length}>l)p=-1;else{`;
      s += emitLitCheck(tb, 'p', '{p=-1;}');
      s += `if(p>=0)p+=${tb.length};}`;
      return s;
    }
    case FlatOp.F_BETWEEN_BITSET: {
      const lo = st.min!; const hi = st.max!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `var c=0;while(p<l&&c<${hi}){var b=d[p];if(!(${e}))break;p++;c++;}if(c<${lo})p=-1;`;
    }
    case FlatOp.F_REPEAT_BITSET: {
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `var sp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-sp<${st.min!})p=-1;`;
    }
    case FlatOp.F_EXEC: {
      return emitInline(ctx, st.child!, cp);
    }
  }
  return null;
}

function emitAltChild(ctx: Ctx, op: CompiledOp): string | null {
  if (op.op === Op.TEXT || op.op === Op.FAST_SEQ_BYTES) {
    const tb = op.textBytes!;
    if (tb.length >= 4) {
      let s = `if(l!==${tb.length})return -1;`;
      s += emitLitCheck(tb, '0', 'return -1;');
      s += `return ${tb.length};`;
      return s;
    }
    const name = ctx.capture(tb);
    return `if(l!==${tb.length})return -1;for(var i=0;i<${tb.length};i++)if(d[i]!==${name}[i])return -1;return ${tb.length};`;
  }
  if (op.op === Op.FAST_REPEAT_BITSET) {
    const e = bsExpr(ctx, op.bitset!, 'b');
    return `var p=0;while(p<l){var b=d[p];if(!(${e}))break;p++;}return p>=${op.min!}?p:-1;`;
  }
  const bs = opToBitset(op);
  if (bs) {
    const e = bsExpr(ctx, bs, 'd[0]');
    return `if(l!==1)return -1;return ${e}?1:-1;`;
  }
  if (op.op === Op.ALT) {
    return emitEntry(ctx, op, null as any);
  }
  return null;
}

function flatStepFixedWidth(st: import('./fast-types.js').FlatStep): number {
  switch (st.fop) {
    case FlatOp.F_BYTE: return 1;
    case FlatOp.F_BITSET: return 1;
    case FlatOp.F_EXACTLY_BITSET: return st.min!;
    case FlatOp.F_SEQ_BYTES: return st.textBytes!.length;
    default: return -1;
  }
}

function emitFlatStepNoBounds(ctx: Ctx, st: import('./fast-types.js').FlatStep, off: number): string | null {
  switch (st.fop) {
    case FlatOp.F_BYTE:
      return `if(d[p+${off}]!==${st.byte!})return -1;`;
    case FlatOp.F_BITSET: {
      const e = bsExpr(ctx, st.bitset!, `d[p+${off}]`);
      return `if(!(${e}))return -1;`;
    }
    case FlatOp.F_EXACTLY_BITSET: {
      const n = st.min!;
      let code = '';
      for (let i = 0; i < n; i++) {
        const e = bsExpr(ctx, st.bitset!, `d[p+${off + i}]`);
        code += `if(!(${e}))return -1;`;
      }
      return code;
    }
    case FlatOp.F_SEQ_BYTES: {
      const tb = st.textBytes!;
      const name = ctx.capture(tb);
      let code = '';
      for (let i = 0; i < tb.length; i++) code += `if(d[p+${off + i}]!==${tb[i]})return -1;`;
      return code;
    }
    default: return null;
  }
}

function emitFlat(ctx: Ctx, entry: CompiledOp, cp: CompiledProgram): string | null {
  const steps = entry.flatSteps;
  if (!steps) return null;

  let s = 'var p=0;';
  let i = 0;
  while (i < steps.length) {
    let runWidth = 0;
    let j = i;
    while (j < steps.length) {
      const w = flatStepFixedWidth(steps[j]);
      if (w < 0) break;
      runWidth += w;
      j++;
    }
    if (j > i && runWidth > 0 && j - i >= 2) {
      s += `if(p+${runWidth}>l)return -1;`;
      let off = 0;
      for (let k = i; k < j; k++) {
        const code = emitFlatStepNoBounds(ctx, steps[k], off);
        if (code === null) { j = k; break; }
        s += code;
        off += flatStepFixedWidth(steps[k]);
      }
      s += `p+=${runWidth};`;
      i = j;
    } else {
      const code = emitFlatStep(ctx, steps[i], cp);
      if (code === null) return null;
      s += code;
      i++;
    }
  }

  const ft = entry.flatTail;
  if (ft && ft.length > 0) {
    if (ft.length === 1 && (ft[0].op === Op.REP_ZERO_OR_MORE || ft[0].op === Op.REP_ONE_OR_MORE)) {
      const tail = emitRepTail(ctx, ft[0], cp);
      if (tail === null) return null;
      s += tail;
    } else {
      return null;
    }
  }

  s += 'return p;';
  return s;
}

function emitFlatStep(ctx: Ctx, st: import('./fast-types.js').FlatStep, cp: CompiledProgram): string | null {
  switch (st.fop) {
    case FlatOp.F_BYTE:
      return `if(p>=l||d[p]!==${st.byte!})return -1;p++;`;
    case FlatOp.F_BITSET: {
      const e = bsExpr(ctx, st.bitset!, 'd[p]');
      return `if(p>=l||!(${e}))return -1;p++;`;
    }
    case FlatOp.F_EXACTLY_BITSET: {
      const n = st.min!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `if(p+${n}>l)return -1;for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e}))return -1;}p+=${n};`;
    }
    case FlatOp.F_SEQ_BYTES: {
      const tb = st.textBytes!;
      if (tb.length >= 4) {
        let s = `if(p+${tb.length}>l)return -1;`;
        s += emitLitCheck(tb, 'p', 'return -1;');
        s += `p+=${tb.length};`;
        return s;
      }
      const name = ctx.capture(tb);
      return `if(p+${tb.length}>l)return -1;for(var i=0;i<${tb.length};i++)if(d[p+i]!==${name}[i])return -1;p+=${tb.length};`;
    }
    case FlatOp.F_BETWEEN_BITSET: {
      const lo = st.min!; const hi = st.max!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `var c=0;while(p<l&&c<${hi}){var b=d[p];if(!(${e}))break;p++;c++;}if(c<${lo})return -1;`;
    }
    case FlatOp.F_REPEAT_BITSET: {
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `var sp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-sp<${st.min!})return -1;`;
    }
    case FlatOp.F_LITERAL_REPEAT_BS: {
      const tb = st.textBytes!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      let code;
      if (tb.length >= 4) {
        code = `if(p+${tb.length}>l)return -1;`;
        code += emitLitCheck(tb, 'p', 'return -1;');
        code += `p+=${tb.length};`;
      } else {
        const name = ctx.capture(tb);
        code = `if(p+${tb.length}>l)return -1;for(var i=0;i<${tb.length};i++)if(d[p+i]!==${name}[i])return -1;p+=${tb.length};`;
      }
      code += `var sp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-sp<${st.min!})return -1;`;
      return code;
    }
    case FlatOp.F_MULTI_LITERAL_REPEAT_BS: {
      const segs = st.segments!;
      let code = '';
      for (const sg of segs) {
        const be = bsExpr(ctx, sg.bitset, 'b');
        if (sg.textBytes.length >= 4) {
          code += `if(p+${sg.textBytes.length}>l)return -1;`;
          code += emitLitCheck(sg.textBytes, 'p', 'return -1;');
          code += `p+=${sg.textBytes.length};`;
        } else {
          const tname = ctx.capture(sg.textBytes);
          code += `if(p+${sg.textBytes.length}>l)return -1;for(var i=0;i<${sg.textBytes.length};i++)if(d[p+i]!==${tname}[i])return -1;p+=${sg.textBytes.length};`;
        }
        code += `var sp=p;while(p<l){var b=d[p];if(!(${be}))break;p++;}if(p-sp<${sg.min})return -1;`;
      }
      return code;
    }
    case FlatOp.F_JOINED_BITSET_BYTE: {
      const sep = st.separator!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      let code = `if(p>=l)return -1;var b=d[p];if(!(${e}))return -1;p++;`;
      code += `while(p<l){b=d[p];if(${e}){p++;continue;}`;
      code += `if(b!==${sep}||p+1>=l)break;b=d[p+1];if(!(${e}))break;p+=2;}`;
      return code;
    }
    case FlatOp.F_JOINED_BYTE: {
      if (!st.child) return '';
      return emitJoinedByte(ctx, st.child);
    }
    case FlatOp.F_REP_OPTIONAL: {
      return emitOptional(ctx, st);
    }
    case FlatOp.F_EXEC: {
      return emitExec(ctx, st.child!, cp);
    }
  }
  return null;
}

function emitJoinedByte(ctx: Ctx, op: CompiledOp): string | null {
  if (op.op !== Op.FAST_JOINED_BYTE) return null;
  const sep = op.byte!;
  const child = op.child!;
  if (child.op === Op.FAST_REPEAT_BITSET) {
    const e = bsExpr(ctx, child.bitset!, 'b');
    let s = `var js=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-js<${child.min!})return -1;`;
    s += `while(p<l&&d[p]===${sep}){p++;js=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-js<${child.min!}){p=js-1;break;}}`;
    return s;
  }
  if (child.op === Op.FAST_EXACTLY_BITSET) {
    const n = child.min!;
    const e = bsExpr(ctx, child.bitset!, 'b');
    let s = `if(p+${n}>l)return -1;for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e}))return -1;}p+=${n};`;
    s += `while(p<l&&d[p]===${sep}){if(p+1+${n}>l)break;var _ok=true;for(var i=0;i<${n};i++){var b=d[p+1+i];if(!(${e})){_ok=false;break;}}if(!_ok)break;p+=1+${n};}`;
    return s;
  }
  if (child.op === Op.FAST_BETWEEN_BITSET) {
    const lo = child.min!; const hi = child.max!;
    const e = bsExpr(ctx, child.bitset!, 'b');
    let s = `var _bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo})return -1;`;
    s += `while(p<l&&d[p]===${sep}){var _jp=p;p++;_bc=0;while(p<l&&_bc<${hi}){var b=d[p];if(!(${e}))break;p++;_bc++;}if(_bc<${lo}){p=_jp;break;}}`;
    return s;
  }
  return null;
}

function emitOptional(ctx: Ctx, st: import('./fast-types.js').FlatStep): string | null {
  const inner = st.child!;
  if (st.leadByte !== undefined) {
    if (inner.op === Op.BYTE) {
      return `if(p<l&&d[p]===${st.leadByte})p++;`;
    }
  }
  if (st.leadBitset) {
    const le = bsExpr(ctx, st.leadBitset, 'd[p]');
    if (inner.op === Op.BYTE) {
      return `if(p<l&&${le})p++;`;
    }
  }
  if (inner.op === Op.FAST_SEQ2 && inner.child!.op === Op.BYTE) {
    const byte = inner.child!.byte!;
    const c2 = inner.child2!;
    if (c2.op === Op.FAST_REPEAT_BITSET) {
      const e = bsExpr(ctx, c2.bitset!, 'b');
      let s = `if(p<l&&d[p]===${byte}){var op=p;p++;var sp=p;`;
      s += `while(p<l){var b=d[p];if(!(${e}))break;p++;}`;
      s += `if(p-sp<${c2.min!})p=op;}`;
      return s;
    }
    if (c2.op === Op.FAST_BETWEEN_BITSET) {
      const e = bsExpr(ctx, c2.bitset!, 'b');
      let s = `if(p<l&&d[p]===${byte}){var op=p;p++;var c=0;`;
      s += `while(p<l&&c<${c2.max!}){var b=d[p];if(!(${e}))break;p++;c++;}`;
      s += `if(c<${c2.min!})p=op;}`;
      return s;
    }
    if (c2.op === Op.FAST_EXACTLY_BITSET) {
      const n = c2.min!;
      const e = bsExpr(ctx, c2.bitset!, 'b');
      let s = `if(p<l&&d[p]===${byte}){var op=p;p++;if(p+${n}<=l){var ok=true;`;
      s += `for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e})){ok=false;break;}}`;
      s += `if(ok)p+=${n};else p=op;}else p=op;}`;
      return s;
    }
  }
  if (inner.op === Op.TEXT || inner.op === Op.FAST_SEQ_BYTES) {
    const tb = inner.textBytes!;
    const name = ctx.capture(tb);
    let s = `if(p+${tb.length}<=l){var ok=true;`;
    s += `for(var i=0;i<${tb.length};i++)if(d[p+i]!==${name}[i]){ok=false;break;}`;
    s += `if(ok)p+=${tb.length};}`;
    return s;
  }
  return `var _skip=0;`;
}

function emitExec(ctx: Ctx, op: CompiledOp, cp: CompiledProgram): string | null {
  if (op.op === Op.FAST_ALT_BYTE_FIRST) {
    const e = bsExpr(ctx, op.bitset!, 'd[p]');
    let s = `if(p<l&&${e}){p++;}else{`;
    const inner = emitExecChild(ctx, op.child!, cp);
    if (inner === null) return null;
    s += inner + '}';
    return s;
  }
  if (op.op === Op.FAST_ALT_LEAD_DISPATCH) {
    const e = bsExpr(ctx, op.bitset!, 'd[p]');
    let s = `if(p>=l)return -1;if(${e}){`;
    const c1 = emitExecChild(ctx, op.child!, cp);
    if (c1 === null) return null;
    s += c1 + '}else{';
    const c2 = emitExecChild(ctx, op.child2!, cp);
    if (c2 === null) return null;
    s += c2 + '}';
    return s;
  }
  return emitPosOp(ctx, op, cp);
}

function emitExecChild(ctx: Ctx, op: CompiledOp, cp?: CompiledProgram): string | null {
  if (op.op === Op.FAST_REPEAT_BITSET) {
    const e = bsExpr(ctx, op.bitset!, 'b');
    return `var sp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-sp<${op.min!})return -1;`;
  }
  if (op.op === Op.BYTE) {
    return `if(p>=l||d[p]!==${op.byte!})return -1;p++;`;
  }
  if (op.op === Op.FAST_SEQ_FLAT && op.fixedPrefix) {
    const fp = op.fixedPrefix;
    const fpLen = op.fixedPrefixLen!;
    const fpName = ctx.capture(fp);
    let s = `if(p+${fpLen}>l)return -1;`;
    s += `for(var i=0;i<${fpLen};i++){var b=d[p+i];if((${fpName}[(i<<3)+(b>>>5)]&(1<<(b&31)))===0)return -1;}p+=${fpLen};`;
    return s;
  }
  if (op.op === Op.FAST_SEQ3 && op.child!.op === Op.BYTE && op.child2!.op === Op.FAST_REPEAT_BITSET && op.child3!.op === Op.BYTE) {
    const b1 = op.child!.byte!;
    const e = bsExpr(ctx, op.child2!.bitset!, 'b');
    const b3 = op.child3!.byte!;
    let s = `if(p>=l||d[p]!==${b1})return -1;p++;`;
    s += `var sp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-sp<${op.child2!.min!})return -1;`;
    s += `if(p>=l||d[p]!==${b3})return -1;p++;`;
    return s;
  }
  const bs = opToBitset(op);
  if (bs) {
    const e = bsExpr(ctx, bs, 'd[p]');
    return `if(p>=l||!(${e}))return -1;p++;`;
  }
  if (cp) return emitPosOp(ctx, op, cp);
  return null;
}

function emitRepTail(ctx: Ctx, op: CompiledOp, cp: CompiledProgram): string | null {
  const repMin = op.op === Op.REP_ONE_OR_MORE ? 1 : 0;
  const body = op.child!;
  if (body.op === Op.FAST_SEQ_FLAT && body.flatSteps && (!body.flatTail || body.flatTail.length === 0)) {
    const rSteps = body.flatSteps;
    let s = `var rc=0;while(p<l){var sp=p;`;
    if (op.leadBitset) {
      const le = bsExpr(ctx, op.leadBitset, 'd[p]');
      s += `if(!(${le}))break;`;
    }
    for (const rst of rSteps) {
      const code = emitFlatStepBreakable(ctx, rst);
      if (code === null) return null;
      s += code;
    }
    s += `if(p===sp)break;rc++;}`;
    if (repMin > 0) s += `if(rc<${repMin})return -1;`;
    return s;
  }
  return null;
}

function emitFlatStepBreakable(ctx: Ctx, st: import('./fast-types.js').FlatStep): string | null {
  switch (st.fop) {
    case FlatOp.F_BYTE:
      return `if(p>=l||d[p]!==${st.byte!}){p=sp;break;}p++;`;
    case FlatOp.F_BITSET: {
      const e = bsExpr(ctx, st.bitset!, 'd[p]');
      return `if(p>=l||!(${e})){p=sp;break;}p++;`;
    }
    case FlatOp.F_EXACTLY_BITSET: {
      const n = st.min!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      let s = `if(p+${n}>l){p=sp;break;}var _ok=true;for(var i=0;i<${n};i++){var b=d[p+i];if(!(${e})){_ok=false;break;}}`;
      s += `if(!_ok){p=sp;break;}p+=${n};`;
      return s;
    }
    case FlatOp.F_SEQ_BYTES: {
      const tb = st.textBytes!;
      const name = ctx.capture(tb);
      let s = `if(p+${tb.length}>l){p=sp;break;}var _ok=true;`;
      s += `for(var i=0;i<${tb.length};i++)if(d[p+i]!==${name}[i]){_ok=false;break;}`;
      s += `if(!_ok){p=sp;break;}p+=${tb.length};`;
      return s;
    }
    case FlatOp.F_BETWEEN_BITSET: {
      const lo = st.min!; const hi = st.max!;
      const e = bsExpr(ctx, st.bitset!, 'b');
      let s = `var c=0;while(p<l&&c<${hi}){var b=d[p];if(!(${e}))break;p++;c++;}`;
      s += `if(c<${lo}){p=sp;break;}`;
      return s;
    }
    case FlatOp.F_REPEAT_BITSET: {
      const e = bsExpr(ctx, st.bitset!, 'b');
      return `var rp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-rp<${st.min!}){p=sp;break;}`;
    }
    case FlatOp.F_EXEC: {
      return emitExecBreakable(ctx, st.child!);
    }
  }
  return null;
}

function emitExecBreakable(ctx: Ctx, op: CompiledOp): string | null {
  if (op.op === Op.FAST_ALT_BYTE_FIRST) {
    const e = bsExpr(ctx, op.bitset!, 'd[p]');
    let s = `if(p<l&&${e}){p++;}else{`;
    const inner = emitExecChildBreakable(ctx, op.child!);
    if (inner === null) return null;
    s += inner + '}';
    return s;
  }
  if (op.op === Op.FAST_ALT_LEAD_DISPATCH) {
    const e = bsExpr(ctx, op.bitset!, 'd[p]');
    let s = `if(p>=l){p=sp;break;}if(${e}){`;
    const c1 = emitExecChildBreakable(ctx, op.child!);
    if (c1 === null) return null;
    s += c1 + '}else{';
    const c2 = emitExecChildBreakable(ctx, op.child2!);
    if (c2 === null) return null;
    s += c2 + '}';
    return s;
  }
  return null;
}

function emitExecChildBreakable(ctx: Ctx, op: CompiledOp): string | null {
  if (op.op === Op.FAST_REPEAT_BITSET) {
    const e = bsExpr(ctx, op.bitset!, 'b');
    return `var rp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-rp<${op.min!}){p=sp;break;}`;
  }
  if (op.op === Op.BYTE) {
    return `if(p>=l||d[p]!==${op.byte!}){p=sp;break;}p++;`;
  }
  if (op.op === Op.FAST_SEQ_FLAT && op.fixedPrefix) {
    const fp = op.fixedPrefix;
    const fpLen = op.fixedPrefixLen!;
    const fpName = ctx.capture(fp);
    let s = `if(p+${fpLen}>l){p=sp;break;}var _ok2=true;`;
    s += `for(var i=0;i<${fpLen};i++){var b=d[p+i];if((${fpName}[(i<<3)+(b>>>5)]&(1<<(b&31)))===0){_ok2=false;break;}}`;
    s += `if(!_ok2){p=sp;break;}p+=${fpLen};`;
    return s;
  }
  if (op.op === Op.FAST_SEQ3 && op.child!.op === Op.BYTE && op.child2!.op === Op.FAST_REPEAT_BITSET && op.child3!.op === Op.BYTE) {
    const b1 = op.child!.byte!;
    const e = bsExpr(ctx, op.child2!.bitset!, 'b');
    const b3 = op.child3!.byte!;
    let s = `if(p>=l||d[p]!==${b1}){p=sp;break;}p++;`;
    s += `var rp=p;while(p<l){var b=d[p];if(!(${e}))break;p++;}if(p-rp<${op.child2!.min!}){p=sp;break;}`;
    s += `if(p>=l||d[p]!==${b3}){p=sp;break;}p++;`;
    return s;
  }
  const bs = opToBitset(op);
  if (bs) {
    const e = bsExpr(ctx, bs, 'd[p]');
    return `if(p>=l||!(${e})){p=sp;break;}p++;`;
  }
  return null;
}
