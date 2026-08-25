function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export function dashboardHtml(opts?: { ownerEmail?: string }): string {
  const ownerEmail = escapeAttr(opts?.ownerEmail?.trim() || "hello@taskra.ai");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="theme-color" content="#07090c"/>
  <title>CryptoGrokBot</title>
  <style>
    :root {
      --bg: #07090c;
      --card: #12161c;
      --line: #2a3140;
      --text: #eef1f4;
      --muted: #8b93a1;
      --accent: #5eead4;
      --warn: #fbbf24;
      --bad: #fb7185;
      --ok: #4ade80;
      --tap: 52px;
      --nav: calc(64px + env(safe-area-inset-bottom, 0px));
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; }
    body { min-height: 100dvh; }
    button, input, select, textarea { font: inherit; color: inherit; }
    button { min-height: var(--tap); border-radius: 12px; border: 0; background: var(--accent);
      color: #042f2e; font-weight: 700; padding: 0 16px; }
    button.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
    button.danger { background: #7f1d1d; color: #fecaca; }
    button:disabled { opacity: 0.5; }
    input, select, textarea { width: 100%; min-height: var(--tap); background: #0b0e13;
      border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
    textarea { min-height: 96px; resize: vertical; }
    a { color: var(--accent); }
    .wrap { padding: 16px 16px var(--nav); max-width: 720px; margin: 0 auto; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    h2 { font-size: 16px; margin: 18px 0 8px; }
    p, li { font-size: 15px; line-height: 1.45; }
    .muted { color: var(--muted); }
    .row { display: flex; gap: 8px; flex-wrap: wrap; }
    .row > * { flex: 1; }
    .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
      padding: 14px; margin: 10px 0; }
    .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 12px;
      font-weight: 700; background: #1f2937; }
    .pill.paper { background: #134e4a; color: #99f6e4; }
    .pill.live { background: #7f1d1d; color: #fecaca; }
    .pill.running { background: #164e63; color: #a5f3fc; }
    .pill.idle { background: #1f2937; color: #d1d5db; }
    .pill.blocked { background: #78350f; color: #fde68a; }
    .pill.error { background: #7f1d1d; color: #fecaca; }
    .nav { position: fixed; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(6, 1fr);
      background: #0c1016; border-top: 1px solid var(--line); padding-bottom: env(safe-area-inset-bottom, 0);
      z-index: 20; }
    .nav button { background: transparent; color: var(--muted); border-radius: 0; font-size: 11px;
      font-weight: 600; min-height: 64px; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 2px; }
    .nav button.on { color: var(--accent); }
    .nav svg { width: 22px; height: 22px; }
    .hidden { display: none !important; }
    .login { min-height: 100dvh; display: flex; flex-direction: column; justify-content: center;
      padding: 24px; max-width: 420px; margin: 0 auto; }
    iframe.dex { width: 100%; height: 280px; border: 0; border-radius: 12px; background: #000; }
    .mint { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
      word-break: break-all; color: var(--muted); }
    .todo { display: flex; gap: 10px; align-items: flex-start; }
    .todo input { width: 28px; min-height: 28px; margin-top: 2px; flex: none; accent-color: var(--accent); }
    .ok { color: var(--ok); } .bad { color: var(--bad); } .warn { color: var(--warn); }
    .banner { background: #111827; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px;
      font-size: 13px; margin: 8px 0 12px; }
    label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 6px; }
    .pulse-age { font-size: 12px; color: var(--muted); }
    details.card > summary { cursor: pointer; font-weight: 700; min-height: var(--tap); display: flex; align-items: center; }
    pre.desk { white-space: pre-wrap; font-size: 13px; line-height: 1.45; margin: 0; }
    .login form { margin: 0; }
  </style>
</head>
<body>
<div id="login" class="login">
  <h1>CryptoGrokBot</h1>
  <p class="muted">cryptogrokbot.com</p>
  <noscript><p class="bad">JavaScript is required to log in.</p></noscript>
  <form id="loginStepCreds">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" inputmode="email" value="${ownerEmail}" />
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" />
    <p id="loginErr" class="bad"></p>
    <button id="loginBtn" type="submit" style="width:100%;margin-top:12px">Log in</button>
    <p class="muted" style="margin-top:20px">Grok Bot invite</p>
    <label for="inviteToken">Invite token or URL</label>
    <input id="inviteToken" name="invite" autocomplete="off" placeholder="cgbot_… or https://…/invite/…" />
    <p id="inviteErr" class="bad"></p>
    <button id="inviteBtn" type="button" class="ghost" style="width:100%;margin-top:8px">Join with invite</button>
  </form>
  <form id="loginStepEmail" class="hidden">
    <p class="muted">Enter the 6-digit code sent to <b id="emailTo"></b>.</p>
    <p class="mint hidden" id="devCodeBox"></p>
    <label for="emailCode">Email code</label>
    <input id="emailCode" name="emailCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" />
    <p id="emailErr" class="bad"></p>
    <button id="emailBtn" type="submit" style="width:100%;margin-top:12px">Verify email</button>
    <button id="emailBack" type="button" class="ghost" style="width:100%;margin-top:8px">Back</button>
  </form>
</div>
<div id="app" class="hidden">
  <div class="wrap">
    <section id="page-home"></section>
    <section id="page-crew" class="hidden"></section>
    <section id="page-trade" class="hidden"></section>
    <section id="page-book" class="hidden"></section>
    <section id="page-intel" class="hidden"></section>
    <section id="page-improve" class="hidden"></section>
  </div>
  <nav class="nav">
    <button data-page="home" class="on">${icon("home")}<span>Home</span></button>
    <button data-page="crew">${icon("crew")}<span>Crew</span></button>
    <button data-page="trade">${icon("trade")}<span>Trade</span></button>
    <button data-page="book">${icon("book")}<span>Book</span></button>
    <button data-page="intel">${icon("intel")}<span>Intel</span></button>
    <button data-page="improve">${icon("improve")}<span>Improve</span></button>
  </nav>
</div>
<script>
try { document.getElementById("login").classList.remove("hidden"); } catch (e) {}
</script>
<script src="/dashboard.js" defer></script>

</body>
</html>`;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    home: "M4 12 L12 4 L20 12 V20 H4 Z",
    crew: "M8 10 a4 4 0 1 0 0.01 0 M16 11 a3 3 0 1 0 0.01 0 M4 19 c0-3 3-5 8-5 s8 2 8 5",
    trade: "M4 16 L10 10 L14 14 L20 8 M14 8 H20 V14",
    book: "M5 5 H19 V19 H5 Z M5 10 H19",
    intel: "M12 3 L14 9 L20 9 L15 13 L17 19 L12 15 L7 19 L9 13 L4 9 L10 9 Z",
    improve: "M12 4 V20 M4 12 H20",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths[name] ? `<path d="${paths[name]}"/>` : ""}</svg>`;
}
