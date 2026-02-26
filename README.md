# Match

A pattern matching language that replaces regular expressions. [Website](https://matchlang.com) · [Docs](https://matchlang.com/docs) · [Playground](https://matchlang.com/playground)

> MIT licensed. Free for any use.

## Install

```
npm install @hollowsolve/match
```

ESM and CommonJS. Node 18+.

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

Compile once, match many:

```js
import { parse, match } from '@hollowsolve/match'

const program = parse('main: 4 digits then hyphen then 2 digits then hyphen then 2 digits')
match(program, '2025-01-15')  // matched
match(program, '25-1-5')      // failed
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

```ts
searchFile(program: MatchProgram, path: string, options?: SearchOptions): SearchResult
searchFolder(program: MatchProgram, path: string, options?: SearchOptions): SearchResult
searchFolderStream(program: MatchProgram, path: string, options?: SearchOptions): AsyncGenerator<LineMatch | SearchError>
```

Line-oriented search. `searchFolder` is recursive and skips binary files, hidden dirs, and `node_modules`. `searchFolderStream` yields results as it walks instead of buffering.

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

Boolean-only matching. Returns bytes consumed on success, `-1` on failure. Skips tree building entirely.

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

Across a 182-test benchmark suite against V8's `RegExp` engine: **Match wins 123, regex wins 41, 18 ties.** Highlights:

**Where Match wins:** exact-count patterns (e.g. `4 digits`: 0.57x), bounded ranges (`between 1 and 255 digits`: 0.34x), structured formats (UUID: 0.37x, credit card: 0.46x, date YYYY-MM-DD: 0.62x), large-input scanning (1M digits: 0.72x, joined lists: 0.65x), and failure rejection (late mismatch: 0.21x, too short: 0.33x).

**Where regex wins:** `\w` word characters (V8 has a native intrinsic: 1.3-1.6x), multi-step sequences with many small literals on short inputs (1.2-1.4x), recursive/nested grammars (10x+), and first-byte failure on large WASM inputs (WASM setup overhead).

Run it yourself: `node bench-wasm-jit.mjs`

Full methodology and results: [matchlang.com/docs/api/benchmarks](https://matchlang.com/docs/api/benchmarks)

---

## Stability

The following are stable public API as of v1.0:

- `MatchSuccess`, `MatchFailure`, `PartialResult`, `RuleMatch` — field names, types, and semantics
- `formatFailure` output format — structure and field layout
- All exported function signatures

These will not change in backward-incompatible ways without a major version bump.

---

## License

MIT License. See [LICENSE](./LICENSE).
