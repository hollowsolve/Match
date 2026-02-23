# Match — Project Archive

**@architectonic/match v0.1.0**
Describe what you're looking for. Get a match, or don't.

A pattern matching language that replaces regular expressions. English-like PEG syntax, linear-time execution, zero backtracking, detailed failure diagnostics.

---

## What it does

Match compiles human-readable grammars into executable parsers. Instead of `[\x21\x23-\x5B]+`, you write `visible except (double quote, backslash) one or more`. Every rule is named, every failure explains itself, and ReDoS is structurally impossible.

```
token: letter one or more
param: token then equals then token
config: param joined by semicolon
```

That parses `key=value;mode=fast`. On success you get a labeled tree. On failure you get the byte offset, what was expected, what was found, and the full rule stack.

---

## Architecture

Classic compiler pipeline, four stages:

```
Source → Lexer → Tokens → Parser → AST → Validator → Program → Executor → Result
```

| Stage | File | Lines | Role |
|---|---|---|---|
| Lexer | `src/lexer/lexer.ts` | 439 | Tokenization with logical line joining, multi-word keywords, comment stripping, text block and byte literal support |
| Parser | `src/parser/parser.ts` | 446 | Recursive descent with operator precedence, forward references, range and set parsing |
| Validator | `src/validator/validator.ts` | 152 | Static analysis — duplicate rules, undefined references, invalid ranges, left recursion detection |
| Executor | `src/executor/executor.ts` | 507 | Memoized PEG engine operating on UTF-8 byte arrays, greedy semantics, full-input consumption, parse tree construction |

Supporting modules:

| Module | File | Lines | Role |
|---|---|---|---|
| Types | `src/types/` | 288 | AST nodes (18 variants), tokens (84 types), result union, error classes |
| Stdlib | `src/stdlib/stdlib.ts` | 94 | 25 named characters, 9 character classes, byte descriptions, keyword registry |
| Diagnostics | `src/diagnostics/formatter.ts` | 84 | Failure formatting with context lines, ASCII parse tree visualization |
| API | `src/index.ts` | 35 | `parse`, `match`, `run`, `formatFailure`, `formatTree` |

**Total: 2,045 lines of TypeScript. No runtime dependencies.**

---

## The language

Characters have names (`space`, `double quote`, `backslash`). No escape sequences exist.

| Construct | Example |
|---|---|
| Named character | `comma`, `newline`, `tab` |
| Quoted character | `"a"`, `"Z"`, `"7"` |
| Byte literal | `byte 0x80` |
| Character class | `letter`, `digit`, `hex digit`, `whitespace`, `visible`, `printable` |
| Range | `"a" to "z"`, `byte 0x80 to byte 0xFF` |
| Text block | `"http://"` |
| Set inclusion | `any of (letter, digit, underscore)` |
| Set exclusion | `none of (double quote, newline)` |
| Exception | `printable except (double quote, backslash)` |
| Sequence | `key then equals then value` |
| Alternation | `token or quoted value` |
| Repetition | `digit one or more`, `letter zero or more`, `prefix optional` |
| Separated list | `param joined by semicolon` |
| Grouping | `(digit then digit) one or more` |
| Rule definition | `email: user then at then domain` |
| Comments | `-- this is ignored` |
| Continuation | indent continues the previous line |

Last rule in the source is the entry point.

---

## Design decisions

**PEG over CFG.** Ordered choice (`or` tries left first, commits on success) eliminates ambiguity and guarantees linear-time parsing. No backtracking means no ReDoS.

**Packrat memoization.** The executor caches every rule result at every input position. Repeated attempts at the same position return instantly.

**Byte-level matching.** The executor operates on UTF-8 byte arrays, enabling precise control over binary protocols and multi-byte sequences via `byte 0xHH` literals and ranges.

**English syntax.** Every keyword is a word or phrase (`one or more`, `joined by`, `any of`). Multi-word rule names are supported. The lexer handles logical line joining so complex grammars stay readable.

**Rich failures.** A failed match reports: exact byte offset, line and column, expected items, found character, and the full rule call stack. The formatter renders context with a caret pointing at the failure.

**Static validation.** Before execution, the validator catches duplicate rules, undefined references, backwards ranges, and left recursion — errors that would otherwise surface as confusing runtime behavior.

---

## Test coverage

177 tests across 29 categories:

- Named characters, quoted literals, character classes, ranges
- Combinators: `then`, `or`, repetition, `any of`, `none of`, `joined by`, grouping
- Text blocks, rule definitions, forward references, multi-word rule names
- Parse tree structure verification
- `except` modifier, comments, continuation lines
- PEG semantics: greedy matching, ordered choice
- All validation error cases
- Diagnostic formatting
- Recursion and nesting
- Real-world grammars: IPv4, email, RFC 7239 Forwarded headers, HTML tags, CSS colors, CSV
- Edge cases and performance stress tests

---

## Public API

```ts
parse(source: string): MatchProgram
match(program: MatchProgram, input: string): MatchResult
run(source: string, input: string): MatchResult
formatFailure(failure: MatchFailure, input?: string): string
formatTree(tree: RuleMatch): string
```

Success returns a tree of `{ rule, start, end, text, children }`. Failure returns `{ offset, line, column, expected, found, rule_stack }`.

---

## Build

```
npm run build      # ESM + CJS dual output
npm run typecheck   # tsc --noEmit
npm test           # 177 tests via node test-suite.js
```

Dual-format package: ESM at `dist/esm/`, CJS at `dist/cjs/`. TypeScript declarations included. Published as `@architectonic/match` on npm.

---

## File tree

```
Match/
├── src/
│   ├── index.ts
│   ├── types/
│   │   ├── index.ts
│   │   ├── ast.ts
│   │   ├── error.ts
│   │   ├── result.ts
│   │   └── token.ts
│   ├── lexer/lexer.ts
│   ├── parser/parser.ts
│   ├── validator/validator.ts
│   ├── executor/executor.ts
│   ├── stdlib/stdlib.ts
│   └── diagnostics/formatter.ts
├── test-suite.js
├── package.json
├── tsconfig.json
├── tsconfig.esm.json
├── tsconfig.cjs.json
├── LICENSE
└── README.md
```

---

MIT License · hollowsolve · 2026
