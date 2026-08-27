#!/usr/bin/env python3
"""Keep cryptogrokbot.com's Worker ORIGIN pointed at a live trycloudflare URL.

Cloudflare Workers cannot fetch *.cfargotunnel.com (Error 1102), so the public
site uses a quick tunnel as ORIGIN. Those hostnames die when cloudflared exits.
This watcher restarts the quick tunnel and re-uploads Worker ORIGIN.
Never prints or writes API tokens.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import time
import uuid
import urllib.error
import urllib.request
from pathlib import Path

ACCT = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "35f07519cabd1e6505bdb773b149f211")
SCRIPT = os.environ.get("CF_WORKER_SCRIPT", "cryptogrokbot")
ORIGIN_PORT = os.environ.get("DASHBOARD_ORIGIN", "http://127.0.0.1:8787")
CLOUDFLARED = os.environ.get("CLOUDFLARED", "/tmp/cloudflared")
LOG = Path(os.environ.get("CF_QUICK_LOG", "/tmp/cf-quick.log"))
URL_FILE = Path(os.environ.get("CF_ORIGIN_URL_FILE", "/tmp/cf-origin-url.txt"))
WORKER_JS = Path(os.environ.get("CF_WORKER_JS", str(Path(__file__).resolve().parents[1] / "workers" / "cryptogrokbot.js")))
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare.com")


def token() -> str:
    env = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if env:
        return env
    path = Path(os.environ.get("CLOUDFLARE_API_TOKEN_FILE", "/tmp/cf-api.token"))
    if path.is_file():
        return path.read_text().strip()
    raise SystemExit("CLOUDFLARE_API_TOKEN missing")


def cf_put_worker(origin: str) -> None:
    tok = token()
    boundary = "----cf" + uuid.uuid4().hex
    metadata = json.dumps(
        {
            "main_module": "worker.js",
            "bindings": [{"type": "plain_text", "name": "ORIGIN", "text": origin}],
            "compatibility_date": "2024-09-23",
        }
    )
    js = WORKER_JS.read_text()
    raw = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"; filename=\"metadata.json\"\r\nContent-Type: application/json\r\n\r\n{metadata}\r\n".encode()
        + f"--{boundary}\r\nContent-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\nContent-Type: application/javascript+module\r\n\r\n".encode()
        + js.encode()
        + f"\r\n--{boundary}--\r\n".encode()
    )
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{ACCT}/workers/scripts/{SCRIPT}",
        data=raw,
        method="PUT",
        headers={
            "Authorization": f"Bearer {tok}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = json.loads(res.read().decode())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        raise RuntimeError(f"worker upload failed: {body.get('errors')}") from None
    if not body.get("success"):
        raise RuntimeError(f"worker upload failed: {body.get('errors')}")


def current_url() -> str:
    if not LOG.is_file():
        return ""
    text = LOG.read_text(errors="replace")
    found = URL_RE.findall(text)
    return found[-1] if found else ""


def publish(url: str) -> None:
    last = URL_FILE.read_text().strip() if URL_FILE.is_file() else ""
    if last == url:
        return
    print(f"updating Worker ORIGIN to {url}", flush=True)
    cf_put_worker(url)
    URL_FILE.write_text(url + "\n")
    print("origin updated", flush=True)


def start_tunnel() -> subprocess.Popen[str]:
    LOG.write_text("")
    bin_path = CLOUDFLARED if Path(CLOUDFLARED).exists() else "cloudflared"
    return subprocess.Popen(
        [bin_path, "tunnel", "--no-autoupdate", "--url", ORIGIN_PORT],
        stdout=open(LOG, "a"),
        stderr=subprocess.STDOUT,
        text=True,
    )


def main() -> int:
    proc: subprocess.Popen[str] | None = None

    def stop(_signum=None, _frame=None) -> None:
        if proc and proc.poll() is None:
            proc.send_signal(signal.SIGINT)
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    while True:
        if proc is None or proc.poll() is not None:
            print("starting quick tunnel", flush=True)
            proc = start_tunnel()
        for _ in range(40):
            url = current_url()
            if url:
                try:
                    publish(url)
                except Exception as e:
                    print(f"origin update error: {e}", flush=True)
                break
            if proc.poll() is not None:
                break
            time.sleep(1)
        while proc.poll() is None:
            time.sleep(5)
        print("quick tunnel exited; restarting", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    raise SystemExit(main())
