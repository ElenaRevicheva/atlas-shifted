# Oracle deploy — Atlas Shifted (`/home/ubuntu/whitespace`)

Per [ORACLE_ALL_PRODUCTS_RESILIENCE.md](https://github.com/ElenaRevicheva/AIPA_AITCF/blob/main/docs/oracle/ORACLE_ALL_PRODUCTS_RESILIENCE.md):

| Field | Value |
|-------|--------|
| **VM** | `ubuntu@170.9.242.90` |
| **SSH** | `ssh -i ~/.ssh/ssh-key-2026-01-07private.key ubuntu@170.9.242.90` |
| **Path** | `/home/ubuntu/whitespace` |
| **PM2** | `whitespace` (port 8095) |
| **Health** | `http://127.0.0.1:8095/healthz` |
| **Public** | `https://webhook.aideazz.xyz/whitespace/` |

---

## Git pull (fixed Jun 26 2026)

**Problem:** Remote was `https://github.com/...` — `git pull` failed with no credentials on the VM.

**Fix:** SSH deploy key + SSH remote:

```
origin  git@github.com:ElenaRevicheva/atlas-shifted.git
```

Deploy key title on GitHub: **`oracle-whitespace-deploy`** (read-only).

---

## Deploy after you push to `main`

From your dev machine:

```bash
ssh -i ~/.ssh/ssh-key-2026-01-07private.key ubuntu@170.9.242.90 \
  "bash /home/ubuntu/whitespace/scripts/deploy-oracle.sh"
```

Or on the VM:

```bash
cd /home/ubuntu/whitespace
git pull origin main
npm run build
pm2 restart whitespace
```

---

## One-time SSH setup (already done on VM)

If you rebuild the VM or clone fresh:

```bash
bash scripts/oracle-setup-github-ssh.sh
```

Uses `GITHUB_TOKEN` from `/home/ubuntu/cto-aipa/.env` to register the deploy key.

---

## Daily cron (unchanged)

`crontab -l` → `0 14 * * *` (9 AM Panama):

```
/home/ubuntu/whitespace/scripts/atlas-capture-cron.sh
```

Pipeline: capture → classify → brief → concept → backup `captures.jsonl` to `atlas-captures` repo (HTTPS token — separate from code pull).

---

## Verify

```bash
curl -s http://127.0.0.1:8095/healthz
pm2 list | grep whitespace
cd /home/ubuntu/whitespace && git status && git log -1 --oneline
```
