import { parse, vmMatch, fastMatch } from './dist/esm/index.js';

const enc = new TextEncoder();

function test(grammar, input) {
  let prog;
  try { prog = parse(grammar); } catch(e) { return null; }
  const cp = prog.__compiled;
  const bytes = enc.encode(input);
  const expected = fastMatch(cp, bytes);
  let got;
  try { got = vmMatch(cp, bytes); } catch(e) { console.log('ERROR:', grammar, '|', input, '|', e.message); return false; }
  if (got === expected) return true;
  console.log('FAIL:', grammar, '|', input, '| expected:', expected, 'got:', got);
  return false;
}

const tests = [
  ['main: "hello"', 'hello'],
  ['main: "hello"', 'hellx'],
  ['main: "hello"', 'hell'],
  ['main: one or more digits', '12345'],
  ['main: one or more digits', ''],
  ['main: one or more letters', 'abcdef'],
  ['main: one or more word characters', 'abc_123'],
  ['main: "hello" then one or more digits', 'hello123'],
  ['main: between 1 and 3 digits', '12'],
  ['main: between 1 and 3 digits', '1234'],
  ['main: one or more digits joined by "."', '1.2.3'],
  ['main: one or more digits joined by "."', '123'],
  ['main: 4 digits', '2024'],
  ['main: 4 digits', '202'],
  ['main: letter', 'A'],
  ['main: digit', '5'],
  ['main: optional digit then letter', 'A'],
  ['main: optional digit then letter', '5A'],
  ['main: digit or letter', 'A'],
  ['main: digit or letter', '5'],
  ['main: any character', 'x'],
  ['main: "a" then "b" then "c"', 'abc'],
  ['main: zero or more digits', ''],
  ['main: zero or more digits', '123'],
  ['main: "hello" or "world"', 'hello'],
  ['main: "hello" or "world"', 'world'],
  ['main: "hello" or "world"', 'other'],
  ['main: one or more hex digits', 'deadBEEF42'],
  ['main: "abc" then optional digit then "xyz"', 'abcxyz'],
  ['main: "abc" then optional digit then "xyz"', 'abc5xyz'],
  ['main: between 2 and 5 letters', 'abc'],
  ['main: between 2 and 5 letters', 'a'],
  ['main: between 2 and 5 letters', 'abcdef'],
  ['main: one or more digits joined by ","', '1,2,3,4'],
  ['main: word\nword: one or more letters', 'hello'],
  ['main: "start" then one or more digits then "end"', 'start123end'],
  ['main: digit then digit then digit', '123'],
  ['main: digit then digit then digit', '12'],
  ['main: one or more (letter except ("q"))', 'abcdef'],
  ['main: "a" or "b" or "c"', 'b'],
  ['main: "a" or "b" or "c"', 'z'],
  ['main: optional "prefix" then one or more digits', '123'],
  ['main: optional "prefix" then one or more digits', 'prefix123'],
  ['main: one or more whitespace', '   '],
  ['main: "GET" or "POST" or "PUT" or "DELETE"', 'POST'],
  ['main: "GET" or "POST" or "PUT" or "DELETE"', 'DELETE'],
  ['main: "GET" or "POST" or "PUT" or "DELETE"', 'PATCH'],
  ['main: ip\nip: between 1 and 3 digits joined by "."', '192.168.1.1'],
  ['main: one or more (digit or ".")', '1.2.3'],
  ['main: "(" then one or more digits then ")"', '(123)'],
  ['main: "(" then one or more digits then ")"', '(abc)'],
];

let pass = 0, fail = 0, skip = 0;
for (const [grammar, input] of tests) {
  const r = test(grammar, input);
  if (r === null) skip++;
  else if (r) pass++;
  else fail++;
}
console.log(pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped, ' + tests.length + ' total');
