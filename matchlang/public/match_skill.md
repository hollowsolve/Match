# Match Language Skill

> Your project's custom grammars are at `.match/grammars.md`. Add reusable grammars there.

## Syntax Reference

### Rules
```
name: pattern
```
- Last rule is the entry point
- Rules reference other rules by name
- Multi-word names allowed: `token char`, `quoted value`
- Indent continuation lines for long rules

### Characters
Named characters (no escape sequences):
```
hyphen (dash)  period (dot)  comma  colon  semicolon
slash  backslash  at  hash  dollar  percent  ampersand
asterisk  plus  equals  pipe  tilde  caret  underscore
backtick  exclamation  question  single quote  double quote
open paren  close paren  open bracket  close bracket
open brace  close brace  less than  greater than
space  tab  newline  carriage return  null
```

Quoted single characters: `"a"`, `"Z"`, `"0"`, `"+"`

### Character Classes
```
letter           a-z, A-Z
uppercase        A-Z
lowercase        a-z
digit            0-9
hex digit        0-9, a-f, A-F
whitespace       space, tab, newline, carriage return
visible          0x21-0x7E (printable, no space)
printable        0x20-0x7E (visible + space)
alphanumeric     letter or digit
word character   letter, digit, or underscore
any character    any single UTF-8 codepoint
```

### Text Blocks
Multi-character literals use quotes:
```
"hello world"
"http://"
```

### Sequences & Alternation
```
A then B          sequence
A, B              comma shorthand for then
A or B            ordered choice (PEG)
```
`then` binds tighter than `or`: `a then b or c then d` = `(a then b) or (c then d)`

### Repetition
Quantifiers are **prefix** — they come before the pattern:
```
one or more X         1+ (greedy)
zero or more X        0+ (greedy)
optional X            0 or 1
N X                   exactly N times (e.g. 4 digits)
between N and M X     N to M times (greedy)
```
Binds tightest. `letter then one or more digits` = `letter then (one or more digits)`

Parenthesized: `one or more (letter then digit)`

### Sets
```
any of (letter, digit, underscore)                match one from set
one or more of (letter, digit, underscore)        quantified set
none of (double quote, newline)                   match one NOT in set
one or more characters except (comma, newline)    quantified negated set
visible except (double quote, backslash)          narrow a class
"a" to "z"                                        range
```

### Negation
```
any character isn't newline
digit isn't "0"
```
`A isn't B`: if B matches, fail. If B fails, try A.

### Until
```
any character until including newline
any character until excluding "END"
```

### Extract
```
extract ruleName
extract (one or more digits)
```
Tagged matches appear in `result.extracted[]`.

### Joined By
```
field joined by comma
item joined by comma lenient    (allows trailing separator)
```

### Precedence (tight → loose)
1. Repetition
2. isn't
3. then
4. joined by
5. or

### Comments
```
-- this is a comment
key: one or more letters  -- inline comment
```

## API Quick Reference
```typescript
import { run, parse, match, find, tryParse, formatTree, formatFailure } from '@hollowsolve/match'

// One-shot
const result = run(grammar, input)

// Compile once, match many
const program = parse(grammar)
const result = match(program, input)

// Find all matches in text
const matches = find(program, text)

// Partial results on failure
const partial = tryParse(grammar, input)

// Formatting
formatTree(result.tree)
formatFailure(result, input)
```
