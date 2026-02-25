# Matchmaker Skill

You create, organize, and maintain codebase-specific Match grammars. When the user asks you to create a grammar for a pattern in their codebase, you write it, test it, store it in `/match/custom_matches.md`, and make it available for future use.

This skill is independent from match_skill.md. It assumes you already know how to write Match grammars (if not, load match_skill.md first).

## What you do

1. **Identify patterns** the user wants to match in their codebase (log formats, config syntax, protocol messages, domain-specific strings).
2. **Write a grammar** for each pattern using the Match language.
3. **Test it** against sample input from the codebase to verify correctness.
4. **Store it** in `/match/custom_matches.md` with a name, description, grammar, and sample inputs.
5. **Maintain** the collection: update grammars when formats change, remove obsolete ones, keep the file organized.

## Directory structure

Create and manage a `/match/` directory at the root of the user's project:

```
project/
  match/
    custom_matches.md    <-- grammar collection
```

## custom_matches.md format

```markdown
# Custom Matches

Quick reference of codebase-specific grammars.

---

## log line

Matches structured log lines in this project's format: `[LEVEL] timestamp: message`

### Grammar
\```
level: "ERROR" or "WARN" or "INFO" or "DEBUG"
timestamp: 4 digits then hyphen then 2 digits then hyphen then 2 digits
  then space then 2 digits then colon then 2 digits then colon then 2 digits
message: one or more characters except (newline)
log line: open bracket then level then close bracket then space then timestamp then colon then space then message
\```

### Sample inputs
- `[ERROR] 2025-01-15 14:30:00: connection refused` -> matched
- `[INFO] 2025-01-15 08:00:00: server started` -> matched
- `bad log line` -> failed

### Usage
\```js
import { parse, find } from '@hollowsolve/match'
const program = parse(grammar)
find(program, logFileContents)
\```

---

## api route

Matches API route patterns like `/api/v2/users/:id/posts`

### Grammar
\```
segment: one or more of (letter, digit, hyphen, underscore)
param: colon then segment
part: param or segment
route: one or more (slash then part)
\```

### Sample inputs
- `/api/v2/users/:id/posts` -> matched
- `/health` -> matched

### Usage
\```js
import { run } from '@hollowsolve/match'
run(grammar, route)
\```

---
```

Each entry has: name (h2), description, grammar in a code block, sample inputs with expected results, and a usage snippet.

## Workflow

### When the user says "create a match for X"

1. Ask for or find sample input from the codebase.
2. Write the grammar.
3. Test it with `run(grammar, sample)` — verify it matches successes and rejects failures.
4. If `/match/custom_matches.md` doesn't exist, create it with the header.
5. Append the new entry in the format above.
6. Report back: grammar, what it matches, where it's stored.

### When the user says "update the match for X"

1. Read `/match/custom_matches.md`, find the entry.
2. Modify the grammar.
3. Re-test against the sample inputs.
4. Update the file.

### When the user says "list my matches" or "what matches do I have"

1. Read `/match/custom_matches.md`.
2. List all entries: name, one-line description.

### When the user says "remove the match for X"

1. Remove the entry from `/match/custom_matches.md`.
2. Confirm removal.

### When the user says "find X in my code"

1. Look up the grammar in `/match/custom_matches.md`.
2. Use `searchFolder` or `searchFile` to find matches.
3. Report results.

## Quick-match section

After building several grammars for a codebase, add a quick-match section at the top of `custom_matches.md` for fast reference:

```markdown
# Custom Matches

## Quick match

| Name | Pattern | One-liner |
|---|---|---|
| log line | `[LEVEL] timestamp: message` | structured log entry |
| api route | `/segment/segment/:param` | API route with params |
| env var | `KEY=value` | environment variable |
| semver | `major.minor.patch` | semantic version |

---
```

Update the quick-match table whenever you add, modify, or remove an entry.

## Principles

- **One grammar per pattern.** Don't combine unrelated patterns into one grammar.
- **Test before storing.** Always verify the grammar matches sample input and rejects non-matching input.
- **Name clearly.** The grammar name should describe what it matches, not how it works.
- **Keep samples real.** Use actual strings from the codebase, not hypothetical ones.
- **Grammar quality.** Use `joined by` for lists, `extract` for values the user needs to pull out, multi-word rule names for clarity.
- **Maintain the collection.** When the codebase changes, update or remove stale grammars.
