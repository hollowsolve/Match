# Lava

A language built on top of [match](../README.md). The source code is a literal
map of system state: every effect is guarded, every value has a declared origin,
and logic is legible to anyone who can read English.

## Locked design decisions

- **The program is a map, not a script.** A bug can only exist if the map is wrong.
- **Actions are flat, sealed leaves.** Each action reads its declared inputs and
  writes its declared outputs — nothing else. **Actions cannot call other actions.**
  All composition (sequencing, branching, repetition, waiting) lives in the
  top-level orchestration layer.
- **Capability footprints.** An action may only touch state named in its header,
  so it is auditable by reading it alone — no tracing a call graph.
- **No reuse of effect-logic.** If five actions need the same write sequence, the
  design is wrong. Duplication is visible; indirection is not.
- **Failure is a state, not a value.** Operations that cannot resolve fail; callers
  check state.

## match dialect

Lava uses match for every text-shape pattern, under a strict dialect:

- **Proper full names only — no quoted character literals, anywhere** (shapes
  *and* markers). `minus` not `"-"`, `pipe` not `"|"`, `period` not `"."`.
- **No abbreviations.** Rule names are full words: `pchar` → `unreserved character`.
- **No synonyms.** One canonical name per byte (match allows `dash`/`hyphen` and
  `dot`/`period`; Lava picks one and rejects the rest).

```
create pattern "unreserved character" as
  one or more (letter or digit or minus or period or underscore or tilde)
end
```

The compiler expands `unreserved character` to the RFC set and maps canonical
names onto match (e.g. `minus` → match's `hyphen`). match itself is unchanged.

## Status

**Slice 1 — core.**

- `create container "<name>" of type <type> with value <value>`
- `create constant "<name>" of type <type> with value <value>`
- `update <name> to <expr>`
- math: `+ - * / ^ √` and n-th root, with `[ ]` grouping
  (more than one operation **requires** brackets)
- predicates: `is`, `and`, `or`, `not`, parens
- `if (<predicate>) then <effects> [else <effects>]` (effects separated by `,`)
- `print(<expr>)` — a write to the built-in `Console` origin
- `~` comments

**Slice 2 — actions with capability footprints.**

- `create action "<name>" [reads <list>] [writes <list>] as <body> end`
- an action body may touch **only** state named in its header; the loader
  statically rejects any out-of-footprint read/write *before the program runs*
- actions **cannot call other actions** (parse error)
- actions are called from the top-level orchestrator: `Name()`
- the top level holds ambient authority (read / write / print / call freely)

**Slice 3 — loops and break.**

- `loop … end` (infinite, with a runaway cap), `loop until (<cond>) … end`,
  `loop <n> times … end`
- loop-local container: `loop (create container "n" …) until (<cond>) … end`
- `break` exits the enclosing loop (forbidden inside actions, forbidden at top level)
- loops may nest

**Slice 4 — patterns (match integration).**

- `create pattern "<name>" as <clauses> end` — clauses separated by `,`:
  an optional `start at|after <marker>`, an optional `stop at|before <marker>`,
  and exactly one shape (a match expression in the strict dialect)
- a marker is a canonical character name (`pipe`, `minus`, …) or `char <n>` —
  never a quoted literal
- `extract <PatternName> from <source>` reads `<source>` (a string container),
  anchors the region in the host, and shapes the capture with the **real match
  VM** (`../dist`). Extracting counts as a read, so an action using it must
  declare `reads <source>`.

Not yet: classes, states, `wait`, filesystem I/O, `UserInput`.

## Run

```
node lava/lava.mjs lava/examples/velocity.lava   # core: math, guards
node lava/lava.mjs lava/examples/account.lava    # actions + footprints
node lava/lava.mjs lava/examples/escalation.lava # footprint violation, rejected
node lava/lava.mjs lava/examples/loops.lava      # loops + break
node lava/lava.mjs lava/examples/pattern.lava    # patterns via match
```
