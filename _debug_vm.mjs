import { buildVmWasm } from './dist/esm/executor/vm-exec.js';
import { vmCompile } from './dist/esm/executor/vm-compile.js';
import { parse, compile } from './dist/esm/index.js';

const binary = buildVmWasm();
const mod = new WebAssembly.Module(binary);
const inst = new WebAssembly.Instance(mod);
const mem = inst.exports.memory;
const fn = inst.exports.vm_exec;
const view = new Uint8Array(mem.buffer);

const BC_BASE    = 0x00040;
const DATA_BASE  = 0x10040;
const INPUT_BASE = 0x20040;

// Test 1: MATCH opcode (12) alone
view[BC_BASE] = 12; // MATCH
console.log('MATCH alone:', fn(1, 0)); // should be 0 (pos=0)

// Test 2: BYTE opcode
view[BC_BASE] = 0; // BYTE
view[BC_BASE + 1] = 65; // 'A'
view[BC_BASE + 2] = 12; // MATCH
view[INPUT_BASE] = 65; // 'A'
console.log('BYTE A match A:', fn(3, 1)); // should be 1

// Test 3: TEXT opcode
const prog = parse('main: "hello"');
const cp = prog.__compiled;
const vp = vmCompile(cp);
console.log('Bytecode:', Array.from(vp.bytecode));
console.log('Data:', Array.from(vp.data));

view.set(vp.bytecode, BC_BASE);
view.set(vp.data, DATA_BASE);
const input = new TextEncoder().encode('hello');
view.set(input, INPUT_BASE);
console.log('TEXT hello:', fn(vp.bytecode.length, input.length)); // should be 5

// Test 4: REP_BITSET for digits
const prog2 = parse('main: one or more digits');
const cp2 = prog2.__compiled;
const vp2 = vmCompile(cp2);
console.log('\nDigits bytecode:', Array.from(vp2.bytecode));
console.log('Digits data:', Array.from(vp2.data));

view.set(vp2.bytecode, BC_BASE);
view.set(vp2.data, DATA_BASE);
const input2 = new TextEncoder().encode('12345');
view.set(input2, INPUT_BASE);
console.log('REP_BITSET digits:', fn(vp2.bytecode.length, input2.length)); // should be 5
