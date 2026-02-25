# Match Skill

You can write Match grammars instead of regular expressions. Match is a pattern matching language: readable, composable, PEG-based, no ReDoS. Every failure tells you exactly what went wrong.

## Install

```
npm install @hollowsolve/match
```

## Core API

```js
import { run, parse, match, find, compile, fastMatch, formatTree, formatFailure } from '@hollowsolve/match'

// one-shot
const result = run(grammar, input)

// compile once, match many
const program = parse(grammar)
match(program, input)

// find all matches in a string
find(program, input) // [{ start, end, text, tree }]

// fast boolean matching (no parse tree)
const cp = compile(program)
const encoder = new TextEncoder()
fastMatch(cp, encoder.encode(input)) // bytes consumed or -1
```

`run` and `match` return `{ matched: true, bytes_consumed, tree, extracted }` or `{ matched: false, offset, line, column, expected, found, rule_stack }`.

## Writing grammars

A grammar is a string of rules. Each rule names a pattern. The **last rule** is the entry point.

```
key: one or more letters
value: one or more digits
pair: key then equals then value
```

### Characters have names

No escape sequences. Ever.

| Name | Char | | Name | Char |
|---|---|---|---|---|
| exclamation (bang) | ! | | open bracket | [ |
| double quote | " | | backslash | \ |
| hash | # | | close bracket | ] |
| dollar | $ | | caret | ^ |
| percent | % | | underscore | _ |
| ampersand | & | | backtick | ` |
| single quote | ' | | open brace | { |
| open paren | ( | | pipe | \| |
| close paren | ) | | close brace | } |
| asterisk | * | | tilde | ~ |
| plus | + | | space | (0x20) |
| comma | , | | tab | (0x09) |
| hyphen (dash) | - | | newline | (0x0A) |
| period (dot) | . | | carriage return | (0x0D) |
| slash | / | | null | (0x00) |
| colon | : | | at | @ |
| semicolon | ; | | less than | < |
| equals | = | | greater than | > |
| question | ? | | byte 0xHH | any byte |

### Character classes

```
letter           -- a-z, A-Z
uppercase        -- A-Z
lowercase        -- a-z
digit            -- 0-9
hex digit        -- 0-9, a-f, A-F
whitespace       -- space, tab, newline, carriage return
visible          -- 0x21-0x7E (no space)
printable        -- 0x20-0x7E (visible + space)
alphanumeric     -- letter or digit
word character   -- letter, digit, underscore
any character    -- one UTF-8 codepoint (1-4 bytes)
```

Plural forms are accepted: `letters`, `digits`, `hex digits`, `any characters`, `word characters`, `alphanumerics`.

All classes except `any character` match ASCII only.

### Quoted characters and strings

Single character for ranges:
```
"a"  "Z"  "7"
"a" to "z"
"0" to "9"
```

Multi-character strings:
```
"http://"
"SELECT * FROM"
"ERROR"
```

### Combining patterns

```
a then b                           -- sequence
a, b                               -- comma shorthand for then
a or b                             -- first match wins (PEG ordered choice)
item joined by comma               -- separated list
item joined by comma lenient       -- trailing separator ok
```

### Repetition (prefix)

Repetition is prefix — it comes before the pattern:

```
one or more digits                 -- 1+
zero or more letters               -- 0+
optional space                     -- 0 or 1
4 digits                           -- exactly N
between 2 and 10 letters           -- N to M
```

For compound patterns, use parentheses:

```
one or more (letter then digit)
optional (plus or hyphen)
zero or more (escaped or str char)
```

Infix form is also valid: `one digit or more` = `one or more digits`.

### Sets

```
any of (letter, digit, underscore)
any of (printable except (double quote, backslash), tab)
none of (double quote, newline)
```

`any of` matches one character from the set. `none of` matches one character NOT in the set.

Repeated set shorthand:
```
one or more of (letter, digit, period)    -- same as: one or more (any of (letter, digit, period))
one or more characters except (comma)     -- same as: one or more (none of (comma))
```

### Negation

```
any character isn't newline
digit isn't "0"
(one or more printable) isn't "--"
```

`A isn't B`: if B matches, fail. If B fails, try A.

### Until

```
any character until including newline
any character until excluding "END"
any character until including (digit then digit)
```

Use `until` when the terminator is multi-character. Use `none of` for single-character set negation.

### Extract

```
num: one or more digits
main: "value=" then extract num
-- result.extracted[0].text === "42"
```

`extract` binds to a single atom or parenthesized group:

```
extract digit                    -- ok
extract num                      -- ok
extract (one or more digits)     -- ok (parenthesized)
extract one or more digits       -- PARSE ERROR (needs parens)
```

### Precedence (tightest to loosest)

1. Repetition (`one or more`, `zero or more`, `optional`, `N`, `between N and M`)
2. `isn't`
3. `then` / `,` (sequence)
4. `joined by`
5. `or` (alternation)

`a then b or c then d` = `(a then b) or (c then d)`.

### Rules

```
field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline
```

Multi-word names are allowed: `token char`, `quoted value`, `hex pair`.

Indent continuation lines for long rules:

```
token char:
  any of (
    exclamation, hash, dollar, percent,
    ampersand, asterisk, plus, period,
    "0" to "9", "a" to "z", "A" to "Z"
  )
```

Comments start with `--`:

```
key: one or more letters  -- identifier
```

### Unicode

`any character` and `none of` consume one UTF-8 codepoint. All other classes match ASCII bytes only. Mixing `any character`/`none of` with byte ranges >= 0x80 in the same rule is a compile error — split into separate rules.

## Results

### Success

```js
{
  matched: true,
  bytes_consumed: number,
  tree: { rule, start, end, text, children: [] },
  extracted: [{ rule, start, end, text, children }]
}
```

### Failure

```js
{
  matched: false,
  offset: number,
  line: number,        // 1-based
  column: number,      // 1-based
  expected: string[],
  found: string,
  rule_stack: string[] // outermost first
}
```

```js
formatFailure(result)
// match failed at byte 5 (line 1, column 6):
//   expected: digit
//   found: "a" (0x61)
//   in: pair > value

formatTree(result.tree)
// pair [0..7]
// +-- key [0..4] "name"
// +-- value [5..7] "42"
```

## Examples

### Date parser
```
year: 4 digits
month: 2 digits
day: 2 digits
date: year then hyphen then month then hyphen then day
```

### CSV
```
field: one or more characters except (comma, newline)
row: field joined by comma
csv: row joined by newline
```

### Email
```
local: one or more of (letter, digit, period, hyphen)
domain: one or more letters then period then one or more letters
email: local then at then domain
```

### JSON string
```
escaped: backslash then any of (double quote, backslash, slash, "b", "f", "n", "r", "t")
str char: printable except (double quote, backslash) or escaped
json string: double quote then zero or more str char then double quote
```

### Hex color
```
hex: any of ("0" to "9", "a" to "f", "A" to "F")
color: hash then 6 hex digits
```

### Key-value pairs
```
key: one or more letters
value: one or more digits
pair: key then equals then value
```

### RFC 7239 Forwarded header
```
token char:
  any of (
    exclamation, hash, dollar, percent, ampersand,
    single quote, asterisk, plus, period, caret,
    underscore, backtick, pipe, tilde,
    "0" to "9", "a" to "z", "A" to "Z", hyphen
  )
token: one or more token char
escaped: backslash then any of (tab, byte 0x20 to byte 0x7E, byte 0x80 to byte 0xFF)
qdtext: any of (printable except (double quote, backslash), tab, byte 0x80 to byte 0xFF)
quoted value: double quote then zero or more (qdtext or escaped) then double quote
value: token or quoted value
param: token then equals then value
element: param joined by semicolon
ows: zero or more (space or tab)
forwarded: element joined by comma then ows
```

## Common patterns

| Pattern | Match grammar |
|---|---|
| One or more letters | `one or more letters` |
| Optional whitespace | `optional whitespace` |
| Anything except newline | `any character isn't newline` |
| Literal string | `"your string here"` |
| Identifier | `letter then zero or more word characters` |
| Integer | `one or more digits` |
| Signed integer | `optional (plus or hyphen) then one or more digits` |
| Quoted string | `double quote then zero or more (none of (double quote)) then double quote` |
| Separated list | `item joined by comma` |
| IP octet | `between 1 and 3 digits` |
| Hex byte | `2 hex digits` |
| Until end of line | `any character until including newline` |
| Non-empty line | `one or more characters except (newline)` |

## Rules for writing Match

1. Every grammar needs at least one rule. The last rule is the entry point.
2. Name characters, don't escape them: `backslash` not `\\`, `double quote` not `\"`.
3. Use `then` to sequence, `or` to alternate.
4. Repetition is prefix: `one or more digits`, `4 letters`, `between 2 and 10 digits`. Use parentheses for compound patterns: `one or more (letter then digit)`.
5. Use `"..."` for literal strings: `"hello"`, `"http://"`. Single char `"a"` works for ranges.
6. `extract` requires a single atom or parenthesized group.
7. Don't mix `any character`/`none of` with high byte ranges in the same rule.
8. No left recursion.
9. Use `joined by` for separated lists instead of manual loops.
10. Use `one or more characters except (...)` for repeated character exclusion, `none of (...)` for single character exclusion.
11. Use `one or more of (...)` for repeated character sets.
12. Use `compile` + `fastMatch` for high-throughput boolean matching where you don't need parse trees. `match()` already uses this internally to optimize success paths.
