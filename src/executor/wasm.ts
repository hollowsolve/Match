import { CompiledProgram, fastMatch as jsFastMatch } from './fast.js';
import { jitMatch } from './wasm-jit.js';

export function wasmFastMatch(cp: CompiledProgram, input: Uint8Array): number {
  if (input.length < 64) return jsFastMatch(cp, input);
  const r = jitMatch(cp, input);
  if (r === -2) return jsFastMatch(cp, input);
  return r;
}
