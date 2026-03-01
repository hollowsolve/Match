import fs from 'fs';
import { parse, scan, scanBytes, compile, fastMatch, compileToWasmBuffer } from './dist/esm/index.js';
import { jitMatch, jitScanString, jitScanBytes, jitCompile } from './dist/esm/executor/wasm-jit.js';
import { jsJitMatch } from './dist/esm/executor/js-jit.js';
import { fastMatch as jsInterp } from './dist/esm/executor/fast-match.js';
import { vmMatch } from './dist/esm/executor/vm-exec.js';
import { wasmFastMatch, fastScan, fastScanBytes } from './dist/esm/executor/wasm.js';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { pathToFileURL } from 'url';
import { execSync } from 'child_process';

const file = process.argv[2] || '/tmp/regex-benchmark/input-text.txt';
const data = fs.readFileSync(file, 'utf8');
const dataBytes = fs.readFileSync(file);

const RUNS = 10;
const enc = new TextEncoder();

let nativeAddon = null;
try {
  let d = process.cwd();
  for (let j = 0; j < 6; j++) {
    const p = join(d, 'native', 'match-native.node');
    if (existsSync(p)) {
      const req = createRequire(pathToFileURL(p).href);
      nativeAddon = req(p);
      break;
    }
    d = dirname(d);
  }
} catch {}

const emailGrammar = `wchar: any of (letter, digit, underscore, period, plus, hyphen)
label: one or more of (letter, digit, underscore, hyphen)
dots: label joined by period
domain: label then period then dots
main: one or more wchar then at then domain`;

const uriGrammar = `scheme char: any of (letter, digit, underscore)
path char: any character except (space, question, hash)
host char: any character except (slash, space, question, hash)
query char: any character except (space, hash)
frag char: any character except (space)
main: one or more scheme char then "://" then one or more host char then zero or more path char then optional (question then zero or more query char) then optional (hash then zero or more frag char)`;

const ipGrammar = `octet: between 1 and 3 digits
main: octet then period then octet then period then octet then period then octet`;

const patterns = [
  { label: 'Email', regex: '[\\w.+-]+@[\\w.-]+\\.[\\w.-]+', grammar: emailGrammar },
  { label: 'URI', regex: '[\\w]+:\\/\\/[^\\/\\s?#]+[^\\s?#]+(?:\\?[^\\s#]*)?(?:#[^\\s]*)?', grammar: uriGrammar },
  { label: 'IP', regex: '(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9])', grammar: ipGrammar },
];

function bench(name, fn) {
  try { fn(); } catch { return null; }
  let best = Infinity, count = -1;
  for (let i = 0; i < RUNS; i++) {
    const t0 = process.hrtime.bigint();
    const c = fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (c === null || c === undefined) return null;
    count = c;
    if (ms < best) best = ms;
  }
  return { name, ms: best, count };
}

console.log(`Mariomka Regex Benchmark — All Match Backends`);
console.log(`Input: ${(dataBytes.length / 1024 / 1024).toFixed(1)} MB  (${data.length} chars)\n`);

for (const pat of patterns) {
  const program = parse(pat.grammar);
  const cp = program.__compiled;
  const bytes = enc.encode(data);

  // warm up
  scanBytes(program, new Uint8Array([119, 97, 114, 109]));
  scanBytes(program, dataBytes);
  try { jitCompile(cp); } catch {}

  let nativeProg = null;
  if (nativeAddon) {
    try { nativeProg = new nativeAddon.NativeProgram(cp); } catch {}
  }

  const results = [];

  // V8 Regex
  results.push(bench('V8 Regex', () => {
    const re = new RegExp(pat.regex, 'g');
    const m = data.match(re);
    return m ? m.length : 0;
  }));

  // Match: WASM JIT scan (primary fast path)
  results.push(bench('WASM JIT scan', () => {
    const r = jitScanBytes(cp, dataBytes);
    return r ? r.length : null;
  }));

  // Match: WASM JIT scan string
  results.push(bench('WASM JIT str', () => {
    const r = jitScanString(cp, data);
    return r ? r.length : null;
  }));

  // Match: Native (NAPI Rust)
  if (nativeProg) {
    results.push(bench('Native (NAPI)', () => {
      const buf = nativeProg.scanOffsets(dataBytes);
      return buf.byteLength >>> 3;
    }));
  }

  // Match: JS JIT scan (byte-by-byte via jsJitMatch)
  results.push(bench('JS JIT scan', () => {
    let count = 0, pos = 0;
    while (pos < bytes.length) {
      const sub = bytes.subarray(pos);
      const consumed = jsJitMatch(cp, sub);
      if (consumed > 0) { count++; pos += consumed; } else { pos++; }
    }
    return count;
  }));

  // Match: scanBytes (auto-selects best available)
  results.push(bench('scanBytes(auto)', () => {
    return scanBytes(program, dataBytes).length;
  }));

  // Match: JS interpreter scan
  results.push(bench('JS interp scan', () => {
    let count = 0, pos = 0;
    while (pos < bytes.length) {
      const sub = bytes.subarray(pos);
      const consumed = jsInterp(cp, sub);
      if (consumed > 0) { count++; pos += consumed; } else { pos++; }
    }
    return count;
  }));

  // Match: libmatch (C FFI) via Python
  const bcPath = `/tmp/match-bytecodes/${pat.label.toLowerCase()}.bin`;
  if (existsSync(bcPath)) {
    try {
      const pyScript = `/tmp/_bench_libmatch.py`;
      fs.writeFileSync(pyScript, [
        `import sys, time, os`,
        `sys.path.insert(0, 'bindings/python')`,
        `from match_lang import load_bytecode`,
        `p = load_bytecode('${bcPath}')`,
        `data = open('${file}', 'r').read()`,
        `p.scan_count(data)`,
        `best = float('inf')`,
        `count = 0`,
        `for _ in range(${RUNS}):`,
        `    t0 = time.perf_counter()`,
        `    count = p.scan_count(data)`,
        `    ms = (time.perf_counter() - t0) * 1000`,
        `    if ms < best: best = ms`,
        `print(f'{best:.4f},{count}')`,
      ].join('\n'));
      const out = execSync(`python3 ${pyScript}`, { encoding: 'utf8', timeout: 60000 }).trim();
      const [ms, count] = out.split(',');
      results.push({ name: 'libmatch (Python)', ms: parseFloat(ms), count: parseInt(count) });
    } catch (e) { /* skip */ }
  }

  // Python re (baseline)
  try {
    const pyScript = `/tmp/_bench_pyre.py`;
    fs.writeFileSync(pyScript, [
      `import sys, time, re`,
      `data = open('${file}', 'r').read()`,
      `pat = re.compile(r"""${pat.regex}""")`,
      `pat.findall(data)`,
      `best = float('inf')`,
      `count = 0`,
      `for _ in range(${RUNS}):`,
      `    t0 = time.perf_counter()`,
      `    count = len(pat.findall(data))`,
      `    ms = (time.perf_counter() - t0) * 1000`,
      `    if ms < best: best = ms`,
      `print(f'{best:.4f},{count}')`,
    ].join('\n'));
    const out = execSync(`python3 ${pyScript}`, { encoding: 'utf8', timeout: 60000 }).trim();
    const [ms, count] = out.split(',');
    results.push({ name: 'Python re', ms: parseFloat(ms), count: parseInt(count) });
  } catch (e) { /* skip */ }

  const valid = results.filter(r => r && r.ms != null);
  if (valid.length === 0) continue;

  valid.sort((a, b) => a.ms - b.ms);
  const fastest = valid[0].ms;

  console.log(`── ${pat.label} ${'─'.repeat(58 - pat.label.length)}`);
  console.log(
    '  ' + '#'.padEnd(4) +
    'Engine'.padEnd(20) +
    'Scan time'.padStart(10) +
    'Matches'.padStart(8) +
    'vs #1'.padStart(8)
  );
  for (let i = 0; i < valid.length; i++) {
    const r = valid[i];
    const ratio = r.ms / fastest;
    const ratioStr = i === 0 ? '' : `${ratio.toFixed(1)}x`;
    const barLen = Math.max(1, Math.min(Math.round(40 * r.ms / valid[valid.length - 1].ms), 40));
    const bar = '█'.repeat(barLen);
    console.log(
      `  ${String(i + 1).padEnd(4)}` +
      `${r.name.padEnd(20)}` +
      `${r.ms.toFixed(2).padStart(8)}ms` +
      `${String(r.count).padStart(8)}` +
      `${ratioStr.padStart(8)}` +
      `  ${bar}`
    );
  }
  console.log('');
}
