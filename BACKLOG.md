# Backlog

## [x] Docs

Completed. Full docs site at matchlang.com/docs with 30 pages: getting started, language reference, API reference, examples, CLI.

## [x] match_ai — AI skill files

Completed. Two markdown skill files in `match_ai/`:

- **match_skill.md** — teaches any AI to write Match grammars instead of regex. Complete language reference, API docs, examples, common patterns table.
- **matchmaker_skill.md** — teaches an AI to create, organize, and maintain codebase-specific grammars. Creates/manages `/match/custom_matches.md` with quick-match table.

## [x] Matchmaker playground

Completed. Live at matchlang.com/playground.

- Left pane: grammar editor
- Right pane: test input with live match results
- Parse tree visualization, extracted values tab, find-all tab
- Failure diagnostics with partial tree display
- 10 example grammars to load (key-value, date, CSV, email, hex color, JSON string, IP, semver, URL path, log line)

## [x] Syntax v2 — prefix repetition, quoted strings, plurals

Completed. Major language revision:

- Prefix repetition: `one or more digits`, `4 digits`, `between 2 and 10 letters`
- Infix repetition: `one digit or more`
- Postfix repetition removed
- `"hello"` as text block syntax
- Plural class names: `digits`, `letters`, `hex digits`, `any characters`, etc.
- `one or more of (...)` shorthand for repeated `any of`
- `one or more characters except (...)` shorthand for repeated `none of`
- `extract` accepts prefix repetition directly: `extract one or more digits`
- All 333 tests updated and passing

## [x] Comma shorthand for sequences

Completed. Commas work as shorthand for `then` outside parentheses. `then` is preferred for clarity, commas for brevity. Inside parens (e.g. `any of (a, b)`), commas remain set separators.

## Grammar modularity

No grammar imports or first-class composition. All rules live in one string. For large grammars this becomes unwieldy. Potential approaches:

- `import` / `include` syntax
- Programmatic composition already works (concatenate rule strings before `parse`), but not first-class

## Streaming folder search

`searchFolder` still buffers all results. Would need async `walkDir` to yield file-by-file results as a stream. Lower priority since individual file streaming already works via `searchFileStream`.
