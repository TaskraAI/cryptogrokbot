#!/usr/bin/env bash
# Find CLOUDFLARE_API_TOKEN in env / .env / durable data file /tmp and
# write it to /tmp/cf-api.token and data/.cf-api.token (0600). Never prints it.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import os
from pathlib import Path

root = Path(".")
data = root / "data"
data.mkdir(exist_ok=True)
dests = [Path("/tmp/cf-api.token"), data / ".cf-api.token"]

def from_env_file(path: Path) -> str:
    if not path.is_file():
        return ""
    for ln in path.read_text().splitlines():
        if ln.startswith("CLOUDFLARE_API_TOKEN="):
            return ln.split("=", 1)[1].strip().strip("'").strip('"')
    return ""

token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
if not token:
    for path in (Path("/tmp/cf-api.token"), data / ".cf-api.token"):
        if path.is_file():
            token = path.read_text().strip()
            if token:
                break
if not token:
    token = from_env_file(root / ".env")
if not token:
    print("cf token not in env, .env, /tmp, or data/.cf-api.token — unchanged")
    raise SystemExit(0)

for dest in dests:
    dest.write_text(token + "\n")
    dest.chmod(0o600)

envp = root / ".env"
if envp.is_file() and not from_env_file(envp):
    text = envp.read_text()
    if "CLOUDFLARE_API_TOKEN=" in text:
        lines = []
        for ln in text.splitlines(True):
            if ln.startswith("CLOUDFLARE_API_TOKEN="):
                lines.append("CLOUDFLARE_API_TOKEN=" + token + ("\n" if ln.endswith("\n") else ""))
            else:
                lines.append(ln)
        envp.write_text("".join(lines))
    else:
        extra = "" if text.endswith("\n") else "\n"
        envp.write_text(text + extra + "CLOUDFLARE_API_TOKEN=" + token + "\n")
    envp.chmod(0o600)
print("wrote /tmp/cf-api.token and data/.cf-api.token (not printed)")
PY
