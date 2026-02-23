# Finding Code

Always use @tags to find code. Never search blindly.

## Workflow

1. **Check PROJECT_INTENT.md** (already read on boot)
   - Find the relevant @tag for the feature/concept

2. **Grep PROJECT_SPECIFICS.md for details**
   ```bash
   grep -A 20 "@tag-name" /Users/noahedery/Desktop/Match/PROJECT_SPECIFICS.md
   ```
   - Shows: file paths, sub-tags, spec references

3. **Grep the codebase for the tag**
   ```bash
   grep -A 50 "@tag-name" /Users/noahedery/Desktop/Match/src/path/to/file.ts
   ```
   - Gets the actual code section

## Examples

User says "fix the literal parser":
1. PROJECT_INTENT shows: Lexer (@lexer)
2. `grep -A 20 "@lexer" PROJECT_SPECIFICS.md` → shows sub-tags including @lex-literal
3. `grep -A 50 "@lex-literal" src/lexer/lexer.ts` → gets the code

User says "memoization bug":
1. PROJECT_INTENT shows: Executor (@executor)
2. `grep -A 20 "@match-memo" PROJECT_SPECIFICS.md` → shows memo table location
3. `grep -A 50 "@match-memo" src/executor/executor.ts` → gets the code

## Adding Tags

When writing significant code (>10 lines, independently referenced):
```typescript
// @tag-name
... code ...
// @tag-name-end
```

After writing, add the tag to PROJECT_SPECIFICS.md under the parent section.
