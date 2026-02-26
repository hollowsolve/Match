import { CompiledProgram, fastMatch as jsFastMatch } from './fast.js';
import { jitMatch, jitMatchString } from './wasm-jit.js';
import { jsJitMatch } from './js-jit.js';
import { vmMatch, vmMatchString, vmMatchTree } from './vm-exec.js';
import type { VmTreeResult } from './vm-exec.js';

const enc = new TextEncoder();

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

export { vmMatch, vmMatchString, vmMatchTree };
export type { VmTreeResult };
