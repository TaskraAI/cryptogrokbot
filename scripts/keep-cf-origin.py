#!/usr/bin/env python3
"""Keep cryptogrokbot.com's Worker ORIGIN pointed at a live trycloudflare URL.

Cloudflare Workers cannot fetch *.cfargotunnel.com (Error 1102), so the public
site uses a quick tunnel as ORIGIN. Those hostnames die when cloudflared exits.
This watcher restarts the quick tunnel and re-uploads Worker ORIGIN.

Health checks MUST hit https://cryptogrokbot.com/health with a browser-like
User-Agent. This VM often cannot resolve *.trycloudflare.com, and Cloudflare
returns 403 to Python-urllib's default UA even when curl/browsers get 200.

Never run two `--url` quick tunnels at once — they fight over Worker ORIGIN.
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
WORKER_JS = Path(
    os.environ.get(
        "CF_WORKER_JS",
        str(Path(__file__).resolve().parents[1] / "workers" / "cryptogrokbot.js"),
    )
)
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare.com")
PUBLIC_HEALTH = os.environ.get("CF_PUBLIC_HEALTH", "https://cryptogrokbot.com")
HEALTH_UA = "Mozilla/5.0 (compatible; CryptoGrokBotOriginWatch/1.0; +https://cryptogrokbot.com/health)"


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
            "User-Agent": HEALTH_UA,
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


def http_health(url: str, *, quiet: bool = False) -> bool:
    if not url:
        return False
    req = urllib.request.Request(
        url.rstrip("/") + "/health",
        method="GET",
        headers={
            "User-Agent": HEALTH_UA,
            "Accept": "application/json,text/plain,*/*",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as res:
            body = res.read().decode("utf-8", "replace")
            ok = res.status == 200 and "cryptogrokbot-dashboard" in body
            if not ok and not quiet:
                print(f"health {url} status={res.status} body={body[:80]!r}", flush=True)
            return ok
    except urllib.error.HTTPError as e:
        if not quiet:
            print(f"health {url} HTTP {e.code}", flush=True)
        return False
    except Exception as e:
        if not quiet:
            print(f"health {url} {type(e).__name__}: {e}", flush=True)
        return False


def public_ok(*, quiet: bool = False) -> bool:
    """This VM often cannot resolve trycloudflare DNS; the Worker can. Use the public host."""
    return http_health(PUBLIC_HEALTH, quiet=quiet)


def wait_until(pred, timeout: float, interval: float = 2.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(interval)
    return False


def quick_tunnel_pids() -> list[int]:
    try:
        out = subprocess.check_output(["ps", "-eo", "pid=,args="], text=True)
    except Exception:
        return []
    pids: list[int] = []
    for line in out.splitlines():
        text = line.strip()
        if "cloudflared" not in text or "--url" not in text:
            continue
        if " tunnel " not in text:
            continue
        try:
            pids.append(int(text.split(None, 1)[0]))
        except ValueError:
            continue
    return pids


def kill_quick_tunnels(keep: int | None = None) -> None:
    """Only `--url` quick tunnels. Named `tunnel run --token` is left alone."""
    for pid in quick_tunnel_pids():
        if keep is not None and pid == keep:
            continue
        print(f"stopping leftover quick tunnel pid {pid}", flush=True)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    deadline = time.time() + 6
    while time.time() < deadline:
        left = [p for p in quick_tunnel_pids() if p != keep]
        if not left:
            return
        time.sleep(0.25)
    for pid in quick_tunnel_pids():
        if keep is not None and pid == keep:
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def stop_proc(proc: subprocess.Popen[str] | None) -> None:
    if not proc or proc.poll() is not None:
        return
    proc.send_signal(signal.SIGINT)
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


def start_tunnel() -> subprocess.Popen[str]:
    kill_quick_tunnels()
    LOG.write_text("")
    bin_path = CLOUDFLARED if Path(CLOUDFLARED).exists() else "cloudflared"
    return subprocess.Popen(
        [bin_path, "tunnel", "--no-autoupdate", "--url", ORIGIN_PORT],
        stdout=open(LOG, "a"),
        stderr=subprocess.STDOUT,
        text=True,
    )


def monitor_public(proc: subprocess.Popen[str] | None = None) -> None:
    """Watch the public host. Recycle only after three consecutive misses."""
    fails = 0
    while True:
        if proc is not None and proc.poll() is not None:
            print("quick tunnel process exited", flush=True)
            return
        if public_ok():
            fails = 0
        else:
            fails += 1
            print(f"public health miss {fails}/3", flush=True)
            if fails >= 3:
                print("public site down; starting a new origin tunnel", flush=True)
                return
        time.sleep(20)


def main() -> int:
    proc: subprocess.Popen[str] | None = None

    def stop(_signum=None, _frame=None) -> None:
        stop_proc(proc)
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    extras = quick_tunnel_pids()
    if extras:
        print(f"existing quick tunnel pids: {extras}", flush=True)

    if public_ok():
        print("public site already healthy; monitoring until it fails", flush=True)
        monitor_public()

    while True:
        if proc is None or proc.poll() is not None:
            print("starting quick tunnel", flush=True)
            proc = start_tunnel()
        url = ""
        for _ in range(45):
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
        if url:
            print("waiting for https://cryptogrokbot.com/health", flush=True)
            if not wait_until(lambda: public_ok(), timeout=90, interval=3):
                print("public site never became healthy; recycling", flush=True)
                stop_proc(proc)
                kill_quick_tunnels()
            else:
                print("cryptogrokbot.com healthy", flush=True)
                monitor_public(proc)
                stop_proc(proc)
                kill_quick_tunnels()
        print("quick tunnel exited; restarting", flush=True)
        time.sleep(2)


if __name__ == "__main__":
    raise SystemExit(main())
