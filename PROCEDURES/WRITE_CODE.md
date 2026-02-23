# Writing Code

When writing or editing code, follow these rules:

## 1. Tag Every Section

Add `// @tag-name` comment before any distinct chunk of code:

```typescript
// @lex-literal
function lexLiteral(source: string, pos: number): [Token, number] {
  // ...
}
// @lex-literal-end
```

What counts as a section:
- Functions (>10 lines)
- Type/interface definitions
- Class methods
- Any code that might be referenced independently

## 2. Update PROJECT_SPECIFICS Immediately

After adding a tag, add it to PROJECT_SPECIFICS.md under the parent section:

```markdown
@lexer
Handler: src/lexer/lexer.ts
Sub-tags:
  @lex-literal — lexLiteral(), string literal with escape resolution
  ...
```

Do this at write time, not later.

## 3. Tag Naming

- Lexer: `// @lex-*`
- Parser: `// @parse-*`
- Validator: `// @validate-*`
- Compiler: `// @compile-*`
- Executor: `// @match-*`
- Diagnostics: `// @diag-*`
- Types: `// @type-*`
- Stdlib: `// @stdlib-*`
- Debug: `// @debug-*`

## 4. No Orphan Tags

Every tag in code must be listed in PROJECT_SPECIFICS. Every tag in PROJECT_SPECIFICS must exist in code.

## 5. Spec References

When implementing non-obvious spec behavior, reference the spec section:

```typescript
// Ordered choice with commitment [Impl §7.2]
```
