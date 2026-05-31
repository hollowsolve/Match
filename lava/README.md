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

**Slice 5 — classes and states.**

- `create class "<Name>" from "<path>" where "<Field>" is <Pattern>, …`
  binds a file; each field is a pattern applied to that file's contents.
  Paths resolve `~`, absolute, or relative to the `.lava` file.
- `<Field> from <Class>` is a **live read** — the file is re-read every time.
- `create state "<Field>" from class <Class> with states "<case>", …` declares
  the closed set of valid cases for a class field (the state name *is* a field).
- `<Field> from <Class> is <case>` checks the case with bare names and boolean
  algebra: `is admin`, `is (owner or admin)`, `is not member` — never quoted.
  An undeclared case name, or data outside the declared set, is an error.
- reading a class field charges the **class** against the capability footprint.

**Slice 6 — filesystem writes.**

- `overwrite(<part> of <Class>, <value>)` writes to the class's file:
  - `contents of <Class>` — replace the whole file (creates it if absent)
  - `name of <Class>` — rename/move the file; the class tracks its new path
  - `Line of <Class>` / `Line <n> of <Class>` — replace one line (bare `Line`
    is the first line); an out-of-range line is an error
- reads are live, so a write is visible on the very next read
- overwriting charges `writes <Class>` against the capability footprint
- read/write asymmetry: reads use `from`, writes name the target with `of`

**Slice 7 — UserInput.**

- `UserInput` is a read-only origin that yields one line of stdin (accepts with
  newline). Use it anywhere a string value is expected: `update Name to UserInput`.
- Origins are **direction-typed**: `UserInput` is read-only, `Console` is
  write-only. Declaring `writes UserInput` or `reads Console` is rejected at load.

**Slice 8 — reactive wait.**

- `wait until (<predicate>) then <effects>` is **non-blocking**: if the predicate
  is already true it fires now; otherwise it *suspends* and execution continues.
- A container `update` is a wake event: every suspended wait whose predicate is
  now true fires, in **source order** (top of file first). A fired wait's effects
  may mutate further, waking more waits — cascades resolve in source order.
- A wait that never becomes true simply never fires; the program ends normally.
- `wait` is top-level only (forbidden inside actions, like `loop`).
- The timed form `wait (<duration>) until …` errors clearly (not yet implemented).

**Slice 9 — synchronous actions.**

- `create synchronous actions "<Name>" as <Call>(), <Call>(), … end` composes
  already-defined actions into one **atomic** unit. It is orchestration, not an
  action, so "actions cannot call actions" still holds — the block does the calling.
- the block's footprint is the **union** of the actions it calls (derived).
- atomicity: the composed actions run in order (each sees prior writes), but the
  reactive `wake()` is **deferred to the end** — so no suspended `wait` can ever
  observe a half-applied transaction. On any failure, container state is **rolled
  back** from a pre-transaction snapshot. (Mid-transaction file overwrites are not
  rolled back — an OS-level limit.)
- a synchronous block may not nest another; calling an unknown action is rejected.

**Slice 10 — bounds (invariants on containers).**

- a numeric refinement declared between the type and `with value`, so a bound is
  part of the container's identity — there is nothing for it to drift from:
  - `of type int at least <N>` / `at most <N>` / `between <N> and <M>` — literal
  - `of type int never above <Container>` / `never below <Container>` — relational
- the initial value must satisfy the bound; every `update` is checked, and a
  violation undoes that write and fails (failure-is-a-state).
- a relational bound reads its reference for validation only — that is
  language-level enforcement, **not** part of an action's footprint (an action
  that writes a bounded container needs only `writes <it>`).
- inside a synchronous block, bounds are checked **once at commit**, so a
  transaction may pass through an intermediate that violates a relational bound
  as long as the committed state is consistent — ACID-Consistency, emergent from
  bounds + synchronous actions.
- bounds apply only to `int` containers.

Not yet: timed / `UserInput`-driven waits.

## Run

```
node lava/lava.mjs lava/examples/velocity.lava   # core: math, guards
node lava/lava.mjs lava/examples/account.lava    # actions + footprints
node lava/lava.mjs lava/examples/escalation.lava # footprint violation, rejected
node lava/lava.mjs lava/examples/loops.lava      # loops + break
node lava/lava.mjs lava/examples/pattern.lava    # patterns via match
node lava/lava.mjs lava/examples/classes.lava    # classes + states (live file reads)
node lava/lava.mjs lava/examples/writes.lava     # overwrite + live read roundtrip
printf 'alice\nhi\nyo\n' | node lava/lava.mjs lava/examples/userinput.lava  # UserInput
node lava/lava.mjs lava/examples/wait.lava       # reactive wait: suspend, wake, cascade
node lava/lava.mjs lava/examples/sync.lava       # synchronous actions: atomic transaction
node lava/lava.mjs lava/examples/bounds.lava     # bounds: invariants on containers
node lava/lava.mjs lava/examples/bounds-atomic.lava       # consistency: dip then commit
node lava/lava.mjs lava/examples/bounds-violation.lava    # a violation is rejected
```
