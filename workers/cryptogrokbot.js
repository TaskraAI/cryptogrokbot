const CANONICAL = "cryptogrokbot.com";
const REDIRECT_HOSTS = new Set([
  "www.cryptogrokbot.com",
  "dash.cryptogrokbot.com",
  "app.cryptogrokbot.com",
]);

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
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", "https");
    const init = { method: request.method, headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }
    try {
      return await fetch(target, init);
    } catch {
      return new Response("origin unreachable", { status: 502, headers: { "content-type": "text/plain" } });
    }
  },
};
