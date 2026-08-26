(function showLoginImmediately() {
  var el = document.getElementById("login");
  if (el) el.classList.remove("hidden");
})();

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
  ["home","crew","trade","book","intel","improve"].forEach((p) => {
    $("page-" + p).classList.toggle("hidden", p !== name);
  });
  refresh();
}

document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => go(b.dataset.page)));

$("loginStepCreds").addEventListener("submit", (e) => { e.preventDefault(); login(); });
$("loginStepEmail").addEventListener("submit", (e) => { e.preventDefault(); verifyEmailStep(); });
$("emailBack").addEventListener("click", () => showLoginStep("creds"));
$("inviteBtn").addEventListener("click", joinInvite);
$("inviteToken").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); joinInvite(); }
});

function showLoginStep(step) {
  $("loginStepCreds").classList.toggle("hidden", step !== "creds");
  $("loginStepEmail").classList.toggle("hidden", step !== "email");
}

async function login() {
  $("loginErr").textContent = "";
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: $("email").value, password: $("pw").value }),
    });
    $("pw").value = "";
    if (data.step === "email") {
      $("emailTo").textContent = data.email || $("email").value;
      if (data.devCode) {
        $("devCodeBox").classList.remove("hidden");
        $("devCodeBox").textContent = "Code (email sending not configured): " + data.devCode;
      } else {
        $("devCodeBox").classList.add("hidden");
        $("devCodeBox").textContent = "";
      }
      showLoginStep("email");
      $("emailCode").focus();
      return;
    }
    showApp();
  } catch (e) {
    $("loginErr").textContent = e.message || "login failed";
  }
}

async function verifyEmailStep() {
  $("emailErr").textContent = "";
  try {
    await api("/api/email/verify", { method: "POST", body: JSON.stringify({ code: $("emailCode").value }) });
    $("emailCode").value = "";
    showApp();
  } catch (e) {
    $("emailErr").textContent = e.message || "email verify failed";
  }
}

async function joinInvite() {
  $("inviteErr").textContent = "";
  let raw = ($("inviteToken").value || "").trim();
  const m = raw.match(new RegExp("/invite/([^/?#]+)"));
  if (m) raw = decodeURIComponent(m[1]);
  if (!raw) {
    $("inviteErr").textContent = "Paste the invite token";
    return;
  }
  try {
    await api("/api/bot-token", { method: "POST", body: JSON.stringify({ token: raw }) });
    $("inviteToken").value = "";
    showApp();
  } catch (e) {
    $("inviteErr").textContent = e.message || "invite failed";
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
    if (page === "intel") await renderIntel();
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
    " · auto live desk needs MASTER · only Grok Bot Bearer can buy/sell</div>" +
    masterCardHtml(d) +
    grokAsksHtml(d) +
    gemsHtml(d) +
    challengeCardHtml(d) +
    '<div class="card"><h2 style="margin-top:0">P&amp;L</h2>' +
    "<p>Paper net <b>" + Number(d.pnl.paperNetSol).toFixed(4) + " SOL</b> · " + d.pnl.paperTrades + " closed</p>" +
    "<p>Live net <b>" + Number(d.pnl.liveNetSol).toFixed(4) + " SOL</b> · " + d.pnl.liveTrades + " closed</p>" +
    (d.budget
      ? "<p>Paper day <b>" + Number(d.budget.paper.spentSol).toFixed(3) + "/" + Number(d.budget.paper.cap) +
        " SOL</b> · Live day <b>" + Number(d.budget.live.spentSol).toFixed(3) + "/" + Number(d.budget.live.cap) + " SOL</b></p>"
      : "") +
    "<p>Open positions: " + d.openCount + "</p></div>" +
    '<div class="card"><h2 style="margin-top:0">Intel</h2><p class="muted">Eight Grok desks: X sentiment, gems, project eval, whales, timing, narratives, portfolio, scam radar.</p>' +
    '<button id="goIntel" style="width:100%">Open Intel</button></div>' +
    '<div class="card" id="accessCard"><h2 style="margin-top:0">Access</h2>' +
    "<p class='muted'>Owner: " + esc(d.email || "") + " · email verification</p>" +
    '<button id="inviteGrok" style="width:100%">Invite Grok Bot</button>' +
    '<label style="margin-top:12px">Invite by email</label>' +
    '<div class="row"><input id="inviteEmail" type="email" placeholder="teammate@email"/><button class="ghost" id="inviteHuman">Send invite</button></div>' +
    '<p id="inviteMsg" class="muted"></p><div id="grantList"></div></div>' +
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
  const gi = $("goIntel");
  if (gi) gi.onclick = () => go("intel");
  bindMaster();
  bindChallenge();
  bindSizeAsks();
  bindGems();
  await bindAccess();
}

function challengeCardHtml(d) {
  const c = d.challenge;
  if (!c) return "";
  const r = c.rung || {};
  const jobs = ((c.playbook && c.playbook.tonight) || []).slice(0, 7).map((t) => "<li>" + esc(t) + "</li>").join("");
  const ideas = (c.ideas || []).slice(0, 6).map((i) =>
    "<p><span class='pill'>" + esc(i.venue) + "</span> " + esc(i.title) +
    " <span class='muted'>" + esc(i.status) + (i.side ? " · " + esc(i.side) : "") + "</span></p>"
  ).join("");
  const from = Number(r.from || 100);
  const to = Number(r.to || 5000);
  return (
    '<div class="card"><h2 style="margin-top:0">Rung challenge</h2>' +
    "<p><b>$" + from.toLocaleString() + " → $" + to.toLocaleString() + "</b>" +
    " · declared <b>$" + Number(c.bankrollUsd || 0).toLocaleString() + "</b>" +
    " · " + Number(r.progressPct || 0).toFixed(0) + "% of this rung</p>" +
    "<p class='muted'>" + esc((c.playbook && c.playbook.honesty) || "") + "</p>" +
    "<p class='muted'>Crypto via Grok Bot Bearer. Polymarket stays off until you say it is time.</p>" +
    "<ol style='padding-left:18px'>" + jobs + "</ol>" +
    "<h2>Ideas</h2>" + (ideas || "<p class='muted'>None yet. Grok Bot logs Solana ideas here.</p>") +
    '<label>Declared bankroll (USD)</label><div class="row"><input id="bankrollUsd" type="number" min="0" step="1" value="' +
    Number(c.bankrollUsd || 100) + '"/><button id="saveBankroll" class="ghost">Save</button></div>' +
    '<p id="challengeMsg" class="muted"></p></div>'
  );
}

function bindChallenge() {
  const btn = $("saveBankroll");
  if (!btn) return;
  btn.onclick = async () => {
    const msg = $("challengeMsg");
    btn.disabled = true;
    if (msg) msg.textContent = "saving…";
    try {
      await api("/api/challenge", { method: "POST", body: JSON.stringify({ bankrollUsd: Number($("bankrollUsd").value) }) });
    } catch (e) {
      if (msg) msg.textContent = e.message || "failed";
      btn.disabled = false;
      return;
    }
    renderHome();
  };
}

function masterCardHtml(d) {
  const on = Boolean(d.masterEnabled);
  return (
    '<div class="card"><h2 style="margin-top:0">MASTER</h2>' +
    "<p>" + (on
      ? "Auto Scout/Sentinel live txs are on. Kill MASTER to halt the auto desk. Grok Bot Bearer can still place explicit buy/sell."
      : "MASTER off. Auto live buys and live exits are halted. Only Grok Bot (Bearer invite token) can place buy and sell orders.") +
    "</p>" +
    (on
      ? '<button class="danger" id="killMaster" style="width:100%">Kill MASTER</button>'
      : '<label>Type CONFIRM to resume the auto live desk</label><input id="resumeConfirm" placeholder="CONFIRM" autocomplete="off"/>' +
        '<button id="resumeMaster" style="width:100%;margin-top:8px">Resume MASTER</button>') +
    '<p id="masterMsg" class="muted"></p></div>'
  );
}

function bindMaster() {
  const msg = $("masterMsg");
  const kill = $("killMaster");
  if (kill) {
    kill.onclick = async () => {
      kill.disabled = true;
      if (msg) msg.textContent = "killing…";
      try {
        await api("/api/master", { method: "POST", body: JSON.stringify({ enabled: false }) });
      } catch (e) {
        if (msg) msg.textContent = e.message || "failed";
      }
      renderHome();
    };
  }
  const resume = $("resumeMaster");
  if (resume) {
    resume.onclick = async () => {
      const confirm = ($("resumeConfirm") && $("resumeConfirm").value || "").trim();
      resume.disabled = true;
      if (msg) msg.textContent = "resuming…";
      try {
        await api("/api/master", { method: "POST", body: JSON.stringify({ enabled: true, confirm }) });
      } catch (e) {
        if (msg) msg.textContent = e.message || "failed";
        resume.disabled = false;
        return;
      }
      renderHome();
    };
  }
}

function gemsHtml(d) {
  const rows = d.opportunities || [];
  if (!rows.length) return "";
  return rows.map((o) => {
    const can = Boolean(d.canPlaceOrders);
    return (
      '<div class="card"><h2 style="margin-top:0">Gem — buy this</h2>' +
      "<p><b>" + esc(o.ticker) + "</b> hype <b>" + Number(o.sentiment).toFixed(2) +
      "</b> · score " + Number(o.score).toFixed(0) +
      " · vol5m " + Number(o.volume5m).toLocaleString() +
      " · cost-out <b>" + Number(o.costOutMultiple) + "x</b> then moon bag</p>" +
      "<p class='muted'>" + esc(o.mint) + "</p>" +
      "<p class='muted'>" + esc(o.note || "Grok Bot decides. Do not wait.") + "</p>" +
      (can
        ? '<div class="row"><button data-gem="' + o.id + '" data-action="buy">Buy ' + Number(o.sizeSol) + " SOL</button>" +
          '<button class="ghost" data-gem="' + o.id + '" data-action="skip">Skip</button></div>'
        : "<p>Tell Grok Bot: buy " + Number(o.sizeSol) + " SOL of " + esc(o.ticker) +
          " (Bearer POST /api/buy). Dashboard login cannot place orders.</p>") +
      '<p class="muted" data-gem-msg="' + o.id + '"></p></div>'
    );
  }).join("");
}

function bindGems() {
  document.querySelectorAll("button[data-gem]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.gem;
      const action = btn.dataset.action;
      const msg = document.querySelector('[data-gem-msg="' + id + '"]');
      document.querySelectorAll("button[data-gem='" + id + "']").forEach((b) => { b.disabled = true; });
      if (msg) msg.textContent = "sending…";
      try {
        const r = await api("/api/opportunities/" + id, {
          method: "POST",
          body: JSON.stringify({ action }),
        });
        if (msg) msg.textContent = r.message || (r.ok ? "done" : "answered");
      } catch (e) {
        if (msg) msg.textContent = e.message || "failed";
      }
      renderHome();
    };
  });
}

function grokAsksHtml(d) {
  const asks = d.sizeAsks || [];
  if (!asks.length) return "";
  return asks.map((a) => {
    const test = Number(a.testSol);
    const ceil = Number(a.ceilingSol);
    const can = Boolean(d.canPlaceOrders);
    const extra = [];
    if (can) {
      extra.push('<button data-ask="' + a.id + '" data-action="keep">Keep ' + test + "</button>");
      if (0.02 > test + 1e-12 && 0.02 <= ceil + 1e-12) {
        extra.push('<button class="ghost" data-ask="' + a.id + '" data-action="increase" data-sol="0.02">Increase 0.02</button>');
      }
      extra.push('<button data-ask="' + a.id + '" data-action="increase" data-sol="' + ceil + '">Increase ' + ceil + "</button>");
    }
    return (
      '<div class="card"><h2 style="margin-top:0">Grok asks</h2>' +
      "<p>Sentiment <b>" + Number(a.sentiment).toFixed(2) + "</b> is high on <b>" + esc(a.ticker) +
      "</b>. Increase trade size before investing?</p>" +
      "<p class='muted'>" + esc(a.mint) + "</p>" +
      (can
        ? '<div class="row">' + extra.join("") + "</div>"
        : "<p>Tell Grok Bot: keep " + test + ", increase 0.02, or increase " + ceil +
          ". Dashboard login cannot place buy/sell orders.</p>") +
      '<p class="muted" data-ask-msg="' + a.id + '"></p></div>'
    );
  }).join("");
}

function bindSizeAsks() {
  document.querySelectorAll("button[data-ask]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.ask;
      const action = btn.dataset.action;
      const sol = btn.dataset.sol ? Number(btn.dataset.sol) : undefined;
      const msg = document.querySelector('[data-ask-msg="' + id + '"]');
      document.querySelectorAll("button[data-ask='" + id + "']").forEach((b) => { b.disabled = true; });
      if (msg) msg.textContent = "sending…";
      try {
        const r = await api("/api/size-asks/" + id, {
          method: "POST",
          body: JSON.stringify({ action, sol }),
        });
        if (msg) msg.textContent = r.message || (r.ok ? "done" : "answered");
      } catch (e) {
        if (msg) msg.textContent = e.message || "failed";
      }
      renderHome();
    };
  });
}

async function bindAccess() {
  const box = $("grantList");
  const msg = $("inviteMsg");
  if (!box) return;
  async function refreshGrants() {
    const a = await api("/api/access");
    const rows = (a.grants || []).map((g) =>
      '<div class="card" style="margin:8px 0"><b>' + esc(g.label) + "</b> " +
      '<span class="pill">' + esc(g.kind) + "</span>" +
      '<div class="muted">' + esc(g.email) + "</div>" +
      '<button class="danger" data-revoke="' + esc(g.id) + '">Revoke</button></div>'
    ).join("");
    box.innerHTML = rows || "<p class='muted'>No invites yet.</p>";
    box.querySelectorAll("button[data-revoke]").forEach((b) => {
      b.onclick = async () => {
        await api("/api/access/revoke", { method: "POST", body: JSON.stringify({ id: b.dataset.revoke }) });
        refreshGrants();
      };
    });
  }
  async function invite(kind, email) {
    msg.textContent = "creating…";
    try {
      const r = await api("/api/access/invite", {
        method: "POST",
        body: JSON.stringify({ kind, email, label: kind === "grokbot" ? "Grok Bot" : "" }),
      });
      msg.innerHTML = "Share this URL with " + esc(r.label) + ":<br><span class='mint'>" + esc(r.url) + "</span>";
      await refreshGrants();
    } catch (e) {
      msg.textContent = e.message || "invite failed";
    }
  }
  $("inviteGrok").onclick = () => invite("grokbot");
  $("inviteHuman").onclick = () => invite("human", $("inviteEmail").value);
  await refreshGrants();
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
    (d.canPlaceOrders
      ? '<button data-buy="' + esc(w.mint) + '">Buy</button>'
      : '<span class="muted">Grok Bot only</span>') +
    "</div>" +
    (w.pairAddress
      ? '<iframe class="dex" title="DexScreener" src="https://dexscreener.com/solana/' + encodeURIComponent(w.pairAddress) +
        '?embed=1&theme=dark&trades=0&info=0" allow="clipboard-write"></iframe>'
      : '<p class="muted">No DexScreener pair yet.</p>') +
    "</div>"
  ).join("");
  const can = Boolean(d.canPlaceOrders);
  $("page-trade").innerHTML =
    "<h1>Trade</h1>" +
    '<div class="banner">' + pill(d.mode) +
    " Only Grok Bot (Bearer invite token) can place buy/sell. MASTER off halts auto Scout/Sentinel live txs. Live size stays at maxSolPerTrade.</div>" +
    '<div class="card"><label>Mint address</label><input id="buyMint" placeholder="Solana mint"/>' +
    '<label>Size (SOL)</label><input id="buySol" type="number" step="0.001" min="0.001" value="0.05"/>' +
    '<div class="row" style="margin-top:10px">' +
    (can
      ? '<button id="doBuy">Buy mint</button>'
      : '<button id="doBuy" disabled>Buy mint (Grok Bot only)</button>') +
    '<button class="ghost" id="loadDex">Load DexScreener</button></div>' +
    '<p id="buyMsg" class="muted">' +
    (can ? "" : "Owner dashboard cannot send orders. Tell Grok Bot the mint and size.") +
    "</p><div id=\"dexBox\"></div></div>" +
    "<h2>Watchlist</h2>" + (items || "<p class='muted'>Empty watchlist</p>");
  const doBuy = $("doBuy");
  if (doBuy && can) doBuy.onclick = () => buyMint($("buyMint").value.trim(), Number($("buySol").value || 0.01));
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
    b.onclick = () => buyMint(b.dataset.buy, Number($("buySol").value || 0.01));
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
    (p.status === "open"
      ? (d.canPlaceOrders
        ? '<button data-sell="' + p.id + '">Sell</button>'
        : "<p class='muted'>Grok Bot Bearer sells this bag. Dashboard login cannot.</p>")
      : "") +
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

async function renderIntel() {
  const d = await api("/api/desks");
  const cards = (d.desks || []).map((desk) => {
    const fields = (desk.fields || []).map((f) => {
      if (f.type === "select") {
        const opts = (f.options || []).map((o) => "<option>" + esc(o) + "</option>").join("");
        return "<label>" + esc(f.label) + '</label><select data-k="' + esc(f.key) + '">' + opts + "</select>";
      }
      return "<label>" + esc(f.label) + '</label><input data-k="' + esc(f.key) + '" placeholder="' + esc(f.placeholder || "") + '"/>';
    }).join("");
    const last = desk.last
      ? '<p class="muted">Last ' + esc(desk.last.via) + " · " + esc(new Date(desk.last.at).toLocaleString()) + "</p>"
      : "";
    const x = desk.useXSearch ? '<span class="pill">X search</span> ' : "";
    return '<details class="card" data-desk="' + esc(desk.id) + '"><summary>' + x + esc(desk.title) +
      "</summary><p class='muted'>" + esc(desk.blurb) + "</p>" + fields + last +
      '<button data-run="' + esc(desk.id) + '" style="width:100%;margin-top:12px">Run</button>' +
      '<p class="bad" data-err="' + esc(desk.id) + '"></p>' +
      '<pre class="desk" data-out="' + esc(desk.id) + '"></pre></details>';
  }).join("");
  $("page-intel").innerHTML =
    "<h1>Intel</h1>" +
    '<div class="banner">' + (d.grokReady ? "Grok/xAI ready — X search on sentiment and narratives." :
      "No XAI_API_KEY yet — desks still return a framework plus Dex grounding. Add the key for live X.") + "</div>" +
    cards;
  $("page-intel").querySelectorAll("button[data-run]").forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.run;
      const box = $("page-intel").querySelector('details[data-desk="' + id + '"]');
      const err = $("page-intel").querySelector('[data-err="' + id + '"]');
      const out = $("page-intel").querySelector('[data-out="' + id + '"]');
      const fields = {};
      box.querySelectorAll("[data-k]").forEach((el) => { fields[el.dataset.k] = el.value; });
      btn.disabled = true;
      btn.textContent = "Running…";
      err.textContent = "";
      out.textContent = "";
      try {
        const r = await api("/api/desks/" + id, { method: "POST", body: JSON.stringify({ fields }) });
        out.textContent = (r.via ? "[" + r.via + "]\\n\\n" : "") + (r.report || "");
      } catch (e) {
        err.textContent = e.message || "failed";
      } finally {
        btn.disabled = false;
        btn.textContent = "Run";
      }
    };
  });
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
  showLogin();
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
