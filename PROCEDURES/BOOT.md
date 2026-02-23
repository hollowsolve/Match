# Boot (`/boot`)

Use when terminal was closed mid-session. Follow these steps exactly:

## Steps

1. **Assess uncommitted state**:
   ```bash
   cd /Users/noahedery/Desktop/Match
   git status
   git diff --stat
   ```

2. **Check last session context**:
   ```bash
   git log -3 --oneline
   ```

3. **Identify incomplete work**:
   - Look at modified files to understand what was in progress
   - Check if type check passes: `npx tsc --noEmit`
   - Check if tests pass: `npm test`
   - Check BACKLOG.md for any "in progress" markers

4. **Auto-recover**:
   - If changes are complete and working → commit with "Session XXX (recovered): [summary]"
   - If changes are broken → report what's broken, ask user how to proceed
   - If changes are partial → report status, ask user: continue or revert?

5. **Report**:
   ```
   Boot audit complete.

   Last commit: [hash] [message]
   Uncommitted changes: [list files or "none"]
   Type check: [passing/failing]
   Tests: [passing/failing]

   Assessment: [complete/broken/partial]
   Recommendation: [commit/fix/continue/revert]
   ```
