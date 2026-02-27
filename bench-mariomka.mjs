import fs from 'fs';
import { parse, scan, scanBytes } from './dist/esm/index.js';

const file = process.argv[2] || '/tmp/regex-benchmark/input-text.txt';
const data = fs.readFileSync(file, 'utf8');
const dataBytes = fs.readFileSync(file);

function measureRegex(label, pattern) {
  const start = process.hrtime.bigint();
  const regex = new RegExp(pattern, 'g');
  const matches = data.match(regex);
  const count = matches ? matches.length : 0;
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, ms, count, engine: 'Regex' };
}

function measureMatch(label, grammar) {
  const program = parse(grammar);
  scanBytes(program, new Uint8Array([119, 97, 114, 109]));
  const start = process.hrtime.bigint();
  const matches = scanBytes(program, dataBytes);
  const count = matches.length;
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, ms, count, engine: 'Match' };
}

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

const tests = [
  { label: 'Email', regex: '[\\w.+-]+@[\\w.-]+\\.[\\w.-]+', grammar: emailGrammar },
  { label: 'URI', regex: '[\\w]+:\\/\\/[^\\/\\s?#]+[^\\s?#]+(?:\\?[^\\s#]*)?(?:#[^\\s]*)?', grammar: uriGrammar },
  { label: 'IP', regex: '(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9])\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9])', grammar: ipGrammar },
];

console.log(`Input: ${(data.length / 1024 / 1024).toFixed(1)} MB\n`);
console.log('Test'.padEnd(10), 'Engine'.padEnd(8), 'Time (ms)'.padStart(12), 'Count'.padStart(8));
console.log('─'.repeat(42));

for (const t of tests) {
  const r = measureRegex(t.label, t.regex);
  const m = measureMatch(t.label, t.grammar);
  const ratio = (m.ms / r.ms).toFixed(2);
  const countMatch = m.count === r.count ? '✓' : `MISMATCH (${m.count} vs ${r.count})`;

  console.log(r.label.padEnd(10), r.engine.padEnd(8), r.ms.toFixed(2).padStart(12), String(r.count).padStart(8));
  console.log(m.label.padEnd(10), m.engine.padEnd(8), m.ms.toFixed(2).padStart(12), String(m.count).padStart(8));
  console.log(`  → ${ratio}x (Match/Regex)  counts: ${countMatch}`);
  console.log('');
}
