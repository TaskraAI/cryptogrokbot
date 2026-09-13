#!/usr/bin/env bash
# Set the dashboard owner password on THIS disk (the VPS). Never prints it.
# Use this when Forgot password email does not arrive (RESEND_API_KEY missing).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data

if [[ -n "${1:-}" ]]; then
  echo "Do not pass the password on the command line (it shows in process lists)."
  echo "Run: bash scripts/set-dashboard-password.sh"
  echo "Then type the password when asked."
  exit 1
fi

if [[ ! -t 0 ]]; then
  echo "BLOCKED: this script reads the new password from the terminal (hidden)."
  exit 1
fi

printf 'New dashboard password (min 8 characters, hidden): '
IFS= read -r -s pass1
printf '\n'
printf 'Type it again: '
IFS= read -r -s pass2
printf '\n'

if [[ -z "$pass1" || ${#pass1} -lt 8 ]]; then
  unset pass1 pass2
  echo "BLOCKED: use at least 8 characters."
  exit 1
fi
if [[ "$pass1" != "$pass2" ]]; then
  unset pass1 pass2
  echo "BLOCKED: passwords did not match."
  exit 1
fi

umask 077
printf '%s\n' "$pass1" > data/.dashboard-password
chmod 600 data/.dashboard-password
unset pass1 pass2

python3 - <<'PY'
from pathlib import Path
env = Path(".env")
if env.is_file():
    lines = env.read_text().splitlines(True)
    out = []
    seen = False
    for ln in lines:
        raw = ln.split("\n", 1)[0]
        if raw.strip() and not raw.lstrip().startswith("#") and raw.startswith("DASHBOARD_PASSWORD="):
            out.append("DASHBOARD_PASSWORD=\n")
            seen = True
        else:
            out.append(ln)
    if not seen:
        if out and not out[-1].endswith("\n"):
            out[-1] += "\n"
        out.append("DASHBOARD_PASSWORD=\n")
    env.write_text("".join(out))
    env.chmod(0o600)
print("wrote data/.dashboard-password (not printed)")
print("cleared DASHBOARD_PASSWORD in .env so the file is used")
PY

echo "Restart the agent so login uses the new password:"
echo "  sudo systemctl restart cryptogrokbot-agent"
echo "Then log in at https://cryptogrokbot.com with hello@taskra.ai and that password."
