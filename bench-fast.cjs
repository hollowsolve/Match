const { parse, match, compile, fastMatch } = require('./dist/cjs/index.js');

const WARMUP = 1000;
const ITERATIONS = 50000;

const encoder = new TextEncoder();

function bench(name, fns, input) {
  const inputBytes = encoder.encode(input);
  for (let i = 0; i < WARMUP; i++) { for (const f of fns) f.fn(inputBytes); }

  const times = [];
  for (const f of fns) {
    const t0 = performance.now();
    for (let i = 0; i < ITERATIONS; i++) f.fn(inputBytes);
    times.push(performance.now() - t0);
  }
  return { name, times };
}

const cases = [];

function add(name, grammar, re, input) {
  const p = parse(grammar);
  const cp = compile(p);
  cases.push({ name, p, cp, re, input, grammar });
}

add('Email validation',
`atext: any of (letter, digit, exclamation, hash, dollar, percent, ampersand, single quote, asterisk, plus, slash, equals, question, caret, underscore, backtick, open brace, pipe, close brace, tilde, hyphen)
dotted: one or more atext joined by period
qtext: any of (printable except (double quote, backslash), space, tab)
qpair: backslash then printable
quoted: double quote then zero or more (qtext or qpair) then double quote
local: dotted or quoted
label: one or more of (letter, digit, hyphen)
hostname: label joined by period
octet: between 1 and 3 digits
addr: octet joined by period
ip literal: open bracket then addr then close bracket
domain: hostname or ip literal
email: local then at then domain`,
  /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])$/,
  'dev.team+tag@sub-domain.example.com');

add('IPv4 address',
`octet: between 1 and 3 digits
ipv4: octet joined by period`,
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/,
  '192.168.1.1');

add('ISO date',
`year: 4 digits
month: 2 digits
day: 2 digits
date: year then hyphen then month then hyphen then day`,
  /^\d{4}-\d{2}-\d{2}$/,
  '2025-01-15');

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

add('Key=value',
`key: one or more letters
value: one or more digits
pair: key then equals then value`,
  /^([a-zA-Z]+)=(\d+)$/,
  'count=42');

add('CSV row (10 fields)',
`field: one or more characters except (comma, newline)
row: field joined by comma`,
  /^[^,\n]+(?:,[^,\n]+)*$/,
  'Alice,London,Engineer,42,true,hello,world,foo,bar,baz');

add('CSV quoted fields',
`escaped: double quote then double quote
quoted: double quote then zero or more (any of (printable except (double quote), space, tab) or escaped) then double quote
plain: one or more characters except (comma, double quote, newline)
field: quoted or plain
row: field joined by comma`,
  /^(?:"(?:[^"]|"")*"|[^,"\n]+)(?:,(?:"(?:[^"]|"")*"|[^,"\n]+))*$/,
  'Alice,"New York","said ""hello""",42,true');

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

add('UUID',
`hex: any of ("0" to "9", "a" to "f", "A" to "F")
uuid: 8 hex, hyphen, 4 hex, hyphen, 4 hex, hyphen, 4 hex, hyphen, 12 hex`,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  '550e8400-e29b-41d4-a716-446655440000');

add('MAC address',
`hex: any of ("0" to "9", "a" to "f", "A" to "F")
pair: 2 hex
mac: pair joined by colon`,
  /^[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}$/,
  'AA:BB:CC:DD:EE:FF');

add('Content-Type',
`token char: any of (letter, digit, exclamation, hash, dollar, percent, ampersand, single quote, asterisk, plus, hyphen, period, caret, underscore, backtick, pipe, tilde)
token: one or more token char
value: token or (double quote then one or more characters except (double quote) then double quote)
param: token then equals then value
content type: token, slash, token, zero or more (semicolon then space then param)`,
  /^[!#$%&'*+\-.^_`|~\w]+\/[!#$%&'*+\-.^_`|~\w]+(?:;\s*[!#$%&'*+\-.^_`|~\w]+=(?:[!#$%&'*+\-.^_`|~\w]+|"[^"]*"))*$/,
  'application/json; charset=utf-8; boundary="----WebKit"');

add('Cron expression',
`num: one or more digits
range: num then optional (hyphen then num)
step: range then optional (slash then num)
item: step or asterisk
field: item joined by comma
cron: field, space, field, space, field, space, field, space, field`,
  /^(?:(?:\d+(?:-\d+)?(?:\/\d+)?|\*)(?:,(?:\d+(?:-\d+)?(?:\/\d+)?|\*))*\s){4}(?:\d+(?:-\d+)?(?:\/\d+)?|\*)(?:,(?:\d+(?:-\d+)?(?:\/\d+)?|\*))*$/,
  '*/15 0-23/2 1,15 1-6 1-5');

add('JWT structure',
`b64: one or more of (letter, digit, plus, slash, hyphen, underscore, equals)
jwt: b64, period, b64, period, b64`,
  /^[A-Za-z0-9+/\-_=]+\.[A-Za-z0-9+/\-_=]+\.[A-Za-z0-9+/\-_=]+$/,
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');

add('Query string (50 pairs)',
`key: one or more letters
value: one or more digits
pair: key then equals then value
pairs: pair joined by ampersand`,
  /^[a-zA-Z]+=\d+(?:&[a-zA-Z]+=\d+)*$/,
  Array.from({ length: 50 }, (_, i) => `key${i}=${i * 100}`).join('&'));

add('Failure near end',
`num: one or more digits
csv: num joined by comma`,
  /^\d+(?:,\d+)*$/,
  '1,2,3,4,5,6,7,8,9,abc');

add('Pure letters (10k)',
`main: one or more letters`,
  /^[a-zA-Z]+$/,
  'a'.repeat(10000));

// Verify correctness
console.log('Verifying fast path correctness...\n');
let allOk = true;
for (const c of cases) {
  const inputBytes = encoder.encode(c.input);
  const fastResult = fastMatch(c.cp, inputBytes);
  const regexResult = c.re.test(c.input);
  const fastOk = fastResult === inputBytes.length;
  if (fastOk !== regexResult) {
    console.log(`MISMATCH: ${c.name} — fast=${fastOk}(pos=${fastResult}) regex=${regexResult}`);
    allOk = false;
  }
}
if (allOk) console.log('All cases agree.\n');

// Run
console.log(`Benchmarking: ${WARMUP} warmup, ${ITERATIONS} iterations\n`);
console.log('─'.repeat(90));
console.log(`${'Test'.padEnd(28)} ${'Fast'.padStart(9)} ${'Regex'.padStart(9)} ${'Ratio'.padStart(8)} ${'Old'.padStart(9)} ${'Speedup'.padStart(9)} ${'Winner'.padStart(8)}`);
console.log('─'.repeat(90));

const results = [];
for (const c of cases) {
  const inputBytes = encoder.encode(c.input);
  const r = bench(c.name, [
    { name: 'fast', fn: () => fastMatch(c.cp, inputBytes) },
    { name: 'regex', fn: () => c.re.test(c.input) },
    { name: 'old', fn: () => match(c.p, c.input) },
  ], c.input);

  const [fast, regex, old] = r.times;
  const ratio = fast / regex;
  const speedup = old / fast;
  const winner = ratio <= 1 ? 'MATCH' : 'REGEX';

  results.push({ name: c.name, fast, regex, old, ratio, speedup, winner });

  console.log(
    `${c.name.padEnd(28)} ${fast.toFixed(1).padStart(7)}ms ${regex.toFixed(1).padStart(7)}ms ${ratio.toFixed(1).padStart(6)}x ${old.toFixed(1).padStart(7)}ms ${speedup.toFixed(0).padStart(7)}x ${winner.padStart(8)}`
  );
}

console.log('─'.repeat(90));

const avgRatio = results.reduce((s, r) => s + r.ratio, 0) / results.length;
const avgSpeedup = results.reduce((s, r) => s + r.speedup, 0) / results.length;
const matchWins = results.filter(r => r.winner === 'MATCH').length;

console.log(`\nSummary:`);
console.log(`  Fast vs Regex avg ratio: ${avgRatio.toFixed(1)}x`);
console.log(`  Fast vs Old avg speedup: ${avgSpeedup.toFixed(0)}x`);
console.log(`  Match wins: ${matchWins} / ${results.length}`);
