export function dashboardHtml(): string {
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
    .nav { position: fixed; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: repeat(5, 1fr);
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
  </style>
</head>
<body>
<div id="login" class="login hidden">
  <h1>CryptoGrokBot</h1>
  <p class="muted">cryptogrokbot.com</p>
  <div id="loginStepCreds">
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" inputmode="email" value="hello@taskra.ai" />
    <label for="pw">Password</label>
    <input id="pw" type="password" autocomplete="current-password" />
    <p id="loginErr" class="bad"></p>
    <button id="loginBtn" style="width:100%;margin-top:12px">Log in</button>
  </div>
  <div id="loginStepTotp" class="hidden">
    <p class="muted">Enter the 6-digit code from your authenticator app.</p>
    <label for="totp">2FA code</label>
    <input id="totp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" />
    <p id="totpErr" class="bad"></p>
    <button id="totpBtn" style="width:100%;margin-top:12px">Verify</button>
    <button id="totpBack" class="ghost" style="width:100%;margin-top:8px">Back</button>
  </div>
  <div id="loginStepEnroll" class="hidden">
    <p>Add this account in <b>Google Authenticator</b>, <b>Authy</b>, or iOS Passwords, then enter the first code.</p>
    <p><a id="otpauthLink" href="#">Open authenticator</a></p>
    <p class="mint" id="totpSecret"></p>
    <label for="enrollCode">First 2FA code</label>
    <input id="enrollCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="8" />
    <p id="enrollErr" class="bad"></p>
    <button id="enrollBtn" style="width:100%;margin-top:12px">Enable 2FA and log in</button>
  </div>
</div>
<div id="app" class="hidden">
  <div class="wrap">
    <section id="page-home"></section>
    <section id="page-crew" class="hidden"></section>
    <section id="page-trade" class="hidden"></section>
    <section id="page-book" class="hidden"></section>
    <section id="page-improve" class="hidden"></section>
  </div>
  <nav class="nav">
    <button data-page="home" class="on">${icon("home")}<span>Home</span></button>
    <button data-page="crew">${icon("crew")}<span>Crew</span></button>
    <button data-page="trade">${icon("trade")}<span>Trade</span></button>
    <button data-page="book">${icon("book")}<span>Book</span></button>
    <button data-page="improve">${icon("improve")}<span>Improve</span></button>
  </nav>
</div>
<script>
const $ = (id) => document.getElementById(id);
let page = "home";
let cache = {};
let crewTimer = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || "request failed");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function go(name) {
  page = name;
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("on", b.dataset.page === name));
  ["home","crew","trade","book","improve"].forEach((p) => {
    $("page-" + p).classList.toggle("hidden", p !== name);
  });
  refresh();
}

document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));

$("loginBtn").addEventListener("click", login);
$("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("email").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
$("totpBtn").addEventListener("click", verifyTotpStep);
$("totp").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyTotpStep(); });
$("totpBack").addEventListener("click", () => showLoginStep("creds"));
$("enrollBtn").addEventListener("click", enrollTotp);
$("enrollCode").addEventListener("keydown", (e) => { if (e.key === "Enter") enrollTotp(); });

function showLoginStep(step) {
  $("loginStepCreds").classList.toggle("hidden", step !== "creds");
  $("loginStepTotp").classList.toggle("hidden", step !== "totp");
  $("loginStepEnroll").classList.toggle("hidden", step !== "enroll");
}

async function login() {
  $("loginErr").textContent = "";
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: $("email").value, password: $("pw").value }),
    });
    $("pw").value = "";
    if (data.step === "enroll") {
      $("otpauthLink").href = data.otpauth;
      $("totpSecret").textContent = data.secret;
      showLoginStep("enroll");
      return;
    }
    if (data.step === "totp") {
      showLoginStep("totp");
      $("totp").focus();
      return;
    }
    showApp();
  } catch (e) {
    $("loginErr").textContent = e.message || "login failed";
  }
}

async function verifyTotpStep() {
  $("totpErr").textContent = "";
  try {
    await api("/api/2fa/verify", { method: "POST", body: JSON.stringify({ code: $("totp").value }) });
    $("totp").value = "";
    showApp();
  } catch (e) {
    $("totpErr").textContent = e.message || "2fa failed";
  }
}

async function enrollTotp() {
  $("enrollErr").textContent = "";
  try {
    await api("/api/2fa/enroll", { method: "POST", body: JSON.stringify({ code: $("enrollCode").value }) });
    $("enrollCode").value = "";
    showApp();
  } catch (e) {
    $("enrollErr").textContent = e.message || "2fa setup failed";
  }
}

async function showApp() {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  go(page);
}

function showLogin() {
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
  showLoginStep("creds");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
}

function pill(mode) {
  const live = String(mode).toUpperCase() === "LIVE";
  return '<span class="pill ' + (live ? "live" : "paper") + '">' + (live ? "LIVE" : "PAPER") + "</span>";
}

async function refresh() {
  try {
    if (page === "home") await renderHome();
    if (page === "crew") await renderCrew();
    if (page === "trade") await renderTrade();
    if (page === "book") await renderBook();
    if (page === "improve") await renderImprove();
  } catch (e) {
    if (e.status === 401) { showLogin(); return; }
    const el = $("page-" + page);
    el.innerHTML = '<div class="card bad">' + esc(e.message) + "</div>";
  }
}

async function renderHome() {
  const d = await api("/api/home");
  cache.home = d;
  const todos = (d.todos || []).map((t) =>
    '<div class="todo card" style="margin:8px 0"><input type="checkbox" data-todo="' + t.id + '"' +
    (t.done ? " checked" : "") + "/><div><b>" + esc(t.title) + "</b></div></div>"
  ).join("");
  const bugs = d.auditor
    ? '<div class="card"><div class="' + (d.auditor.ok ? "ok" : "bad") + '">' + esc(d.auditor.summary) +
      "</div><div class='muted'>" + esc(new Date(d.auditor.at).toLocaleString()) + "</div></div>"
    : '<div class="card muted">No auditor scan yet.</div>';
  $("page-home").innerHTML =
    "<h1>Desk</h1>" +
    '<div class="banner">' + pill(d.mode) + " master=" + esc(String(d.masterEnabled)) +
    " · live stays fail-closed without MASTER</div>" +
    '<div class="card"><h2 style="margin-top:0">P&amp;L</h2>' +
    "<p>Paper net <b>" + Number(d.pnl.paperNetSol).toFixed(4) + " SOL</b> · " + d.pnl.paperTrades + " closed</p>" +
    "<p>Live net <b>" + Number(d.pnl.liveNetSol).toFixed(4) + " SOL</b> · " + d.pnl.liveTrades + " closed</p>" +
    "<p class='muted'>Open positions: " + d.openCount + "</p></div>" +
    "<h2>Todos</h2>" + todos +
    '<div class="row"><input id="newTodo" placeholder="Add a todo"/><button id="addTodo">Add</button></div>' +
    "<h2>Bugs (Auditor)</h2>" + bugs +
    '<button id="runAudit" class="ghost" style="width:100%">Run auditor scan</button>' +
    '<p class="muted" style="margin-top:16px"><button class="ghost" id="logout">Log out</button></p>';
  $("page-home").querySelectorAll("input[data-todo]").forEach((box) => {
    box.addEventListener("change", async () => {
      await api("/api/todos/" + box.dataset.todo, { method: "PATCH", body: JSON.stringify({ done: box.checked }) });
    });
  });
  $("addTodo").onclick = async () => {
    const title = $("newTodo").value.trim();
    if (!title) return;
    await api("/api/todos", { method: "POST", body: JSON.stringify({ title }) });
    renderHome();
  };
  $("runAudit").onclick = async () => {
    $("runAudit").disabled = true;
    $("runAudit").textContent = "Scanning…";
    try { await api("/api/auditor", { method: "POST", body: JSON.stringify({ full: false }) }); }
    finally { renderHome(); }
  };
  $("logout").onclick = async () => { await api("/api/logout", { method: "POST", body: "{}" }); showLogin(); };
}

async function renderCrew() {
  const d = await api("/api/crew");
  const rows = (d.pulses || []).map((p) =>
    '<div class="card"><div class="row" style="align-items:center">' +
    "<div><b>" + esc(p.title) + "</b><div class='muted'>" + esc(p.job || p.id) + "</div></div>" +
    '<span class="pill ' + esc(p.status) + '">' + esc(p.status) + "</span></div>" +
    "<p>" + esc(p.detail) + '</p><div class="pulse-age">' + Math.max(0, Math.round((Date.now()-p.at)/1000)) +
    "s ago · ticks " + p.ticks + "</div></div>"
  ).join("");
  const log = (d.log || []).slice(0, 16).map((e) =>
    "<li><code>" + new Date(e.at).toISOString().slice(11,19) + "</code> <b>" + esc(e.id) + "</b> " + esc(e.detail) + "</li>"
  ).join("");
  $("page-crew").innerHTML =
    "<h1>Crew</h1><p class='muted'>All six agents pulse at once. Auditor is the bug scanner.</p>" +
    rows + "<h2>Recent</h2><ul>" + log + "</ul>" +
    '<button id="runAudit2" class="ghost" style="width:100%">Run auditor scan</button>';
  const btn = $("runAudit2");
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    await api("/api/auditor", { method: "POST", body: "{}" }).catch(() => {});
    renderCrew();
  };
}

async function renderTrade() {
  const d = await api("/api/trade");
  const items = (d.watchlist || []).map((w) =>
    '<div class="card"><div class="row" style="align-items:center"><div><b>' + esc(w.ticker || "?") +
    "</b><div class='mint'>" + esc(w.mint) + "</div></div>" +
    '<button data-buy="' + esc(w.mint) + '">Paper buy</button></div>' +
    (w.pairAddress
      ? '<iframe class="dex" title="DexScreener" src="https://dexscreener.com/solana/' + encodeURIComponent(w.pairAddress) +
        '?embed=1&theme=dark&trades=0&info=0" allow="clipboard-write"></iframe>'
      : '<p class="muted">No DexScreener pair yet.</p>') +
    "</div>"
  ).join("");
  $("page-trade").innerHTML =
    "<h1>Trade</h1>" +
    '<div class="banner">' + pill(d.mode) + " Paper buy writes the SQLite ledger only. Live needs MODE=LIVE and MASTER.</div>" +
    '<div class="card"><label>Mint address</label><input id="buyMint" placeholder="Solana mint"/>' +
    '<label>Size (SOL)</label><input id="buySol" type="number" step="0.01" value="0.05"/>' +
    '<div class="row" style="margin-top:10px"><button id="doBuy">Paper buy mint</button>' +
    '<button class="ghost" id="loadDex">Load DexScreener</button></div>' +
    '<p id="buyMsg" class="muted"></p><div id="dexBox"></div></div>' +
    "<h2>Watchlist</h2>" + (items || "<p class='muted'>Empty watchlist</p>");
  $("doBuy").onclick = () => buyMint($("buyMint").value.trim(), Number($("buySol").value || 0.05));
  $("loadDex").onclick = async () => {
    const mint = $("buyMint").value.trim();
    if (!mint) return;
    const info = await api("/api/dex?mint=" + encodeURIComponent(mint));
    $("dexBox").innerHTML = info.pairAddress
      ? '<iframe class="dex" src="https://dexscreener.com/solana/' + encodeURIComponent(info.pairAddress) +
        '?embed=1&theme=dark"></iframe>'
      : '<p class="muted">No Solana pair</p>';
  };
  $("page-trade").querySelectorAll("button[data-buy]").forEach((b) => {
    b.onclick = () => buyMint(b.dataset.buy, Number($("buySol").value || 0.05));
  });
}

async function buyMint(mint, sol) {
  const msg = $("buyMsg") || document.createElement("p");
  if ($("buyMsg")) $("buyMsg").textContent = "buying…";
  try {
    const r = await api("/api/buy", { method: "POST", body: JSON.stringify({ mint, sol }) });
    alert(r.message || (r.ok ? "bought" : "failed"));
    if (page === "trade") renderTrade();
  } catch (e) {
    alert(e.message);
  }
}

async function renderBook() {
  const d = await api("/api/book");
  const pos = (d.positions || []).map((p) =>
    '<div class="card"><b>#' + p.id + " " + esc(p.ticker) + "</b> " + pill(p.mode) +
    " <span class='pill'>" + esc(p.status) + "</span>" +
    '<div class="mint">' + esc(p.mint) + "</div>" +
    "<p>spent " + p.sol_spent + " SOL · tokens " + p.tokens_held +
    (p.net_sol != null ? " · net " + Number(p.net_sol).toFixed(4) : "") + "</p>" +
    (p.status === "open" ? '<button data-sell="' + p.id + '">Paper sell</button>' : "") +
    (p.grade ? "<p class='muted'>grade " + esc(p.grade) + " " + esc(p.grade_note || "") + "</p>" : "") +
    "</div>"
  ).join("");
  const wallets = (d.wallets || []).map((w) =>
    '<div class="card"><b>' + esc(w.label) + "</b> " +
    (w.connected ? '<span class="pill running">connected</span>' : '<span class="pill idle">no secret</span>') +
    '<div class="mint">' + esc(w.publicKey || "(no public key)") + "</div>" +
    "<p>desk " + esc(w.assignedDesk || "—") +
    " · SOL " + (w.solBalance == null ? "—" : Number(w.solBalance).toFixed(4)) + "</p>" +
    '<button class="danger" data-delw="' + w.id + '">Remove</button></div>'
  ).join("");
  $("page-book").innerHTML =
    "<h1>Book</h1>" +
    '<div class="card"><h2 style="margin-top:0">P&amp;L</h2><p>Paper ' + Number(d.pnl.paperNetSol).toFixed(4) +
    " SOL · Live " + Number(d.pnl.liveNetSol).toFixed(4) + " SOL</p></div>" +
    "<h2>Positions</h2>" + (pos || "<p class='muted'>No positions</p>") +
    "<h2>Wallets</h2><p class='muted'>Secrets are stored server-side only and never returned after save.</p>" +
    wallets +
    '<div class="card"><label>Label</label><input id="wLabel" placeholder="hot wallet"/>' +
    '<label>Public key</label><input id="wPub" placeholder="Solana address"/>' +
    '<label>Secret (optional, never shown again)</label><input id="wSec" type="password" autocomplete="off"/>' +
    '<label>Assigned desk</label><select id="wDesk">' +
    ["","chief","scout","sentinel","grok","scholar","auditor"].map((x) =>
      "<option>" + x + "</option>").join("") + "</select>" +
    '<button id="addWallet" style="width:100%;margin-top:12px">Save wallet</button></div>';
  $("page-book").querySelectorAll("button[data-sell]").forEach((b) => {
    b.onclick = async () => {
      const r = await api("/api/sell", { method: "POST", body: JSON.stringify({ idOrMint: String(b.dataset.sell) }) });
      alert(r.message || "sold");
      renderBook();
    };
  });
  $("page-book").querySelectorAll("button[data-delw]").forEach((b) => {
    b.onclick = async () => {
      await api("/api/wallets/" + b.dataset.delw, { method: "DELETE" });
      renderBook();
    };
  });
  $("addWallet").onclick = async () => {
    const body = {
      label: $("wLabel").value,
      publicKey: $("wPub").value,
      secret: $("wSec").value,
      assignedDesk: $("wDesk").value,
    };
    const r = await api("/api/wallets", { method: "POST", body: JSON.stringify(body) });
    $("wSec").value = "";
    if (JSON.stringify(r).includes(body.secret) && body.secret) {
      alert("server leaked a secret — not saved in UI");
    }
    renderBook();
  };
}

async function renderImprove() {
  const d = await api("/api/improve");
  const rules = (d.rules || []).map((r) =>
    '<div class="todo card"><input type="checkbox" data-rule="' + esc(r.id) + '"' + (r.enabled ? " checked" : "") +
    "/><div><b>" + esc(r.id) + "</b> <span class='muted'>" + esc(r.type) + "=" + esc(r.value) +
    "</span><div class='muted'>" + esc(r.note || "") + "</div></div></div>"
  ).join("");
  const grades = (d.ungraded || []).map((p) =>
    '<div class="card"><b>#' + p.id + " " + esc(p.ticker) + "</b> net " + Number(p.net_sol || 0).toFixed(4) +
    '<div class="row" style="margin-top:8px">' +
    '<button data-grade="' + p.id + '" data-g="win">win</button>' +
    '<button class="ghost" data-grade="' + p.id + '" data-g="meh">meh</button>' +
    '<button class="danger" data-grade="' + p.id + '" data-g="fail">fail</button></div></div>'
  ).join("");
  const fb = (d.feedback || []).map((f) =>
    "<li>" + esc(new Date(f.at).toISOString().slice(0,16)) + " — " + esc(f.text) + "</li>"
  ).join("");
  $("page-improve").innerHTML =
    "<h1>Improve</h1>" +
    "<h2>Rules</h2>" + rules +
    "<h2>Grade fills</h2>" + (grades || "<p class='muted'>No ungraded closed fills</p>") +
    "<h2>Feedback / lessons</h2>" +
    '<textarea id="fb" placeholder="What should the desk do better?"></textarea>' +
    '<button id="sendFb" style="width:100%;margin-top:8px">Save lesson</button>' +
    "<ul>" + fb + "</ul>" +
    "<h2>Lessons.md (tail)</h2><pre class='card' style='white-space:pre-wrap;font-size:12px'>" +
    esc(d.lessonsTail || "") + "</pre>";
  $("page-improve").querySelectorAll("input[data-rule]").forEach((box) => {
    box.addEventListener("change", async () => {
      await api("/api/rules", { method: "POST", body: JSON.stringify({ id: box.dataset.rule, enabled: box.checked }) });
    });
  });
  $("page-improve").querySelectorAll("button[data-grade]").forEach((b) => {
    b.onclick = async () => {
      await api("/api/grade", { method: "POST", body: JSON.stringify({ id: Number(b.dataset.grade), grade: b.dataset.g, note: "dashboard" }) });
      renderImprove();
    };
  });
  $("sendFb").onclick = async () => {
    const text = $("fb").value.trim();
    if (!text) return;
    await api("/api/feedback", { method: "POST", body: JSON.stringify({ text }) });
    renderImprove();
  };
}

async function boot() {
  try {
    await api("/api/session");
    showApp();
  } catch {
    showLogin();
  }
  setInterval(() => {
    if (page === "crew" && !$("app").classList.contains("hidden")) renderCrew().catch(() => {});
  }, 2000);
}
boot();
</script>
</body>
</html>`;
}

function icon(name: string): string {
  const paths: Record<string, string> = {
    home: "M4 12 L12 4 L20 12 V20 H4 Z",
    crew: "M8 10 a4 4 0 1 0 0.01 0 M16 11 a3 3 0 1 0 0.01 0 M4 19 c0-3 3-5 8-5 s8 2 8 5",
    trade: "M4 16 L10 10 L14 14 L20 8 M14 8 H20 V14",
    book: "M5 5 H19 V19 H5 Z M5 10 H19",
    improve: "M12 4 V20 M4 12 H20",
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${paths[name] ? `<path d="${paths[name]}"/>` : ""}</svg>`;
}
