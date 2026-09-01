#!/usr/bin/env python3
"""Keep cryptogrokbot.com reachable while this host runs the desk.

Preferred path: named tunnel `cryptogrokbot-dashboard` (remote Cloudflare config)
plus Worker ORIGIN = https://origin.cryptogrokbot.com (tunnel public hostname,
not *.cfargotunnel.com — Workers return Error 1102 for those).

trycloudflare `--url` hostnames from this VM return 530 Origin DNS error even
when cloudflared has a live QUIC connection. Do not publish them as ORIGIN
unless the named tunnel token cannot be fetched.

Health checks MUST hit https://cryptogrokbot.com/health with a browser-like
User-Agent. This VM often cannot resolve *.trycloudflare.com, and Cloudflare
returns 403 to Python-urllib's default UA even when curl/browsers get 200.

Never run two `--url` quick tunnels at once. Never prints or writes API tokens
to stdout.
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
NAMED_LOG = Path(os.environ.get("CF_NAMED_LOG", "/tmp/cf-named.log"))
TUNNEL_ID = os.environ.get("CF_TUNNEL_ID", "1a38795c-af25-4f8c-8dd1-7167da5b673c")
TUNNEL_NAME = os.environ.get("CF_TUNNEL_NAME", "cryptogrokbot-dashboard")
ORIGIN_HOST = os.environ.get("CF_ORIGIN_HOST", "origin.cryptogrokbot.com")
TUNNEL_TOKEN_FILE = Path(os.environ.get("TUNNEL_TOKEN_FILE", "/tmp/cf-tunnel.token"))
WORKER_DOMAINS_FILE = Path(os.environ.get("CF_WORKER_DOMAINS_FILE", "/tmp/cf-worker-domains.json"))
WORKER_JS = Path(
    os.environ.get(
        "CF_WORKER_JS",
        str(Path(__file__).resolve().parents[1] / "workers" / "cryptogrokbot.js"),
    )
)
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare.com")
PUBLIC_HEALTH = os.environ.get("CF_PUBLIC_HEALTH", "https://cryptogrokbot.com")
NAMED_ORIGIN_URL = f"https://{ORIGIN_HOST}"
HEALTH_UA = "Mozilla/5.0 (compatible; CryptoGrokBotOriginWatch/1.0; +https://cryptogrokbot.com/health)"
ZONE_ID = os.environ.get("CF_ZONE_ID", "b48c25ee8ebe0c890e8fa74d0e285c79")


def token() -> str:
    env = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if env:
        return env
    path = Path(os.environ.get("CLOUDFLARE_API_TOKEN_FILE", "/tmp/cf-api.token"))
    if path.is_file():
        return path.read_text().strip()
    raise FileNotFoundError("CLOUDFLARE_API_TOKEN missing")


def wait_for_token(interval: float = 10.0) -> str:
    """Host VMs come up without secrets. Wait until Taskra drops the token file."""
    while True:
        try:
            tok = token()
            if tok:
                return tok
        except FileNotFoundError:
            pass
        print(
            "waiting for CLOUDFLARE_API_TOKEN or /tmp/cf-api.token to publish Worker ORIGIN",
            flush=True,
        )
        time.sleep(interval)


def cf_request(method: str, path: str, *, data: bytes | None = None, content_type: str | None = None) -> dict:
    tok = token()
    headers = {
        "Authorization": f"Bearer {tok}",
        "User-Agent": HEALTH_UA,
    }
    if content_type:
        headers["Content-Type"] = content_type
    elif data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        data=data,
        method=method,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode("utf-8", "replace")
            if not raw.strip():
                return {"success": True}
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        if not raw.strip():
            return {"success": e.code in (200, 202, 204)}
        try:
            return json.loads(raw)
        except Exception:
            return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}


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


def publish(url: str, *, force: bool = False) -> None:
    last = URL_FILE.read_text().strip() if URL_FILE.is_file() else ""
    if not force and last == url:
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


def cloudflared_bin() -> str:
    return CLOUDFLARED if Path(CLOUDFLARED).exists() else "cloudflared"


def pids_matching(*needles: str) -> list[int]:
    try:
        out = subprocess.check_output(["ps", "-eo", "pid=,args="], text=True)
    except Exception:
        return []
    pids: list[int] = []
    for line in out.splitlines():
        text = line.strip()
        low = text.lower()
        if "cloudflared" not in low:
            continue
        if any(n not in text for n in needles):
            continue
        try:
            pids.append(int(text.split(None, 1)[0]))
        except ValueError:
            continue
    return pids


def quick_tunnel_pids() -> list[int]:
    pids: list[int] = []
    for pid in pids_matching("cloudflared", "--url"):
        try:
            args = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace")
        except Exception:
            args = ""
        if " tunnel " not in f" {args} " and "tunnel" not in args:
            continue
        pids.append(pid)
    if pids:
        return pids
    try:
        out = subprocess.check_output(["ps", "-eo", "pid=,args="], text=True)
    except Exception:
        return []
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


def named_tunnel_pids() -> list[int]:
    found: list[int] = []
    for pid in pids_matching("cloudflared"):
        try:
            args = Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\x00", b" ").decode("utf-8", "replace")
        except Exception:
            continue
        if "--url" in args:
            continue
        if "tunnel" in args and ("run" in args or TUNNEL_ID in args or TUNNEL_NAME in args):
            found.append(pid)
    return found


def kill_pids(pids: list[int], keep: int | None = None) -> None:
    for pid in pids:
        if keep is not None and pid == keep:
            continue
        print(f"stopping leftover pid {pid}", flush=True)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            continue
    deadline = time.time() + 6
    while time.time() < deadline:
        left = [p for p in pids if p != keep and Path(f"/proc/{p}").exists()]
        if not left:
            return
        time.sleep(0.25)
    for pid in pids:
        if keep is not None and pid == keep:
            continue
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def kill_quick_tunnels(keep: int | None = None) -> None:
    """Only `--url` quick tunnels. Named `tunnel run --token` is left alone."""
    kill_pids(quick_tunnel_pids(), keep=keep)


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
    return subprocess.Popen(
        [cloudflared_bin(), "tunnel", "--no-autoupdate", "--url", ORIGIN_PORT],
        stdout=open(LOG, "a"),
        stderr=subprocess.STDOUT,
        text=True,
    )


def save_named_tunnel_token() -> bool:
    body = cf_request("GET", f"/accounts/{ACCT}/cfd_tunnel/{TUNNEL_ID}/token")
    result = body.get("result")
    if not body.get("success") or not isinstance(result, str) or not result.strip():
        print(f"named tunnel token unavailable: {body.get('errors')}", flush=True)
        return False
    TUNNEL_TOKEN_FILE.write_text(result.strip() + "\n")
    TUNNEL_TOKEN_FILE.chmod(0o600)
    print("named tunnel token saved", flush=True)
    return True


def ensure_named_origin_hostname() -> None:
    body = cf_request("GET", f"/accounts/{ACCT}/cfd_tunnel/{TUNNEL_ID}/configurations")
    if not body.get("success"):
        print(f"tunnel config read failed: {body.get('errors')}", flush=True)
        return
    cfg = ((body.get("result") or {}).get("config")) or {}
    ingress = list(cfg.get("ingress") or [])
    have = any(isinstance(row, dict) and row.get("hostname") == ORIGIN_HOST for row in ingress)
    if not have:
        insert_at = 0
        for i, row in enumerate(ingress):
            if isinstance(row, dict) and not row.get("hostname"):
                insert_at = i
                break
            insert_at = i + 1
        ingress.insert(insert_at, {"hostname": ORIGIN_HOST, "service": ORIGIN_PORT})
        payload = {
            "config": {
                "ingress": ingress,
                "warp-routing": cfg.get("warp-routing") or {"enabled": False},
            }
        }
        put = cf_request(
            "PUT",
            f"/accounts/{ACCT}/cfd_tunnel/{TUNNEL_ID}/configurations",
            data=json.dumps(payload).encode(),
        )
        if put.get("success"):
            print(f"named tunnel hostname {ORIGIN_HOST} -> {ORIGIN_PORT}", flush=True)
        else:
            print(f"tunnel config update failed: {put.get('errors')}", flush=True)
    else:
        print(f"named tunnel already has {ORIGIN_HOST}", flush=True)

    record = {
        "type": "CNAME",
        "name": ORIGIN_HOST,
        "content": f"{TUNNEL_ID}.cfargotunnel.com",
        "ttl": 1,
        "proxied": True,
        "comment": "cryptogrokbot worker origin",
    }
    created = cf_request(
        "POST",
        f"/zones/{ZONE_ID}/dns_records",
        data=json.dumps(record).encode(),
    )
    if created.get("success"):
        print(f"DNS CNAME created for {ORIGIN_HOST}", flush=True)
    else:
        err = created.get("errors") or []
        codes = [e.get("code") for e in err if isinstance(e, dict)]
        if 81058 in codes or 81057 in codes:
            print(f"DNS CNAME for {ORIGIN_HOST} already exists", flush=True)
        else:
            print(f"DNS CNAME for {ORIGIN_HOST} skipped: {err}", flush=True)


def start_named_tunnel() -> subprocess.Popen[str]:
    kill_pids(named_tunnel_pids())
    NAMED_LOG.write_text("")
    return subprocess.Popen(
        [
            cloudflared_bin(),
            "tunnel",
            "--no-autoupdate",
            "run",
            "--token-file",
            str(TUNNEL_TOKEN_FILE),
        ],
        stdout=open(NAMED_LOG, "a"),
        stderr=subprocess.STDOUT,
        text=True,
    )


def list_worker_domains() -> list[dict]:
    body = cf_request("GET", f"/accounts/{ACCT}/workers/domains")
    if not body.get("success"):
        print(f"worker domains list failed: {body.get('errors')}", flush=True)
        return []
    return [row for row in (body.get("result") or []) if isinstance(row, dict)]


def detach_worker_domains() -> bool:
    """Let the named tunnel serve apex/www/dash/app when Worker ORIGIN is 530."""
    rows = list_worker_domains()
    ours = [row for row in rows if row.get("service") == SCRIPT]
    if not ours:
        print("no worker custom domains to detach", flush=True)
        return False
    WORKER_DOMAINS_FILE.write_text(json.dumps(ours, indent=2) + "\n")
    WORKER_DOMAINS_FILE.chmod(0o600)
    ok = True
    for row in ours:
        did = row.get("id")
        host = row.get("hostname")
        if not did:
            continue
        body = cf_request("DELETE", f"/accounts/{ACCT}/workers/domains/{did}")
        if body.get("success"):
            print(f"detached worker domain {host}", flush=True)
        else:
            print(f"detach {host} failed: {body.get('errors')}", flush=True)
            ok = False
    return ok


def reattach_worker_domains() -> None:
    if not WORKER_DOMAINS_FILE.is_file():
        return
    try:
        rows = json.loads(WORKER_DOMAINS_FILE.read_text())
    except Exception:
        return
    for row in rows:
        payload = {
            "environment": row.get("environment") or "production",
            "hostname": row.get("hostname"),
            "service": row.get("service") or SCRIPT,
        }
        zone = row.get("zone_id") or ZONE_ID
        if zone:
            payload["zone_id"] = zone
        if not payload.get("hostname"):
            continue
        body = cf_request(
            "PUT",
            f"/accounts/{ACCT}/workers/domains",
            data=json.dumps(payload).encode(),
        )
        if not body.get("success"):
            body = cf_request(
                "POST",
                f"/accounts/{ACCT}/workers/domains",
                data=json.dumps(payload).encode(),
            )
        host = payload["hostname"]
        if body.get("success"):
            print(f"reattached worker domain {host}", flush=True)
        else:
            print(f"reattach {host} failed: {body.get('errors')}", flush=True)


def monitor_public(proc: subprocess.Popen[str] | None = None) -> None:
    """Watch the public host. Recycle only after three consecutive misses."""
    fails = 0
    while True:
        if proc is not None and proc.poll() is not None:
            print("origin process exited", flush=True)
            return
        if public_ok():
            fails = 0
        else:
            fails += 1
            print(f"public health miss {fails}/3", flush=True)
            if fails >= 3:
                print("public site down; recycling origin", flush=True)
                return
        time.sleep(20)


def run_named_loop() -> bool:
    """Return False if named tunnel cannot be used so caller can fall back."""
    if not save_named_tunnel_token():
        return False
    ensure_named_origin_hostname()
    kill_quick_tunnels()
    detached = False
    proc: subprocess.Popen[str] | None = None
    try:
        while True:
            if proc is None or proc.poll() is not None:
                print(f"starting named tunnel {TUNNEL_NAME}", flush=True)
                proc = start_named_tunnel()
            try:
                publish(NAMED_ORIGIN_URL, force=True)
            except Exception as e:
                print(f"origin update error: {e}", flush=True)
            print("waiting for https://cryptogrokbot.com/health via named tunnel", flush=True)
            if wait_until(lambda: public_ok(), timeout=90, interval=3):
                print("cryptogrokbot.com healthy", flush=True)
                monitor_public(proc)
            else:
                print("public site still 530 with Worker in front of named origin", flush=True)
                if not detached:
                    print("detaching Worker custom domains so named tunnel can serve apex", flush=True)
                    detached = detach_worker_domains()
                    if wait_until(lambda: public_ok(), timeout=90, interval=3):
                        print("cryptogrokbot.com healthy via named tunnel", flush=True)
                        monitor_public(proc)
                    else:
                        print("apex still down after detach; restoring Worker domains", flush=True)
                        reattach_worker_domains()
                        detached = False
                else:
                    print("named tunnel up but public still down; restarting connector", flush=True)
            stop_proc(proc)
            kill_pids(named_tunnel_pids())
            print("named tunnel exited; restarting", flush=True)
            time.sleep(2)
    finally:
        stop_proc(proc)
        if detached and not public_ok(quiet=True):
            reattach_worker_domains()
    return True


def run_quick_loop() -> None:
    proc: subprocess.Popen[str] | None = None
    while True:
        if proc is None or proc.poll() is not None:
            print("starting quick tunnel", flush=True)
            proc = start_tunnel()
        url = ""
        for _ in range(45):
            url = current_url()
            if url:
                try:
                    publish(url, force=True)
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


def main() -> int:
    proc_holder: dict[str, subprocess.Popen[str] | None] = {"proc": None}

    def stop(_signum=None, _frame=None) -> None:
        stop_proc(proc_holder.get("proc"))
        sys.exit(0)

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    wait_for_token()

    extras = quick_tunnel_pids()
    if extras:
        print(f"existing quick tunnel pids: {extras}", flush=True)

    if public_ok():
        print("public site already healthy; monitoring until it fails", flush=True)
        monitor_public()

    print("public site down; using named tunnel cryptogrokbot-dashboard", flush=True)
    if run_named_loop():
        return 0

    print("named tunnel unavailable; last-resort trycloudflare origin", flush=True)
    run_quick_loop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
