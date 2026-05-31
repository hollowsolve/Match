# Lava 🌋

**A language where the source code is a literal map of system state.**

In most languages there is a *gap*: the source is a list of instructions, and
the behavior happens elsewhere — later, in a machine state you cannot see. Bugs
live in that gap. The program did something the text didn't visibly say.

Lava collapses the gap. The source isn't a recipe for state; it's a description
of state, and execution is that description being true. So:

> **A bug can only exist if the map is wrong.** When something is off, you don't
> debug a timeline — you read the map and see the declaration that's incorrect.

Lava is built on [match](../README.md): every text-shape pattern is a match
program, run on the real match VM.

```
create container "Velocity" of type int with value 0
update Velocity to [Velocity + 10]
update Velocity to [Velocity * 3]

if (Velocity is 30) then print("go")
```

```
$ node lava/lava.mjs program.lava
go
```

---

## Principles

- **The program is a map, not a script.** Every value has a declared origin;
  every effect is guarded.
- **Actions are flat, sealed leaves.** An action reads its declared inputs and
  writes its declared outputs — nothing else. **Actions cannot call other
  actions.** All composition lives in the top-level orchestrator.
- **Capability footprints.** An action may only touch state named in its header,
  enforced *before the program runs*. "Which actions can write the auth file?"
  is a header grep — and privilege escalation is structurally impossible, not
  merely guarded against.
- **No reuse of effect-logic.** If five actions need the same write sequence, the
  design is wrong. Duplication is visible; indirection is not.
- **Failure is a state, not a value.** Operations that cannot resolve fail; the
  orchestrator checks state. There is no `return`, no propagating error string.
- **Readable as English.** Logic is legible to anyone, not just programmers.

---

## A tour

### Containers, constants, math

```
create container "Score" of type int with value 0
create constant "Max" of type int with value 100
update Score to [Score + 10]
```

Types (`int`, `string`, unions like `string/int`) are mandatory and checked on
every write. Math uses `+ - * / ^ √` (and n-th root, `n√x`); more than one
operation **requires** brackets — `[[a + b] * c]`, never `a + b * c`.

### Bounds — invariants that can't be broken

A numeric refinement is part of a container's identity, so the bad state cannot
exist (and there's no separate rule to drift out of sync):

```
create container "Credit" of type int at least 0 with value 100
create container "Hold"   of type int never above Credit with value 0
```

`at least N` · `at most N` · `between N and M` · `never above C` · `never below C`.
Every write is checked; a violation undoes the write and fails.

### Guards and predicates

```
if (PermissionLevel is "admin") then ShowDashboard()
if ((Velocity is 30) and (not (Name is "anon"))) then go()
```

Predicate algebra is just `is`, `and`, `or`, `not`, parens. Effects after `then`
(and `else`) are comma-separated.

### Loops

```
loop 3 times
  update Total to [Total + 10]
end

loop (create container "n" of type int with value 0) until (n is 5)
  update n to [n + 1]
end
```

`loop` (infinite) · `loop until (cond)` · `loop n times` · optional loop-local
container · `break`.

### Actions — sealed, with declared footprints

```
create action "Promote" reads PermissionLevel writes PermissionLevel, Audit, Console as
  if (PermissionLevel is "member") then update PermissionLevel to "admin", print("done")
end

Promote()   ~ called from the orchestrator
```

The body may touch **only** what the header declares. An action that writes
state it didn't declare is rejected at load — before a single line runs:

```
lava: action 'Cheat':
  - writes 'PermissionLevel' but does not declare it (writes: Balance)
```

Actions take no parameters and return no values — the state they update *is* the
data that needed to pass. They cannot call other actions.

### Patterns — match, under a strict dialect

```
create pattern "GetUsername" as
  start after pipe,
  stop before pipe,
  one or more unreserved character
end
```

The dialect: **proper full names only, no quoted literals anywhere** (`pipe` not
`"|"`, `minus` not `"-"`), no abbreviations (`unreserved character`, not
`pchar`), one canonical name per byte. Compiles to a match grammar and runs on
the match VM. Markers are character names or `char <n>`.

### Classes & states — files as live state

```
create class "Users" from "data/users.txt" where
  "Username" is GetUsername,
  "PermissionLevel" is GetRole

create state "PermissionLevel" from class Users with states
  "owner", "admin", "member"

print(Username from Users)                          ~ live read, re-read each time
if (PermissionLevel from Users is (owner or admin)) then ShowDashboard()
```

A class binds a file; each field is a pattern over its contents. `<Field> from
<Class>` re-reads live. A `state` is a closed case-set; checks use bare names and
boolean algebra. Data outside the set, or an undeclared case, is an error.

### Writes

```
overwrite(contents of Users, "all new text")
overwrite(Line 5 of Users, "specific line")
overwrite(name of Users, "data/archive.txt")
```

Read/write asymmetry: reads use `from`, writes name the target with `of`.

### UserInput

```
update Name to UserInput        ~ one line of stdin, accepts with newline
```

Origins are direction-typed: `UserInput` is read-only, `Console` (where `print`
goes) is write-only. Declaring them backwards is rejected.

### Reactive wait — suspend, wake on mutation

```
wait until (Ready is "yes") then go()
```

Non-blocking: if the predicate is already true it fires now; otherwise it
suspends and execution continues. A container `update` is the wake event — the
mutation, not a clock. Every now-true wait fires in **source order**; cascades
(a wait whose effect wakes another) resolve in source order too.

### Synchronous actions — atomic composition

```
create action "Authenticate" writes LoginStatus as
  update LoginStatus to "authenticated"
end
create action "Promote" writes PermissionLevel as
  update PermissionLevel to "member"
end

create synchronous actions "UpdateUser" as
  Authenticate(),
  Promote()
end
```

The block composes already-sealed actions into one **atomic** unit — its
footprint is their union. The composed actions run in order, but the reactive
`wake()` is deferred to the end, so no suspended `wait` can ever observe a
half-applied state. On failure, container state rolls back from a
pre-transaction snapshot.

> *"It cannot exist in a state where one updates but the other does not."*

And because bounds are checked **at commit**, a transaction may pass through an
intermediate that violates a relational bound and still commit a consistent
state — ACID-style consistency, emergent from bounds + synchronous actions.

---

## Why this is safe by construction

| Class of bug | Why it can't happen in Lava |
|---|---|
| Privilege escalation | An action can only touch its declared footprint; out-of-footprint writes are rejected at load. |
| Injection | No string is concatenated into a command/query — you read & write declared containers via guarded patterns. |
| Hidden control flow | Actions can't call actions; every edge is a static call in the orchestrator, on the map. |
| Half-applied state | Synchronous blocks commit atomically; the intermediate is never observable. |
| Out-of-range / broken invariant | Bounds are part of the container's identity; a violating write fails. |
| Map/code drift | There is no second artifact — the source *is* the map. |

Auditing a Lava program is reading the list of declared states and footprints,
not chasing an open-ended space of exploits.

---

## Run

```
node lava/lava.mjs <file>.lava
```

Examples (each runs end to end):

```
node lava/lava.mjs lava/examples/velocity.lava            # math, guards
node lava/lava.mjs lava/examples/account.lava             # actions + footprints
node lava/lava.mjs lava/examples/escalation.lava          # footprint violation, rejected
node lava/lava.mjs lava/examples/loops.lava               # loops + break
node lava/lava.mjs lava/examples/pattern.lava             # patterns via match
node lava/lava.mjs lava/examples/classes.lava             # classes + states (live reads)
node lava/lava.mjs lava/examples/writes.lava              # overwrite + live read
printf 'a\nb\nc\n' | node lava/lava.mjs lava/examples/userinput.lava
node lava/lava.mjs lava/examples/wait.lava                # reactive wait + cascade
node lava/lava.mjs lava/examples/sync.lava                # atomic transaction
node lava/lava.mjs lava/examples/bounds.lava              # invariants on containers
node lava/lava.mjs lava/examples/bounds-atomic.lava       # dip-through, commit consistent
node lava/lava.mjs lava/examples/bounds-violation.lava    # a violation is rejected
```

Requirements: Node 18+, and match built at `../dist` (`npm run build:esm` from
the repo root). The interpreter (`lava.mjs`) has no other dependencies.

---

## The whole surface

```
create container "<name>" of type <type> [<bound>] with value <value>
create constant  "<name>" of type <type> with value <value>
create action "<name>" [reads <list>] [writes <list>] as <body> end
create pattern "<name>" as <clauses> end
create class "<name>" from "<path>" where "<field>" is <pattern>, …
create state "<name>" from class <class> with states "<case>", …
create synchronous actions "<name>" as <Call>(), … end

update <name> to <expr>                         ~ container / state write
overwrite(<contents|name|Line [n]> of <class>, <value>)
print(<expr>)                                   ~ write to Console
<field> from <class>                            ~ live read
extract <pattern> from <source>                 ~ pattern over a string
UserInput                                       ~ read-only origin (one line of stdin)

if (<pred>) then <effects> [else <effects>]
loop / loop until (<pred>) / loop n times … end / break
wait until (<pred>) then <effects>
Name()                                          ~ action / synchronous-block call

~ comment
```

**Bounds:** `at least N` · `at most N` · `between N and M` · `never above C` ·
`never below C` (int containers).
**Predicates:** `is`, `and`, `or`, `not`, parens.
**Math:** `+ - * / ^ √`, n-th root; brackets required for >1 operation.

---

## Not yet implemented

- Timed / `UserInput`-driven waits (`wait (30s) until …`) — error clearly rather
  than misbehave.
- Cross-file write atomicity inside a synchronous block — container state rolls
  back, but file overwrites are not undone (an OS-level limit).

---

