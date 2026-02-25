import { Op, FlatOp, CompiledOp, CompiledProgram, FlatStep } from './fast-types.js';

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