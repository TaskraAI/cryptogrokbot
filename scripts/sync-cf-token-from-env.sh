#!/usr/bin/env bash
# Copy CLOUDFLARE_API_TOKEN from the environment or gitignored .env into
# /tmp/cf-api.token (0600). Never prints the token.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import os
from pathlib import Path

dest = Path("/tmp/cf-api.token")
token = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
if not token:
    env = Path(".env")
    if env.is_file():
        for ln in env.read_text().splitlines():
            if ln.startswith("CLOUDFLARE_API_TOKEN="):
                token = ln.split("=", 1)[1].strip().strip("'").strip('"')
                break
if not token:
    print("cf token not in env or .env — /tmp/cf-api.token unchanged")
    raise SystemExit(0)
dest.write_text(token + "\n")
dest.chmod(0o600)
print("wrote /tmp/cf-api.token from CLOUDFLARE_API_TOKEN (not printed)")
PY
