#!/usr/bin/env bash
# Run ON the always-on VPS (not a Cursor Cloud Agent).
# Starts npm run agent on 127.0.0.1:8787 so the existing Cloudflare Tunnel
# (origin.cryptogrokbot.com → http://127.0.0.1:8787) stops 502ing.
#
# Does NOT start localhost.run or keep-cf-origin.py. Do not point Worker ORIGIN
# at the named host until this script prints named origin LIVE.
# Never prints secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

if [[ -z "${FORCE_VPS_INSTALL:-}" ]]; then
  if [[ -n "${CURSOR_AGENT:-}" || -d /opt/cursor || -d /tmp/cursor ]]; then
    echo "BLOCKED: this looks like a Cursor Cloud Agent, not the VPS."
    echo "Clone the repo on the VPS and run this script there. See grok-bot/VPS.md"
    echo "Override only if you really mean it: FORCE_VPS_INSTALL=1 $0"
    exit 1
  fi
fi

if [[ ! -f .env ]]; then
  echo "no .env — creating one from .env.example (no secrets written). See grok-bot/VPS.md"
  bash scripts/prepare-restore.sh
fi
if [[ ! -f .env ]]; then
  echo "BLOCKED: .env is still missing. Run bash scripts/prepare-restore.sh"
  echo "See grok-bot/VPS.md"
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "BLOCKED: node is not on PATH. Install Node 22+ then re-run."
  exit 1
fi
NODE_MAJOR="$(node -p "parseInt(process.versions.node, 10)")"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "BLOCKED: Node $NODE_MAJOR found; need Node 22+."
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "installing npm dependencies"
  npm install
fi

mkdir -p data
chmod 600 .env || true

# Tunnel service is http://127.0.0.1:8787 — bind loopback so only cloudflared can reach the desk.
python3 - <<'PY'
from pathlib import Path
p = Path(".env")
text = p.read_text()
lines = text.splitlines(True)
out = []
seen_bind = False
for ln in lines:
    raw = ln.split("\n", 1)[0]
    if raw.strip() and not raw.lstrip().startswith("#") and raw.startswith("DASHBOARD_BIND="):
        out.append("DASHBOARD_BIND=127.0.0.1\n")
        seen_bind = True
        continue
    out.append(ln)
if not seen_bind:
    if out and not out[-1].endswith("\n"):
        out[-1] += "\n"
    out.append("DASHBOARD_BIND=127.0.0.1\n")
p.write_text("".join(out))
p.chmod(0o600)
print("DASHBOARD_BIND=127.0.0.1 (tunnel talks to localhost)")
PY

if grep -qE '^WALLET_SECRET_KEY=.+' .env; then
  echo "wallet        SET (never printed)"
else
  echo "NOTE: WALLET_SECRET_KEY is empty — paper desk only."
fi

UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"
PATH_DIR="$(dirname "$NODE_BIN"):$(dirname "$NPM_BIN"):/usr/local/bin:/usr/bin"

if [[ -w "$UNIT_DIR" ]] || command -v sudo >/dev/null 2>&1; then
  SUDO=()
  if [[ ! -w "$UNIT_DIR" ]]; then
    SUDO=(sudo)
  fi
  sed -e "s#WorkingDirectory=/opt/cryptogrokbot#WorkingDirectory=${ROOT}#" \
      -e "s#ExecStart=/usr/bin/bash scripts/keep-agent.sh#ExecStart=/usr/bin/bash ${ROOT}/scripts/keep-agent.sh#" \
      scripts/systemd/cryptogrokbot-agent.service > /tmp/cryptogrokbot-agent.service
  if ! grep -q '^Environment=PATH=' /tmp/cryptogrokbot-agent.service; then
    python3 - <<PY
from pathlib import Path
p = Path("/tmp/cryptogrokbot-agent.service")
text = p.read_text()
needle = "[Service]\n"
insert = "[Service]\nEnvironment=PATH=${PATH_DIR}\n"
if needle in text and "Environment=PATH=" not in text:
    p.write_text(text.replace(needle, insert, 1))
PY
  fi
  "${SUDO[@]}" install -m 644 /tmp/cryptogrokbot-agent.service "$UNIT_DIR/cryptogrokbot-agent.service"
  "${SUDO[@]}" systemctl daemon-reload
  "${SUDO[@]}" systemctl enable --now cryptogrokbot-agent.service
  echo "systemd       cryptogrokbot-agent.service enabled"
else
  echo "NOTE: cannot write $UNIT_DIR — starting keep-agent.sh in the background for this session only."
  if ! pgrep -f '[b]ash scripts/keep-agent.sh' >/dev/null 2>&1; then
    nohup bash scripts/keep-agent.sh >/tmp/cryptogrokbot-agent.log 2>&1 &
    echo "keep-agent    pid $!"
  else
    echo "keep-agent    already running"
  fi
fi

echo "waiting for http://127.0.0.1:8787/health"
ok=0
for i in $(seq 1 40); do
  if curl -sf --max-time 3 http://127.0.0.1:8787/health 2>/dev/null | grep -q cryptogrokbot-dashboard; then
    echo "local :8787  UP"
    ok=1
    break
  fi
  sleep 2
done
if [[ "$ok" -ne 1 ]]; then
  echo "BLOCKED: :8787 never answered. Check: journalctl -u cryptogrokbot-agent.service -n 80"
  exit 1
fi

UA='Mozilla/5.0 (compatible; CryptoGrokBotOriginWatch/1.0; +https://cryptogrokbot.com/health)'
named="$(curl -sS --max-time 12 -A "$UA" https://origin.cryptogrokbot.com/health 2>/dev/null || true)"
if printf '%s' "$named" | grep -q cryptogrokbot-dashboard && ! printf '%s' "$named" | grep -q '"origin":"down"'; then
  echo "named origin  LIVE — safe to publish Worker ORIGIN"
  echo "next: python3 scripts/keep-cf-origin.py --publish-named"
else
  echo "named origin  still not LIVE (${named:-empty})"
  echo "If this is still HTTP 502, the tunnel service is not http://127.0.0.1:8787 or cloudflared is on another box."
  echo "Do not publish Worker ORIGIN yet."
  exit 1
fi
