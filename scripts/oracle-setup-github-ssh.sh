#!/usr/bin/env bash
# One-time: register Oracle deploy key + switch whitespace to SSH remote.
set -euo pipefail

KEY=~/.ssh/id_ed25519_github
PUB="${KEY}.pub"
REPO=git@github.com:ElenaRevicheva/atlas-shifted.git
WS=/home/ubuntu/whitespace

if [[ ! -f "$PUB" ]]; then
  ssh-keygen -t ed25519 -C 'oracle-atlas-shifted-deploy' -f "$KEY" -N ''
fi

# GitHub deploy key (read-only — enough for git pull)
if ! grep -q 'Host github.com' ~/.ssh/config 2>/dev/null; then
  cat >> ~/.ssh/config <<'EOF'

Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
EOF
  chmod 600 ~/.ssh/config
fi

TOKEN=$(grep -m1 '^GITHUB_TOKEN=' /home/ubuntu/cto-aipa/.env | cut -d= -f2- | tr -d '\r')
PUBKEY=$(cat "$PUB")
EXISTING=$(curl -sS -H "Authorization: token ${TOKEN}" \
  https://api.github.com/repos/ElenaRevicheva/atlas-shifted/keys | grep -c 'oracle-whitespace-deploy' || true)
if [[ "$EXISTING" == "0" ]]; then
  curl -sS -X POST \
    -H "Authorization: token ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/ElenaRevicheva/atlas-shifted/keys \
    -d "$(python3 -c "import json,sys; print(json.dumps({'title':'oracle-whitespace-deploy','key':sys.argv[1],'read_only':True}))" "$PUBKEY")"
  echo "Deploy key registered."
else
  echo "Deploy key already registered."
fi

ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | head -1 || true

cd "$WS"
git remote set-url origin "$REPO"
git remote -v

git stash push -u -m "oracle pre-ssh-pull $(date -Iseconds)" || true
git fetch origin main
git pull --ff-only origin main
npm run build
pm2 restart whitespace
echo "DONE: whitespace on $(git rev-parse --short HEAD), PM2 restarted"
