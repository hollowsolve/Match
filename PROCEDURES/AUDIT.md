# Audit (`/audit`)

Run periodically or on user request. Follow this checklist:

## Checklist

1. **Verify BACKLOG.md** items haven't been silently completed

2. **Identify stale backlog entries**

3. **Flag competing/overlapping backlog items**

4. **Identify complexity flags**:
   - Files >300 lines
   - Functions >50 lines
   - Deeply nested logic (>3 levels)

5. **Verify BRAIN.md rules are followed** — spot-check pipeline isolation, type safety, tagging

6. **Verify @tags are up to date** — check recent commits for new code that should be tagged

7. **Spec conformance check** — verify implementation matches IMPLEMENTATION-SPEC.md for recently touched sections

## Scriptable Checks

```bash
# Large files
find src -name "*.ts" -exec wc -l {} + | sort -rn | head -20

# Untagged functions (functions without a preceding @tag)
grep -n "function " src/**/*.ts | head -30
```

## After Audit

When adding new backlog items, ask: "Does this overlap with existing items?" Surface conflicts as clarification requests.
