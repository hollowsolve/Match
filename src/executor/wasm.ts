import { CompiledProgram, compileToWasmBuffer, fastMatch as jsFastMatch } from './fast.js';

interface WasmExports {
  memory: WebAssembly.Memory;
  alloc: (size: number) => number;
  fast_match: (prog_ptr: number, prog_len: number, input_ptr: number, input_len: number) => number;
}

let wasmInstance: WasmExports | null = null;
let wasmFailed = false;
let wasmMem: Uint8Array | null = null;

function loadWasmSync(): WasmExports | null {
  if (wasmFailed) return null;
  if (wasmInstance) return wasmInstance;
  try {
    const fs = require('fs');
    const path = require('path');
    const wasmPath = path.join(__dirname, 'match_wasm.wasm');
    const wasmBytes = fs.readFileSync(wasmPath);
    const mod = new WebAssembly.Module(wasmBytes);
    const inst = new WebAssembly.Instance(mod, {});
    wasmInstance = inst.exports as unknown as WasmExports;
    wasmMem = new Uint8Array(wasmInstance.memory.buffer);
    return wasmInstance;
  } catch {
    wasmFailed = true;
    return null;
  }
}

interface WasmProgramState {
  progPtr: number;
  progLen: number;
  inputPtr: number;
}

const wasmStateCache = new WeakMap<CompiledProgram, WasmProgramState>();

function ensureState(wasm: WasmExports, cp: CompiledProgram): WasmProgramState | null {
  let state = wasmStateCache.get(cp);
  if (state) return state;
  const progBuf = compileToWasmBuffer(cp);
  const progBytes = new Uint8Array(progBuf);
  const totalSize = progBytes.length + 65536;
  const ptr = wasm.alloc(totalSize);
  if (ptr === 0) return null;
  wasmMem = new Uint8Array(wasm.memory.buffer);
  wasmMem.set(progBytes, ptr);
  state = { progPtr: ptr, progLen: progBytes.length, inputPtr: ptr + progBytes.length };
  wasmStateCache.set(cp, state);
  return state;
}

// Optimistic pre-check entry point. Selects between WASM and JS fast path:
//   - Inputs < 40 bytes → JS fast path (WASM overhead not worth it)
//   - Inputs >= 40 bytes → WASM if available, JS fast path as fallback
// Returns bytes consumed on success, -1 on failure.
// The result is used by match() to decide whether the tree executor can
// skip failure tracking (success) or needs full diagnostics (failure).
export function wasmFastMatch(cp: CompiledProgram, input: Uint8Array): number {
  if (input.length < 40) return jsFastMatch(cp, input);
  const wasm = loadWasmSync();
  if (!wasm) return jsFastMatch(cp, input);
  const state = ensureState(wasm, cp);
  if (!state) return jsFastMatch(cp, input);
  wasmMem!.set(input, state.inputPtr);
  return wasm.fast_match(state.progPtr, state.progLen, state.inputPtr, input.length);
}
