# Match

A pattern matching language that replaces regular expressions. [Website](https://matchlang.com) · [Docs](https://matchlang.com/docs) · [Playground](https://matchlang.com/playground)

> MIT licensed. Free for any use.

## Install

**Node.js** (ESM and CommonJS, Node 18+):

```
npm install @hollowsolve/match
```

**Python** (via C FFI):

```bash
cd native/libmatch && cargo build --release
```

```python
from match_lang import load_bytecode
prog = load_bytecode('pattern.bin')
```

**C / Rust** (shared library):

```bash
cd native/libmatch && cargo build --release
# produces libmatch_ffi.dylib / .so / .dll
```

## Quick start

```js
import { run, formatTree, formatFailure } from '@hollowsolve/match'

const grammar = `
key: one or more letters
value: one or more digits
pair: key then equals then value
`

const ok = run(grammar, 'name=42')
console.log(formatTree(ok.tree))
// pair [0..7]
// ├── key [0..4] "name"
// └── value [5..7] "42"

const bad = run(grammar, 'name=abc')
console.log(formatFailure(bad))
// match failed at byte 5 (line 1, column 6):
//   expected: digit
//   found: "a" (0x61)
//   in: pair > value
```

Find all matches in a string:

```js
import { parse, find } from '@hollowsolve/match'

const program = parse('main: one or more digits')
find(program, 'port 8080 and port 443')
// [{ start: 5, end: 9, text: "8080" }, { start: 20, end: 23, text: "443" }]
```

High-performance scanning over large buffers:

```js
import { parse, scan, scanBytes } from '@hollowsolve/match'

const program = parse('main: one or more digits')

scan(program, 'port 8080 and port 443')
// [{ start: 5, end: 9, text: "8080" }, { start: 20, end: 23, text: "443" }]

const buf = fs.readFileSync('access.log')
scanBytes(program, buf)  // byte-level offsets, no string conversion
```

Compile once, match many:

```js
import { parse, match } from '@hollowsolve/match'

const program = parse('main: 4 digits then hyphen then 2 digits then hyphen then 2 digits')
match(program, '2025-01-15')  // matched
match(program, '25-1-5')      // failed
```

Batch matching:

```js
import { parse, matchMany } from '@hollowsolve/match'

const program = parse('main: one or more digits')
matchMany(program, ['42', 'abc', '7'])  // [true, false, true]
```

Export bytecode for cross-platform use:

```js
import { parse, exportBytecode } from '@hollowsolve/match'
import fs from 'fs'

const program = parse('main: one or more digits')
fs.writeFileSync('digits.bin', Buffer.from(exportBytecode(program)))
```

---

## The language

### Characters have names

No escape sequences. Anywhere. Ever.

```
semicolon    -- ;
double quote -- "
backslash    -- \
newline      -- line feed
space        -- space
dot          -- .
dash         -- -
bang         -- !
```

### Text blocks

Literal strings:

```
"hello world"
"http://"
"SELECT * FROM"
```

Single-character quoted strings (`"a"`, `"Z"`, `"7"`) match exactly that character and can be used in ranges.

To match strings containing literal double quotes, use the `double quote` named character:

```
-- matches: "hello"
main: double quote then "hello" then double quote

-- matches: she said "hi"
main: "she said " then double quote then "hi" then double quote
```

### Character sets

```
any of (letter, digit, underscore)
any of (printable except (double quote, backslash), tab)
none of (double quote, newline)
```

`any of` matches one character from the set. `none of` matches one character *not* in the set.

### Combining rules

```
key then equals then value        -- sequence
key, equals, value                -- comma shorthand (same thing)
token or quoted value             -- first match wins (PEG ordered choice)
param joined by semicolon         -- separated list
param joined by semicolon lenient -- trailing separator ok
```

### Repetition

Prefix form (preferred):

```
one or more digits
zero or more letters
4 digits
between 2 and 10 letters
optional hyphen
```

Infix form:

```
one digit or more
```

Shorthands for repeated sets:

```
one or more of (letter, digit, underscore)            -- repeated any of
one or more characters except (double quote, newline)  -- repeated none of
```

Plural class names work with repetition: `digits`, `letters`, `hex digits`, `alphanumerics`, `word characters`, `any characters`.

### Negation

```
any character isn't newline                       -- any char except newline
(printable isn't "—") one or more                 -- printable chars until —
digit isn't "0"                                   -- digit that isn't zero
```

### Consume until a terminator

`until` consumes input until a terminator pattern is found. The terminator can be any pattern.

```
any character until including newline                         -- consumes the newline
any character until excluding "END"                           -- stops before END
any character until including (digit then digit)              -- two consecutive digits
any character until excluding closing tag                     -- rule reference as terminator
```

**`until` vs `none of`:** `until` consumes a run of characters up to a boundary. `none of` matches a single character not in a set. Use `until` when your terminator is multi-character or a pattern. Use `none of` when you need a character-set negation.

### Extract

Tag rules with `extract` to pull matched text into `result.extracted`:

```
num: one or more digits
main: "value=" then extract num
-- result.extracted[0].text === "42"
```

`extract` accepts prefix repetition directly:

```
extract digit                         -- single atom
extract num                           -- rule reference
extract one or more digits            -- prefix repetition
extract (digit or letter)             -- parenthesized compound
```

Extracts are collected left-to-right in sequences, iteration order in loops. Failed `or` branches contribute nothing. Sub-rule extracts bubble up. `extracted[0]`, `extracted[1]` indexing is reliable.

### Rules

Rules name patterns. The last rule is the entry point.

```
field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline
```

Multi-word rule names are supported: `token char`, `quoted value`, `hex pair`.

Left recursion is detected at parse time and rejected.

### Modules

Import rules from other grammars with `use`:

```
use "email" (local, domain)

main: local then at then domain
```

The `use` statement imports named rules (and their dependencies) from a module. Modules are resolved at parse time via a `resolve` map:

```js
import { run } from '@hollowsolve/match'

const emailGrammar = `
local: one or more letters
domain: one or more letters joined by period
`

const result = run(`
use "email" (local, domain)
main: local then at then domain
`, 'alice@example.com', {
  resolve: { email: emailGrammar }
})
```

Dependencies are auto-resolved — if `local` references another rule in the module, it gets pulled in too. Grammars without `use` work exactly as before.

### Precedence

From tightest to loosest:

1. Repetition (`one or more`, `zero or more`, `optional`, `N`, `between N and M`)
2. `isn't`
3. `then` / `,` (sequence)
4. `joined by`
5. `or` (alternation)

So `a then b or c then d` means `(a then b) or (c then d)`.

`joined by` binds the element as a full sequence and the separator as a full sequence.

---

## API

All functions are named exports from `@hollowsolve/match`.

### Core

```ts
run(source: string, input: string): MatchResult
```

Parse a grammar and match it against input in one call. Returns `MatchSuccess` or `MatchFailure`.

```ts
parse(source: string): MatchProgram
match(program: MatchProgram, input: string): MatchResult
```

Separate compilation from matching. `parse` compiles and validates a grammar. `match` runs a compiled grammar against input. Use this when matching the same grammar against many inputs.

### Search

```ts
find(program: MatchProgram, input: string): FindMatch[]
```

Find all non-overlapping matches of a pattern within a string. Returns an array of `{ start, end, text, tree }`.

### Scan

```ts
scan(program: MatchProgram, input: string, options?: ScanOptions): ScanMatch[]
scanBytes(program: MatchProgram, input: Uint8Array, options?: ScanOptions): ByteScanMatch[]
```

WASM JIT + SIMD accelerated scanning. Finds all non-overlapping matches in a string or byte buffer. `scanBytes` operates on raw bytes with no string conversion — designed for large-input scanning (files, logs, network data).

`ScanMatch` returns `{ start, end, text }`. `ByteScanMatch` returns `{ start, end }` (byte offsets only).

Pass `{ tree: true }` to enrich each match with a full parse tree:

```js
const results = scan(program, input, { tree: true })
results[0].tree  // RuleMatch with children, offsets, etc.
```

### Batch matching

```ts
matchMany(program: MatchProgram, inputs: string[]): boolean[]
```

Match a compiled program against many inputs at once. Uses WASM JIT with shared memory for minimal overhead per input.

### Bytecode export

```ts
exportBytecode(program: MatchProgram): ArrayBuffer
```

Serialize a compiled program to a portable bytecode buffer. The bytecode can be loaded by the Python bindings, C FFI library, or any runtime that implements the Match VM.

### File search

```ts
searchFile(program: MatchProgram, path: string, options?: SearchOptions): SearchResult
searchFolder(program: MatchProgram, path: string, options?: SearchOptions): SearchResult
searchFolderStream(program: MatchProgram, path: string, options?: SearchOptions): AsyncGenerator<LineMatch | SearchError>
searchStream(program: MatchProgram, stream: Readable, options?: StreamSearchOptions): AsyncGenerator<LineMatch>
searchFileStream(program: MatchProgram, path: string, options?: StreamSearchOptions): AsyncGenerator<LineMatch>
```

Line-oriented search. `searchFolder` is recursive and skips binary files, hidden dirs, and `node_modules`. The `Stream` variants yield results as they walk instead of buffering — suitable for large directories and continuous input.

### Diagnostics

```ts
formatFailure(failure: MatchFailure, input?: string): string
formatTree(tree: RuleMatch): string
```

`formatFailure` produces a human-readable diagnostic with a source pointer. `formatTree` produces a tree visualization.

### Fast path

```ts
compile(program: MatchProgram): CompiledProgram
fastMatch(cp: CompiledProgram, input: Uint8Array): number
```

Boolean-only matching. Returns bytes consumed on success, `-1` on failure. Skips tree building entirely. Normally you don't need to call this directly — `parse()` attaches a compiled program automatically and `match()`/`scan()` use it.

### Partial parsing

```ts
tryParse(source: string, input: string): MatchSuccess | PartialResult
```

Like `run`, but on failure returns a `PartialResult` with `bytes_consumed`, `partial_tree`, and `extracted` from the furthest-progressed branch. Intended for editor/IDE integration.

---

## Results

### Success

```js
{
  matched: true,
  bytes_consumed: number,
  tree: RuleMatch,
  extracted: RuleMatch[]
}
```

The tree is a full parse tree. Every rule produces a node:

```js
{
  rule: string,      // rule name
  start: number,     // byte offset (inclusive)
  end: number,       // byte offset (exclusive)
  text: string,      // matched text
  children: RuleMatch[]
}
```

### Failure

```js
{
  matched: false,
  offset: number,      // byte offset where the failure occurred
  line: number,        // 1-based line number
  column: number,      // 1-based column number
  expected: string[],  // patterns the parser expected
  found: string,       // what was actually there
  rule_stack: string[] // rule call stack (outermost first)
}
```

`formatFailure(failure, input?)` renders this as a human-readable string with a source pointer:

```
match failed at byte 47 (line 3, column 12):
  expected: digit, hyphen, or end of input
  found: "x" (0x78)
  in: forwarded > element > param > value > token

  ...invalid=x;more
              ^
```

---

## CLI

```bash
npx match-search "pattern" in file path.log
npx match-search "pattern" in folder ./logs
npx match-search "pattern" in folder ./logs --glob "*.log"
npx match-search "pattern" in file app.log lines 100 to 200
cat server.log | npx match-search "pattern"
```

Respects `NO_COLOR`. Disables color automatically when piped.

---

## Characters reference

Every character has a name. No escape sequences exist.

**Symbols:**
`exclamation` (`bang`) `!` · `double quote` `"` · `hash` `#` · `dollar` `$` · `percent` `%` · `ampersand` `&` · `single quote` `'` · `open paren` `(` · `close paren` `)` · `asterisk` `*` · `plus` `+` · `comma` `,` · `hyphen` (`dash`) `-` · `period` (`dot`) `.` · `slash` `/` · `colon` `:` · `semicolon` `;` · `less than` `<` · `equals` `=` · `greater than` `>` · `question` `?` · `at` `@` · `open bracket` `[` · `backslash` `\` · `close bracket` `]` · `caret` `^` · `underscore` `_` · `backtick` `` ` `` · `open brace` `{` · `pipe` `|` · `close brace` `}` · `tilde` `~`

**Whitespace:** `space` · `tab` · `newline` · `carriage return`

**Other:** `null` · `byte 0xHH`

**Classes:** `letter` (`letters`) · `uppercase` · `lowercase` · `digit` (`digits`) · `hex digit` (`hex digits`) · `whitespace` · `visible` · `printable` · `alphanumeric` (`alphanumerics`) · `word character` (`word characters`) · `any character` (`any characters`)

**Quoted characters:** `"a"` `"Z"` `"7"` — for ranges: `"a" to "z"` · `"0" to "9"` · `byte 0x80 to byte 0xFF`

> **Unicode.** `any character` and `none of` consume one UTF-8 codepoint (1-4 bytes). `cafe` is 4 `any character` matches, not 5. All other classes (`letter`, `digit`, etc.) match ASCII bytes only.
>
> **Byte ranges.** `byte 0x80 to byte 0xFF` operates byte-by-byte. Mixing codepoint-aware constructs (`any character`, `none of`) with high byte ranges (>= 0x80) in the same rule is a compile error — split them into separate rules instead.

---

## Performance

Match uses a three-tier execution engine:

1. **JS JIT** — small inputs (<32 bytes). Generates optimized JavaScript with i32 word-comparison for literals.
2. **WASM JIT** — larger inputs (≥32 bytes). SIMD-accelerated matching with specialized joined-by and repeat handlers.
3. **WASM tree executor** — on the success path, a bytecode VM in WASM builds the parse tree directly, bypassing the JS recursive descent executor.

The engine tier is chosen automatically. The fast paths handle boolean matching; the tree executor reconstructs full `RuleMatch` trees from WASM memory events.

**Where Match is faster:** exact-count patterns (`4 digits`, `32 hex digits`), bounded ranges (`between 1 and 255 digits`), structured formats (UUID, credit card, date YYYY-MM-DD), large inputs (WASM SIMD processes 16 bytes/iteration), failure rejection (fast path returns immediately), and joined-by patterns (fused element+separator loops).

**Where regex is faster:** `\w` word characters (V8 has a native intrinsic), multi-step sequences with many small literals on short inputs, recursive/nested grammars, and first-byte failure on large WASM inputs (module instantiation overhead).

**Scanning** (`scan` / `scanBytes`): WASM JIT with SIMD lead-byte acceleration. Skips non-matching bytes in 16-byte chunks. Faster than regex for structured patterns at scale, especially patterns with distinctive lead bytes (dates with digits, emails with `@`).

Run it yourself: `node bench-wasm-jit.mjs` (matching) · `node bench-inputs.mjs` (scanning)

Full methodology and results: [matchlang.com/docs/api/benchmarks](https://matchlang.com/docs/api/benchmarks)

---

## Multi-language support

Match patterns compile to a portable bytecode format. The Node.js package compiles grammars and exports bytecode; other languages load the bytecode and run it natively.

### Python

```python
from match_lang import load_bytecode

prog = load_bytecode('email.bin')

prog.is_match('user@example.com')  # True
prog.exec('hello')                 # bytes consumed, or -1
prog.scan('Contact user@example.com or admin@test.org')
# [(6, 22, 'user@example.com'), (27, 41, 'admin@test.org')]

prog.scan_bytes(b'raw bytes here')  # [(start, end), ...]
prog.scan_count('count matches')    # int

prog.search_file('/path/to/file.log')
# {'matches': [{'file': '...', 'matches': [{'line': 1, 'col': 6, 'end_col': 22}]}], 'errors': 0}

prog.search_folder('/path/to/logs', glob='*.log')
# same format, recursive directory walk
```

Requires the native library: `cd native/libmatch && cargo build --release`. Set `MATCH_LIB_PATH` to override the search path.

### C FFI

```c
#include <stdint.h>

// Load bytecode
MatchProgram* match_program_from_bytecode(const uint8_t* bytecode, uint32_t len);
void match_program_free(MatchProgram* prog);

// Match
int32_t match_exec(const MatchProgram* prog, const uint8_t* input, uint32_t len);
int32_t match_is_match(const MatchProgram* prog, const uint8_t* input, uint32_t len);

// Scan
MatchScanResults* match_scan(const MatchProgram* prog, const uint8_t* input, uint32_t len);
void match_scan_results_free(MatchScanResults* results);

// File/folder search
MatchSearchResults* match_search_file(const MatchProgram* prog, const char* path);
MatchSearchResults* match_search_folder(const MatchProgram* prog, const char* path, const char* glob);
void match_search_results_free(MatchSearchResults* results);
```

Build: `cd native/libmatch && cargo build --release` produces `libmatch_ffi.dylib` / `.so` / `.dll`.

### Browser

The browser build (`matchlang/src/match-browser.ts`) supports the same API as Node.js for in-memory operations: `parse`, `match`, `run`, `find`, `scan`. The `scan` function uses WASM JIT with SIMD acceleration when the browser supports it, falling back to the JS interpreter.

File search is not available in browsers (no filesystem access).

---

## Stability

The following are stable public API as of v1.0:

- `MatchSuccess`, `MatchFailure`, `PartialResult`, `RuleMatch` — field names, types, and semantics
- `formatFailure` output format — structure and field layout
- All exported function signatures
- Bytecode format — programs exported with `exportBytecode` will remain loadable

These will not change in backward-incompatible ways without a major version bump.

---

## License

MIT License. See [LICENSE](./LICENSE).
