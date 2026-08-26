# Grok Bot setup — Taskra night desk

**Start here for Cursor sign-in + click-by-click + feature walkthrough:** [`WALKTHROUGH.md`](WALKTHROUGH.md)  
**Copy-paste chat lines:** [`feature-prompts.md`](feature-prompts.md)

This folder is everything you paste into **Grok Bot** (the Mac/iOS app).  
It is **not** the same product as Grok Build CLI (`grok`) or the xAI API key used by this repo.

I (the Cursor cloud agent) **cannot sign into your Grok Bot account**. There is no public API to create Bots remotely. You create them once in the app; after that they share one **Agent Computer** and can run this repo so you watch five desks at once.

Official docs: [Grok Bot overview](https://docs.x.ai/grok-bot/overview) · [Agent computer](https://docs.x.ai/grok-bot/agent-computer)

---

## What you should see

Five named teammates in the sidebar, plus one **group chat** (six desks if you add Auditor):

| Bot | Job you watch |
|-----|----------------|
| **Chief** | Budget, kill switch, “go / no-go” |
| **Scout** | New mints from *your* X/Telegram/sites list |
| **Sentinel** | Tape: dip+sentiment = HOLD; fade/dump = sell |
| **Grok** | Thesis + xAI research (needs `XAI_API_KEY` in `.env` on the computer) |
| **Scholar** | `/review`, grades, extra rules |
| **Auditor** | Bug scan, paper default, secrets off git |

The Node process they start prints a live board at `http://127.0.0.1:8787/` **on Grok Bot’s computer** (not your laptop). Ask any bot: *open the crew board in the browser*.

---

## One-time in the Grok Bot app (about 10 minutes)

### 1. Sign in

Use the same xAI / Cursor account you used to download Grok Bot.

### 2. Connect GitHub (private repo)

This repo is **private** (`TaskraAI/CryptoTrading`). In Grok Bot settings, connect GitHub and grant access to that org/repo so the Agent Computer can `git clone`.

Until PR #1 is merged, clone the working branch:

```bash
git clone https://github.com/TaskraAI/CryptoTrading.git
cd CryptoTrading
git checkout cursor/solana-meme-night-agent-1f38
```

After merge, `main` is enough.

### 3. Create five Bots

For each row: **New → Create new agent → Edit Profile**.  
Copy **Name**, **Title**, and **Description** from `profiles/` (one file per bot).

Then **Skills → add** the matching file from `skills/`.

| Create this Bot | Paste from |
|-----------------|------------|
| Chief | `profiles/chief.md` + `skills/chief.md` + `skills/challenge.md` |
| Scout | `profiles/scout.md` + `skills/scout.md` |
| Sentinel | `profiles/sentinel.md` + `skills/sentinel.md` |
| Grok | `profiles/grok.md` + `skills/grok.md` + `skills/challenge.md` |
| Scholar | `profiles/scholar.md` + `skills/scholar.md` |

Optional: give each a distinct emoji / color in Edit Profile so the group chat is readable.

### 4. First message (paper only)

Open **Chief**. Paste the entire contents of `first-tasks/bring-up-paper.md`.

That task: clone → `npm install` → `MODE=PAPER npm run agent` → screenshot the terminal and open `http://127.0.0.1:8787/`.

**Do not** paste `LIVE`, `MASTER_ENABLED=true`, or any private key into Grok Bot unless you later decide to fund a dedicated hot wallet. Paper is the demo.

### 5. Group chat (see them work together)

**New group chat**. Add Chief, Scout, Sentinel, Grok, Scholar.

Paste `first-tasks/group-desk.md` as the first group message.

Use `@Scout` / `@Sentinel` / `@Grok` / `@Scholar` / `@Chief` so the right bot acts. They share one computer — only **one** `npm run agent` should be running.

### 6. Optional routine (night tick, still paper)

On **Chief**: create a routine (e.g. every 15 minutes while you sleep) that says:

> If `npm run agent` is not running, start `MODE=PAPER npm run agent` in the CryptoTrading repo. Do not change MODE to LIVE. Post a 5-line crew summary.

Turn the routine **off** if you are not watching. Grok Bot computer sessions are not a 24/7 VPS.

---

## Secrets (read this)

| Put here | Never put in a Bot profile/skill |
|----------|----------------------------------|
| `.env` **on the Agent Computer** after clone (see `../.env.example`) | Private keys, Telegram bot token, RPC keys in **Edit Profile** text (that text can be shared / logged) |
| `XAI_API_KEY` in `.env` so **Grok** can call `/research` | `MASTER_ENABLED=true` until you have graded paper fills |

Grok Bot **cannot** reach `localhost` MCP on your Mac. The agent in this repo is started **on Grok Bot’s cloud computer**, which is the right place.

---

## If something fails

- **Clone 404 / auth**: GitHub not connected, or branch not pushed.
- **Board blank**: wait one tick, or `npm run agent -- --once` then refresh `/crew.json`.
- **Grok says no API key**: add `XAI_API_KEY` to `.env` on the computer (xAI console, not the Grok Bot login).
- **Two agents fighting**: `pkill -f "apps/agent"` then start one process only.
