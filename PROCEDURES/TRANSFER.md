# Transfer (`/transfer`)

When ending a session:

## Steps

1. **Update BACKLOG.md** with any new items or completed items
   - Mark completed items with `[x]` and note the session number

2. **Update PROJECT_SPECIFICS.md** with any new @tags added to code

3. **Git commit and push**:
   ```bash
   cd /Users/noahedery/Desktop/Match
   git add -A
   git commit -m "Session XXX: [summary]"
   git push origin main
   ```

4. **Output the transfer prompt** for next session:

```
You are Session [XXX]. Sessions since last audit: [N].

Read these files:
- /Users/noahedery/Desktop/Match/BRAIN.md
- /Users/noahedery/Desktop/Match/PROJECT_INTENT.md
- /Users/noahedery/Desktop/Match/BACKLOG.md

When you need implementation details, grep PROJECT_SPECIFICS.md:
  grep -A 20 "@tag-name" /Users/noahedery/Desktop/Match/PROJECT_SPECIFICS.md

Check what last session did:
  git -C /Users/noahedery/Desktop/Match log -5 --oneline

Current task: [FILL IN]
```

5. Say "Session terminated" to confirm.
