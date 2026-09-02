const CANONICAL = "cryptogrokbot.com";
const REDIRECT_HOSTS = new Set([
  "www.cryptogrokbot.com",
  "dash.cryptogrokbot.com",
  "app.cryptogrokbot.com",
]);

const TUNNEL_DOWN_JSON = JSON.stringify({
  ok: false,
  error: "Desk is reconnecting. Wait a few seconds and try again.",
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

function sanitizeOriginResponse(incoming, originRes, body) {
  const path = incoming.pathname;
  const text = typeof body === "string" ? body : "";
  const isApi = path.startsWith("/api/");
  const html = originRes.headers.get("content-type") || "";
  const originLooksHtml = /html/i.test(html) || looksLikeTunnelHtml(text);
  if (isApi && (originRes.status >= 500 || originLooksHtml) && (originLooksHtml || looksLikeTunnelHtml(text) || originRes.status === 503)) {
    return new Response(TUNNEL_DOWN_JSON, {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (originRes.status === 503 && looksLikeTunnelHtml(text)) {
    if (isApi || path === "/health") {
      return new Response(TUNNEL_DOWN_JSON, {
        status: 502,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response(
      "<!doctype html><html><head><meta charset=utf-8><title>CryptoGrokBot</title></head><body style=\"font-family:system-ui;background:#07111d;color:#e8eef7;padding:2rem\"><h1>Desk is reconnecting</h1><p>Wait a few seconds and refresh.</p></body></html>",
      { status: 502, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
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
      return new Response("origin not configured", { status: 502, headers: { "content-type": "text/plain" } });
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
      if (incoming.pathname.startsWith("/api/")) {
        return new Response(TUNNEL_DOWN_JSON, {
          status: 502,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
      return new Response("origin unreachable", { status: 502, headers: { "content-type": "text/plain" } });
    }

    const body = await originRes.arrayBuffer();
    const ctype = originRes.headers.get("content-type") || "";
    if (ctype.includes("text/html") || incoming.pathname.startsWith("/api/") || incoming.pathname === "/health") {
      const text = new TextDecoder().decode(body);
      return sanitizeOriginResponse(incoming, originRes, text);
    }
    return new Response(body, { status: originRes.status, headers: originRes.headers });
  },
};
