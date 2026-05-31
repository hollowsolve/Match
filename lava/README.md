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

- **Proper full names only — no quoted character literals.**
  `minus` not `"-"`, `period` not `"."`, `underscore` not `"_"`, `tilde` not `"~"`.
- **No abbreviations.** Rule names are full words: `pchar` → `unreserved character`.
- **No synonyms.** One canonical name per byte (match allows `dash`/`hyphen` and
  `dot`/`period`; Lava picks one).

```
create pattern "unreserved character" as
  letter or digit or minus or period or underscore or tilde
```

The Lava compiler maps its canonical names onto match (e.g. `minus` → `0x2D`).
match itself is unchanged.

## Status — slice 1 (execution core)

Implemented:

- `create container "<name>" of type <type> with value <value>`
- `create constant "<name>" of type <type> with value <value>`
- `update <name> to <expr>`
- math: `+ - * / ^ √` and n-th root, with `[ ]` grouping
  (more than one operation **requires** brackets)
- predicates: `is`, `and`, `or`, `not`, parens
- `if (<predicate>) then <effects> [else <effects>]` (effects separated by `,`)
- `print(<expr>)`
- `~` comments

Not yet: actions, patterns, classes, states, loops, `wait`, filesystem I/O,
`UserInput`, match integration.

Run:

```
node lava/lava.mjs lava/examples/velocity.lava
```
