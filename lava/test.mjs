#!/usr/bin/env node
// Lava test harness — runs every example and checks output + exit code.
// Spawns each program as a child so a thrown LavaError (exit 1) is observable.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const lava = join(here, 'lava.mjs');
const ex = (f) => join(here, 'examples', f);

function run(file, stdin = '', args = []) {
  try {
    const out = execFileSync('node', [lava, ex(file), ...args], { input: stdin, encoding: 'utf8' });
    return { code: 0, out: out.replace(/\n$/, '') };
  } catch (e) {
    return { code: e.status ?? 1, out: ((e.stdout || '') + (e.stderr || '')).replace(/\n$/, '') };
  }
}

// Serve-mode cases assert on what a frame SHOWS rather than its bytes: a 32x32
// frame is 4KB of base64 and pinning that in a test would break on any unrelated
// pixel. `paddleAt` reads back the cyan row, which is the thing input is supposed
// to move.
function paddleAt(frameLine) {
  const m = /^\[\[lava:frame (\d+) (\d+) (\S+)\]\]$/.exec(frameLine);
  if (!m) return null;
  const w = Number(m[1]);
  const buf = Buffer.from(m[3], 'base64');
  const xs = [];
  for (let p = 0; p < buf.length; p += 3) {
    const q = p / 3;
    if (Math.floor(q / w) === 30 && buf[p] < 100 && buf[p + 1] > 200 && buf[p + 2] > 200) xs.push(q % w);
  }
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
}

const cases = [
  ['velocity.lava', '', 0, 'velocity is thirty\nplayer one\nguards compose'],
  ['account.lava', '', 0, 'member\npromotion applied\nadmin\npromoted to admin'],
  ['loops.lava', '', 0, '30\n1\n2\n3\n4\n5\n33'],
  ['pattern.lava', '', 0, 'alice_99\nalice_99\nalice_99'],
  ['classes.lava', '', 0, 'alice_99\nadmin\nis admin\nelevated\nnot member\nalice_99'],
  ['writes.lava', '', 0, 'alpha\nbravo\ncharlie'],
  ['wait.lava', '', 0, 'before the mutation\nwait A woke\nwait B woke\ncascade: Log is A\nafter the mutation\nA'],
  ['sync.lava', '', 0, 'before\nlogin fully applied\nafter\nauthenticated\nmember\nuser upgraded'],
  ['bounds.lava', '', 0, '60\n60\n50'],
  ['bounds-atomic.lava', '', 0, 'before\nafter\n50\n50'],
  ['states.lava', '', 0, 'healthy\nlow\noverdrawn\nnegative\nmaxed out'],
  ['userinput.lava', 'alice\nhi\nyo\n', 0, 'what is your name?\nalice\nsay something:\nhi\ntype a greeting:\nyo'],
  // expected-rejection cases: nonzero exit
  ['reads.lava', '', 0, 'line one\nline two\nline three\nline one\nline two\nline 9 is past the end\nline 1 exists'],
  ['fields.lava', '', 0, 'alice\nbob\n|bob|admin|'],
  // Screen: the frame wire format is pinned on a 2x1 screen (6 bytes of raw RGB
  // = red then blue), so a change to the marker or the encoding fails here.
  ['screen-tiny.lava', '', 0, '[[lava:frame 2 1 /wAAAAD/]]'],
  ['screen.lava', '', 0, null], // full 16x16 frame — exercised, output too large to pin
  // aligned declarations/headers must parse identically to tight ones, while
  // spacing inside a string literal stays content
  ['alignment.lava', '', 0, '484\ninside\n3\nhello   world'],
  // `%` remainder, incl. negative dividend sign and remainder-by-zero failing
  ['modulo.lava', '', 1, '1\n0\n5\n-1\n3\n0\n1\n2\n3\n4\n5\n6\n7\n0\n1\nlava: remainder by zero'],
  // groups: declare/insert/iterate/count, positional insert, nested pair cursors
  ['groups.lava', '', 0, '2\n60\n74\n1010\n1020\n2010\n2020'],
  // ...and a cursor charges its GROUP, so a system that walks every entity still
  // has to declare it — the property that makes footprints worth having at scale
  ['group-footprint.lava', '', 1, "lava: action 'Peek':\n  - reads 'Bodies' but does not declare it (reads: none)"],
  // actions may loop: cursor needs no declaring, `break` works, loops nest
  ['action-loop.lava', '', 0, '10\n4\n9'],
  // ...and a loop body is still inside the footprint — the guarantee that had to
  // survive letting actions loop at all
  ['action-loop-footprint.lava', '', 1, "lava: action 'Skim':\n  - reads 'Ledger' but does not declare it (reads: Tally)\n  - writes 'Ledger' but does not declare it (writes: Tally)"],
  // expected-rejection cases: nonzero exit
  ['escalation.lava', '', 1, null],
  // drawing obeys footprints: an action that draws must declare `writes Screen`
  ['screen-footprint.lava', '', 1, "lava: action 'Undeclared':\n  - writes 'Screen' but does not declare it (writes: none)"],
  ['bounds-violation.lava', '', 1, null],
  // every bound form, plus the strict-bound message (a strict bound must not
  // report itself as inclusive): >= <= between accept endpoints, > < reject them
  ['bounds-between.lava', '', 1, "0\n100\n1\n9\n12\nlava: 'Quantity' is 0, violating bound: must be greater than 0"],
];

let pass = 0, fail = 0;
for (const [file, stdin, wantCode, wantOut] of cases) {
  const r = run(file, stdin);
  const codeOk = r.code === wantCode;
  const outOk = wantOut === null || r.out === wantOut;
  if (codeOk && outOk) { pass++; }
  else {
    fail++;
    console.log(`FAIL ${file}`);
    if (!codeOk) console.log(`  exit: got ${r.code}, want ${wantCode}`);
    if (!outOk) console.log(`  out:  got [${r.out.replace(/\n/g, '|')}]`);
  }
}
// --- serve mode: the host owns the clock, so input actually lands ---
{
  const script = ['tick', 'keys left', 'tick', 'tick', 'keys right', 'tick', 'tick', 'tick', 'keys', 'tick', 'quit'];
  const r = run('serve-paddle.lava', script.join('\n') + '\n', ['--serve', 'Tick']);
  const frames = r.out.split('\n').filter(l => l.startsWith('[[lava:frame'));
  const xs = frames.map(paddleAt);
  const checks = [
    ['serve exits cleanly', r.code === 0, r.out.split('\n').filter(l => !l.startsWith('[[')).join(' ')],
    ['one frame per tick', frames.length === script.filter(c => c === 'tick').length, `got ${frames.length}`],
    ['left moves left', xs[1] === xs[0] - 1 && xs[2] === xs[0] - 2, xs.join(',')],
    ['right moves right', xs[3] === xs[2] + 1 && xs[5] === xs[2] + 3, xs.join(',')],
    // the whole point of a level-triggered origin: releasing stops the motion
    ['releasing stops motion', xs[6] === xs[5], xs.join(',')],
  ];
  for (const [name, ok, detail] of checks) {
    if (ok) pass++;
    else { fail++; console.log(`FAIL serve: ${name}${detail ? ` — ${detail}` : ''}`); }
  }
}

// A held key must still not let an action reach past its footprint.
{
  const r = run('keyboard-footprint.lava');
  const want = "lava: action 'Steer':\n  - reads 'Keyboard' but does not declare it (reads: Paddle X)";
  if (r.code === 1 && r.out === want) pass++;
  else { fail++; console.log(`FAIL keyboard-footprint.lava\n  got [${r.out.replace(/\n/g, '|')}]`); }
}

try { rmSync(join(here, 'examples', 'data', 'scratch.txt')); } catch {}
console.log(`\n${pass}/${pass + fail} passed${fail ? '' : '  ✓ all green'}`);
process.exit(fail ? 1 : 0);
