#!/usr/bin/env bash
# Seed a gitignored .env from .env.example with non-secret desk defaults.
# Never writes WALLET_SECRET_KEY or a Cloudflare token. Never prints secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

if [[ ! -f .env.example ]]; then
  echo "BLOCKED: .env.example missing"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "created .env from .env.example"
else
  echo ".env already present (not overwritten)"
fi

python3 - <<'PY'
from pathlib import Path
p = Path(".env")
text = p.read_text()
lines = text.splitlines(True)
wanted = {
    "MASTER_ENABLED": "false",
    "DASHBOARD_BIND": "0.0.0.0",
    "DASHBOARD_HOST": "cryptogrokbot.com",
    "DASHBOARD_EMAIL": "hello@taskra.ai",
}
seen = set()
out = []
for ln in lines:
    raw = ln.split("\n", 1)[0]
    if raw.strip() and not raw.lstrip().startswith("#") and "=" in raw:
        k = raw.split("=", 1)[0]
        if k in wanted:
            out.append(f"{k}={wanted[k]}\n")
            seen.add(k)
            continue
    out.append(ln)
if out and not out[-1].endswith("\n"):
    out[-1] += "\n"
for k, v in wanted.items():
    if k not in seen:
        out.append(f"{k}={v}\n")
p.write_text("".join(out))
p.chmod(0o600)
print("set MASTER_ENABLED=false DASHBOARD_BIND=0.0.0.0 DASHBOARD_HOST=cryptogrokbot.com DASHBOARD_EMAIL=hello@taskra.ai")
print("WALLET_SECRET_KEY and Cloudflare token were not written. See grok-bot/VPS.md")
PY
