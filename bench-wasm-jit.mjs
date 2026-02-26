import { parse, compile } from './dist/esm/index.js';
import { wasmFastMatch, wasmFastMatchString } from './dist/esm/executor/wasm.js';
import { fastMatch } from './dist/esm/executor/fast.js';
import { jitMatch } from './dist/esm/executor/wasm-jit.js';

const enc = new TextEncoder();

const benchmarks = [
  // ══════════════════════════════════════════════════════════════════
  // Category 1: Single character classes
  // ══════════════════════════════════════════════════════════════════
  { name: 'digit (1 char)', grammar: 'main: digit', input: '5', regex: /^\d$/ },
  { name: 'letter (1 char)', grammar: 'main: letter', input: 'a', regex: /^[a-zA-Z]$/ },
  { name: 'hex digit (1 char)', grammar: 'main: hex digit', input: 'f', regex: /^[0-9a-fA-F]$/ },
  { name: 'whitespace (1 char)', grammar: 'main: whitespace', input: ' ', regex: /^[\s]$/ },
  { name: 'word character (1 char)', grammar: 'main: word character', input: '_', regex: /^\w$/ },
  { name: 'uppercase (1 char)', grammar: 'main: uppercase', input: 'Z', regex: /^[A-Z]$/ },
  { name: 'lowercase (1 char)', grammar: 'main: lowercase', input: 'z', regex: /^[a-z]$/ },
  { name: 'alphanumeric (1 char)', grammar: 'main: alphanumeric', input: '9', regex: /^[a-zA-Z0-9]$/ },
  { name: 'printable (1 char)', grammar: 'main: printable', input: '~', regex: /^[\x20-\x7E]$/ },
  { name: 'visible (1 char)', grammar: 'main: visible', input: '!', regex: /^[\x21-\x7E]$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 2: Quoted literals — various lengths
  // ══════════════════════════════════════════════════════════════════
  { name: 'literal 1 char', grammar: 'main: "x"', input: 'x', regex: /^x$/ },
  { name: 'literal 3 chars', grammar: 'main: "foo"', input: 'foo', regex: /^foo$/ },
  { name: 'literal 5 chars', grammar: 'main: "hello"', input: 'hello', regex: /^hello$/ },
  { name: 'literal 10 chars', grammar: 'main: "helloworld"', input: 'helloworld', regex: /^helloworld$/ },
  { name: 'literal 20 chars', grammar: 'main: "abcdefghijklmnopqrst"', input: 'abcdefghijklmnopqrst', regex: /^abcdefghijklmnopqrst$/ },
  { name: 'literal 50 chars', grammar: `main: "${'a'.repeat(50)}"`, input: 'a'.repeat(50), regex: new RegExp(`^${'a'.repeat(50)}$`) },

  // ══════════════════════════════════════════════════════════════════
  // Category 3: Repetition — one or more (scaling input sizes)
  // ══════════════════════════════════════════════════════════════════
  { name: '1+ digits (5)', grammar: 'main: one or more digits', input: '12345', regex: /^\d+$/ },
  { name: '1+ digits (10)', grammar: 'main: one or more digits', input: '1234567890', regex: /^\d+$/ },
  { name: '1+ digits (20)', grammar: 'main: one or more digits', input: '1'.repeat(20), regex: /^\d+$/ },
  { name: '1+ digits (50)', grammar: 'main: one or more digits', input: '1'.repeat(50), regex: /^\d+$/ },
  { name: '1+ digits (100)', grammar: 'main: one or more digits', input: '1'.repeat(100), regex: /^\d+$/ },
  { name: '1+ digits (500)', grammar: 'main: one or more digits', input: '1'.repeat(500), regex: /^\d+$/ },
  { name: '1+ digits (1000)', grammar: 'main: one or more digits', input: '1'.repeat(1000), regex: /^\d+$/ },
  { name: '1+ digits (5000)', grammar: 'main: one or more digits', input: '1'.repeat(5000), regex: /^\d+$/ },

  { name: '1+ letters (5)', grammar: 'main: one or more letters', input: 'abcde', regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (10)', grammar: 'main: one or more letters', input: 'abcdefghij', regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (20)', grammar: 'main: one or more letters', input: 'a'.repeat(20), regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (50)', grammar: 'main: one or more letters', input: 'a'.repeat(50), regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (100)', grammar: 'main: one or more letters', input: 'a'.repeat(100), regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (500)', grammar: 'main: one or more letters', input: 'a'.repeat(500), regex: /^[a-zA-Z]+$/ },
  { name: '1+ letters (5000)', grammar: 'main: one or more letters', input: 'a'.repeat(5000), regex: /^[a-zA-Z]+$/ },

  { name: '1+ word chars (10)', grammar: 'main: one or more word characters', input: 'abc_123_XY', regex: /^\w+$/ },
  { name: '1+ word chars (50)', grammar: 'main: one or more word characters', input: 'abc_123_'.repeat(7).slice(0, 50), regex: /^\w+$/ },
  { name: '1+ word chars (100)', grammar: 'main: one or more word characters', input: 'abc_123_'.repeat(13).slice(0, 100), regex: /^\w+$/ },
  { name: '1+ word chars (500)', grammar: 'main: one or more word characters', input: 'abc_123_'.repeat(63).slice(0, 500), regex: /^\w+$/ },
  { name: '1+ word chars (5000)', grammar: 'main: one or more word characters', input: 'abc_123_'.repeat(625), regex: /^\w+$/ },

  { name: '1+ hex digits (10)', grammar: 'main: one or more hex digits', input: 'deadbeef01', regex: /^[0-9a-fA-F]+$/ },
  { name: '1+ hex digits (50)', grammar: 'main: one or more hex digits', input: 'deadbeef'.repeat(7).slice(0, 50), regex: /^[0-9a-fA-F]+$/ },
  { name: '1+ hex digits (100)', grammar: 'main: one or more hex digits', input: 'deadbeef'.repeat(13).slice(0, 100), regex: /^[0-9a-fA-F]+$/ },
  { name: '1+ hex digits (500)', grammar: 'main: one or more hex digits', input: 'deadbeef'.repeat(63).slice(0, 500), regex: /^[0-9a-fA-F]+$/ },

  { name: '1+ alphanumeric (50)', grammar: 'main: one or more alphanumerics', input: 'abc123'.repeat(9).slice(0, 50), regex: /^[a-zA-Z0-9]+$/ },
  { name: '1+ alphanumeric (500)', grammar: 'main: one or more alphanumerics', input: 'abc123'.repeat(84).slice(0, 500), regex: /^[a-zA-Z0-9]+$/ },

  { name: '1+ uppercase (50)', grammar: 'main: one or more uppercase', input: 'ABCDEFGHIJ'.repeat(5), regex: /^[A-Z]+$/ },
  { name: '1+ uppercase (500)', grammar: 'main: one or more uppercase', input: 'ABCDEFGHIJ'.repeat(50), regex: /^[A-Z]+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 4: Repetition — zero or more
  // ══════════════════════════════════════════════════════════════════
  { name: '0+ digits (empty)', grammar: 'main: zero or more digits', input: '', regex: /^\d*$/ },
  { name: '0+ digits (1)', grammar: 'main: zero or more digits', input: '5', regex: /^\d*$/ },
  { name: '0+ digits (50)', grammar: 'main: zero or more digits', input: '9'.repeat(50), regex: /^\d*$/ },
  { name: '0+ digits (500)', grammar: 'main: zero or more digits', input: '9'.repeat(500), regex: /^\d*$/ },
  { name: '0+ letters (empty)', grammar: 'main: zero or more letters', input: '', regex: /^[a-zA-Z]*$/ },
  { name: '0+ letters (500)', grammar: 'main: zero or more letters', input: 'z'.repeat(500), regex: /^[a-zA-Z]*$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 5: Exact repetition — various counts
  // ══════════════════════════════════════════════════════════════════
  { name: '1 digit', grammar: 'main: 1 digit', input: '7', regex: /^\d{1}$/ },
  { name: '2 digits', grammar: 'main: 2 digits', input: '42', regex: /^\d{2}$/ },
  { name: '4 digits', grammar: 'main: 4 digits', input: '2025', regex: /^\d{4}$/ },
  { name: '8 digits', grammar: 'main: 8 digits', input: '20250225', regex: /^\d{8}$/ },
  { name: '10 digits', grammar: 'main: 10 digits', input: '1234567890', regex: /^\d{10}$/ },
  { name: '20 digits', grammar: 'main: 20 digits', input: '1'.repeat(20), regex: /^\d{20}$/ },
  { name: '50 digits', grammar: 'main: 50 digits', input: '5'.repeat(50), regex: /^\d{50}$/ },
  { name: '100 digits', grammar: 'main: 100 digits', input: '5'.repeat(100), regex: /^\d{100}$/ },
  { name: '2 hex digits', grammar: 'main: 2 hex digits', input: 'FF', regex: /^[0-9a-fA-F]{2}$/ },
  { name: '6 hex digits', grammar: 'main: 6 hex digits', input: 'FF00AA', regex: /^[0-9a-fA-F]{6}$/ },
  { name: '32 hex digits', grammar: 'main: 32 hex digits', input: 'a'.repeat(32), regex: /^[0-9a-fA-F]{32}$/ },
  { name: '3 letters', grammar: 'main: 3 letters', input: 'abc', regex: /^[a-zA-Z]{3}$/ },
  { name: '10 letters', grammar: 'main: 10 letters', input: 'abcdefghij', regex: /^[a-zA-Z]{10}$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 6: Between repetition — various ranges
  // ══════════════════════════════════════════════════════════════════
  { name: 'between 1-3 digits (1)', grammar: 'main: between 1 and 3 digits', input: '4', regex: /^\d{1,3}$/ },
  { name: 'between 1-3 digits (2)', grammar: 'main: between 1 and 3 digits', input: '42', regex: /^\d{1,3}$/ },
  { name: 'between 1-3 digits (3)', grammar: 'main: between 1 and 3 digits', input: '420', regex: /^\d{1,3}$/ },
  { name: 'between 2-10 letters (2)', grammar: 'main: between 2 and 10 letters', input: 'ab', regex: /^[a-zA-Z]{2,10}$/ },
  { name: 'between 2-10 letters (7)', grammar: 'main: between 2 and 10 letters', input: 'abcdefg', regex: /^[a-zA-Z]{2,10}$/ },
  { name: 'between 2-10 letters (10)', grammar: 'main: between 2 and 10 letters', input: 'abcdefghij', regex: /^[a-zA-Z]{2,10}$/ },
  { name: 'between 1-255 digits (1)', grammar: 'main: between 1 and 255 digits', input: '7', regex: /^\d{1,255}$/ },
  { name: 'between 1-255 digits (50)', grammar: 'main: between 1 and 255 digits', input: '7'.repeat(50), regex: /^\d{1,255}$/ },
  { name: 'between 1-255 digits (100)', grammar: 'main: between 1 and 255 digits', input: '7'.repeat(100), regex: /^\d{1,255}$/ },
  { name: 'between 1-255 digits (255)', grammar: 'main: between 1 and 255 digits', input: '7'.repeat(255), regex: /^\d{1,255}$/ },
  { name: 'between 5-20 hex (10)', grammar: 'main: between 5 and 20 hex digits', input: 'deadbeef01', regex: /^[0-9a-fA-F]{5,20}$/ },
  { name: 'between 1-100 letters (50)', grammar: 'main: between 1 and 100 letters', input: 'x'.repeat(50), regex: /^[a-zA-Z]{1,100}$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 7: Optional
  // ══════════════════════════════════════════════════════════════════
  { name: 'optional digit (empty)', grammar: 'main: optional digit', input: '', regex: /^\d?$/ },
  { name: 'optional digit (present)', grammar: 'main: optional digit', input: '5', regex: /^\d?$/ },
  { name: 'optional letter (empty)', grammar: 'main: optional letter', input: '', regex: /^[a-zA-Z]?$/ },
  { name: 'optional letter (present)', grammar: 'main: optional letter', input: 'a', regex: /^[a-zA-Z]?$/ },
  { name: 'optional "0x" (empty)', grammar: 'main: optional "0x"', input: '', regex: /^(0x)?$/ },
  { name: 'optional "0x" (present)', grammar: 'main: optional "0x"', input: '0x', regex: /^(0x)?$/ },
  { name: 'optional prefix+body', grammar: 'main: optional "0x" then one or more hex digits', input: '0xDEADBEEF', regex: /^(0x)?[0-9a-fA-F]+$/ },
  { name: 'optional prefix absent', grammar: 'main: optional "0x" then one or more hex digits', input: 'DEADBEEF', regex: /^(0x)?[0-9a-fA-F]+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 8: Sequences — various step counts
  // ══════════════════════════════════════════════════════════════════
  { name: 'letter then digit', grammar: 'main: letter then digit', input: 'a1', regex: /^[a-zA-Z]\d$/ },
  { name: '2 seq steps: digit "." digit', grammar: 'main: digit then "." then digit', input: '1.2', regex: /^\d\.\d$/ },
  { name: '3 seq steps: d-d-d', grammar: 'main: digit then "-" then digit then "-" then digit', input: '1-2-3', regex: /^\d-\d-\d$/ },
  { name: 'date YYYY-MM-DD', grammar: 'main: 4 digits then "-" then 2 digits then "-" then 2 digits', input: '2025-02-25', regex: /^\d{4}-\d{2}-\d{2}$/ },
  { name: 'time HH:MM:SS', grammar: 'main: 2 digits then ":" then 2 digits then ":" then 2 digits', input: '14:30:59', regex: /^\d{2}:\d{2}:\d{2}$/ },
  { name: 'datetime', grammar: 'main: 4 digits then "-" then 2 digits then "-" then 2 digits then " " then 2 digits then ":" then 2 digits then ":" then 2 digits', input: '2025-02-25 14:30:59', regex: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ },
  { name: 'hex color #RRGGBB', grammar: 'main: "#" then 6 hex digits', input: '#FF00AA', regex: /^#[0-9a-fA-F]{6}$/ },
  { name: 'literal+repeat "hello"+digits', grammar: 'main: "hello" then one or more digits', input: 'hello123456', regex: /^hello\d+$/ },
  { name: 'literal+repeat+literal', grammar: 'main: "start" then one or more digits then "end"', input: 'start12345end', regex: /^start\d+end$/ },
  { name: 'long seq: proto+host+path', grammar: 'main: "https://" then one or more letters then "." then one or more letters then "/" then one or more letters', input: 'https://example.com/path', regex: /^https:\/\/[a-zA-Z]+\.[a-zA-Z]+\/[a-zA-Z]+$/ },
  { name: 'long seq: 5 parts', grammar: 'main: one or more letters then ":" then one or more digits then ":" then one or more letters then ":" then one or more digits then ":" then one or more letters', input: 'abc:123:def:456:ghi', regex: /^[a-zA-Z]+:\d+:[a-zA-Z]+:\d+:[a-zA-Z]+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 9: Alternatives
  // ══════════════════════════════════════════════════════════════════
  { name: 'letter or digit', grammar: 'main: letter or digit', input: '7', regex: /^[a-zA-Z0-9]$/ },
  { name: '2 alternatives', grammar: 'main: "yes" or "no"', input: 'no', regex: /^(yes|no)$/ },
  { name: '3 alternatives', grammar: 'main: "foo" or "bar" or "baz"', input: 'baz', regex: /^(foo|bar|baz)$/ },
  { name: '4 alternatives', grammar: 'main: "foo" or "bar" or "baz" or "qux"', input: 'qux', regex: /^(foo|bar|baz|qux)$/ },
  { name: '6 alternatives', grammar: 'main: "GET" or "POST" or "PUT" or "DELETE" or "PATCH" or "HEAD"', input: 'DELETE', regex: /^(GET|POST|PUT|DELETE|PATCH|HEAD)$/ },
  { name: 'any of (letter,digit)', grammar: 'main: any of (letter, digit)', input: 'a', regex: /^[a-zA-Z0-9]$/ },
  { name: 'any of (letter,digit,"-","_",".")', grammar: 'main: one or more of (letter, digit, "-", "_", ".")', input: 'hello-world_v1.0', regex: /^[a-zA-Z0-9\-_.]+$/ },
  { name: 'any of 3 classes (50)', grammar: 'main: one or more of (letter, digit, "_")', input: 'abc_123_def_456_ghi'.repeat(3).slice(0, 50), regex: /^[a-zA-Z0-9_]+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 10: Joined by — various segment counts and separators
  // ══════════════════════════════════════════════════════════════════
  { name: 'digits joined "." (2 segs)', grammar: 'main: one or more digits joined by "."', input: '12.34', regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined "." (3 segs)', grammar: 'main: one or more digits joined by "."', input: '1.2.3', regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined "." (5 segs)', grammar: 'main: one or more digits joined by "."', input: '1.2.3.4.5', regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined "." (10 segs)', grammar: 'main: one or more digits joined by "."', input: Array.from({length: 10}, (_, i) => i).join('.'), regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined "." (20 segs)', grammar: 'main: one or more digits joined by "."', input: Array.from({length: 20}, (_, i) => i).join('.'), regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined "." (50 segs)', grammar: 'main: one or more digits joined by "."', input: Array.from({length: 50}, (_, i) => i % 10).join('.'), regex: /^\d+(\.\d+)*$/ },
  { name: 'digits joined "," (5 segs)', grammar: 'main: one or more digits joined by ","', input: '1,2,3,4,5', regex: /^\d+(,\d+)*$/ },
  { name: 'digits joined "," (50 segs)', grammar: 'main: one or more digits joined by ","', input: Array.from({length: 50}, (_, i) => i % 10).join(','), regex: /^\d+(,\d+)*$/ },
  { name: 'words joined ","', grammar: 'main: one or more letters joined by ","', input: 'foo,bar,baz,qux,quux', regex: /^[a-zA-Z]+(,[a-zA-Z]+)*$/ },
  { name: 'words joined ", " (long)', grammar: 'main: one or more letters joined by ", "', input: Array.from({length: 50}, () => 'word').join(', '), regex: /^[a-zA-Z]+(, [a-zA-Z]+)*$/ },
  { name: 'words joined " | "', grammar: 'main: one or more letters joined by " | "', input: Array.from({length: 10}, () => 'item').join(' | '), regex: /^[a-zA-Z]+( \| [a-zA-Z]+)*$/ },
  { name: 'long segments joined ";"', grammar: 'main: one or more alphanumerics joined by ";"', input: Array.from({length: 10}, () => 'abc123def456').join(';'), regex: /^[a-zA-Z0-9]+(;[a-zA-Z0-9]+)*$/ },
  { name: 'exactly-2 joined ":" (6 segs)', grammar: 'pair: 2 hex digits\nmain: pair joined by ":"', input: '00:1A:2B:3C:4D:5E', regex: /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2})*$/ },
  { name: 'between 1-3 joined "." (4)', grammar: 'octet: between 1 and 3 digits\nmain: octet joined by "."', input: '192.168.1.1', regex: /^\d{1,3}(\.\d{1,3})*$/ },
  { name: 'between 1-3 joined "." (8)', grammar: 'octet: between 1 and 3 digits\nmain: octet joined by "."', input: '10.20.30.40.50.60.70.80', regex: /^\d{1,3}(\.\d{1,3})*$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 11: Real-world patterns
  // ══════════════════════════════════════════════════════════════════
  { name: 'IPv4 address', grammar: 'octet: between 1 and 3 digits\nmain: octet joined by "."', input: '192.168.1.1', regex: /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/ },
  { name: 'email-like (short)', grammar: 'local: one or more of (letter, digit, ".", "-", "_")\ndomain: one or more of (letter, digit, "-")\nmain: local then "@" then domain then "." then domain', input: 'a@b.c', regex: /^[a-zA-Z0-9._-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+$/ },
  { name: 'email-like (typical)', grammar: 'local: one or more of (letter, digit, ".", "-", "_")\ndomain: one or more of (letter, digit, "-")\nmain: local then "@" then domain then "." then domain', input: 'user.name@example.com', regex: /^[a-zA-Z0-9._-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+$/ },
  { name: 'email-like (long)', grammar: 'local: one or more of (letter, digit, ".", "-", "_")\ndomain: one or more of (letter, digit, "-")\nmain: local then "@" then domain then "." then domain', input: 'very.long.local.part@subdomain-host.example', regex: /^[a-zA-Z0-9._-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+$/ },
  { name: 'key=value pairs (3)', grammar: 'key: one or more of (letter, digit)\nval: one or more of (letter, digit)\npair: key then "=" then val\nmain: pair joined by "&"', input: 'foo=bar&baz=123&key=value', regex: /^[a-zA-Z0-9]+=[a-zA-Z0-9]+(&[a-zA-Z0-9]+=[a-zA-Z0-9]+)*$/ },
  { name: 'key=value pairs (10)', grammar: 'key: one or more of (letter, digit)\nval: one or more of (letter, digit)\npair: key then "=" then val\nmain: pair joined by "&"', input: Array.from({length: 10}, (_, i) => `k${i}=v${i}`).join('&'), regex: /^[a-zA-Z0-9]+=[a-zA-Z0-9]+(&[a-zA-Z0-9]+=[a-zA-Z0-9]+)*$/ },
  { name: 'semver', grammar: 'num: one or more digits\nmain: num then "." then num then "." then num', input: '1.23.456', regex: /^\d+\.\d+\.\d+$/ },
  { name: 'semver-pre', grammar: 'num: one or more digits\npre: one or more of (letter, digit, ".")\nmain: num then "." then num then "." then num then "-" then pre', input: '1.23.456-beta.1', regex: /^\d+\.\d+\.\d+-[a-zA-Z0-9.]+$/ },
  { name: 'CSS hex shorthand', grammar: 'main: "#" then 3 hex digits', input: '#F0A', regex: /^#[0-9a-fA-F]{3}$/ },
  { name: 'CSS hex full', grammar: 'main: "#" then 6 hex digits', input: '#FF00AA', regex: /^#[0-9a-fA-F]{6}$/ },
  { name: 'CSS hex color short/full', grammar: 'main: "#" then (6 hex digits or 3 hex digits)', input: '#FF00AA', regex: /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/ },
  { name: 'MAC address', grammar: 'pair: 2 hex digits\nmain: pair joined by ":"', input: '00:1A:2B:3C:4D:5E', regex: /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/ },
  { name: 'UUID', grammar: 'main: 8 hex digits then "-" then 4 hex digits then "-" then 4 hex digits then "-" then 4 hex digits then "-" then 12 hex digits', input: '550e8400-e29b-41d4-a716-446655440000', regex: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ },
  { name: 'phone US', grammar: 'main: "(" then 3 digits then ") " then 3 digits then "-" then 4 digits', input: '(415) 555-1234', regex: /^\(\d{3}\) \d{3}-\d{4}$/ },
  { name: 'credit card (16 digits)', grammar: 'group: 4 digits\nmain: group joined by " "', input: '4111 1111 1111 1111', regex: /^\d{4}( \d{4}){3}$/ },
  { name: 'content-type', grammar: 'main: one or more of (letter, digit, "-") then "/" then one or more of (letter, digit, "-", ".", "+")', input: 'application/json', regex: /^[a-zA-Z0-9-]+\/[a-zA-Z0-9\-.+]+$/ },
  { name: 'slug', grammar: 'main: one or more of (lowercase, digit, "-")', input: 'my-awesome-blog-post-123', regex: /^[a-z0-9-]+$/ },
  { name: 'base64 chars (100)', grammar: 'main: one or more of (letter, digit, "+", "/")', input: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/ABCDEFGHIJKLMNOPQRSTUVWXYZab', regex: /^[a-zA-Z0-9+/]+$/ },
  { name: 'csv row (10 fields)', grammar: 'field: one or more of (letter, digit, " ")\nmain: field joined by ","', input: Array.from({length: 10}, (_, i) => `field${i}`).join(','), regex: /^[a-zA-Z0-9 ]+(,[a-zA-Z0-9 ]+)*$/ },
  { name: 'path segments (5)', grammar: 'seg: one or more of (letter, digit, "-", "_")\nmain: seg joined by "/"', input: 'api/v2/users/profile/settings', regex: /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/ },
  { name: 'domain name', grammar: 'label: one or more of (letter, digit, "-")\nmain: label joined by "."', input: 'www.example.co.uk', regex: /^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*$/ },
  { name: 'HTTP header line', grammar: 'name: one or more of (letter, "-")\nmain: name then ": " then one or more of (letter, digit, " ", "/", ";", "=", ".", "-")', input: 'Content-Type: application/json; charset=utf-8', regex: /^[a-zA-Z-]+: [a-zA-Z0-9 /;=.\-]+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 12: Except/exclusion patterns
  // ══════════════════════════════════════════════════════════════════
  { name: 'letter except "q" (50)', grammar: 'main: one or more (letter except ("q"))', input: 'abcdefghijklmnop'.repeat(4).slice(0, 50), regex: /^[a-pA-Zr-z]+$/ },
  { name: 'letter except "q" (500)', grammar: 'main: one or more (letter except ("q"))', input: 'abcdefghijklmnop'.repeat(32).slice(0, 500), regex: /^[a-pA-Zr-z]+$/ },
  { name: 'digit except "0" (50)', grammar: 'main: one or more (digit except ("0"))', input: '123456789'.repeat(6).slice(0, 50), regex: /^[1-9]+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 13: Failure cases (no match — early bail, late bail)
  // ══════════════════════════════════════════════════════════════════
  { name: 'FAIL: digits on alpha (6)', grammar: 'main: one or more digits', input: 'abcdef', regex: /^\d+$/ },
  { name: 'FAIL: letters on digits (6)', grammar: 'main: one or more letters', input: '123456', regex: /^[a-zA-Z]+$/ },
  { name: 'FAIL: date bad sep', grammar: 'main: 4 digits then "-" then 2 digits then "-" then 2 digits', input: '2025/02/25', regex: /^\d{4}-\d{2}-\d{2}$/ },
  { name: 'FAIL: empty on 1+', grammar: 'main: one or more digits', input: '', regex: /^\d+$/ },
  { name: 'FAIL: early mismatch (1st byte)', grammar: 'main: 100 digits', input: 'x' + '1'.repeat(99), regex: /^\d{100}$/ },
  { name: 'FAIL: late mismatch (last byte)', grammar: 'main: 100 digits', input: '1'.repeat(99) + 'x', regex: /^\d{100}$/ },
  { name: 'FAIL: wrong literal', grammar: 'main: "hello"', input: 'world', regex: /^hello$/ },
  { name: 'FAIL: almost literal', grammar: 'main: "hello"', input: 'hellx', regex: /^hello$/ },
  { name: 'FAIL: too short for exact', grammar: 'main: 10 digits', input: '12345', regex: /^\d{10}$/ },
  { name: 'FAIL: too long for exact', grammar: 'main: 5 letters', input: '12345', regex: /^[a-zA-Z]{5}$/ },
  { name: 'FAIL: joined bad sep', grammar: 'main: one or more letters joined by "."', input: '1,2,3', regex: /^[a-zA-Z]+(\.[a-zA-Z]+)*$/ },
  { name: 'FAIL: UUID bad format', grammar: 'main: 8 hex digits then "-" then 4 hex digits then "-" then 4 hex digits then "-" then 4 hex digits then "-" then 12 hex digits', input: '550e8400-e29b-41d4-a716', regex: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 14: Stress tests — large inputs
  // ══════════════════════════════════════════════════════════════════
  { name: 'STRESS: 1+ digits (10k)', grammar: 'main: one or more digits', input: '7'.repeat(10000), regex: /^\d+$/ },
  { name: 'STRESS: 1+ digits (50k)', grammar: 'main: one or more digits', input: '7'.repeat(50000), regex: /^\d+$/ },
  { name: 'STRESS: 1+ digits (100k)', grammar: 'main: one or more digits', input: '7'.repeat(100000), regex: /^\d+$/ },
  { name: 'STRESS: 1+ digits (500k)', grammar: 'main: one or more digits', input: '7'.repeat(500000), regex: /^\d+$/ },
  { name: 'STRESS: 1+ digits (1M)', grammar: 'main: one or more digits', input: '7'.repeat(1000000), regex: /^\d+$/ },
  { name: 'STRESS: 1+ letters (10k)', grammar: 'main: one or more letters', input: 'abcdefghij'.repeat(1000), regex: /^[a-zA-Z]+$/ },
  { name: 'STRESS: 1+ letters (100k)', grammar: 'main: one or more letters', input: 'abcdefghij'.repeat(10000), regex: /^[a-zA-Z]+$/ },
  { name: 'STRESS: 1+ hex (100k)', grammar: 'main: one or more hex digits', input: 'deadbeef'.repeat(12500), regex: /^[0-9a-fA-F]+$/ },
  { name: 'STRESS: 1+ word (100k)', grammar: 'main: one or more word characters', input: 'hello_world_'.repeat(8333).slice(0, 100000), regex: /^\w+$/ },
  { name: 'STRESS: 1+ alphanumeric (100k)', grammar: 'main: one or more alphanumerics', input: 'abc123'.repeat(16667).slice(0, 100000), regex: /^[a-zA-Z0-9]+$/ },
  { name: 'STRESS: date repeated (1k)', grammar: 'main: one or more of (digit, "-")', input: '2025-02-25-'.repeat(1000).slice(0, -1), regex: /^[\d-]+$/ },
  { name: 'STRESS: date repeated (5k)', grammar: 'main: one or more of (digit, "-")', input: '2025-02-25-'.repeat(5000).slice(0, -1), regex: /^[\d-]+$/ },
  { name: 'STRESS: between 1-50000 digits (25k)', grammar: 'main: between 1 and 50000 digits', input: '3'.repeat(25000), regex: /^\d{1,50000}$/ },
  { name: 'STRESS: joined "," (100 segs)', grammar: 'main: one or more digits joined by ","', input: Array.from({length: 100}, (_, i) => i % 10).join(','), regex: /^\d+(,\d+)*$/ },
  { name: 'STRESS: joined "," (1k segs)', grammar: 'main: one or more digits joined by ","', input: Array.from({length: 1000}, (_, i) => i % 10).join(','), regex: /^\d+(,\d+)*$/ },
  { name: 'STRESS: joined "," (5k segs)', grammar: 'main: one or more digits joined by ","', input: Array.from({length: 5000}, (_, i) => i % 10).join(','), regex: /^\d+(,\d+)*$/ },
  { name: 'STRESS: joined "," (10k segs)', grammar: 'main: one or more digits joined by ","', input: Array.from({length: 10000}, (_, i) => i % 10).join(','), regex: /^\d+(,\d+)*$/ },
  { name: 'STRESS: MAC addr joined (100)', grammar: 'pair: 2 hex digits\nmain: pair joined by ":"', input: Array.from({length: 100}, () => 'AA').join(':'), regex: /^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2})*$/ },
  { name: 'STRESS: between 1-3 joined (100)', grammar: 'octet: between 1 and 3 digits\nmain: octet joined by "."', input: Array.from({length: 100}, () => '192').join('.'), regex: /^\d{1,3}(\.\d{1,3})*$/ },
  { name: 'STRESS: key=val joined (100)', grammar: 'key: one or more of (letter, digit)\nval: one or more of (letter, digit)\npair: key then "=" then val\nmain: pair joined by "&"', input: Array.from({length: 100}, (_, i) => `key${i}=val${i}`).join('&'), regex: /^[a-zA-Z0-9]+=[a-zA-Z0-9]+(&[a-zA-Z0-9]+=[a-zA-Z0-9]+)*$/ },
  { name: 'STRESS: path 50 segments', grammar: 'seg: one or more of (letter, digit, "-")\nmain: seg joined by "/"', input: Array.from({length: 50}, (_, i) => `seg-${i}`).join('/'), regex: /^[a-zA-Z0-9-]+(\/[a-zA-Z0-9-]+)*$/ },
  { name: 'STRESS: FAIL early (50k)', grammar: 'main: one or more digits', input: 'x' + '1'.repeat(49999), regex: /^\d+$/ },

  // ══════════════════════════════════════════════════════════════════
  // Category 15: Nested/complex grammar
  // ══════════════════════════════════════════════════════════════════
  { name: 'nested parens ()(())', grammar: 'nested: "(" then optional nested then ")"\nmain: one or more nested', input: '()(())', regex: /^(\((\(\))*\))+$/ },
  { name: 'mixed seq + alt + rep', grammar: 'main: one or more (letter or digit) then "-" then one or more digits', input: 'abc123-456', regex: /^[a-zA-Z0-9]+-\d+$/ },
  { name: 'complex: log line', grammar: 'ts: 4 digits then "-" then 2 digits then "-" then 2 digits\nlvl: "INFO" or "WARN" or "ERROR"\nmain: ts then " " then lvl then " " then one or more of (letter, digit, " ", ".", "-", "_", ":")', input: '2025-02-25 ERROR something went wrong: detail_info', regex: /^\d{4}-\d{2}-\d{2} (INFO|WARN|ERROR) [a-zA-Z0-9 .\-_:]+$/ },
  { name: 'complex: log line (long msg)', grammar: 'ts: 4 digits then "-" then 2 digits then "-" then 2 digits\nlvl: "INFO" or "WARN" or "ERROR"\nmain: ts then " " then lvl then " " then one or more of (letter, digit, " ", ".", "-", "_", ":")', input: '2025-02-25 INFO ' + 'processing request data for user '.repeat(10).trim(), regex: /^\d{4}-\d{2}-\d{2} (INFO|WARN|ERROR) [a-zA-Z0-9 .\-_:]+$/ },
  { name: 'multi-rule: address', grammar: 'num: one or more digits\nstreet: one or more of (letter, " ")\ncity: one or more letters\nstate: 2 uppercase\nzip: 5 digits\nmain: num then " " then street then ", " then city then ", " then state then " " then zip', input: '123 Main Street, Springfield, IL 62701', regex: /^\d+ [a-zA-Z ]+, [a-zA-Z]+, [A-Z]{2} \d{5}$/ },
  { name: 'multi-rule: URL path+query', grammar: 'seg: one or more of (letter, digit, "-")\npath: seg joined by "/"\nkey: one or more letters\nval: one or more of (letter, digit)\npair: key then "=" then val\nquery: pair joined by "&"\nmain: "/" then path then "?" then query', input: '/api/v2/users?page=1&limit=20&sort=name', regex: /^\/[a-zA-Z0-9-]+(\/[a-zA-Z0-9-]+)*\?[a-zA-Z]+=[a-zA-Z0-9]+(&[a-zA-Z]+=[a-zA-Z0-9]+)*$/ },
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

  const sR = wasmFastMatchString(cp, b.input);
  const sOk = sR >= 0;
  if (sOk !== reR) console.log(`  !! ${b.name}: string path mismatch matchStr=${sR} regex=${reR}`);

  const engine = bytes.length < 64 ? 'JS' : 'WASM';
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
console.log('Engine = JS (small input, <64 bytes) or WASM (large input)');
