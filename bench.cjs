const { parse, match, compile, fastMatch } = require('./dist/cjs/index.js');

const encoder = new TextEncoder();

// ─── Config ───────────────────────────────────────────────────────────
const WARMUP = 500;
const ITERATIONS = 10_000;

// ─── Harness ──────────────────────────────────────────────────────────
function bench(name, matchFn, regexFn, input) {
  for (let i = 0; i < WARMUP; i++) { matchFn(input); regexFn(input); }

  const t0 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) matchFn(input);
  const matchTime = performance.now() - t0;

  const t1 = performance.now();
  for (let i = 0; i < ITERATIONS; i++) regexFn(input);
  const regexTime = performance.now() - t1;

  const ratio = matchTime / regexTime;
  const winner = ratio <= 1 ? 'MATCH' : 'REGEX';
  const factor = ratio <= 1 ? (1 / ratio).toFixed(1) : ratio.toFixed(1);

  return { name, matchTime, regexTime, ratio, winner, factor };
}

function add(name, grammar, re, input) {
  cases.push({ name, grammar, re, input });
}

const cases = [];

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 1 — Literals & Fixed Strings
// ═══════════════════════════════════════════════════════════════════════

add('Literal word',
  `main: "hello"`,
  /^hello$/,
  'hello');

add('Multi-word literal',
  `main: "Content-Type: application/json"`,
  /^Content-Type: application\/json$/,
  'Content-Type: application/json');

add('Case-sensitive keyword',
  `main: "SELECT" then space then "FROM"`,
  /^SELECT FROM$/,
  'SELECT FROM');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 2 — Character Classes
// ═══════════════════════════════════════════════════════════════════════

add('Single letter',
  `main: letter`,
  /^[a-zA-Z]$/,
  'x');

add('Single digit',
  `main: digit`,
  /^[0-9]$/,
  '7');

add('One alphanumeric',
  `main: alphanumeric`,
  /^[a-zA-Z0-9]$/,
  'k');

add('One word character',
  `main: word character`,
  /^[a-zA-Z0-9_]$/,
  '_');

add('Hex digit',
  `main: hex digit`,
  /^[0-9a-fA-F]$/,
  'c');

add('Printable char',
  `main: printable`,
  /^[\x20-\x7e]$/,
  '~');

add('Visible char',
  `main: visible`,
  /^[\x21-\x7e]$/,
  '!');

add('Any character',
  `main: any character`,
  /^.$/,
  '\u00E9');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 3 — Ranges & Sets
// ═══════════════════════════════════════════════════════════════════════

add('Char range (a-z)',
  `main: "a" to "z"`,
  /^[a-z]$/,
  'm');

add('Any-of set',
  `main: any of (letter, digit, underscore, hyphen)`,
  /^[a-zA-Z0-9_-]$/,
  '-');

add('None-of set',
  `main: none of (space, tab, newline)`,
  /^[^ \t\n]$/,
  'A');

add('Except modifier',
  `main: printable except (double quote, backslash)`,
  /^[\x20-\x7e&&[^"\\]]$/.source ? /^[^\x00-\x1f\x7f"\\]$/ : /^[^\x00-\x1f\x7f"\\]$/,
  'a');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 4 — Quantifiers
// ═══════════════════════════════════════════════════════════════════════

add('One or more letters',
  `main: one or more letters`,
  /^[a-zA-Z]+$/,
  'abcdefghij');

add('Zero or more digits',
  `main: zero or more digits`,
  /^\d*$/,
  '314159');

add('Optional prefix',
  `main: optional hyphen then one or more digits`,
  /^-?\d+$/,
  '-42');

add('Exactly N chars',
  `main: 6 letters`,
  /^[a-zA-Z]{6}$/,
  'foobar');

add('Between N and M',
  `main: between 2 and 4 digits`,
  /^\d{2,4}$/,
  '123');

add('Repeated set',
  `main: one or more of (letter, digit, underscore)`,
  /^[a-zA-Z0-9_]+$/,
  'my_var_123');

add('Repeated except',
  `main: one or more characters except (comma, newline)`,
  /^[^,\n]+$/,
  'hello world! how are you?');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 5 — Sequences & Alternation
// ═══════════════════════════════════════════════════════════════════════

add('Simple sequence (then)',
  `main: one or more letters then equals then one or more digits`,
  /^[a-zA-Z]+=\d+$/,
  'count=42');

add('Comma sequence',
  `year: 4 digits
month: 2 digits
day: 2 digits
main: year, hyphen, month, hyphen, day`,
  /^\d{4}-\d{2}-\d{2}$/,
  '2025-01-15');

add('Two alternatives',
  `main: "true" or "false"`,
  /^(?:true|false)$/,
  'false');

add('Three alternatives',
  `main: "GET" or "POST" or "DELETE"`,
  /^(?:GET|POST|DELETE)$/,
  'DELETE');

add('Nested alternation',
  `sign: "+" or "-"
tz: "Z" or (sign then 2 digits then colon then 2 digits)
main: tz`,
  /^(?:Z|[+-]\d{2}:\d{2})$/,
  '+05:30');

add('Grouped expression',
  `main: "http" then optional "s" then "://"`,
  /^https?:\/\/$/,
  'https://');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 6 — Joined By (Separated Lists)
// ═══════════════════════════════════════════════════════════════════════

add('Joined by comma',
  `item: one or more letters
main: item joined by comma`,
  /^[a-zA-Z]+(?:,[a-zA-Z]+)*$/,
  'alpha,beta,gamma,delta,epsilon');

add('Joined by separator',
  `num: one or more digits
main: num joined by period`,
  /^\d+(?:\.\d+)*$/,
  '192.168.1.1');

add('Joined by multi-char sep',
  `word: one or more letters
main: word joined by ", "`,
  /^[a-zA-Z]+(?:, [a-zA-Z]+)*$/,
  'one, two, three, four, five');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 7 — Named Rules & Composition
// ═══════════════════════════════════════════════════════════════════════

add('Simple rule ref',
  `hex: any of ("0" to "9", "a" to "f", "A" to "F")
main: 6 hex`,
  /^[0-9a-fA-F]{6}$/,
  'ff00aa');

add('Multi-level rules',
  `digit pair: 2 digits
octet: between 1 and 3 digits
ipv4: octet joined by period`,
  /^\d{1,3}(?:\.\d{1,3})*$/,
  '192.168.1.1');

add('Deep rule nesting',
  `hex: any of ("0" to "9", "a" to "f", "A" to "F")
pair: 2 hex
mac: pair joined by colon`,
  /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/,
  'AA:BB:CC:DD:EE:FF');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 8 — Real-World Formats
// ═══════════════════════════════════════════════════════════════════════

add('Email address',
  `atext: any of (letter, digit, exclamation, hash, dollar, percent, ampersand, single quote, asterisk, plus, slash, equals, question, caret, underscore, backtick, open brace, pipe, close brace, tilde, hyphen)
dotted: one or more atext joined by period
local: dotted
label: one or more of (letter, digit, hyphen)
hostname: label joined by period
email: local then at then hostname`,
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/,
  'dev.team+tag@sub-domain.example.com');

add('IPv4 address',
  `octet: between 1 and 3 digits
ipv4: octet joined by period`,
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
  '192.168.1.1');

add('ISO datetime',
  `year: 4 digits
month: 2 digits
day: 2 digits
hour: 2 digits
minute: 2 digits
second: 2 digits
frac: period then between 1 and 6 digits
tz: "Z" or (("+" or "-") then 2 digits then colon then 2 digits)
datetime: year, hyphen, month, hyphen, day, "T", hour, colon, minute, colon, second, optional frac, tz`,
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/,
  '2025-01-15T13:45:30.123456Z');

add('Hex color',
  `hex: any of ("0" to "9", "a" to "f", "A" to "F")
color: hash then (6 hex or 3 hex)`,
  /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/,
  '#6366f1');

add('Semver',
  `num: one or more digits
pre: one or more of (letter, digit, hyphen) joined by period
build: one or more of (letter, digit, hyphen) joined by period
semver: num, period, num, period, num, optional (hyphen then pre), optional (plus then build)`,
  /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?(?:\+[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*)?$/,
  '1.23.456-beta.1+build.789');

add('UUID',
  `hex: any of ("0" to "9", "a" to "f", "A" to "F")
uuid: 8 hex, hyphen, 4 hex, hyphen, 4 hex, hyphen, 4 hex, hyphen, 12 hex`,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  '550e8400-e29b-41d4-a716-446655440000');

add('URL (full)',
  `scheme: one or more letters
user: one or more characters except (at, colon, slash)
pass: one or more characters except (at, slash)
auth: user then optional (colon then pass) then at
host: one or more of (letter, digit, hyphen, period)
port: colon then one or more digits
path: one or more (slash then zero or more characters except (question, hash, space))
query: question then one or more characters except (hash, space)
fragment: hash then one or more characters except (space)
url: scheme, "://", optional auth, host, optional port, optional path, optional query, optional fragment`,
  /^([a-zA-Z]+):\/\/(?:([^:@/]+)(?::([^@/]+))?@)?([a-zA-Z0-9.-]+)(?::(\d+))?((?:\/[^?#\s]*)*)(?:\?([^#\s]*))?(?:#(\S*))?$/,
  'https://user:pass@api.example.com:8080/v2/users?sort=name&limit=10#section');

add('Content-Type header',
  `token char: any of (letter, digit, exclamation, hash, dollar, percent, ampersand, single quote, asterisk, plus, hyphen, period, caret, underscore, backtick, pipe, tilde)
token: one or more token char
value: token or (double quote then one or more characters except (double quote) then double quote)
param: token then equals then value
content type: token, slash, token, zero or more (semicolon then space then param)`,
  /^[!#$%&'*+\-.^_`|~\w]+\/[!#$%&'*+\-.^_`|~\w]+(?:;\s*[!#$%&'*+\-.^_`|~\w]+=(?:[!#$%&'*+\-.^_`|~\w]+|"[^"]*"))*$/,
  'application/json; charset=utf-8; boundary="----WebKit"');

add('Nginx access log',
  `ip: one or more of (digit, period)
method: one or more letters
path: one or more characters except (space)
version: "HTTP/" then one or more of (digit, period)
status: one or more digits
size: one or more digits
stamp: one or more characters except (close bracket)
entry: ip, " - - [", stamp, "] ", double quote, method, space, path, space, version, double quote, space, status, space, size`,
  /^(\d[\d.]+) - - \[([^\]]+)\] "([A-Z]+) (\S+) HTTP\/([\d.]+)" (\d+) (\d+)$/,
  '192.168.1.1 - - [10/Oct/2024:13:55:36 +0000] "GET /api/users HTTP/1.1" 200 1234');

add('JWT structure',
  `b64: one or more of (letter, digit, plus, slash, hyphen, underscore, equals)
jwt: b64, period, b64, period, b64`,
  /^[A-Za-z0-9+/\-_=]+\.[A-Za-z0-9+/\-_=]+\.[A-Za-z0-9+/\-_=]+$/,
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');

add('Cron expression',
  `num: one or more digits
range: num then optional (hyphen then num)
step: range then optional (slash then num)
item: step or asterisk
field: item joined by comma
cron: field, space, field, space, field, space, field, space, field`,
  /^(?:(?:\d+(?:-\d+)?(?:\/\d+)?|\*)(?:,(?:\d+(?:-\d+)?(?:\/\d+)?|\*))*\s){4}(?:\d+(?:-\d+)?(?:\/\d+)?|\*)(?:,(?:\d+(?:-\d+)?(?:\/\d+)?|\*))*$/,
  '*/15 0-23/2 1,15 1-6 1-5');

add('CSS color (hex or rgb)',
  `hex: any of ("0" to "9", "a" to "f", "A" to "F")
hexcolor: hash then (6 hex or 3 hex)
num: one or more digits
rgbcolor: "rgb(" then num then comma then space then num then comma then space then num then ")"
color: hexcolor or rgbcolor`,
  /^(?:#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})|rgb\(\d+, \d+, \d+\))$/,
  'rgb(255, 102, 0)');

add('CSV row (quoted fields)',
  `escaped: double quote then double quote
quoted: double quote then zero or more (any of (printable except (double quote), space, tab) or escaped) then double quote
plain: one or more characters except (comma, double quote, newline)
field: quoted or plain
row: field joined by comma`,
  /^(?:"(?:[^"]|"")*"|[^,"\n]+)(?:,(?:"(?:[^"]|"")*"|[^,"\n]+))*$/,
  'Alice,"New York","said ""hello""",42,true');

add('Env var assignment',
  `key: one or more of (letter, digit, underscore)
value: one or more characters except (newline)
assign: key then equals then value`,
  /^[a-zA-Z0-9_]+=[^\n]+$/,
  'DATABASE_URL=postgres://localhost:5432/mydb');

add('Markdown heading',
  `hashes: between 1 and 6 hash
heading: hashes then space then one or more characters except (newline)`,
  /^#{1,6} [^\n]+$/,
  '### API Reference');

add('Filepath (Unix)',
  `seg: one or more of (letter, digit, hyphen, underscore, period)
segs: seg joined by slash
path: slash then segs`,
  /^\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/,
  '/usr/local/bin/node');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 9 — Scaling & Stress Tests
// ═══════════════════════════════════════════════════════════════════════

add('Pure letters (100)',
  `main: one or more letters`,
  /^[a-zA-Z]+$/,
  'a'.repeat(100));

add('Pure letters (1k)',
  `main: one or more letters`,
  /^[a-zA-Z]+$/,
  'a'.repeat(1_000));

add('Pure letters (10k)',
  `main: one or more letters`,
  /^[a-zA-Z]+$/,
  'a'.repeat(10_000));

add('CSV row (10 fields)',
  `field: one or more characters except (comma, newline)
row: field joined by comma`,
  /^[^,\n]+(?:,[^,\n]+)*$/,
  'Alice,London,Engineer,42,true,hello,world,foo,bar,baz');

add('CSV row (100 fields)',
  `field: one or more characters except (comma, newline)
row: field joined by comma`,
  /^[^,\n]+(?:,[^,\n]+)*$/,
  Array.from({ length: 100 }, (_, i) => `field${i}`).join(','));

add('Query string (10 pairs)',
  `key: one or more letters
value: one or more digits
pair: key then equals then value
main: pair joined by ampersand`,
  /^[a-zA-Z]+=\d+(?:&[a-zA-Z]+=\d+)*$/,
  Array.from({ length: 10 }, (_, i) => `key${i}=${i}`).join('&'));

add('Query string (50 pairs)',
  `key: one or more letters
value: one or more digits
pair: key then equals then value
main: pair joined by ampersand`,
  /^[a-zA-Z]+=\d+(?:&[a-zA-Z]+=\d+)*$/,
  Array.from({ length: 50 }, (_, i) => `key${i}=${i * 100}`).join('&'));

add('Digits (10k)',
  `main: one or more digits`,
  /^\d+$/,
  '1234567890'.repeat(1_000));

add('Mixed alphanum (1k)',
  `main: one or more alphanumerics`,
  /^[a-zA-Z0-9]+$/,
  'aB3cD5eF7g'.repeat(100));

add('Nested alternation (long)',
  `proto: "https" or "http" or "ftp" or "ssh" or "wss" or "ws"
main: proto then "://example.com"`,
  /^(?:https?|ftp|ssh|wss?):\/\/example\.com$/,
  'https://example.com');

// ═══════════════════════════════════════════════════════════════════════
//  CATEGORY 10 — Failure Cases (mismatch)
// ═══════════════════════════════════════════════════════════════════════

add('Fail at start',
  `main: one or more digits`,
  /^\d+$/,
  'abc123');

add('Fail at end',
  `num: one or more digits
csv: num joined by comma`,
  /^\d+(?:,\d+)*$/,
  '1,2,3,4,5,6,7,8,9,abc');

add('Fail mid-string',
  `hex: any of ("0" to "9", "a" to "f", "A" to "F")
uuid: 8 hex, hyphen, 4 hex, hyphen, 4 hex, hyphen, 4 hex, hyphen, 12 hex`,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  '550e8400-e29b-ZZZZ-a716-446655440000');

add('Fail long input (5k letters then digit)',
  `main: one or more letters`,
  /^[a-zA-Z]+$/,
  'a'.repeat(5_000) + '9');

add('Near-miss email',
  `atext: any of (letter, digit, exclamation, hash, dollar, percent, ampersand, single quote, asterisk, plus, slash, equals, question, caret, underscore, backtick, open brace, pipe, close brace, tilde, hyphen)
dotted: one or more atext joined by period
local: dotted
label: one or more of (letter, digit, hyphen)
hostname: label joined by period
email: local then at then hostname`,
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/,
  'user@');

// ═══════════════════════════════════════════════════════════════════════
//  Parse all grammars
// ═══════════════════════════════════════════════════════════════════════

for (const c of cases) {
  c.p = parse(c.grammar);
  c.cp = compile(c.p);
}

// ═══════════════════════════════════════════════════════════════════════
//  Verify correctness
// ═══════════════════════════════════════════════════════════════════════

console.log('Verifying correctness...\n');
let allOk = true;
for (const c of cases) {
  const inputBytes = encoder.encode(c.input);
  const fastResult = fastMatch(c.cp, inputBytes) === inputBytes.length;
  const rResult = c.re.test(c.input);
  if (fastResult !== rResult) {
    console.log(`MISMATCH: ${c.name} — fast=${fastResult} regex=${rResult}`);
    console.log(`  input: ${c.input.slice(0, 80)}`);
    allOk = false;
  }
}
if (allOk) console.log('All cases agree on match/fail result.\n');
else { console.log('\nAborting — fix mismatches first.\n'); process.exit(1); }

// ═══════════════════════════════════════════════════════════════════════
//  Run benchmarks
// ═══════════════════════════════════════════════════════════════════════

const COL = { name: 40, ms: 9, ratio: 8, winner: 7, factor: 7 };
const SEP = '\u2500'.repeat(COL.name + COL.ms * 2 + COL.ratio + COL.winner + COL.factor + 6);

console.log(`Benchmarking: ${WARMUP} warmup, ${ITERATIONS} iterations each\n`);
console.log(SEP);
console.log(
  'Test'.padEnd(COL.name) + ' ' +
  'Match'.padStart(COL.ms) + ' ' +
  'Regex'.padStart(COL.ms) + ' ' +
  'Ratio'.padStart(COL.ratio) + ' ' +
  'Winner'.padStart(COL.winner) + ' ' +
  'Factor'.padStart(COL.factor)
);
console.log(SEP);

let currentCategory = '';
const results = [];
const categories = [
  [0, 'Literals & Fixed Strings'],
  [3, 'Character Classes'],
  [11, 'Ranges & Sets'],
  [15, 'Quantifiers'],
  [22, 'Sequences & Alternation'],
  [28, 'Joined By'],
  [31, 'Named Rules & Composition'],
  [34, 'Real-World Formats'],
  [50, 'Scaling & Stress Tests'],
  [60, 'Failure Cases'],
];
const catMap = new Map(categories);

for (let i = 0; i < cases.length; i++) {
  const c = cases[i];

  if (catMap.has(i)) {
    const cat = catMap.get(i);
    if (i > 0) console.log('');
    console.log(`  \x1b[36m${cat}\x1b[0m`);
  }

  const inputBytes = encoder.encode(c.input);
  const matchFn = () => fastMatch(c.cp, inputBytes);
  const regexFn = () => c.re.test(c.input);
  const r = bench(c.name, matchFn, regexFn, c.input);
  results.push(r);

  const mStr = r.matchTime.toFixed(1).padStart(COL.ms - 2) + 'ms';
  const rStr = r.regexTime.toFixed(1).padStart(COL.ms - 2) + 'ms';
  const ratio = r.ratio.toFixed(2).padStart(COL.ratio - 1) + 'x';
  const color = r.winner === 'MATCH' ? '\x1b[32m' : '\x1b[33m';
  console.log(
    `${c.name.padEnd(COL.name)} ${mStr} ${rStr} ${ratio} ${color}${r.winner.padStart(COL.winner)}\x1b[0m ${(r.factor + 'x').padStart(COL.factor)}`
  );
}

console.log(SEP);

// ═══════════════════════════════════════════════════════════════════════
//  Summary
// ═══════════════════════════════════════════════════════════════════════

const sorted = [...results].sort((a, b) => a.ratio - b.ratio);
const avgRatio = results.reduce((s, r) => s + r.ratio, 0) / results.length;
const median = sorted[Math.floor(sorted.length / 2)].ratio;
const geoMean = Math.exp(results.reduce((s, r) => s + Math.log(r.ratio), 0) / results.length);
const matchWins = results.filter(r => r.winner === 'MATCH').length;
const regexWins = results.filter(r => r.winner === 'REGEX').length;
const successCases = results.filter(r => !r.name.startsWith('Fail'));
const failCases = results.filter(r => r.name.startsWith('Fail'));

console.log(`\n\x1b[1mSummary\x1b[0m  (${results.length} cases)\n`);
console.log(`  Match wins:   ${matchWins}`);
console.log(`  Regex wins:   ${regexWins}`);
console.log(`  Mean ratio:   ${avgRatio.toFixed(2)}x  (match / regex)`);
console.log(`  Median ratio: ${median.toFixed(2)}x`);
console.log(`  Geo mean:     ${geoMean.toFixed(2)}x`);
if (successCases.length) {
  const sAvg = successCases.reduce((s, r) => s + r.ratio, 0) / successCases.length;
  console.log(`  Success-only: ${sAvg.toFixed(2)}x mean`);
}
if (failCases.length) {
  const fAvg = failCases.reduce((s, r) => s + r.ratio, 0) / failCases.length;
  console.log(`  Failure-only: ${fAvg.toFixed(2)}x mean`);
}
console.log(`\n  Best for Match:  ${sorted[0].name} (${sorted[0].ratio.toFixed(2)}x)`);
console.log(`  Worst for Match: ${sorted[sorted.length - 1].name} (${sorted[sorted.length - 1].ratio.toFixed(2)}x)`);
console.log('');
