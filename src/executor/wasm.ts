import { CompiledProgram, fastMatch as jsFastMatch } from './fast.js';
import { jitMatch, jitMatchString, jitScanString, jitScanBytes } from './wasm-jit.js';
import type { ByteScanMatch } from './wasm-jit.js';
import { jsJitMatch } from './js-jit.js';
import { vmMatch, vmMatchString, vmMatchTree } from './vm-exec.js';
import type { VmTreeResult } from './vm-exec.js';
import type { ScanMatch } from './wasm-jit.js';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
const enc = new TextEncoder();

let nativeAddon: any = null;
let nativeAddonLoaded: boolean | null = null;
function loadAddon(): any {
  if (nativeAddonLoaded === false) return null;
  if (nativeAddonLoaded === true) return nativeAddon;
  nativeAddonLoaded = false;
  try {
    const dirs: string[] = [];
    try { dirs.push(__dirname); } catch {}
    dirs.push(process.cwd());
    for (const base of dirs) {
      let d = base;
      for (let j = 0; j < 6; j++) {
        const p = join(d, 'native', 'match-native.node');
        if (existsSync(p)) {
          const req = createRequire(pathToFileURL(p).href);
          nativeAddon = req(p);
          nativeAddonLoaded = true;
          return nativeAddon;
        }
        d = dirname(d);
      }
    }
  } catch {}
  return null;
}

const nativeProgCache = new WeakMap<CompiledProgram, any>();

function tryNativeScan(cp: CompiledProgram, input: string): ScanMatch[] | null {
  const addon = loadAddon();
  if (!addon) return null;
  try {
    let np = nativeProgCache.get(cp);
    if (!np) {
      np = new addon.NativeProgram(cp);
      nativeProgCache.set(cp, np);
    }
    if (np.scanUtf8) {
      const buf: Buffer = np.scanUtf8(input);
      const count = buf.byteLength >>> 3;
      if (count === 0) return [];
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const results: ScanMatch[] = new Array(count);
      for (let i = 0; i < count; i++) {
        const s = dv.getUint32(i * 8, true);
        const e = dv.getUint32(i * 8 + 4, true);
        results[i] = { start: s, end: e, text: input.slice(s, e) };
      }
      return results;
    }
    return np.scan(input);
  } catch {
    return null;
  }
}

export function wasmFastMatch(cp: CompiledProgram, input: Uint8Array): number {
  if (input.length < 32) {
    const r = jsJitMatch(cp, input);
    if (r !== -2) return r;
    return jsFastMatch(cp, input);
  }
  const r = jitMatch(cp, input);
  if (r === -2) return jsFastMatch(cp, input);
  return r;
}

export function wasmFastMatchString(cp: CompiledProgram, input: string): number {
  if (input.length < 32) {
    const bytes = enc.encode(input);
    const r = jsJitMatch(cp, bytes);
    if (r !== -2) return r;
    return jsFastMatch(cp, bytes);
  }
  const r = jitMatchString(cp, input);
  if (r === -2) return jsFastMatch(cp, enc.encode(input));
  return r;
}

export function fastScan(cp: CompiledProgram, input: string): ScanMatch[] {
  const nativeResult = tryNativeScan(cp, input);
  if (nativeResult !== null) return nativeResult;
  const wasmResult = jitScanString(cp, input);
  if (wasmResult !== null) return wasmResult;
  const bytes = enc.encode(input);
  return jsJitScan(cp, bytes, input);
}

export function fastScanBytes(cp: CompiledProgram, input: Uint8Array): ByteScanMatch[] {
  const wasmResult = jitScanBytes(cp, input);
  if (wasmResult !== null) return wasmResult;
  const results: ByteScanMatch[] = [];
  let pos = 0;
  while (pos < input.length) {
    const sub = input.subarray(pos);
    let consumed = jsJitMatch(cp, sub);
    if (consumed === -2) consumed = jsFastMatch(cp, sub);
    if (consumed > 0) {
      results.push({ start: pos, end: pos + consumed });
      pos += consumed;
    } else {
      pos++;
    }
  }
  return results;
}

function jsJitScan(cp: CompiledProgram, bytes: Uint8Array, str: string): ScanMatch[] {
  const results: ScanMatch[] = [];
  const len = bytes.length;
  let bytePos = 0;
  let charPos = 0;
  while (bytePos < len) {
    const sub = bytes.subarray(bytePos);
    let consumed = jsJitMatch(cp, sub);
    if (consumed === -2) consumed = jsFastMatch(cp, sub);
    if (consumed > 0) {
      const charEnd = advanceChars(str, charPos, bytes, bytePos, consumed);
      results.push({ start: charPos, end: charEnd, text: str.slice(charPos, charEnd) });
      charPos = charEnd;
      bytePos += consumed;
    } else {
      const code = bytes[bytePos];
      const seqLen = code < 0x80 ? 1 : code < 0xE0 ? 2 : code < 0xF0 ? 3 : 4;
      bytePos += seqLen;
      charPos += seqLen === 4 ? 2 : 1;
    }
  }
  return results;
}

function advanceChars(str: string, charPos: number, bytes: Uint8Array, byteStart: number, byteCount: number): number {
  let bi = byteStart;
  let ci = charPos;
  const end = byteStart + byteCount;
  while (bi < end) {
    const code = bytes[bi];
    if (code < 0x80) bi += 1;
    else if (code < 0xE0) bi += 2;
    else if (code < 0xF0) bi += 3;
    else { bi += 4; ci++; }
    ci++;
  }
  return ci;
}

export { vmMatch, vmMatchString, vmMatchTree };
export type { VmTreeResult, ScanMatch, ByteScanMatch };
