import { parse } from './dist/esm/index.js';
import { wasmFastMatch } from './dist/esm/executor/wasm.js';
import { vmMatch } from './dist/esm/executor/vm-exec.js';

const enc = new TextEncoder();

const benchmarks = [
  { name: 'literal 5', grammar: 'main: "hello"', input: 'hello' },
  { name: 'literal 20', grammar: 'main: "abcdefghijklmnopqrst"', input: 'abcdefghijklmnopqrst' },
  { name: '1+ digits (10)', grammar: 'main: one or more digits', input: '1234567890' },
  { name: '1+ digits (100)', grammar: 'main: one or more digits', input: '1'.repeat(100) },
  { name: '1+ digits (1000)', grammar: 'main: one or more digits', input: '1'.repeat(1000) },
  { name: '1+ letters (100)', grammar: 'main: one or more letters', input: 'a'.repeat(100) },
  { name: '1+ word chars (100)', grammar: 'main: one or more word characters', input: 'a'.repeat(100) },
  { name: 'between 1-3 digits', grammar: 'main: between 1 and 3 digits', input: '12' },
  { name: '4 digits', grammar: 'main: 4 digits', input: '2024' },
  { name: 'joined . (20 segs)', grammar: 'main: one or more digits joined by "."', input: Array(20).fill('123').join('.') },
  { name: '"hello" or "world"', grammar: 'main: "hello" or "world"', input: 'world' },
  { name: 'seq: lit+rep', grammar: 'main: "hello" then one or more digits', input: 'hello' + '1'.repeat(50) },
  { name: 'optional + required', grammar: 'main: optional digit then letter', input: 'A' },
  { name: 'hex digits (100)', grammar: 'main: one or more hex digits', input: 'deadBEEF'.repeat(12).slice(0, 100) },
  { name: 'multi-rule', grammar: 'main: word\nword: one or more letters', input: 'hello' },
  { name: 'FAIL early', grammar: 'main: "hello"', input: 'x' + 'a'.repeat(99) },
  { name: '3-way ALT', grammar: 'main: "GET" or "POST" or "DELETE"', input: 'DELETE' },
  { name: 'IP address', grammar: 'main: between 1 and 3 digits joined by "."', input: '192.168.1.1' },
];

const WARMUP = 5000;
const ITERS = 50000;

function bench(fn, cp, input) {
  for (let i = 0; i < WARMUP; i++) fn(cp, input);
  const t0 = performance.now();
  for (let i = 0; i < ITERS; i++) fn(cp, input);
  return performance.now() - t0;
}

console.log('Benchmark: v1 (JIT) vs v2 (bytecode VM)');
console.log('='.repeat(75));
console.log('Name'.padEnd(30), 'v1 (ms)'.padStart(10), 'v2 (ms)'.padStart(10), 'ratio'.padStart(10), 'winner'.padStart(10));
console.log('-'.repeat(75));

let v1wins = 0, v2wins = 0, ties = 0;

for (const b of benchmarks) {
  const prog = parse(b.grammar);
  const cp = prog.__compiled;
  const input = enc.encode(b.input);

  const v1check = wasmFastMatch(cp, input);
  const v2check = vmMatch(cp, input);
  if (v1check !== v2check) {
    console.log(`${b.name}: MISMATCH v1=${v1check} v2=${v2check}`);
    continue;
  }

  const v1t = bench(wasmFastMatch, cp, input);
  const v2t = bench(vmMatch, cp, input);
  const ratio = v2t / v1t;
  const winner = ratio < 0.95 ? 'VM' : ratio > 1.05 ? 'JIT' : 'tie';
  if (winner === 'VM') v2wins++;
  else if (winner === 'JIT') v1wins++;
  else ties++;

  console.log(
    b.name.padEnd(30),
    v1t.toFixed(1).padStart(10),
    v2t.toFixed(1).padStart(10),
    (ratio.toFixed(2) + 'x').padStart(10),
    winner.padStart(10)
  );
}

console.log('-'.repeat(75));
console.log(`JIT wins: ${v1wins}, VM wins: ${v2wins}, ties: ${ties}`);
