import { parse, scanBytes } from './dist/esm/index.js';

const RUNS = 15;
const WARMUP = 3;

function measure(fn) {
  for (let i = 0; i < WARMUP; i++) fn();
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const start = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms < best) best = ms;
  }
  return best;
}

function genText(size, matchDensity, matchGen, fillerGen) {
  const parts = [];
  let len = 0;
  let matches = 0;
  while (len < size) {
    if (Math.random() < matchDensity) {
      const m = matchGen();
      parts.push(m);
      len += m.length;
      matches++;
    } else {
      const f = fillerGen();
      parts.push(f);
      len += f.length;
    }
  }
  return { text: parts.join(''), expectedMatches: matches };
}

function randWord(minLen, maxLen) {
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return s;
}

function randDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

const patterns = [
  {
    label: 'Email',
    regex: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+',
    grammar: `wchar: any of (letter, digit, underscore, period, plus, hyphen)
label: one or more of (letter, digit, underscore, hyphen)
dots: label joined by period
domain: label then period then dots
main: one or more wchar then at then domain`,
    matchGen: () => `${randWord(3, 8)}@${randWord(3, 6)}.${randWord(2, 3)}`,
    fillerGen: () => ' ' + randWord(1, 12) + ' ',
  },
  {
    label: 'IP',
    regex: '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}',
    grammar: `octet: between 1 and 3 digits
main: octet then period then octet then period then octet then period then octet`,
    matchGen: () => `${randDigits(1 + Math.floor(Math.random() * 3))}.${randDigits(1 + Math.floor(Math.random() * 3))}.${randDigits(1 + Math.floor(Math.random() * 3))}.${randDigits(1 + Math.floor(Math.random() * 3))}`,
    fillerGen: () => ' ' + randWord(2, 15) + ' ',
  },
  {
    label: 'URI',
    regex: '[\\w]+:\\/\\/[^\\s]+',
    grammar: `sc: any of (letter, digit, underscore)
rc: any character except (space)
main: one or more sc then "://" then one or more rc`,
    matchGen: () => `https://${randWord(3, 10)}.${randWord(2, 3)}/${randWord(2, 8)}`,
    fillerGen: () => ' ' + randWord(1, 12) + ' ',
  },
  {
    label: 'Date',
    regex: '\\d{4}-\\d{2}-\\d{2}',
    grammar: `main: 4 digits then hyphen then 2 digits then hyphen then 2 digits`,
    matchGen: () => `${2000 + Math.floor(Math.random() * 25)}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`,
    fillerGen: () => ' ' + randWord(2, 10) + ' ',
  },
  {
    label: 'HexColor',
    regex: '#[0-9a-fA-F]{6}',
    grammar: `main: hash then 6 hex digits`,
    matchGen: () => '#' + Array.from({ length: 6 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''),
    fillerGen: () => ' ' + randWord(2, 10) + ' ',
  },
  {
    label: 'QuotedStr',
    regex: '"[^"]*"',
    grammar: `main: quote then zero or more (any character except quote) then quote`,
    matchGen: () => `"${randWord(3, 20)}"`,
    fillerGen: () => ' ' + randWord(1, 8) + ' ',
  },
];

const sizes = [
  { label: '10 KB', bytes: 10_000 },
  { label: '100 KB', bytes: 100_000 },
  { label: '1 MB', bytes: 1_000_000 },
  { label: '10 MB', bytes: 10_000_000 },
];

const densities = [
  { label: 'sparse', d: 0.005 },
  { label: 'moderate', d: 0.05 },
  { label: 'dense', d: 0.3 },
];

const colW = [14, 8, 8, 10, 10, 8];
function row(...cols) {
  return cols.map((c, i) => String(c).padEnd(colW[i])).join('');
}

console.log(row('Pattern', 'Size', 'Density', 'Regex ms', 'Match ms', 'Ratio'));
console.log('─'.repeat(colW.reduce((a, b) => a + b, 0)));

for (const pat of patterns) {
  const program = parse(pat.grammar);
  scanBytes(program, new Uint8Array(10));

  for (const size of sizes) {
    for (const density of densities) {
      const { text } = genText(size.bytes, density.d, pat.matchGen, pat.fillerGen);
      const bytes = Buffer.from(text);

      let regexCount = 0;
      const regexMs = measure(() => {
        const re = new RegExp(pat.regex, 'g');
        const m = text.match(re);
        regexCount = m ? m.length : 0;
      });

      let matchCount = 0;
      const matchMs = measure(() => {
        const m = scanBytes(program, bytes);
        matchCount = m.length;
      });

      const ratio = regexMs > 0.001 ? (matchMs / regexMs).toFixed(2) + 'x' : '-';
      console.log(row(
        pat.label,
        size.label,
        density.label,
        regexMs.toFixed(2),
        matchMs.toFixed(2),
        ratio,
      ));
    }
  }
  console.log('');
}
