# Backup & Restore — Atlas Shifted

## Restore point (before v2 intelligence layer)

| Ref | Purpose |
|-----|---------|
| **Tag** `backup-pre-v2-2026-06-26` | Exact snapshot of codebase before Jun 26 enhancements |
| **Branch** `backup/pre-v2-jun26-2026` | Same commit, easy to branch from |

Created: **June 26, 2026** — after `docs/CONTEST_REALITY_CHECK.md`, before intelligence layer + UI v2.

---

## Go back to the backup (local)

```bash
cd D:\aideazz\whitespace   # or /home/ubuntu/whitespace on Oracle

# Option A — detached checkout (look only)
git checkout backup-pre-v2-2026-06-26

# Option B — new branch from backup (work from old code)
git checkout -b my-fix-from-backup backup/pre-v2-jun26-2026

# Return to latest main
git checkout main
git pull
```

---

## Deploy backup on Oracle (if v2 breaks production)

```bash
ssh ubuntu@170.9.242.90
cd /home/ubuntu/whitespace
git fetch --tags
git checkout backup-pre-v2-2026-06-26
npm run build
pm2 restart whitespace
```

To return to latest:

```bash
git checkout main
git pull
npm run build
pm2 restart whitespace
```

---

## What's in v2 (after backup)

- `src/intelligence.ts` — Alternate Universe, Wait Cost, Half-Life, Market Memory
- `/api/atlas/history` — sparkline data
- `/api/atlas/evidence` — evidence drawer API
- `public/atlas.html` — intelligence UI, drawer, mutations, sparklines
- `concept.ts` — 3 creative mutation variants
- `docs/MARKET_ANALYSIS.md` — this analysis doc

Data on server (`data/captures.jsonl`, etc.) is **not** in git — backup tag only saves **code**.
