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

function run(file, stdin = '') {
  try {
    const out = execFileSync('node', [lava, ex(file)], { input: stdin, encoding: 'utf8' });
    return { code: 0, out: out.replace(/\n$/, '') };
  } catch (e) {
    return { code: e.status ?? 1, out: ((e.stdout || '') + (e.stderr || '')).replace(/\n$/, '') };
  }
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
  // expected-rejection cases: nonzero exit
  ['escalation.lava', '', 1, null],
  ['bounds-violation.lava', '', 1, null],
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
try { rmSync(join(here, 'examples', 'data', 'scratch.txt')); } catch {}
console.log(`\n${pass}/${pass + fail} passed${fail ? '' : '  ✓ all green'}`);
process.exit(fail ? 1 : 0);
