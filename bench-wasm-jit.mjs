import { parse, compile } from './dist/esm/index.js';
import { wasmFastMatch } from './dist/esm/executor/wasm.js';
import { fastMatch } from './dist/esm/executor/fast.js';

const enc = new TextEncoder();

const benchmarks = [
  // ── Category 1: Simple character classes ──
  { name: 'digit (1 char)', grammar: 'main: digit', input: '5', regex: /^\d$/ },
  { name: 'letter (1 char)', grammar: 'main: letter', input: 'a', regex: /^[a-zA-Z]$/ },
  { name: 'hex digit (1 char)', grammar: 'main: hex digit', input: 'f', regex: /^[0-9a-fA-F]$/ },
  { name: 'whitespace (1 char)', grammar: 'main: whitespace', input: ' ', regex: /^[\s]$/ },
  { name: 'word character (1 char)', grammar: 'main: word character', input: '_', regex: /^\w$/ },
  { name: 'uppercase (1 char)', grammar: 'main: uppercase', input: 'Z', regex: /^[A-Z]$/ },

  // ── Category 2: Quoted literals ──
  { name: 'literal 5 chars', grammar: 'main: "hello"', input: 'hello', regex: /^hello$/ },
  { name: 'literal 10 chars', grammar: 'main: "helloworld"', input: 'helloworld', regex: /^helloworld$/ },
  { name: 'literal 20 chars', grammar: 'main: "abcdefghijklmnopqrst"', input: 'abcdefghijklmnopqrst', regex: /^abcdefghijklmnopqrst$/ },

  // ── Category 3: Repetition — one or more ──
  { name: '1+ digits (5)', grammar: 'main: one or more digits', input: '12345', regex: /^\d+$/ },
  { name: '1+ digits (50)', grammar: 'main: one or more digits', input: '1'.repeat(50), regex: /^\d+$/ },
  { name: '1+ digits (500)', grammar: 'main: one or more digits', input: '1'.repeat(500), regex: /^\d+$/ },
  { name: '1+ digits (5000)', grammar: 'main: one or more digits', input: '1'.repeat(5000), regex: /^\d+$/ },
  { name: '1+ letters (50)', grammar: 'main: one or more letters', input: 'a'.repeat(50), regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (500)', grammar: 'main: one or more letters', input: 'a'.repeat(500), regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (5000)', grammar: 'main: one or more letters', input: 'a'.repeat(5000), regex: /^[a-zA-Z]+$/ },
  { name: '1+ word chars (500)', grammar: 'main: one or more word characters', input: 'abc_123_'.repeat(62).slice(0, 500), regex: /^\w+$/ },
  { name: '1+ hex digits (500)', grammar: 'main: one or more hex digits', input: 'deadbeef'.repeat(62).slice(0, 500), regex: /^[0-9a-fA-F]+$/ },

  // ── Category 4: Repetition — zero or more ──
  { name: '0+ digits (empty)', grammar: 'main: zero or more digits', input: '', regex: /^\d*$/ },
  { name: '0+ digits (500)', grammar: 'main: zero or more digits', input: '9'.repeat(500), regex: /^\d*$/ },

  // ── Category 5: Exact repetition ──
  { name: '4 digits', grammar: 'main: 4 digits', input: '2025', regex: /^\d{4}$/ },
  { name: '10 digits', grammar: 'main: 10 digits', input: '1234567890', regex: /^\d{10}$/ },
  { name: '100 digits', grammar: 'main: 100 digits', input: '5'.repeat(100), regex: /^\d{100}$/ },

  // ── Category 6: Between repetition ──
  { name: 'between 1-3 digits (2)', grammar: 'main: between 1 and 3 digits', input: '42', regex: /^\d{1,3}$/ },
  { name: 'between 2-10 letters (7)', grammar: 'main: between 2 and 10 letters', input: 'abcdefg', regex: /^[a-zA-Z]{2,10}$/ },
  { name: 'between 1-255 digits (100)', grammar: 'main: between 1 and 255 digits', input: '7'.repeat(100), regex: /^\d{1,255}$/ },

  // ── Category 7: Optional ──
  { name: 'optional digit (empty)', grammar: 'main: optional digit', input: '', regex: /^\d?$/ },
  { name: 'optional digit (present)', grammar: 'main: optional digit', input: '5', regex: /^\d?$/ },

  // ── Category 8: Sequences ──
  { name: 'letter then digit', grammar: 'main: letter then digit', input: 'a1', regex: /^[a-zA-Z]\d$/ },
  { name: 'date YYYY-MM-DD', grammar: 'main: 4 digits then "-" then 2 digits then "-" then 2 digits', input: '2025-02-25', regex: /^\d{4}-\d{2}-\d{2}$/ },
  { name: 'time HH:MM:SS', grammar: 'main: 2 digits then ":" then 2 digits then ":" then 2 digits', input: '14:30:59', regex: /^\d{2}:\d{2}:\d{2}$/ },
  { name: 'hex color #RRGGBB', grammar: 'main: "#" then 6 hex digits', input: '#FF00AA', regex: /^#[0-9a-fA-F]{6}$/ },
  { name: 'literal+repeat "hello"+digits', grammar: 'main: "hello" then one or more digits', input: 'hello123456', regex: /^hello\d+$/ },
  { name: 'long seq: proto+host+path', grammar: 'main: "https://" then one or more letters then "." then one or more letters then "/" then one or more letters', input: 'https://example.com/path', regex: /^https:\/\/[a-zA-Z]+\.[a-zA-Z]+\/[a-zA-Z]+$/ },

  // ── Category 9: Alternatives ──
  { name: 'letter or digit', grammar: 'main: letter or digit', input: '7', regex: /^[a-zA-Z0-9]$/ },
  { name: '4 alternatives', grammar: 'main: "foo" or "bar" or "baz" or "qux"', input: 'qux', regex: /^(foo|bar|baz|qux)$/ },
  { name: 'any of (letter,digit)', grammar: 'main: any of (letter, digit)', input: 'a', regex: /^[a-zA-Z0-9]$/ },
  { name: 'any of (letter,digit,"-","_",".")', grammar: 'main: one or more of (letter, digit, "-", "_", ".")', input: 'hello-world_v1.0', regex: /^[a-zA-Z0-9\-_.]+$/ },

  // ── Category 10: Joined by ──
  { name: 'digits joined by "." (5 segs)', grammar: 'main: one or more digits joined by "."', input: '1.2.3.4.5', regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined by "." (20 segs)', grammar: 'main: one or more digits joined by "."', input: Array.from({length: 20}, (_, i) => i).join('.'), regex: /^\d+(\.\d+)*$/ },
  { name: 'words joined by ","', grammar: 'main: one or more letters joined by ","', input: 'foo,bar,baz,qux,quux', regex: /^[a-zA-Z]+(,[a-zA-Z]+)*$/ },
  { name: 'words joined by ", " (long)', grammar: 'main: one or more letters joined by ", "', input: Array.from({length: 50}, () => 'word').join(', '), regex: /^[a-zA-Z]+(, [a-zA-Z]+)*$/ },

  // ── Category 11: Complex real-world patterns ──
  { name: 'IPv4 address', grammar: 'octet: between 1 and 3 digits\nmain: octet joined by "."', input: '192.168.1.1', regex: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/ },
  { name: 'email-like', grammar: 'local: one or more of (letter, digit, ".", "-", "_")\ndomain: one or more of (letter, digit, "-")\nmain: local then "@" then domain then "." then domain', input: 'user.name@example.com', regex: /^[a-zA-Z0-9._-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+$/ },
  { name: 'key=value pairs', grammar: 'key: one or more of (letter, digit)\nval: one or more of (letter, digit)\npair: key then "=" then val\nmain: pair joined by "&"', input: 'foo=bar&baz=123&key=value', regex: /^[a-zA-Z0-9]+=[a-zA-Z0-9]+(&[a-zA-Z0-9]+=[a-zA-Z0-9]+)*$/ },
  { name: 'semver', grammar: 'num: one or more digits\nmain: num then "." then num then "." then num', input: '1.23.456', regex: /^\d+\.\d+\.\d+$/ },
  { name: 'CSS hex color shorthand/full', grammar: 'main: "#" then (6 hex digits or 3 hex digits)', input: '#FF00AA', regex: /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/ },
  { name: 'MAC address', grammar: 'pair: 2 hex digits\nmain: pair joined by ":"', input: '00:1A:2B:3C:4D:5E', regex: /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/ },
  { name: 'UUID', grammar: 'main: 8 hex digits then "-" then 4 hex digits then "-" then 4 hex digits then "-" then 4 hex digits then "-" then 12 hex digits', input: '550e8400-e29b-41d4-a716-446655440000', regex: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ },

  // ── Category 12: Except/exclusion patterns ──
  { name: 'letter except "q" (500)', grammar: 'main: one or more (letter except ("q"))', input: 'abcdefghijklmnop'.repeat(31).slice(0, 500), regex: /^[a-pA-Zr-z]+$/ },

  // ── Category 13: Failure cases (no match) ──
  { name: 'FAIL: digits on alpha', grammar: 'main: one or more digits', input: 'abcdef', regex: /^\d+$/ },
  { name: 'FAIL: letters on digits', grammar: 'main: one or more letters', input: '123456', regex: /^[a-zA-Z]+$/ },
  { name: 'FAIL: date bad format', grammar: 'main: 4 digits then "-" then 2 digits then "-" then 2 digits', input: '2025/02/25', regex: /^\d{4}-\d{2}-\d{2}$/ },
  { name: 'FAIL: empty on 1+ digits', grammar: 'main: one or more digits', input: '', regex: /^\d+$/ },

  // ── Category 14: Large input stress tests ──
  { name: 'STRESS: 1+ digits (50k)', grammar: 'main: one or more digits', input: '7'.repeat(50000), regex: /^\d+$/ },
  { name: 'STRESS: 1+ digits (500k)', grammar: 'main: one or more digits', input: '7'.repeat(500000), regex: /^\d+$/ },
  { name: 'STRESS: date repeated (1k dates)', grammar: 'main: one or more of (digit, "-")', input: '2025-02-25-'.repeat(1000).slice(0, -1), regex: /^[\d-]+$/ },
  { name: 'STRESS: letters (100k)', grammar: 'main: one or more letters', input: 'abcdefghij'.repeat(10000), regex: /^[a-zA-Z]+$/ },
  { name: 'STRESS: word chars (100k)', grammar: 'main: one or more word characters', input: 'hello_world_'.repeat(8333).slice(0, 100000), regex: /^\w+$/ },
  { name: 'STRESS: hex digits (100k)', grammar: 'main: one or more hex digits', input: 'deadbeef'.repeat(12500), regex: /^[0-9a-fA-F]+$/ },
  { name: 'STRESS: joined by (5k segs)', grammar: 'main: one or more digits joined by ","', input: Array.from({length: 5000}, (_, i) => i % 10).join(','), regex: /^\d+(,\d+)*$/ },

  // ── Category 15: Nested/complex grammar ──
  { name: 'nested parens ()(())', grammar: 'nested: "(" then optional nested then ")"\nmain: one or more nested', input: '()(())', regex: /^(\((\(\))*\))+$/ },
  { name: 'mixed seq + alt + rep', grammar: 'main: one or more (letter or digit) then "-" then one or more digits', input: 'abc123-456', regex: /^[a-zA-Z0-9]+-\d+$/ },
  { name: 'optional prefix + body', grammar: 'main: optional "0x" then one or more hex digits', input: '0xDEADBEEF', regex: /^(0x)?[0-9a-fA-F]+$/ },
  { name: 'complex: log line', grammar: 'ts: 4 digits then "-" then 2 digits then "-" then 2 digits\nlvl: "INFO" or "WARN" or "ERROR"\nmain: ts then " " then lvl then " " then one or more of (letter, digit, " ", ".", "-", "_", ":")', input: '2025-02-25 ERROR something went wrong: detail_info', regex: /^\d{4}-\d{2}-\d{2} (INFO|WARN|ERROR) [a-zA-Z0-9 .\-_:]+$/ },
];

function bench(fn, iters) {
  for (let i = 0; i < Math.min(iters, 1000); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  return performance.now() - t0;
}

function chooseIters(inputLen) {
  if (inputLen > 100000) return 1000;
  if (inputLen > 10000) return 5000;
  if (inputLen > 1000) return 20000;
  if (inputLen > 100) return 50000;
  return 200000;
}

import { jitMatch } from './dist/esm/executor/wasm-jit.js';

console.log('Match (JS+WASM hybrid) vs RegExp — Comprehensive Benchmark');
console.log('='.repeat(120));
console.log(
  'Test'.padEnd(42),
  'Input'.padEnd(8),
  'Iters'.padEnd(8),
  'Match(ms)'.padEnd(10),
  'Regex(ms)'.padEnd(10),
  'M/R'.padEnd(8),
  'Engine'.padEnd(8),
  'Winner'
);
console.log('-'.repeat(120));

let matchWins = 0, regexWins = 0, ties = 0;

for (const b of benchmarks) {
  const prog = parse(b.grammar);
  const cp = compile(prog);
  const bytes = enc.encode(b.input);
  const iters = chooseIters(b.input.length);

  const mR = wasmFastMatch(cp, bytes);
  const reR = b.regex.test(b.input);
  const mOk = mR >= 0;
  if (mOk !== reR) console.log(`  !! ${b.name}: correctness mismatch match=${mR} regex=${reR}`);

  const engine = bytes.length < 128 ? 'JS' : 'WASM';
  const mMs = bench(() => wasmFastMatch(cp, bytes), iters);
  const reMs = bench(() => b.regex.test(b.input), iters);

  const mr = (mMs / reMs).toFixed(2);
  let winner;
  const diff = Math.abs(mMs - reMs) / Math.max(mMs, reMs);
  if (diff < 0.05) { winner = 'TIE'; ties++; }
  else if (mMs <= reMs) { winner = 'Match'; matchWins++; }
  else { winner = 'Regex'; regexWins++; }

  console.log(
    b.name.padEnd(42),
    String(b.input.length).padEnd(8),
    String(iters).padEnd(8),
    mMs.toFixed(1).padStart(7).padEnd(10),
    reMs.toFixed(1).padStart(7).padEnd(10),
    mr.padStart(6).padEnd(8),
    engine.padEnd(8),
    winner
  );
}

console.log('='.repeat(120));
console.log(`Winners: Match=${matchWins}  Regex=${regexWins}  Tie=${ties}  (of ${benchmarks.length} tests)`);
console.log();
console.log('M/R = Match time / Regex time (< 1.0 means Match is faster)');
console.log('Engine = JS (small input, <128 bytes) or WASM (large input)');
