---
description: Deploy n8n-nodes-imap to GitHub
---

# Deploy to GitHub Workflow

This workflow describes how to deploy changes to the n8n-nodes-imap project on GitHub.

## Prerequisites
- All tests must pass: `npm test`
- Build must complete successfully: `npm run build`

## Steps

// turbo-all

1. Make sure you're in the project directory:
```bash
cd d:\_Projekty TECH\AI N8N\n8n-nodes-imap
```

2. Check current git status:
```bash
git status
```

3. Add all changes:
```bash
git add -A
```

4. Commit with conventional commit message:
```bash
git commit -m "feat(email): add 'Mark As Seen' option to Move operation"
```

5. Push to GitHub:
```bash
git push origin master
```

## Notes
- Use conventional commits: `feat(scope):`, `fix(scope):`, `docs:`, `test(scope):`
- Never update version numbers manually - semantic-release handles versioning
- Run tests before pushing: `npm test`
