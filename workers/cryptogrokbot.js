const CANONICAL = "cryptogrokbot.com";
const REDIRECT_HOSTS = new Set([
  "www.cryptogrokbot.com",
  "dash.cryptogrokbot.com",
  "app.cryptogrokbot.com",
]);

const HOST_OFFLINE =
  "Desk host is offline. Ask Chief to run bash scripts/bring-origin-back.sh, then tap Log in again.";

const TUNNEL_DOWN_JSON = JSON.stringify({
  ok: false,
  error: HOST_OFFLINE,
});

const ORIGIN_DOWN_HEALTH = JSON.stringify({
  ok: true,
  service: "cryptogrokbot-dashboard",
  origin: "down",
  masterEnabled: false,
  autoTrade: "off",
});

/** Patch origin HTML so a hung/broken login script cannot leave a blank page. */
export function repairDashboardHtml(html) {
  return html
    .replaceAll('id="login" class="login hidden"', 'id="login" class="login"')
    .replaceAll(
      "raw.match(//invite/([^/?#]+)/)",
      'raw.match(new RegExp("/invite/([^/?#]+)"))',
    );
}

/** localhost.run / ngrok HTML must never be shown as a login error. */
export function looksLikeTunnelHtml(text) {
  const t = String(text || "");
  return (
    /no tunnel here/i.test(t) ||
    /tunnel.*not found/i.test(t) ||
    /ngrok/i.test(t) ||
    /<h1>/i.test(t)
  );
}

/** Always-on login shell so a dead tunnel never 502s the page. */
export function fallbackDeskHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="theme-color" content="#07090c"/>
  <title>CryptoGrokBot</title>
  <style>
    html, body { margin: 0; background: #07090c; color: #eef1f4; font-family: ui-sans-serif, system-ui, sans-serif; }
    .login { min-height: 100dvh; display: flex; flex-direction: column; justify-content: center; padding: 24px; max-width: 420px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p, label { font-size: 15px; line-height: 1.45; }
    .muted { color: #8b93a1; }
    .bad { color: #fb7185; }
    .ok { color: #4ade80; }
    label { display: block; font-size: 13px; color: #8b93a1; margin: 10px 0 6px; }
    input { width: 100%; min-height: 52px; background: #0b0e13; border: 1px solid #2a3140; border-radius: 12px; padding: 10px 12px; color: inherit; box-sizing: border-box; }
    button { min-height: 52px; border-radius: 12px; border: 0; background: #5eead4; color: #042f2e; font-weight: 700; width: 100%; margin-top: 12px; }
    .banner { background: #111827; border: 1px solid #2a3140; border-radius: 12px; padding: 10px 12px; font-size: 13px; margin: 8px 0 16px; }
  </style>
</head>
<body>
<div class="login">
  <h1>CryptoGrokBot</h1>
  <p class="muted">cryptogrokbot.com</p>
  <div class="banner"><span class="ok">Auto-trade is off.</span> MASTER is killed. The desk never buys or sells on its own. Only Taskra, Chief, Grok Bot, and invited team decide trades. <span id="originHint">This Cloud Agent is the origin — login and Grok Bot buys fail while it is offline.</span></div>
  <form id="loginStepCreds">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" value="hello@taskra.ai"/>
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password"/>
    <p id="loginErr" class="bad"></p>
    <button id="loginBtn" type="submit">Log in</button>
    <p class="muted" style="margin-top:20px">Grok Bot / AI invite — no 2FA</p>
    <label for="inviteToken">Invite token or URL</label>
    <input id="inviteToken" name="invite" autocomplete="off" placeholder="cgbot_… or https://…/invite/…"/>
    <p id="inviteErr" class="bad"></p>
    <button id="inviteBtn" type="button" style="background:transparent;color:#eef1f4;border:1px solid #2a3140">Join with invite</button>
  </form>
</div>
<script>
function friendlyError(text, status) {
  var raw = String(text || "");
  if (/no tunnel here/i.test(raw) || /<html/i.test(raw) || /<h1>/i.test(raw) || status === 502 || status === 503 || status === 530) {
    return "Desk host is offline. Ask Chief to run bash scripts/bring-origin-back.sh, then tap Log in again.";
  }
  var stripped = raw.replace(/<[^>]+>/g, " ").replace(/\\s+/g, " ").trim();
  if (!stripped || stripped.length > 160) return "Login failed. Try again.";
  return stripped;
}
async function api(path, opts) {
  var res = await fetch(path, Object.assign({ credentials: "same-origin", headers: { "content-type": "application/json" } }, opts || {}));
  var text = await res.text();
  var data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: text }; }
  if (!res.ok) {
    var err = new Error(friendlyError(data.error || text, res.status));
    throw err;
  }
  return data;
}
document.getElementById("loginStepCreds").addEventListener("submit", async function (e) {
  e.preventDefault();
  document.getElementById("loginErr").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("pw").value }) });
    location.reload();
  } catch (err) {
    document.getElementById("loginErr").textContent = err.message || "login failed";
  }
});
async function originLive() {
  try {
    var res = await fetch("/health", { cache: "no-store" });
    var data = await res.json();
    return !!(data && data.ok && data.service === "cryptogrokbot-dashboard" && data.origin !== "down");
  } catch (e) {
    return false;
  }
}
async function paintOriginHint() {
  var hint = document.getElementById("originHint");
  var err = document.getElementById("loginErr");
  if (await originLive()) {
    if (hint) hint.textContent = "Desk is back. Tap Log in.";
    if (err && /host is offline/i.test(err.textContent || "")) err.textContent = "Desk is back. Tap Log in.";
  } else if (hint) {
    hint.textContent = "This Cloud Agent is the origin — login and Grok Bot buys fail while it is offline.";
  }
}
paintOriginHint();
setInterval(paintOriginHint, 5000);
document.getElementById("inviteBtn").addEventListener("click", async function () {
  document.getElementById("inviteErr").textContent = "";
  var raw = (document.getElementById("inviteToken").value || "").trim();
  var m = raw.match(new RegExp("/invite/([^/?#]+)"));
  if (m) raw = decodeURIComponent(m[1]);
  if (!raw) { document.getElementById("inviteErr").textContent = "Paste the invite token"; return; }
  try {
    await api("/api/bot-token", { method: "POST", body: JSON.stringify({ token: raw }) });
    location.reload();
  } catch (err) {
    document.getElementById("inviteErr").textContent = err.message || "invite failed";
  }
});
</script>
</body>
</html>`;
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function jsonResponse(obj, status) {
  return new Response(typeof obj === "string" ? obj : JSON.stringify(obj), {
    status: status ?? 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function originDownResponse(incoming) {
  const path = incoming.pathname;
  if (path === "/health") return jsonResponse(ORIGIN_DOWN_HEALTH, 200);
  if (path === "/dashboard.js") {
    return new Response("/* desk reconnecting */\n", {
      status: 200,
      headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (path.startsWith("/api/")) return jsonResponse(TUNNEL_DOWN_JSON, 502);
  return htmlResponse(fallbackDeskHtml(), 200);
}

function sanitizeOriginResponse(incoming, originRes, body) {
  const path = incoming.pathname;
  const text = typeof body === "string" ? body : "";
  const isApi = path.startsWith("/api/");
  const html = originRes.headers.get("content-type") || "";
  const originLooksHtml = /html/i.test(html) || looksLikeTunnelHtml(text);
  if (originRes.status === 503 && looksLikeTunnelHtml(text)) {
    return originDownResponse(incoming);
  }
  if (isApi && (originRes.status >= 500 || originLooksHtml) && (originLooksHtml || looksLikeTunnelHtml(text) || originRes.status === 503)) {
    return jsonResponse(TUNNEL_DOWN_JSON, 502);
  }
  const headers = new Headers(originRes.headers);
  if (html.includes("text/html") && text) {
    const repaired = repairDashboardHtml(text);
    if (repaired !== text) {
      headers.delete("content-length");
      return new Response(repaired, { status: originRes.status, headers });
    }
  }
  return new Response(body, { status: originRes.status, headers });
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    if (REDIRECT_HOSTS.has(incoming.hostname.toLowerCase())) {
      incoming.protocol = "https:";
      incoming.hostname = CANONICAL;
      incoming.port = "";
      return Response.redirect(incoming.toString(), 301);
    }

    const origin = (env && env.ORIGIN) || "";
    if (!origin) {
      return originDownResponse(incoming);
    }

    const target = new URL(incoming.pathname + incoming.search, origin);
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.delete("cf-ipcountry");
    headers.delete("cf-ray");
    headers.delete("cf-visitor");
    headers.delete("cdn-loop");
    headers.delete("x-forwarded-proto");
    headers.delete("x-real-ip");
    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    let originRes;
    try {
      originRes = await fetch(target.toString(), init);
    } catch {
      return originDownResponse(incoming);
    }

    const body = await originRes.arrayBuffer();
    const ctype = originRes.headers.get("content-type") || "";
    if (ctype.includes("text/html") || incoming.pathname.startsWith("/api/") || incoming.pathname === "/health" || incoming.pathname === "/dashboard.js") {
      const text = new TextDecoder().decode(body);
      return sanitizeOriginResponse(incoming, originRes, text);
    }
    return new Response(body, { status: originRes.status, headers: originRes.headers });
  },
};
