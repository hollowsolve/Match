import { Op, FlatOp, CompiledOp, CompiledProgram, opToBitset, isSingleByteOp } from './fast-types.js';

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
