const { run, parse, match, tryParse, formatFailure, formatTree, find, searchString, searchFile, searchFolder, formatSearchResults } = require('./dist/cjs/index.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;
let errors = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    errors.push({ name, error: e.message || e });
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertMatch(source, input) {
  const result = run(source, input);
  assert(result.matched, `Expected match for ${JSON.stringify(input)} but got failure: ${!result.matched ? formatFailure(result) : ''}`);
  return result;
}

function assertNoMatch(source, input) {
  const result = run(source, input);
  assert(!result.matched, `Expected no match for ${JSON.stringify(input)} but got match`);
  return result;
}

function assertParseError(source, expectedMsg) {
  try {
    parse(source);
    throw new Error(`Expected parse error but succeeded`);
  } catch (e) {
    if (expectedMsg && !e.message.includes(expectedMsg)) {
      throw new Error(`Expected error containing "${expectedMsg}" but got "${e.message}"`);
    }
  }
}

// ============================================================
// 1. Named Characters — every single one (§2.1, §2.2, §2.3)
// ============================================================

const NAMED_CHAR_TESTS = [
  ['exclamation', '!'], ['double quote', '"'], ['hash', '#'],
  ['dollar', '$'], ['percent', '%'], ['ampersand', '&'],
  ['single quote', "'"], ['open paren', '('], ['close paren', ')'],
  ['asterisk', '*'], ['plus', '+'], ['comma', ','],
  ['hyphen', '-'], ['period', '.'], ['slash', '/'],
  ['colon', ':'], ['semicolon', ';'], ['less than', '<'],
  ['equals', '='], ['greater than', '>'], ['question', '?'],
  ['at', '@'], ['open bracket', '['], ['backslash', '\\'],
  ['close bracket', ']'], ['caret', '^'], ['underscore', '_'],
  ['backtick', '`'], ['open brace', '{'], ['pipe', '|'],
  ['close brace', '}'], ['tilde', '~'],
  ['space', ' '], ['tab', '\t'], ['newline', '\n'],
  ['carriage return', '\r'], ['null', '\0'],
];

for (const [name, ch] of NAMED_CHAR_TESTS) {
  test(`named char: ${name}`, () => {
    assertMatch(`main: ${name}`, ch);
  });
}

test('named char: rejects wrong byte', () => {
  assertNoMatch('main: exclamation', 'a');
  assertNoMatch('main: space', 'x');
  assertNoMatch('main: null', 'A');
});

test('named char: rejects empty input', () => {
  assertNoMatch('main: exclamation', '');
  assertNoMatch('main: space', '');
});

test('named char: rejects multi-char input', () => {
  assertNoMatch('main: exclamation', '!!');
  assertNoMatch('main: space', '  ');
});

// ============================================================
// 2. Quoted Literals (§2.4)
// ============================================================

test('quoted literal: lowercase letter', () => {
  assertMatch('main: "a"', 'a');
  assertNoMatch('main: "a"', 'b');
  assertNoMatch('main: "a"', 'A');
});

test('quoted literal: uppercase letter', () => {
  assertMatch('main: "Z"', 'Z');
  assertNoMatch('main: "Z"', 'z');
});

test('quoted literal: digit', () => {
  assertMatch('main: "7"', '7');
  assertMatch('main: "0"', '0');
  assertNoMatch('main: "7"', '8');
});

test('quoted literal: symbol character', () => {
  assertMatch('main: "+"', '+');
  assertMatch('main: "-"', '-');
  assertMatch('main: "."', '.');
});

test('quoted literal: rejects empty', () => {
  assertNoMatch('main: "x"', '');
});

test('quoted literal: rejects multi-char', () => {
  assertNoMatch('main: "x"', 'xx');
});

// ============================================================
// 3. Character Classes — thorough boundary testing (§2.5)
// ============================================================

test('class: letter boundaries', () => {
  assertMatch('main: letter', 'a');
  assertMatch('main: letter', 'z');
  assertMatch('main: letter', 'A');
  assertMatch('main: letter', 'Z');
  assertMatch('main: letter', 'm');
  assertNoMatch('main: letter', '0');
  assertNoMatch('main: letter', '!');
  assertNoMatch('main: letter', ' ');
  assertNoMatch('main: letter', '\t');
});

test('class: digit boundaries', () => {
  assertMatch('main: digit', '0');
  assertMatch('main: digit', '9');
  assertMatch('main: digit', '5');
  assertNoMatch('main: digit', 'a');
  assertNoMatch('main: digit', '/');
  assertNoMatch('main: digit', ':');
});

test('class: hex digit boundaries', () => {
  assertMatch('main: hex digit', '0');
  assertMatch('main: hex digit', '9');
  assertMatch('main: hex digit', 'a');
  assertMatch('main: hex digit', 'f');
  assertMatch('main: hex digit', 'A');
  assertMatch('main: hex digit', 'F');
  assertNoMatch('main: hex digit', 'g');
  assertNoMatch('main: hex digit', 'G');
  assertNoMatch('main: hex digit', 'z');
});

test('class: whitespace all members', () => {
  assertMatch('main: whitespace', ' ');
  assertMatch('main: whitespace', '\t');
  assertMatch('main: whitespace', '\n');
  assertMatch('main: whitespace', '\r');
  assertNoMatch('main: whitespace', 'a');
  assertNoMatch('main: whitespace', '!');
  assertNoMatch('main: whitespace', '\0');
});

test('class: visible boundaries', () => {
  assertMatch('main: visible', '!');
  assertMatch('main: visible', '~');
  assertMatch('main: visible', 'A');
  assertNoMatch('main: visible', ' ');
  assertNoMatch('main: visible', '\t');
  assertNoMatch('main: visible', '\0');
});

test('class: printable boundaries', () => {
  assertMatch('main: printable', ' ');
  assertMatch('main: printable', '~');
  assertMatch('main: printable', '!');
  assertMatch('main: printable', 'A');
  assertNoMatch('main: printable', '\t');
  assertNoMatch('main: printable', '\n');
  assertNoMatch('main: printable', '\0');
});

test('class: alphanumeric', () => {
  assertMatch('main: alphanumeric', 'a');
  assertMatch('main: alphanumeric', 'Z');
  assertMatch('main: alphanumeric', '5');
  assertNoMatch('main: alphanumeric', '_');
  assertNoMatch('main: alphanumeric', '-');
  assertNoMatch('main: alphanumeric', ' ');
});

test('class: word character', () => {
  assertMatch('main: word character', 'a');
  assertMatch('main: word character', 'Z');
  assertMatch('main: word character', '5');
  assertMatch('main: word character', '_');
  assertNoMatch('main: word character', '-');
  assertNoMatch('main: word character', ' ');
  assertNoMatch('main: word character', '!');
});

test('class: any character', () => {
  assertMatch('main: any character', 'x');
  assertMatch('main: any character', '\0');
  assertMatch('main: any character', ' ');
  assertMatch('main: any character', '!');
  assertNoMatch('main: any character', '');
});

// ============================================================
// 4. Ranges (§2.7)
// ============================================================

test('range: "a" to "z" boundaries', () => {
  assertMatch('main: "a" to "z"', 'a');
  assertMatch('main: "a" to "z"', 'z');
  assertMatch('main: "a" to "z"', 'm');
  assertNoMatch('main: "a" to "z"', 'A');
  assertNoMatch('main: "a" to "z"', '0');
  assertNoMatch('main: "a" to "z"', '`');
  assertNoMatch('main: "a" to "z"', '{');
});

test('range: "A" to "Z"', () => {
  assertMatch('main: "A" to "Z"', 'A');
  assertMatch('main: "A" to "Z"', 'Z');
  assertNoMatch('main: "A" to "Z"', 'a');
});

test('range: "0" to "9"', () => {
  assertMatch('main: "0" to "9"', '0');
  assertMatch('main: "0" to "9"', '9');
  assertNoMatch('main: "0" to "9"', 'a');
});

test('range: single char range', () => {
  assertMatch('main: "x" to "x"', 'x');
  assertNoMatch('main: "x" to "x"', 'y');
});

test('range: byte range', () => {
  assertMatch('main: byte 0x41 to byte 0x5A', 'A');
  assertMatch('main: byte 0x41 to byte 0x5A', 'Z');
  assertNoMatch('main: byte 0x41 to byte 0x5A', 'a');
  assertNoMatch('main: byte 0x41 to byte 0x5A', '@');
});

test('range: mixed quoted-to-byte', () => {
  assertMatch('main: "A" to byte 0x5A', 'A');
  assertMatch('main: "A" to byte 0x5A', 'Z');
});

test('range: byte-to-quoted', () => {
  assertMatch('main: byte 0x61 to "z"', 'a');
  assertMatch('main: byte 0x61 to "z"', 'z');
});

// ============================================================
// 5. Combinators — then (§3.1)
// ============================================================

test('then: two elements', () => {
  assertMatch('main: letter then digit', 'a1');
  assertNoMatch('main: letter then digit', '1a');
  assertNoMatch('main: letter then digit', 'a');
  assertNoMatch('main: letter then digit', '1');
});

test('then: three elements', () => {
  assertMatch('main: letter then digit then letter', 'a1b');
  assertNoMatch('main: letter then digit then letter', 'a1');
});

test('then: four elements', () => {
  assertMatch('main: letter then digit then letter then digit', 'a1b2');
});

test('then: named chars in sequence', () => {
  assertMatch('main: open paren then letter then close paren', '(a)');
});

test('then: text block in sequence', () => {
  assertMatch('main: "foo" then equals then "bar"', 'foo=bar');
});

// ============================================================
// 6. Combinators — or (§3.2)
// ============================================================

test('or: two alternatives', () => {
  assertMatch('main: letter or digit', 'a');
  assertMatch('main: letter or digit', '5');
  assertNoMatch('main: letter or digit', '!');
});

test('or: three alternatives', () => {
  assertMatch('main: letter or digit or underscore', 'a');
  assertMatch('main: letter or digit or underscore', '5');
  assertMatch('main: letter or digit or underscore', '_');
  assertNoMatch('main: letter or digit or underscore', '-');
});

test('or: four alternatives', () => {
  assertMatch('main: "a" or "b" or "c" or "d"', 'a');
  assertMatch('main: "a" or "b" or "c" or "d"', 'd');
  assertNoMatch('main: "a" or "b" or "c" or "d"', 'e');
});

test('or: ordered choice — first match wins', () => {
  const result = assertMatch('main: letter or "a"', 'a');
  assert(result.matched);
});

test('or: binds looser than then', () => {
  assertMatch('main: letter then digit or digit then letter', 'a1');
  assertMatch('main: letter then digit or digit then letter', '1a');
  assertNoMatch('main: letter then digit or digit then letter', 'aa');
  assertNoMatch('main: letter then digit or digit then letter', '11');
});

test('or: with sequences of different lengths', () => {
  assertMatch(
    'main: letter then letter then letter or digit then digit',
    'abc'
  );
  assertMatch(
    'main: letter then letter then letter or digit then digit',
    '12'
  );
});

// ============================================================
// 7. Combinators — repetition (§3.3)
// ============================================================

test('one or more: basic', () => {
  assertMatch('main: one or more digits', '1');
  assertMatch('main: one or more digits', '123');
  assertMatch('main: one or more digits', '1234567890');
  assertNoMatch('main: one or more digits', '');
  assertNoMatch('main: one or more digits', 'abc');
});

test('zero or more: basic', () => {
  assertMatch('main: zero or more digits', '');
  assertMatch('main: zero or more digits', '1');
  assertMatch('main: zero or more digits', '123');
});

test('optional: basic', () => {
  assertMatch('main: optional digit', '');
  assertMatch('main: optional digit', '5');
  assertNoMatch('main: optional digit', '55');
});

test('exactly: various counts', () => {
  assertMatch('main: 1 digits', '7');
  assertMatch('main: 4 digits', '1234');
  assertMatch('main: 10 digits', '0123456789');
  assertNoMatch('main: 4 digits', '123');
  assertNoMatch('main: 4 digits', '12345');
});

test('between: various ranges', () => {
  assertMatch('main: between 2 and 4 digits', '12');
  assertMatch('main: between 2 and 4 digits', '123');
  assertMatch('main: between 2 and 4 digits', '1234');
  assertNoMatch('main: between 2 and 4 digits', '1');
  assertNoMatch('main: between 2 and 4 digits', '12345');
});

test('between: min equals max', () => {
  assertMatch('main: between 3 and 3 digits', '123');
  assertNoMatch('main: between 3 and 3 digits', '12');
  assertNoMatch('main: between 3 and 3 digits', '1234');
});

test('repetition binds tighter than then', () => {
  assertMatch('main: one or more digits then hyphen', '123-');
  assertNoMatch('main: one or more digits then hyphen', '-');
});

test('repetition binds tighter than or', () => {
  assertMatch('main: one or more letters or digit', 'abc');
  assertMatch('main: one or more letters or digit', '5');
  assertNoMatch('main: one or more letters or digit', '');
});

test('repetition: greedy consumption', () => {
  assertMatch('main: one or more letters then one or more digits', 'abc123');
  assertNoMatch('main: one or more letters then one or more digits', 'abc');
});

test('repetition: chained modifiers', () => {
  assertMatch('main: one or more (one or more digits)', '123');
});

test('repetition: optional in sequence', () => {
  assertMatch('main: letter then optional digit then letter', 'a1b');
  assertMatch('main: letter then optional digit then letter', 'ab');
});

// ============================================================
// 8. Combinators — any of (§3.4)
// ============================================================

test('any of: single item', () => {
  assertMatch('main: any of (letter)', 'a');
  assertNoMatch('main: any of (letter)', '5');
});

test('any of: mixed types', () => {
  assertMatch('main: any of (letter, digit, underscore, hyphen)', 'a');
  assertMatch('main: any of (letter, digit, underscore, hyphen)', '5');
  assertMatch('main: any of (letter, digit, underscore, hyphen)', '_');
  assertMatch('main: any of (letter, digit, underscore, hyphen)', '-');
  assertNoMatch('main: any of (letter, digit, underscore, hyphen)', '!');
});

test('any of: with ranges', () => {
  assertMatch('main: any of ("a" to "f", "0" to "9")', 'a');
  assertMatch('main: any of ("a" to "f", "0" to "9")', 'f');
  assertMatch('main: any of ("a" to "f", "0" to "9")', '5');
  assertNoMatch('main: any of ("a" to "f", "0" to "9")', 'g');
});

test('any of: with byte ranges', () => {
  assertMatch('main: any of (byte 0xC0 to byte 0xC3) then any of (byte 0x80 to byte 0xBF)', '\xC0');
  assertNoMatch('main: any of (byte 0x80 to byte 0xBF)', 'a');
});

test('any of: with except inside', () => {
  assertMatch('main: any of (printable except (double quote, backslash), tab)', 'a');
  assertMatch('main: any of (printable except (double quote, backslash), tab)', '!');
  assertMatch('main: any of (printable except (double quote, backslash), tab)', '\t');
  assertNoMatch('main: any of (printable except (double quote, backslash), tab)', '"');
  assertNoMatch('main: any of (printable except (double quote, backslash), tab)', '\\');
});

test('any of: with repetition', () => {
  assertMatch('main: one or more of (letter, digit)', 'abc123');
  assertNoMatch('main: one or more of (letter, digit)', '');
});

// ============================================================
// 9. Combinators — none of
// ============================================================

test('none of: basic', () => {
  assertMatch('main: none of (double quote, backslash)', 'a');
  assertMatch('main: none of (double quote, backslash)', '!');
  assertMatch('main: none of (double quote, backslash)', ' ');
  assertNoMatch('main: none of (double quote, backslash)', '"');
  assertNoMatch('main: none of (double quote, backslash)', '\\');
});

test('none of: rejects empty', () => {
  assertNoMatch('main: none of (letter)', '');
});

test('none of: single exclusion', () => {
  assertMatch('main: none of (space)', 'a');
  assertNoMatch('main: none of (space)', ' ');
});

test('none of: with repetition', () => {
  assertMatch('main: one or more characters except (newline)', 'hello world!');
  assertNoMatch('main: one or more characters except (newline)', '');
});

// ============================================================
// 10. Combinators — joined by (§3.5)
// ============================================================

test('joined by: single element', () => {
  assertMatch('main: digit joined by comma', '1');
});

test('joined by: multiple elements', () => {
  assertMatch('main: digit joined by comma', '1,2,3');
  assertMatch('main: digit joined by comma', '1,2');
});

test('joined by: strict rejects trailing separator', () => {
  assertNoMatch('main: digit joined by comma', '1,');
});

test('joined by: rejects empty', () => {
  assertNoMatch('main: digit joined by comma', '');
});

test('joined by: rejects separator only', () => {
  assertNoMatch('main: digit joined by comma', ',');
});

test('joined by: complex elements', () => {
  assertMatch(
    'word: one or more letters\nmain: word joined by comma',
    'hello,world,foo'
  );
});

test('joined by: complex separator', () => {
  assertMatch('main: one or more letters joined by comma then space', 'abc, def, ghi');
  assertNoMatch('main: one or more letters joined by comma then space', 'abc,def');
});

test('joined by: text block separator', () => {
  assertMatch(
    'main: digit joined by ","',
    '1,2,3'
  );
});

test('joined by: multi-char separator with space', () => {
  assertMatch(
    'main: digit joined by comma then space',
    '1, 2, 3'
  );
});

// ============================================================
// 11. Combinators — grouping (§3.6)
// ============================================================

test('grouping: basic', () => {
  assertMatch('main: one or more (letter then digit)', 'a1b2c3');
  assertNoMatch('main: one or more (letter then digit)', 'abc');
});

test('grouping: nested', () => {
  assertMatch('main: (one or more (letter then digit))', 'a1b2');
});

test('grouping: alternation inside', () => {
  assertMatch('main: one or more (letter or digit)', 'a1b2');
  assertMatch('main: one or more (letter or digit)', 'abc');
  assertMatch('main: one or more (letter or digit)', '123');
});

test('grouping: overrides precedence', () => {
  assertMatch('main: letter then (digit or letter)', 'a1');
  assertMatch('main: letter then (digit or letter)', 'ab');
  assertNoMatch('main: letter then (digit or letter)', '1a');
});

// ============================================================
// 12. Text Blocks (§4)
// ============================================================

test('text block: simple', () => {
  assertMatch('main: "hello"', 'hello');
  assertNoMatch('main: "hello"', 'world');
  assertNoMatch('main: "hello"', 'hell');
  assertNoMatch('main: "hello"', 'helloo');
});

test('text block: with symbols', () => {
  assertMatch('main: "<!--"', '<!--');
  assertMatch('main: "-->"', '-->');
  assertMatch('main: "http://"', 'http://');
});

test('text block: with spaces', () => {
  assertMatch('main: "hello world"', 'hello world');
});

test('text block: single character', () => {
  assertMatch('main: "x"', 'x');
});

test('text block: special chars preserved', () => {
  assertMatch('main: "a+b*c"', 'a+b*c');
  assertMatch('main: "foo=bar&baz"', 'foo=bar&baz');
});

test('text block: in sequence', () => {
  assertMatch('main: "http://" then one or more letters', 'http://abc');
  assertNoMatch('main: "http://" then one or more letters', 'ftp://abc');
});

test('text block: as alternative', () => {
  assertMatch('main: "yes" or "no"', 'yes');
  assertMatch('main: "yes" or "no"', 'no');
  assertNoMatch('main: "yes" or "no"', 'maybe');
});

// ============================================================
// 13. Rules (§5)
// ============================================================

test('rules: basic reference', () => {
  assertMatch('tok: one or more letters\nmain: tok', 'hello');
});

test('rules: multi-rule pipeline', () => {
  assertMatch(
    'token: one or more letters\nparam: token then equals then token\nmain: param',
    'key=value'
  );
});

test('rules: last rule is entry point', () => {
  const result = run('a: letter\nb: digit\nmain: a then b', 'x5');
  assert(result.matched);
  assert(result.tree.rule === 'main');
});

test('rules: multi-word rule name', () => {
  assertMatch('my rule: one or more letters\nmain: my rule', 'hello');
});

test('rules: multi-word rule name with hyphen', () => {
  assertMatch('my-rule: one or more letters\nmain: my-rule', 'hello');
});

test('rules: forward reference', () => {
  assertMatch('main: inner\ninner: one or more digits', '123');
});

test('rules: many rules', () => {
  assertMatch(
    'a: letter\nb: digit\nc: a then b\nd: one or more c\nmain: d',
    'a1b2c3'
  );
});

test('rules: rule used multiple times', () => {
  assertMatch('d: digit\nmain: d then d then d', '123');
});

test('rules: rule in alternation', () => {
  assertMatch(
    'num: one or more digits\nword: one or more letters\nmain: num or word',
    'hello'
  );
  assertMatch(
    'num: one or more digits\nword: one or more letters\nmain: num or word',
    '123'
  );
});

// ============================================================
// 14. Parse tree structure (§10)
// ============================================================

test('tree: root rule', () => {
  const result = run('main: one or more letters', 'abc');
  assert(result.matched);
  assert(result.tree.rule === 'main');
  assert(result.tree.start === 0);
  assert(result.tree.end === 3);
  assert(result.tree.text === 'abc');
});

test('tree: child rules', () => {
  const result = run(
    'token: one or more letters\nparam: token then equals then token',
    'key=value'
  );
  assert(result.matched);
  assert(result.tree.rule === 'param');
  assert(result.tree.children.length >= 2);

  const tokens = result.tree.children.filter(c => c.rule === 'token');
  assert(tokens.length === 2, `Expected 2 tokens, got ${tokens.length}`);
  assert(tokens[0].text === 'key');
  assert(tokens[1].text === 'value');
});

test('tree: nested rule hierarchy', () => {
  const result = run(
    'ch: letter\nword: one or more ch\nmain: word',
    'hello'
  );
  assert(result.matched);
  assert(result.tree.rule === 'main');
  const wordChild = result.tree.children.find(c => c.rule === 'word');
  assert(wordChild, 'Should have word child');
  assert(wordChild.text === 'hello');
  assert(wordChild.children.length > 0);
  assert(wordChild.children[0].rule === 'ch');
});

test('tree: bytes_consumed equals input length', () => {
  const result = run('main: one or more letters', 'abcdef');
  assert(result.matched);
  assert(result.bytes_consumed === 6);
});

test('tree: joined by produces separator nodes', () => {
  const result = run(
    'tok: one or more letters\nmain: tok joined by comma',
    'a,b,c'
  );
  assert(result.matched);
  assert(result.tree.children.length >= 3);
  const toks = result.tree.children.filter(c => c.rule === 'tok');
  assert(toks.length === 3, `Expected 3 tok nodes, got ${toks.length}`);
});

test('tree: offsets are correct', () => {
  const result = run(
    'tok: one or more letters\nmain: tok then hyphen then tok',
    'abc-def'
  );
  assert(result.matched);
  const toks = result.tree.children.filter(c => c.rule === 'tok');
  assert(toks.length === 2);
  assert(toks[0].start === 0);
  assert(toks[0].end === 3);
  assert(toks[0].text === 'abc');
  assert(toks[1].start === 4);
  assert(toks[1].end === 7);
  assert(toks[1].text === 'def');
});

// ============================================================
// 15. except modifier (§2.6)
// ============================================================

test('except: printable except specific chars', () => {
  assertMatch('main: printable except (double quote, backslash)', 'a');
  assertMatch('main: printable except (double quote, backslash)', '!');
  assertMatch('main: printable except (double quote, backslash)', ' ');
  assertNoMatch('main: printable except (double quote, backslash)', '"');
  assertNoMatch('main: printable except (double quote, backslash)', '\\');
});

test('except: visible except', () => {
  assertMatch('main: visible except (less than, greater than)', 'a');
  assertMatch('main: visible except (less than, greater than)', '!');
  assertNoMatch('main: visible except (less than, greater than)', '<');
  assertNoMatch('main: visible except (less than, greater than)', '>');
});

test('except: any character except', () => {
  assertMatch('main: zero or more characters except ("x") then "x"', 'abcx');
  assertMatch('main: zero or more characters except ("x") then "x"', 'x');
});

test('except: with repetition', () => {
  assertMatch('main: one or more (visible except (space))', 'hello!');
  assertNoMatch('main: one or more (visible except (space))', '');
});

test('except: single exclusion', () => {
  assertMatch('main: letter except ("q")', 'a');
  assertNoMatch('main: letter except ("q")', 'q');
});

// ============================================================
// 16. Comments (§6)
// ============================================================

test('comments: line comment before rule', () => {
  assertMatch('-- a comment\nmain: letter', 'a');
});

test('comments: inline comment', () => {
  assertMatch('main: letter -- matches a letter', 'a');
});

test('comments: multiple comments', () => {
  assertMatch('-- first\n-- second\nmain: letter -- inline', 'a');
});

test('comments: comment-only lines ignored', () => {
  assertMatch('main: one or more letters\n-- just a comment', 'abc');
});

test('comments: between rules', () => {
  assertMatch(
    'a: letter\n-- separator\nb: digit\nmain: a then b',
    'a1'
  );
});

// ============================================================
// 17. Continuation Lines (§9.2)
// ============================================================

test('continuation: basic indent', () => {
  assertMatch('main:\n  letter\n  then digit', 'a1');
});

test('continuation: deep indent', () => {
  assertMatch(
    'main:\n    one or more letters\n    then hyphen\n    then one or more digits',
    'abc-123'
  );
});

test('continuation: tab indent', () => {
  assertMatch('main:\n\tletter\n\tthen digit', 'a1');
});

test('continuation: multi-rule with continuation', () => {
  assertMatch(
    'tok:\n  one or more letters\nmain:\n  tok then equals then tok',
    'key=value'
  );
});

test('continuation: blank line ends continuation', () => {
  assertMatch(
    'a: one or more letters\n\nmain: a then digit',
    'abc1'
  );
});

// ============================================================
// 18. PEG Semantics (§8.2)
// ============================================================

test('PEG: greedy — any character consumes everything', () => {
  assertNoMatch('main: zero or more any characters then "x"', 'abcx');
});

test('PEG: greedy — letter consumes all letters', () => {
  assertNoMatch('main: zero or more letters then "a"', 'xyzabc');
});

test('PEG: correct alternative for greedy', () => {
  assertMatch(
    'main: zero or more characters except ("x") then "x"',
    'abcx'
  );
});

test('PEG: ordered choice — first wins', () => {
  assertMatch('main: letter or alphanumeric', 'a');
});

test('PEG: no backtracking into repetition', () => {
  assertNoMatch('main: one or more digits then digit', '123');
});

// ============================================================
// 19. Full-input matching (§1)
// ============================================================

test('full input: must consume all', () => {
  assertNoMatch('main: letter', 'ab');
});

test('full input: trailing characters fail', () => {
  assertNoMatch('main: one or more digits', '123abc');
});

test('full input: empty input with zero or more', () => {
  assertMatch('main: zero or more letters', '');
});

test('full input: empty input with one or more fails', () => {
  assertNoMatch('main: one or more letters', '');
});

test('full input: exact match required', () => {
  assertMatch('main: "exact"', 'exact');
  assertNoMatch('main: "exact"', 'exact!');
  assertNoMatch('main: "exact"', 'exac');
});

// ============================================================
// 20. Validation Errors (§12.1)
// ============================================================

test('error: undefined rule', () => {
  assertParseError('main: nonexistent', 'Undefined rule');
});

test('error: duplicate rule', () => {
  assertParseError('a: letter\na: digit\nmain: a', 'Duplicate rule');
});

test('error: left recursion — direct', () => {
  assertParseError('bad: bad then "x"\nmain: bad', 'Left recursion');
});

test('error: left recursion — indirect', () => {
  assertParseError('a: b\nb: a\nmain: a', 'Left recursion');
});

test('error: invalid range', () => {
  assertParseError('main: "z" to "a"', 'Invalid range');
});

test('error: empty file', () => {
  assertParseError('', 'Empty file');
});

test('error: comments-only file', () => {
  assertParseError('-- just a comment', 'Empty file');
});

test('error: empty quoted string', () => {
  assertParseError('main: ""', 'Empty quoted string');
});

// ============================================================
// 21. Failure Diagnostics (§8.3)
// ============================================================

test('diagnostics: offset reported correctly', () => {
  const result = run('main: letter then digit', 'ax');
  assert(!result.matched);
  assert(result.offset === 1, `Expected offset 1, got ${result.offset}`);
});

test('diagnostics: expected set populated', () => {
  const result = run('main: letter then digit', 'ax');
  assert(!result.matched);
  assert(result.expected.length > 0, 'Should have expected items');
});

test('diagnostics: end of input detected', () => {
  const result = run('main: letter then digit', 'a');
  assert(!result.matched);
  assert(result.found === 'end of input');
});

test('diagnostics: found byte described', () => {
  const result = run('main: digit', 'x');
  assert(!result.matched);
  assert(result.found.includes('x'), `Found should describe 'x', got: ${result.found}`);
});

test('diagnostics: rule stack present', () => {
  const result = run('inner: digit\nmain: inner', 'x');
  assert(!result.matched);
  assert(Array.isArray(result.rule_stack), 'Should have rule_stack array');
});

test('diagnostics: line/column calculated', () => {
  const result = run('main: letter then digit', 'ax');
  assert(!result.matched);
  assert(result.line >= 1);
  assert(result.column >= 1);
});

test('diagnostics: formatFailure output', () => {
  const result = run('main: letter then digit', 'ax');
  assert(!result.matched);
  const formatted = formatFailure(result);
  assert(formatted.includes('match failed'));
  assert(formatted.includes('expected'));
  assert(formatted.includes('found'));
});

test('diagnostics: formatFailure with context', () => {
  const result = run('main: letter then digit', 'ax');
  assert(!result.matched);
  const formatted = formatFailure(result, 'ax');
  assert(formatted.includes('match failed'));
});

// ============================================================
// 22. Recursive Rules (§5.3)
// ============================================================

test('recursion: simple nested parens', () => {
  assertMatch(
    'nested: open paren then optional nested then close paren\nmain: nested',
    '()'
  );
});

test('recursion: one level', () => {
  assertMatch(
    'nested: open paren then optional nested then close paren\nmain: nested',
    '(())'
  );
});

test('recursion: deep nesting', () => {
  assertMatch(
    'nested: open paren then optional nested then close paren\nmain: nested',
    '(((())))'
  );
});

test('recursion: unbalanced fails', () => {
  assertNoMatch(
    'nested: open paren then optional nested then close paren\nmain: nested',
    '(()'
  );
});

test('recursion: with content', () => {
  assertMatch(
    'inner: one or more letters\nexpr: open paren then (expr or inner) then close paren\nmain: expr',
    '(hello)'
  );
  assertMatch(
    'inner: one or more letters\nexpr: open paren then (expr or inner) then close paren\nmain: expr',
    '((hello))'
  );
});

// ============================================================
// 23. Byte Literals (§2.3)
// ============================================================

test('byte literal: specific byte', () => {
  assertMatch('main: byte 0x41', 'A');
  assertMatch('main: byte 0x61', 'a');
  assertMatch('main: byte 0x30', '0');
});

test('byte literal: null byte', () => {
  assertMatch('main: byte 0x00', '\0');
});

test('byte literal: high byte via UTF-8', () => {
  assertMatch('main: byte 0xC3 then byte 0xBF', '\xFF');
  assertMatch('main: byte 0xC2 then byte 0x80', '\x80');
});

test('byte literal: case insensitive hex', () => {
  assertMatch('main: byte 0x41', 'A');
  assertMatch('main: byte 0x61', 'a');
});

// ============================================================
// 24. RFC 7239 Forwarded Header (Appendix A)
// ============================================================

const RFC7239 = `
token char:
  any of (
    exclamation, hash, dollar, percent, ampersand,
    single quote, asterisk, plus, period, caret,
    underscore, backtick, pipe, tilde,
    "0" to "9", "a" to "z", "A" to "Z", hyphen
  )

token: one or more token char

escaped:
  backslash then any of (
    tab, byte 0x20 to byte 0x7E, byte 0x80 to byte 0xFF
  )

qdtext:
  any of (
    printable except (double quote, backslash),
    tab,
    byte 0x80 to byte 0xFF
  )

quoted value:
  double quote
  then zero or more (qdtext or escaped)
  then double quote

value: token or quoted value

param: token then equals then value

element: param joined by semicolon

ows: zero or more (space or tab)

forwarded: element joined by comma then ows
`;

test('RFC 7239: simple param', () => {
  assertMatch(RFC7239, 'for=1.2.3.4');
});

test('RFC 7239: param with dots', () => {
  assertMatch(RFC7239, 'for=192.0.2.43');
});

test('RFC 7239: multiple params with semicolon', () => {
  assertMatch(RFC7239, 'for=192.0.2.43;proto=https');
});

test('RFC 7239: multiple elements with comma', () => {
  assertMatch(RFC7239, 'for=192.0.2.43;proto=https,for=198.51.100.178');
});

test('RFC 7239: with OWS', () => {
  assertMatch(RFC7239, 'for=1.2.3.4, for=5.6.7.8');
});

test('RFC 7239: with tab OWS', () => {
  assertMatch(RFC7239, 'for=1.2.3.4,\tfor=5.6.7.8');
});

test('RFC 7239: quoted value', () => {
  assertMatch(RFC7239, 'for="[2001:db8::1]"');
});

test('RFC 7239: quoted value with escaped char', () => {
  assertMatch(RFC7239, 'for="hello\\nworld"');
});

test('RFC 7239: empty quoted value', () => {
  assertMatch(RFC7239, 'for=""');
});

test('RFC 7239: tree structure', () => {
  const result = assertMatch(RFC7239, 'for=192.0.2.43;proto=https,for=198.51.100.178');
  assert(result.tree.rule === 'forwarded');
  assert(result.tree.start === 0);
  assert(result.tree.end === 45);

  const elements = result.tree.children.filter(c => c.rule === 'element');
  assert(elements.length === 2, `Expected 2 elements, got ${elements.length}`);
});

test('RFC 7239: single element', () => {
  assertMatch(RFC7239, 'by=proxy');
});

test('RFC 7239: complex real-world', () => {
  assertMatch(RFC7239, 'for=192.0.2.60;proto=http;by=203.0.113.43');
});

test('RFC 7239: rejects invalid', () => {
  assertNoMatch(RFC7239, '');
  assertNoMatch(RFC7239, '=');
  assertNoMatch(RFC7239, 'for');
});

// ============================================================
// 25. formatTree
// ============================================================

test('formatTree: produces output', () => {
  const result = run(
    'token: one or more letters\nparam: token then equals then token',
    'key=val'
  );
  assert(result.matched);
  const output = formatTree(result.tree);
  assert(output.includes('param'));
  assert(output.includes('token'));
  assert(output.includes('key'));
  assert(output.includes('val'));
});

test('formatTree: includes offsets', () => {
  const result = run('main: one or more letters', 'abc');
  assert(result.matched);
  const output = formatTree(result.tree);
  assert(output.includes('[0..3]'));
});

// ============================================================
// 26. parse() and match() API separation
// ============================================================

test('API: parse returns program, match uses it', () => {
  const program = parse('main: one or more letters');
  const result1 = match(program, 'abc');
  assert(result1.matched);
  const result2 = match(program, '123');
  assert(!result2.matched);
});

test('API: program reuse', () => {
  const program = parse('main: 4 digits');
  assert(match(program, '1234').matched);
  assert(!match(program, '123').matched);
  assert(!match(program, '12345').matched);
  assert(match(program, '0000').matched);
});

// ============================================================
// 27. Complex real-world patterns
// ============================================================

test('pattern: IPv4 address', () => {
  assertMatch(
    'octet: between 1 and 3 digits\nmain: octet joined by period',
    '192.168.1.1'
  );
  assertMatch(
    'octet: between 1 and 3 digits\nmain: octet joined by period',
    '0.0.0.0'
  );
  assertMatch(
    'octet: between 1 and 3 digits\nmain: octet joined by period',
    '192.168.1'
  );
});

test('pattern: simple email-like', () => {
  assertMatch(
    'local: one or more of (letter, digit, period, hyphen, underscore)\ndomain: one or more of (letter, digit, hyphen)\nmain: local then at then (domain joined by period)',
    'user@example.com'
  );
});

test('pattern: key-value pairs', () => {
  assertMatch(
    'key: one or more letters\nval: one or more visible\npair: key then equals then val\nmain: pair joined by ampersand',
    'foo=bar&baz=qux'
  );
});

test('pattern: CSS hex color', () => {
  assertMatch(
    'main: hash then 6 hex digits',
    '#FF00AA'
  );
  assertMatch(
    'main: hash then 6 hex digits',
    '#ffffff'
  );
  assertNoMatch(
    'main: hash then 6 hex digits',
    '#FFF'
  );
});

test('pattern: simple HTML tag', () => {
  assertMatch(
    'tag name: one or more letters\nmain: less than then tag name then greater than',
    '<div>'
  );
});

test('pattern: quoted string', () => {
  assertMatch(
    'inner: zero or more (printable except (double quote))\nmain: double quote then inner then double quote',
    '"hello world"'
  );
  assertMatch(
    'inner: zero or more (printable except (double quote))\nmain: double quote then inner then double quote',
    '""'
  );
});

test('pattern: comma-separated numbers', () => {
  assertMatch(
    'num: one or more digits\nmain: num joined by comma then space',
    '1, 22, 333, 4444'
  );
});

test('pattern: protocol prefix', () => {
  assertMatch(
    'scheme: one or more letters\nhost: one or more of (letter, digit, period, hyphen)\nmain: scheme then colon then slash then slash then host',
    'https://example.com'
  );
});

// ============================================================
// 28. Memoization correctness
// ============================================================

test('memo: reused rule produces consistent results', () => {
  const program = parse('d: one or more digits\nmain: d then hyphen then d');
  assert(match(program, '12-34').matched);
  assert(!match(program, '12-').matched);
});

test('memo: rule called from multiple parents', () => {
  assertMatch(
    'digit-seq: one or more digits\na: digit-seq then hyphen then digit-seq\nb: digit-seq\nmain: a or b',
    '123-456'
  );
  assertMatch(
    'digit-seq: one or more digits\na: digit-seq then hyphen then digit-seq\nb: digit-seq\nmain: a or b',
    '789'
  );
});

// ============================================================
// 29. Edge cases and stress
// ============================================================

test('edge: very long input', () => {
  assertMatch('main: one or more letters', 'a'.repeat(10000));
});

test('edge: many alternatives', () => {
  assertMatch(
    'main: "a" or "b" or "c" or "d" or "e" or "f" or "g" or "h" or "i" or "j"',
    'j'
  );
  assertNoMatch(
    'main: "a" or "b" or "c" or "d" or "e" or "f" or "g" or "h" or "i" or "j"',
    'k'
  );
});

test('edge: deeply nested groups', () => {
  assertMatch('main: (((((letter)))))', 'a');
});

test('edge: optional everything', () => {
  assertMatch('main: optional letter then optional digit', '');
  assertMatch('main: optional letter then optional digit', 'a');
  assertMatch('main: optional letter then optional digit', '1');
  assertMatch('main: optional letter then optional digit', 'a1');
});

test('edge: zero or more of zero or more', () => {
  assertMatch('main: zero or more (zero or more letters)', '');
  assertMatch('main: zero or more (zero or more letters)', 'abc');
});

test('edge: one-char input many ways', () => {
  assertMatch('main: any character', 'x');
  assertMatch('main: letter', 'x');
  assertMatch('main: visible', 'x');
  assertMatch('main: printable', 'x');
  assertMatch('main: alphanumeric', 'x');
  assertMatch('main: word character', 'x');
  assertMatch('main: "x"', 'x');
  assertMatch('main: "a" to "z"', 'x');
});

test('edge: alternation with different-length sequences', () => {
  assertMatch('main: letter then letter or digit', 'ab');
  assertMatch('main: letter then letter or digit', '5');
});

test('edge: byte 0x00 in sequence', () => {
  assertMatch('main: null then null', '\0\0');
});

// ============================================================
// 30. find() — substring matching
// ============================================================

test('find: single match in string', () => {
  const program = parse('main: one or more digits');
  const results = find(program, 'abc123def');
  assert(results.length === 1);
  assert(results[0].text === '123');
  assert(results[0].start === 3);
  assert(results[0].end === 6);
});

test('find: multiple matches', () => {
  const program = parse('main: one or more digits');
  const results = find(program, 'a1b22c333');
  assert(results.length === 3);
  assert(results[0].text === '1');
  assert(results[1].text === '22');
  assert(results[2].text === '333');
});

test('find: no matches', () => {
  const program = parse('main: one or more digits');
  const results = find(program, 'abcdef');
  assert(results.length === 0);
});

test('find: match at start', () => {
  const program = parse('main: one or more digits');
  const results = find(program, '123abc');
  assert(results.length === 1);
  assert(results[0].text === '123');
  assert(results[0].start === 0);
});

test('find: match at end', () => {
  const program = parse('main: one or more digits');
  const results = find(program, 'abc123');
  assert(results.length === 1);
  assert(results[0].text === '123');
});

test('find: entire string matches', () => {
  const program = parse('main: one or more digits');
  const results = find(program, '12345');
  assert(results.length === 1);
  assert(results[0].text === '12345');
});

test('find: text block pattern', () => {
  const program = parse('main: "error" then colon then space then one or more digits');
  const results = find(program, 'info: ok, error: 404, warn: 3');
  assert(results.length === 1);
  assert(results[0].text === 'error: 404');
});

test('find: empty input', () => {
  const program = parse('main: one or more digits');
  const results = find(program, '');
  assert(results.length === 0);
});

test('find: produces parse trees', () => {
  const program = parse('num: one or more digits\nmain: num');
  const results = find(program, 'abc123def');
  assert(results.length === 1);
  assert(results[0].tree.rule === 'main');
});

// ============================================================
// 31. searchString() — in-memory string searching
// ============================================================

test('searchString: basic', () => {
  const program = parse('main: "error:" then space then one or more digits');
  const results = searchString(program, 'line one\nerror: 42\nline three\nerror: 500\n');
  assert(results.length === 2, `Expected 2 matches, got ${results.length}`);
  assert(results[0].line === 2);
  assert(results[1].line === 4);
  assert(results[0].file === '<stdin>');
});

test('searchString: custom label', () => {
  const program = parse('main: one or more digits');
  const results = searchString(program, 'abc 123', 'test-input');
  assert(results[0].file === 'test-input');
});

test('searchString: line range', () => {
  const program = parse('main: one or more digits');
  const results = searchString(program, '1\n2\n3\n4\n5', '<stdin>', { startLine: 2, endLine: 4 });
  assert(results.length === 3, `Expected 3, got ${results.length}`);
  assert(results[0].line === 2);
  assert(results[2].line === 4);
});

// ============================================================
// 32. searchFile() — file searching
// ============================================================

test('searchFile: finds matches in file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  const tmpFile = path.join(tmpDir, 'test.log');
  fs.writeFileSync(tmpFile, 'line one\nerror: 42\nline three\nerror: 500\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFile(program, tmpFile);
  assert(result.matches.length === 2, `Expected 2 matches, got ${result.matches.length}`);
  assert(result.matches[0].line === 2);
  assert(result.matches[1].line === 4);
  assert(result.errors.length === 0);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFile: line range', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  const tmpFile = path.join(tmpDir, 'test.log');
  fs.writeFileSync(tmpFile, 'error: 1\nerror: 2\nerror: 3\nerror: 4\nerror: 5\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFile(program, tmpFile, { startLine: 2, endLine: 4 });
  assert(result.matches.length === 3, `Expected 3 matches, got ${result.matches.length}`);
  assert(result.matches[0].line === 2);
  assert(result.matches[2].line === 4);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFile: no matches', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  const tmpFile = path.join(tmpDir, 'test.log');
  fs.writeFileSync(tmpFile, 'all good\nno problems\n');
  const program = parse('main: "error"');
  const result = searchFile(program, tmpFile);
  assert(result.matches.length === 0);
  assert(result.errors.length === 0);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFile: skips binary files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  const tmpFile = path.join(tmpDir, 'test.bin');
  const buf = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64]);
  fs.writeFileSync(tmpFile, buf);
  const program = parse('main: one or more letters');
  const result = searchFile(program, tmpFile);
  assert(result.matches.length === 0, 'Should skip binary file');
  assert(result.errors.length === 0);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFile: returns error for nonexistent file', () => {
  const program = parse('main: one or more digits');
  const result = searchFile(program, '/tmp/definitely-does-not-exist-' + Date.now());
  assert(result.matches.length === 0);
  assert(result.errors.length === 1, 'Should report error');
  assert(result.errors[0].error.length > 0);
});

test('searchFile: returns error for unreadable file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  const tmpFile = path.join(tmpDir, 'noperm.log');
  fs.writeFileSync(tmpFile, 'error: 42\n');
  fs.chmodSync(tmpFile, 0o000);
  const program = parse('main: one or more digits');
  const result = searchFile(program, tmpFile);
  assert(result.errors.length === 1, 'Should report permission error');
  fs.chmodSync(tmpFile, 0o644);
  fs.rmSync(tmpDir, { recursive: true });
});

// ============================================================
// 33. searchFolder() — folder searching
// ============================================================

test('searchFolder: finds across files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.writeFileSync(path.join(tmpDir, 'a.log'), 'error: 1\nok\n');
  fs.writeFileSync(path.join(tmpDir, 'b.log'), 'ok\nerror: 2\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir);
  assert(result.matches.length === 2, `Expected 2 matches, got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: recurses into subdirectories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'a.log'), 'error: 1\n');
  fs.writeFileSync(path.join(tmpDir, 'sub', 'b.log'), 'error: 2\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir);
  assert(result.matches.length === 2, `Expected 2 matches, got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: skips hidden directories', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.mkdirSync(path.join(tmpDir, '.hidden'));
  fs.writeFileSync(path.join(tmpDir, '.hidden', 'a.log'), 'error: 1\n');
  fs.writeFileSync(path.join(tmpDir, 'b.log'), 'error: 2\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir);
  assert(result.matches.length === 1, `Expected 1 match, got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: skips .git, dist, node_modules, build', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  for (const dir of ['.git', 'dist', 'node_modules', 'build']) {
    fs.mkdirSync(path.join(tmpDir, dir));
    fs.writeFileSync(path.join(tmpDir, dir, 'f.log'), 'error: 1\n');
  }
  fs.writeFileSync(path.join(tmpDir, 'real.log'), 'error: 2\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir);
  assert(result.matches.length === 1, `Expected 1 match (only real.log), got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: skips binary files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.writeFileSync(path.join(tmpDir, 'a.log'), 'error: 1\n');
  fs.writeFileSync(path.join(tmpDir, 'b.bin'), Buffer.from([0x65, 0x72, 0x72, 0x00, 0x6f, 0x72]));
  const program = parse('main: "error"');
  const result = searchFolder(program, tmpDir);
  assert(result.matches.length === 1, `Expected 1 match (text file only), got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: glob filtering', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.writeFileSync(path.join(tmpDir, 'a.log'), 'error: 1\n');
  fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'error: 2\n');
  fs.writeFileSync(path.join(tmpDir, 'c.log'), 'error: 3\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir, { glob: '*.log' });
  assert(result.matches.length === 2, `Expected 2 matches (.log only), got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: glob filtering with ?', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'error: 1\n');
  fs.writeFileSync(path.join(tmpDir, 'b.js'), 'error: 2\n');
  fs.writeFileSync(path.join(tmpDir, 'c.md'), 'error: 3\n');
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir, { glob: '*.?s' });
  assert(result.matches.length === 2, `Expected 2 matches (.ts and .js), got ${result.matches.length}`);
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: symlink loop protection', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-test-'));
  fs.writeFileSync(path.join(tmpDir, 'a.log'), 'error: 1\n');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  try {
    fs.symlinkSync(tmpDir, path.join(tmpDir, 'sub', 'loop'), 'dir');
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true });
    return;
  }
  const program = parse('main: "error:" then space then one or more digits');
  const result = searchFolder(program, tmpDir);
  assert(result.matches.length >= 1, 'Should find at least 1 match without hanging');
  fs.rmSync(tmpDir, { recursive: true });
});

test('searchFolder: nonexistent folder returns no crash', () => {
  const program = parse('main: one or more digits');
  const result = searchFolder(program, '/tmp/definitely-not-a-folder-' + Date.now());
  assert(result.matches.length === 0);
});

// ============================================================
// 34. formatSearchResults()
// ============================================================

test('formatSearchResults: no matches', () => {
  const output = formatSearchResults([]);
  assert(output === 'no matches found');
});

test('formatSearchResults: produces output with color', () => {
  const results = [{
    file: '/tmp/test.log',
    line: 5,
    content: 'error: 42',
    matches: [{ start: 7, end: 9, text: '42', tree: { rule: 'main', start: 7, end: 9, text: '42', children: [] } }],
  }];
  const output = formatSearchResults(results, { color: true });
  assert(output.includes('/tmp/test.log:5:'));
  assert(output.includes('\x1b[1;31m42\x1b[0m'), 'Should contain ANSI color codes');
});

test('formatSearchResults: no color mode', () => {
  const results = [{
    file: '/tmp/test.log',
    line: 5,
    content: 'error: 42',
    matches: [{ start: 7, end: 9, text: '42', tree: { rule: 'main', start: 7, end: 9, text: '42', children: [] } }],
  }];
  const output = formatSearchResults(results, { color: false });
  assert(output.includes('/tmp/test.log:5: error: 42'));
  assert(!output.includes('\x1b['), 'Should not contain ANSI codes');
});

// ============================================================
// 35. until construct
// ============================================================

test('until: basic — any character until including terminator', () => {
  assertMatch('main: any character until including "x"', 'abcx');
  assertNoMatch('main: any character until including "x"', 'abc');
});

test('until including: consumes terminator', () => {
  const result = assertMatch('main: any character until including ";"', 'hello;');
  assert(result.tree.text === 'hello;');
});

test('until including: immediate terminator', () => {
  assertMatch('main: any character until including "x"', 'x');
});

test('until including: with rule as terminator', () => {
  assertMatch(
    'end marker: "END"\nmain: any character until including end marker',
    'stuff hereEND'
  );
});

test('until including: with rule as child', () => {
  assertMatch(
    'ch: printable\nmain: ch until including newline',
    'hello world\n'
  );
});

test('until including: no match when child fails before terminator', () => {
  assertNoMatch('main: letter until including ";"', 'abc 123;');
});

test('until including: in sequence', () => {
  assertMatch(
    'main: "[" then (any character until including "]")',
    '[content]'
  );
});

test('until including: fails on empty with no terminator', () => {
  assertNoMatch('main: any character until including "x"', '');
});

test('until excluding: stops before terminator', () => {
  const result = assertMatch('main: (any character until excluding ";") then ";"', 'hello;');
  assert(result.tree.text === 'hello;');
});

test('until excluding: immediate terminator yields empty prefix', () => {
  assertMatch('main: (any character until excluding "x") then "x"', 'x');
});

test('until excluding: with rule as terminator', () => {
  assertMatch(
    'end marker: "END"\nmain: (any character until excluding end marker) then end marker',
    'stuff hereEND'
  );
});

test('until excluding: fails when no terminator found', () => {
  assertNoMatch('main: any character until excluding "x"', 'abc');
});

test('until: bare until is parse error', () => {
  let threw = false;
  try {
    run('main: any character until "x"', 'abcx');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Expected bare "until" to throw a parse error');
});

// ============================================================
// 36. UTF-8 handling
// ============================================================

test('utf8: multi-byte characters in input', () => {
  assertMatch('main: byte 0xC3 then byte 0xA9', 'é');
});

test('utf8: text block with ASCII still works', () => {
  assertMatch('main: "hello"', 'hello');
});

test('utf8: byte range for high bytes', () => {
  assertMatch('main: (byte 0xC0 to byte 0xDF) then (byte 0x80 to byte 0xBF)', '\xE9');
});

test('utf8: find returns correct char offsets for ASCII', () => {
  const program = parse('main: one or more digits');
  const results = find(program, 'abc123def');
  assert(results.length === 1);
  assert(results[0].start === 3);
  assert(results[0].end === 6);
  assert(results[0].text === '123');
});

test('utf8: find returns correct char offsets with multi-byte prefix', () => {
  const program = parse('main: one or more digits');
  const results = find(program, 'café42');
  assert(results.length === 1);
  assert(results[0].text === '42');
  assert(results[0].start === 4);
  assert(results[0].end === 6);
  assert('café42'.slice(results[0].start, results[0].end) === '42');
});

// ============================================================
// 37. formatTree deep nesting
// ============================================================

test('formatTree: deep nesting produces valid tree', () => {
  const result = run(
    'ch: letter\nword: one or more ch\nsentence: word\nmain: sentence',
    'hello'
  );
  assert(result.matched);
  const output = formatTree(result.tree);
  assert(output.includes('main'));
  assert(output.includes('sentence'));
  assert(output.includes('word'));
  assert(output.includes('ch'));
  const outputLines = output.split('\n');
  for (const l of outputLines) {
    assert(!l.includes('undefined'), `Tree output contains undefined: ${l}`);
  }
});

test('formatTree: wide tree with multiple children', () => {
  const result = run('d: digit\nmain: d then d then d then d', '1234');
  assert(result.matched);
  const output = formatTree(result.tree);
  assert(output.includes('├──') || output.includes('└──'));
  const dMatches = output.split('\n').filter(l => l.includes(' d ['));
  assert(dMatches.length === 4, `Expected 4 d nodes, got ${dMatches.length}`);
});

test('formatTree: connectors are consistent', () => {
  const result = run(
    'a: letter\nb: one or more a\nc: b\nmain: c',
    'hello'
  );
  assert(result.matched);
  const output = formatTree(result.tree);
  const lines = output.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].replace(/[│├└─ ]/g, '').replace(/\s+/g, '');
    assert(trimmed.length > 0, `Line ${i} is empty after stripping connectors`);
  }
});

// ============================================================
// 38. named char aliases
// ============================================================

test('alias: dot matches period', () => {
  assertMatch('main: dot', '.');
  assertNoMatch('main: dot', 'a');
});

test('alias: dash matches hyphen', () => {
  assertMatch('main: dash', '-');
  assertNoMatch('main: dash', 'a');
});

test('alias: bang matches exclamation', () => {
  assertMatch('main: bang', '!');
  assertNoMatch('main: bang', 'a');
});

test('alias: dot in sequence', () => {
  assertMatch('main: one or more digits then dot then one or more digits', '3.14');
});

// ============================================================
// 39. uppercase/lowercase character classes
// ============================================================

test('uppercase: matches A-Z', () => {
  assertMatch('main: uppercase', 'A');
  assertMatch('main: uppercase', 'Z');
  assertNoMatch('main: uppercase', 'a');
  assertNoMatch('main: uppercase', '1');
});

test('lowercase: matches a-z', () => {
  assertMatch('main: lowercase', 'a');
  assertMatch('main: lowercase', 'z');
  assertNoMatch('main: lowercase', 'A');
  assertNoMatch('main: lowercase', '1');
});

test('uppercase: one or more', () => {
  assertMatch('main: one or more uppercase', 'HELLO');
  assertNoMatch('main: one or more uppercase', 'Hello');
});

test('lowercase: one or more', () => {
  assertMatch('main: one or more lowercase', 'hello');
  assertNoMatch('main: one or more lowercase', 'Hello');
});

test('uppercase/lowercase: in any of', () => {
  assertMatch('main: one or more of (uppercase, digit)', 'ABC123');
  assertNoMatch('main: one or more of (uppercase, digit)', 'abc123');
});

// ============================================================
// 40. parser EOF handling
// ============================================================

test('parser: truncated input gives ParseError not TypeError', () => {
  let caught = false;
  try {
    parse('main:');
  } catch (e) {
    caught = true;
    assert(e.message.includes('Expected') || e.message.includes('Unexpected'), `Bad error: ${e.message}`);
  }
  assert(caught, 'Should throw ParseError for truncated input');
});

test('parser: missing rule body gives ParseError', () => {
  let caught = false;
  try {
    parse('main: letter then');
  } catch (e) {
    caught = true;
    assert(e.message.includes('Expected') || e.message.includes('Unexpected'), `Bad error: ${e.message}`);
  }
  assert(caught, 'Should throw ParseError');
});

// ============================================================
// 41. isn't negation predicate
// ============================================================

test("isn't: basic — any character isn't newline", () => {
  assertMatch("main: one or more (any character isn't newline) then newline", 'hello\n');
});

test("isn't: rejects when negated matches", () => {
  assertNoMatch("main: any character isn't letter", 'a');
});

test("isn't: allows when negated doesn't match", () => {
  assertMatch("main: any character isn't letter", '5');
});

test("isn't: with text block", () => {
  assertMatch('main: one or more (any character isn\'t "END") then "END"', 'helloEND');
});

test("isn't: with text block rejects", () => {
  assertNoMatch('main: one or more (letter isn\'t "a")', 'abc');
});

test("isnt: works without apostrophe", () => {
  assertMatch("main: any character isnt letter", '5');
  assertNoMatch("main: any character isnt letter", 'a');
});

test("isn't: with rule ref", () => {
  assertMatch(
    'stop: "--"\nmain: one or more (printable isn\'t stop) then stop',
    'hello world--'
  );
});

test("isn't: preserves child semantics", () => {
  assertMatch('main: digit isn\'t "0"', '5');
  assertNoMatch('main: digit isn\'t "0"', '0');
  assertNoMatch('main: digit isn\'t "0"', 'a');
});

// ============================================================
// 42. joined by trailing separator
// ============================================================

test('joined by lenient: trailing comma accepted', () => {
  assertMatch('main: digit joined by comma lenient', '1,2,3,');
});

test('joined by lenient: still works without trailing', () => {
  assertMatch('main: digit joined by comma lenient', '1,2,3');
});

test('joined by lenient: single element with trailing', () => {
  assertMatch('main: digit joined by comma lenient', '1,');
});

test('joined by lenient: single element no trailing', () => {
  assertMatch('main: digit joined by comma lenient', '1');
});

test('joined by lenient: trailing in real-world CSV row', () => {
  assertMatch(
    'field: one or more characters except (comma, newline)\nrow: field joined by comma lenient',
    'a,b,c,'
  );
});

test('joined by: strict rejects trailing in CSV row', () => {
  assertNoMatch(
    'field: one or more characters except (comma, newline)\nrow: field joined by comma',
    'a,b,c,'
  );
});

// ============================================================
// 43. extract keyword
// ============================================================

test('extract: basic extraction', () => {
  const result = run(
    'main: "[" then extract (one or more letters) then "]"',
    '[hello]'
  );
  assert(result.matched);
  assert(result.extracted.length === 1, `Expected 1 extracted, got ${result.extracted.length}`);
  assert(result.extracted[0].text === 'hello');
});

test('extract: multiple extractions', () => {
  const result = run(
    'main: extract digit then letter then extract digit',
    '1a2'
  );
  assert(result.matched);
  assert(result.extracted.length === 2);
  assert(result.extracted[0].text === '1');
  assert(result.extracted[1].text === '2');
});

test('extract: with rule ref', () => {
  const result = run(
    'num: one or more digits\nmain: "value=" then extract num',
    'value=42'
  );
  assert(result.matched);
  assert(result.extracted.length === 1);
  assert(result.extracted[0].text === '42');
  assert(result.extracted[0].rule === 'num');
});

test('extract: full tree still present', () => {
  const result = run(
    'main: letter then extract digit then letter',
    'a1b'
  );
  assert(result.matched);
  assert(result.tree.text === 'a1b');
  assert(result.extracted.length === 1);
  assert(result.extracted[0].text === '1');
});

test('extract: no extractions on failure', () => {
  const result = run(
    'main: extract digit then letter',
    '12'
  );
  assert(!result.matched);
});

test('extract: empty when no extract keywords used', () => {
  const result = run('main: one or more digits', '123');
  assert(result.matched);
  assert(result.extracted.length === 0);
});

// ============================================================
// 44. byte literal edge cases
// ============================================================

test('byte literal: rejects single hex digit', () => {
  let caught = false;
  try { parse('main: byte 0x1'); } catch (e) { caught = true; }
  assert(caught, 'byte 0x1 should be rejected');
});

test('byte literal: rejects three hex digits', () => {
  let caught = false;
  try { parse('main: byte 0xFFF'); } catch (e) { caught = true; }
  assert(caught, 'byte 0xFFF should be rejected');
});

test('byte literal: rejects missing hex prefix', () => {
  let caught = false;
  try { parse('main: byte FF'); } catch (e) { caught = true; }
  assert(caught, 'byte FF should be rejected');
});

test('byte literal: rejects invalid hex chars', () => {
  let caught = false;
  try { parse('main: byte 0xGG'); } catch (e) { caught = true; }
  assert(caught, 'byte 0xGG should be rejected');
});

// ============================================================
// 45. any character is codepoint-aware
// ============================================================

test('any character: matches single ASCII byte', () => {
  assertMatch('main: any character', 'a');
});

test('any character: matches 2-byte UTF-8 (é)', () => {
  assertMatch('main: any character', 'é');
});

test('any character: matches 3-byte UTF-8 (中)', () => {
  assertMatch('main: any character', '中');
});

test('any character: matches 4-byte UTF-8 (emoji)', () => {
  assertMatch('main: any character', '🎉');
});

test('any character: café is 4 codepoints', () => {
  assertMatch('main: 4 any characters', 'café');
  assertNoMatch('main: 5 any characters', 'café');
});

test('any character: none of with multi-byte', () => {
  assertMatch('main: none of (letter)', 'é');
});

// ============================================================
// 46. tryParse partial results
// ============================================================

test('tryParse: full match returns success', () => {
  const r = tryParse('main: one or more letters', 'abc');
  assert(r.matched === true);
  assert(r.bytes_consumed === 3);
});

test('tryParse: partial match returns partial tree', () => {
  const r = tryParse('main: one or more letters then one or more digits', 'abc');
  assert(r.matched === false);
  assert(r.bytes_consumed === 3);
  assert(r.partial_tree !== null);
  assert(r.partial_tree.text === 'abc');
});

test('tryParse: total failure returns null partial tree', () => {
  const r = tryParse('main: one or more digits', 'abc');
  assert(r.matched === false);
  assert(r.bytes_consumed === 0);
  assert(r.partial_tree === null);
});

test('tryParse: sequence partial preserves children', () => {
  const r = tryParse('tok: one or more letters\nnum: one or more digits\nmain: tok then num', 'abc');
  assert(r.matched === false);
  assert(r.partial_tree !== null);
  assert(r.partial_tree.children.length >= 1);
  assert(r.partial_tree.children[0].rule === 'tok');
});

test('tryParse: includes failure info', () => {
  const r = tryParse('main: one or more letters then one or more digits', 'abc');
  assert(r.matched === false);
  assert(r.expected.length > 0);
  assert(r.offset === 3);
});

test('tryParse: extracts collected before failure', () => {
  const r = tryParse('main: extract (one or more letters) then one or more digits', 'abc');
  assert(r.matched === false);
  assert(r.extracted.length === 1);
  assert(r.extracted[0].text === 'abc');
});

// ============================================================
// 47. extract rollback on failed or branches
// ============================================================

test('extract: failed or branch does not leak extracts', () => {
  const r = run('main: ((extract letter) then letter then digit) or letter then letter then comma', 'ab,');
  assert(r.matched);
  assert(r.extracted.length === 0, `Expected 0 extracts, got ${r.extracted.length}: ${r.extracted.map(e => e.text)}`);
});

test('extract: winning or branch extracts are preserved', () => {
  const r = run('main: (letter then digit) or (extract letter then comma)', 'a,');
  assert(r.matched);
  assert(r.extracted.length === 1);
  assert(r.extracted[0].text === 'a');
});

test('extract: nested or with multiple failed branches', () => {
  const r = run('main: ((extract letter) then digit) or ((extract digit) then letter) or comma', ',');
  assert(r.matched);
  assert(r.extracted.length === 0, `Expected 0 extracts from failed branches, got ${r.extracted.length}`);
});

// ============================================================
// 48. extract compound expression restriction
// ============================================================

test('extract: allows prefix repetition without parens', () => {
  const r1 = assertMatch('main: extract one or more digits', '123');
  assert(r1.extracted.length === 1);
  assert(r1.extracted[0].text === '123');
  const r2 = assertMatch('main: extract zero or more letters', '');
  assert(r2.extracted.length === 1);
  assert(r2.extracted[0].text === '');
  const r3 = assertMatch('main: extract optional digit', '5');
  assert(r3.extracted.length === 1);
  assert(r3.extracted[0].text === '5');
});

test('extract: allows parenthesized compound expression', () => {
  const r = run('main: extract (one or more digits)', '123');
  assert(r.matched);
  assert(r.extracted.length === 1);
  assert(r.extracted[0].text === '123');
});

test('extract: allows single atom without parens', () => {
  const r = run('main: extract digit then letter', '1a');
  assert(r.matched);
  assert(r.extracted.length === 1);
  assert(r.extracted[0].text === '1');
});

test('extract: allows rule ref without parens', () => {
  const r = run('num: one or more digits\nmain: extract num', '42');
  assert(r.matched);
  assert(r.extracted.length === 1);
  assert(r.extracted[0].text === '42');
});

// ============================================================
// 49. left recursion detection with until
// ============================================================

test('left recursion: detected through until', () => {
  let threw = false;
  try { parse('a: a until including "x"\nmain: a'); } catch (e) { threw = true; }
  assert(threw, 'Left recursion through until should be detected');
});

// ============================================================
// 49. find() skips UTF-8 continuation bytes
// ============================================================

test('find: matches at codepoint boundaries in UTF-8', () => {
  const prog = parse('main: letter');
  const results = find(prog, 'a\u00e9b');
  assert(results.length === 2, `Expected 2 matches (a, b), got ${results.length}`);
  assert(results[0].text === 'a');
  assert(results[1].text === 'b');
});

test('find: finds multi-byte codepoints', () => {
  const prog = parse('main: any character');
  const results = find(prog, '\u00e9');
  assert(results.length === 1, `Expected 1 match, got ${results.length}`);
  assert(results[0].text === '\u00e9');
});

test('find: emoji codepoints found correctly', () => {
  const prog = parse('main: any character');
  const results = find(prog, 'a\ud83c\udf89b');
  assert(results.length === 3, `Expected 3 matches (a, emoji, b), got ${results.length}`);
  assert(results[0].text === 'a');
  assert(results[1].text === '\ud83c\udf89');
  assert(results[2].text === 'b');
});

// ============================================================
// 51. byte/codepoint mixing validation
// ============================================================

test('byte-codepoint: rejects any character with high byte range', () => {
  let threw = false;
  try { parse('main: any character then byte 0x80 to byte 0xFF'); } catch (e) {
    threw = true;
    assert(e.message.includes('mixes codepoint-aware'), `Unexpected error: ${e.message}`);
  }
  assert(threw, 'Should reject mixing any character with high byte range');
});

test('byte-codepoint: rejects none of with high byte literal', () => {
  let threw = false;
  try { parse('main: none of (comma) then byte 0xFF'); } catch (e) { threw = true; }
  assert(threw, 'Should reject mixing none of with high byte literal');
});

test('byte-codepoint: allows any character with ASCII byte range', () => {
  const r = run('main: any character then byte 0x20 to byte 0x7E', 'a!');
  assert(r.matched);
});

test('byte-codepoint: allows high byte range alone', () => {
  const r = run('main: byte 0x80 to byte 0xBF', '\xc0\x80');
  // just checking it parses without error — match result depends on input encoding
});

test('byte-codepoint: allows split across separate rules', () => {
  const r = run('raw: byte 0xC3 then byte 0xA9\nmain: raw', 'é');
  assert(r.matched);
});

test('byte-codepoint: rejects mixing in nested expressions', () => {
  let threw = false;
  try { parse('main: (one or more any characters) then (byte 0x80 to byte 0xFF)'); } catch (e) { threw = true; }
  assert(threw, 'Should reject mixing even in nested expressions within same rule');
});

// ============================================================
// 52. streaming search
// ============================================================

test('searchStream: yields matches line by line', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchStream } = require('./dist/cjs/search/search.js');
  const { Readable } = require('stream');

  const program = p('main: one or more digits');
  const input = 'hello\nport 8080\nno match\ncode 42 here\n';
  const stream = Readable.from([input]);

  const results = [];
  for await (const match of searchStream(program, stream)) {
    results.push(match);
  }

  assert(results.length === 2, `Expected 2 matching lines, got ${results.length}`);
  assert(results[0].line === 2, `Expected line 2, got ${results[0].line}`);
  assert(results[0].content === 'port 8080');
  assert(results[1].line === 4);
  assert(results[1].content === 'code 42 here');
});

test('searchStream: respects startLine and endLine', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchStream } = require('./dist/cjs/search/search.js');
  const { Readable } = require('stream');

  const program = p('main: one or more digits');
  const input = 'line1 99\nline2 88\nline3 77\nline4 66\nline5 55\n';
  const stream = Readable.from([input]);

  const results = [];
  for await (const match of searchStream(program, stream, { startLine: 2, endLine: 4 })) {
    results.push(match);
  }

  assert(results.length === 3, `Expected 3 matches (lines 2-4), got ${results.length}`);
  assert(results[0].line === 2);
  assert(results[2].line === 4);
});

test('searchStream: uses label option', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchStream } = require('./dist/cjs/search/search.js');
  const { Readable } = require('stream');

  const program = p('main: digit');
  const stream = Readable.from(['a1\n']);

  const results = [];
  for await (const match of searchStream(program, stream, { label: 'test.log' })) {
    results.push(match);
  }

  assert(results.length === 1);
  assert(results[0].file === 'test.log', `Expected label "test.log", got "${results[0].file}"`);
});

test('searchFileStream: reads file line by line', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchFileStream } = require('./dist/cjs/search/search.js');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tmpFile = path.join(os.tmpdir(), `match-test-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, 'hello world\nerror 404\nall good\nfail 500\n');

  try {
    const program = p('main: one or more digits');
    const results = [];
    for await (const match of searchFileStream(program, tmpFile)) {
      results.push(match);
    }

    assert(results.length === 2, `Expected 2 matching lines, got ${results.length}`);
    assert(results[0].line === 2);
    assert(results[0].matches[0].text === '404');
    assert(results[1].line === 4);
    assert(results[1].matches[0].text === '500');
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

test('searchFolderStream: yields matches across files', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchFolderStream } = require('./dist/cjs/search/search.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-sfs-'));
  fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello 123\nworld\n');
  fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'foo 456\nbar 789\n');

  try {
    const program = p('main: one or more digits');
    const results = [];
    for await (const item of searchFolderStream(program, tmpDir)) {
      results.push(item);
    }
    assert(results.length === 3, `Expected 3 matches, got ${results.length}`);
    assert(results.every(r => 'matches' in r), 'All results should be LineMatch');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('searchFolderStream: glob filtering', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchFolderStream } = require('./dist/cjs/search/search.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-sfs-glob-'));
  fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello 123\n');
  fs.writeFileSync(path.join(tmpDir, 'b.log'), 'world 456\n');

  try {
    const program = p('main: one or more digits');
    const results = [];
    for await (const item of searchFolderStream(program, tmpDir, { glob: '*.log' })) {
      results.push(item);
    }
    assert(results.length === 1, `Expected 1 match, got ${results.length}`);
    assert(results[0].content.includes('456'), 'Should match from .log file only');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('searchFolderStream: skips hidden and excluded dirs', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchFolderStream } = require('./dist/cjs/search/search.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-sfs-skip-'));
  fs.mkdirSync(path.join(tmpDir, '.hidden'));
  fs.writeFileSync(path.join(tmpDir, '.hidden', 'a.txt'), 'secret 111\n');
  fs.mkdirSync(path.join(tmpDir, 'node_modules'));
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'b.txt'), 'dep 222\n');
  fs.writeFileSync(path.join(tmpDir, 'c.txt'), 'visible 333\n');

  try {
    const program = p('main: one or more digits');
    const results = [];
    for await (const item of searchFolderStream(program, tmpDir)) {
      results.push(item);
    }
    assert(results.length === 1, `Expected 1 match, got ${results.length}`);
    assert(results[0].content.includes('333'), 'Should only find visible file');
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('searchFolderStream: recurses into subdirectories', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchFolderStream } = require('./dist/cjs/search/search.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-sfs-recurse-'));
  fs.writeFileSync(path.join(tmpDir, 'top.txt'), 'num 100\n');
  fs.mkdirSync(path.join(tmpDir, 'sub'));
  fs.writeFileSync(path.join(tmpDir, 'sub', 'deep.txt'), 'num 200\n');

  try {
    const program = p('main: one or more digits');
    const results = [];
    for await (const item of searchFolderStream(program, tmpDir)) {
      results.push(item);
    }
    assert(results.length === 2, `Expected 2 matches, got ${results.length}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

test('searchFolderStream: skips binary files', async () => {
  const { parse: p } = require('./dist/cjs/index.js');
  const { searchFolderStream } = require('./dist/cjs/search/search.js');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'match-sfs-bin-'));
  fs.writeFileSync(path.join(tmpDir, 'text.txt'), 'num 123\n');
  fs.writeFileSync(path.join(tmpDir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x31, 0x32, 0x33]));

  try {
    const program = p('main: one or more digits');
    const results = [];
    for await (const item of searchFolderStream(program, tmpDir)) {
      results.push(item);
    }
    assert(results.length === 1, `Expected 1 match, got ${results.length}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true });
  }
});

// ============================================================
// Grammar modularity (use)
// ============================================================

test('use: basic import resolves rules from module', () => {
  const emailModule = `
local: one or more letters
domain: one or more letters joined by period
  `;

  const result = run(`
use "email" (local, domain)
main: local then at then domain
  `, 'alice@foo.bar', { resolve: { email: emailModule } });

  assert(result.matched === true, 'Should match');
});

test('use: imported rule dependencies are auto-resolved', () => {
  const httpModule = `
scheme: "http" then optional "s"
authority: one or more of (letter, digit, period, hyphen)
url: scheme then "://" then authority
  `;

  const result = run(`
use "http" (url)
main: url
  `, 'https://example.com', { resolve: { http: httpModule } });

  assert(result.matched === true, 'Should match — scheme and authority should be auto-imported');
});

test('use: missing module throws', () => {
  let threw = false;
  try {
    run(`
use "missing" (foo)
main: foo
    `, 'test');
  } catch (e) {
    threw = true;
    assert(e.message.includes('Cannot resolve module'), `Expected resolve error, got: ${e.message}`);
  }
  assert(threw, 'Should have thrown');
});

test('use: missing rule in module throws', () => {
  let threw = false;
  try {
    run(`
use "mod" (nonexistent)
main: nonexistent
    `, 'test', { resolve: { mod: 'foo: one or more letters' } });
  } catch (e) {
    threw = true;
    assert(e.message.includes('has no rule'), `Expected missing rule error, got: ${e.message}`);
  }
  assert(threw, 'Should have thrown');
});

test('use: duplicate import from same module is deduplicated', () => {
  const mod = `
num: one or more digits
  `;

  const result = run(`
use "mod" (num, num)
main: num
  `, '42', { resolve: { mod } });

  assert(result.matched === true, 'Should match');
});

test('use: multiple modules', () => {
  const letters = 'word: one or more letters';
  const numbers = 'num: one or more digits';

  const result = run(`
use "letters" (word)
use "numbers" (num)
main: word then equals then num
  `, 'age=25', { resolve: { letters, numbers } });

  assert(result.matched === true, 'Should match with rules from two modules');
});

test('use: local rules override imported for entry point', () => {
  const mod = 'greeting: "hello"';

  const result = run(`
use "mod" (greeting)
main: greeting then space then one or more letters
  `, 'hello world', { resolve: { mod } });

  assert(result.matched === true, 'Entry point should be local main');
});

test('use: multi-word rule names in imports', () => {
  const mod = 'hex pair: hex digit then hex digit';
  const src = 'use "mod" (hex pair)\nmain: hex pair';

  const result = run(src, 'ff', { resolve: { mod } });

  assert(result.matched === true, 'Should resolve multi-word imported rule');
});

test('use: no resolve map with use statement throws', () => {
  let threw = false;
  try {
    run(`
use "something" (foo)
main: foo
    `, 'test');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Should throw when resolve map is missing');
});

test('use: grammar without use statements still works with options', () => {
  const result = run('main: one or more digits', '123', { resolve: {} });
  assert(result.matched === true, 'Should work normally');
});

// ============================================================
// Report
// ============================================================

console.log(`\n${'='.repeat(60)}`);
console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(60)}`);

if (errors.length > 0) {
  console.log('\nFailed tests:');
  for (const { name, error } of errors) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
