# Walkthrough: Cursor + Grok Bot + this night desk

Three products share your **Cursor account** (`hello@taskra.ai`). They are not the same app.

| Product | What it is | What it is not |
|---------|------------|----------------|
| **Cursor IDE** (desktop / this cloud agent) | Writes and reviews `TaskraAI/CryptoTrading` | Does not control the Grok Bot Mac/iOS app |
| **Grok Bot app** | Named teammates + one cloud **Agent Computer** | Not an extension you install *inside* Cursor Settings |
| **This Node agent** (`npm run agent`) | Scout / Sentinel / Grok / Scholar ticking on port **8787** | Not started until a Bot (or you) runs it on a computer |
| **xAI API key** (`XAI_API_KEY`) | Powers `/research` and LLM theses in the Node app | Not created by signing into Grok Bot |

You **connect Grok Bot to Cursor by signing in**. There is no separate Grok Bot password, and I cannot complete that sign-in from this Linux VM.

Official: [Get started](https://docs.x.ai/grok-bot/get-started) · [Sign in](https://cursor.com/help/grok-bot/sign-in) · [Plans](https://cursor.com/help/grok-bot/plans)

---

## Part A — Connect Grok Bot to your Cursor account

### A1. Confirm you have access

Grok Bot is included on **Cursor Pro+**, **Cursor Ultra**, or **Cursor Teams**.  
**Cursor Pro** alone does **not** include it unless you [link individual SuperGrok Plus or Heavy](https://cursor.com/help/grok-bot/supergrok-heavy).

Open [cursor.com/dashboard](https://cursor.com/dashboard) while signed in as `hello@taskra.ai` and check the plan.

### A2. Privacy (required)

Grok Bot needs cloud data storage. If Cursor is on **Legacy Privacy Mode**, Grok Bot will not start.

1. Open [Cursor privacy settings](https://cursor.com/dashboard/settings?openPrivacy=true)
2. Switch off Legacy Privacy Mode (use a supported cloud setting)
3. Wait a minute, then reopen Grok Bot

### A3. Install (if the app is already downloaded, skip to A4)

Download from [cursor.com/bot/onboarding](https://cursor.com/bot/onboarding) (Mac or Windows). There is **no Linux desktop app**. iPhone: App Store **Grok Bot**, same Cursor account.

### A4. Sign in with Cursor (this is the “set up Grok Bot to Cursor” step)

**Desktop**

1. Open **Grok Bot**
2. Click **Get started** (or **Settings → Sign In with Cursor**)
3. In the browser window, sign in with the **same Cursor account** you use in Cursor IDE
4. Return to the app. **Settings** should show your Cursor email

**iPhone**

1. Open Grok Bot
2. Sign in with that same Cursor account
3. Bots and usage sync; they share one weekly usage bucket

If sign-in loops: update the app, sign out, clear cookies for `cursor.com` and `x.ai`, retry in a private window, or try [x.ai/bot](https://x.ai/bot) with the same account. Details: [sign-in help](https://cursor.com/help/grok-bot/sign-in).

### A5. Connect GitHub (so Bots can clone this private repo)

This repo is private (`TaskraAI/CryptoTrading`). The Agent Computer cannot `git clone` it until GitHub is authorized.

1. In Grok Bot: **Settings → Plugins** (sidebar **Plugins**, or avatar → Plugins on iOS)
2. Add **GitHub** (and finish the browser OAuth)
3. Grant the **TaskraAI** org / **CryptoTrading** repo (not “public only”)
4. Optional: add **GitHub** as a Cursor-account integration if you later want event-triggered routines

If clone returns 404, the plugin did not get that repo.

### A6. Optional plugins (not required for the paper demo)

| Plugin | Use later |
|--------|-----------|
| GitHub | Clone / pull this repo |
| (none for Solana RPC) | Put `HELIUS_RPC_URL` in `.env` via the **secure secret card**, never in chat |
| Telegram | Not a substitute for `TELEGRAM_BOT_TOKEN` in `.env` |

Never paste wallet keys, Telegram tokens, or API keys into a Bot chat. Use Grok Bot’s **secure secret card**, then have Chief write them into `/workspace/CryptoTrading/.env` on the **Agent Computer**.

### A7. What this does *not* connect

- It does **not** install Grok Bot inside Cursor IDE (no Cursor Settings → Integrations → Grok Bot).
- It does **not** make this cloud agent appear as a Bot in the Grok Bot sidebar.
- It does **not** create `XAI_API_KEY`. Get that from [console.x.ai](https://console.x.ai) if you want `/research`.
- Localhost MCP on your Mac is **not** visible to Grok Bot. Run `npm run agent` on the **Agent Computer**.

You are connected when: Grok Bot Settings shows `hello@taskra.ai`, GitHub plugin is Installed, and Chief can clone `TaskraAI/CryptoTrading`.

---

## Part B — Create the night desk in Grok Bot (once)

Files to copy live in this folder. Open them on GitHub or in Cursor: `grok-bot/profiles/` and `grok-bot/skills/`.

### B1. Create five Bots

For **each** of Chief, Scout, Sentinel, Grok, Scholar:

1. **New** (or `Cmd/Ctrl+N`) → **Create new agent**
2. **Bot actions → Edit Profile**
3. Paste **Name**, **Title**, **Description** from the matching `profiles/*.md` file (only the three fields, not the heading)
4. **Skills**: add / paste the matching `skills/*.md` (or Settings → Plugins → Yours → enable that skill for this Bot)
5. Pick a distinct color so the group chat is readable
6. Pin the five Bots

Optional: on iOS, swipe a Bot → **Move to** → **New Section** named `Night desk`.

### B2. First paper run (Chief)

Open **Chief**. Paste everything in [`first-tasks/bring-up-paper.md`](first-tasks/bring-up-paper.md).

Watch **Agent Computer** (button on the conversation). You should see:

1. `git clone` + `git checkout cursor/solana-meme-night-agent-1f38`
2. `npm install`
3. `MODE=PAPER npm run agent`
4. Browser on **that** computer at `http://127.0.0.1:8787/`

If it asks you to take over for GitHub 2FA, take control, finish auth, then tell Chief to continue. Do not paste passwords into chat.

**Stay PAPER.** Do not set `MODE=LIVE` or `MASTER_ENABLED=true`.

### B3. Group chat (see them work together)

1. **New** → select Chief, Scout, Sentinel, Grok, Scholar (2–6 Bots)
2. Name it `Night desk`
3. Paste [`first-tasks/group-desk.md`](first-tasks/group-desk.md)
4. Use `@Scout` / `@Sentinel` / `@Grok` / `@Scholar` / `@Chief` when you want one owner

They share **one** computer. Only Chief starts `npm run agent`.

### B4. Optional paper routine (not live trading)

On Chief, after the paper loop is stable:

> Every 15 minutes, if `npm run agent` is not running in CryptoTrading, start `MODE=PAPER npm run agent`. Do not set LIVE or MASTER. Post a 5-line crew summary here. If git or npm fails, report the error and stop.

Then **View conversation details → Routines → Test run**. Pause the routine when you are not watching. Grok Bot’s computer is not a 24/7 VPS, and routines burn weekly usage.

---

## Part C — Feature walkthrough (what to say, what you should see)

Copy-paste lines are also in [`feature-prompts.md`](feature-prompts.md).

Until `config/sources.yaml` has real handles, Scout will often say “nothing to hunt.” That is still a successful paper desk.

### 1. Crew board (watch agents tick)

**Where:** Grok Bot Agent Computer browser, not your laptop.

**Say to Chief:**

> Open http://127.0.0.1:8787/ on this computer and screenshot the five cards. Also `curl -s http://127.0.0.1:8787/crew.json` and paste the JSON.

**Expect:** Chief, Scout, Sentinel, Grok, Scholar with recent timestamps. Telegram `/crew` is the same board if Telegram is configured.

If blank: `MODE=PAPER npm run agent -- --once` then start the long-running process again.

### 2. Discovery (Scout)

**Say in the group:**

> @Scout read config/sources.yaml. Tell me if the list is empty. If I paste handles, add them under x_accounts and show the diff. Do not buy.

Then add sources yourself (or ask Scout to edit the file), for example:

```yaml
x_accounts:
  - handle: "@yourtrusted"
    weight: trusted
    notes: "only this list"
```

**Expect:** Scout reports mints from *your* list only. Empty list → no candidates. Optional `X_BEARER_TOKEN` in `.env` (secret card) for official X timelines.

### 3. Tape and hold rule (Sentinel)

**Say:**

> @Sentinel restate HOLD vs sell. Then, if any paper position exists, describe its last tape (MC, volume, sentiment, pattern). If none, say so.

**Expect:** Dip + high/rising sentiment + volume alive → **HOLD**. Fade / dump / climax / dead volume / hard stop / time stop / `/sellall` → sell. LLM cannot disable stops.

### 4. One tick / paper “trade” (Chief)

**Say:**

> @Chief run `MODE=PAPER npm run agent -- --once` and paste the last decisions from the log. Do not go LIVE.

**Expect:** A scoring pass, possible paper fill if a candidate clears `config/policy.json` (0.5 SOL/day, 5 trades, 0.1 SOL, min score 60, etc.). Most first ticks do nothing if sources are empty — that is correct.

### 5. Research a mint (Grok)

Needs `XAI_API_KEY` from [console.x.ai](https://console.x.ai) in `.env` on the Agent Computer (secret card). Grok Bot login ≠ this key.

**Say:**

> @Grok research mint `<PASTE_MINT>`. Use the repo research path if the API key exists. Do not recommend selling through a healthy_dip. Paste a short thesis.

Or, if Telegram is running: `/research <mint>` in Telegram.

**Expect:** “No API key” if `.env` is empty — still OK; Grok should not invent citations.

### 6. Extra rules (Scholar + file)

**Say:**

> @Scholar list config/rules.yaml (on/off). Explain skip-fresh-snipe and freeze-revoked. Do not disable freeze-revoked.

To toggle without code (Telegram, if connected): `/rules` then `/rule off skip-fresh-snipe` or `/rule on min-vol-5m`.

Or: `@Scholar set skip-stale enabled true in rules.yaml and show the diff.`

### 7. Journal and grading (Scholar)

After a paper fill:

> @Scholar show today’s paper fills (sqlite / review). I grade trade `<id>` as meh — too thin volume. Save a lesson: skip sub-5k 5m volume on unknowns.

**Expect:** Updates to `config/lessons.md` or a proposed `rules.yaml` tighten. Scholar should not loosen daily loss caps.

Telegram equivalents: `/review today`, `/grade <id> win|meh|fail [note]`, `/lesson <text>`, `/never keyword:scam`.

### 8. Budget and kill switch (Chief)

**Say:**

> @Chief print policy.json caps and whether MASTER is off. Confirm MODE=PAPER.

**Expect:** 0.5 SOL/day, 5 trades, 0.1 per trade, −25% hard stop, MASTER false.  
Telegram: `/status` `/budget` `/policy` `/kill` (halts **live** buys and live sells; paper sells still run). `/resume CONFIRM` restores master when `MODE=LIVE` — it cannot set `MODE` and does not enable live while `MODE=PAPER`.

### 9. Telegram cockpit (optional second screen)

On the Agent Computer `.env` (secret card): `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from @BotFather, then restart `npm run agent`.

Phone: message **your** bot (not Grok Bot). Useful commands:

| Command | What it does |
|---------|----------------|
| `/crew` | Same five desks as port 8787 |
| `/status` `/budget` | Mode, master, spend |
| `/positions` `/tape <mint>` `/why <mint>` | Bags and tape |
| `/review 7d` `/trade <id>` `/grade …` | Journal |
| `/research <mint>` | xAI multi-agent |
| `/rules` `/rule on\|off <id>` | Extra filters |
| `/kill` | Stop new entries |
| `/sellall CONFIRM` | Flatten (paper or live) |

Keep Grok Bot for watching / teaching; keep Telegram for phone alerts.

### 10. Live trading (do not do this in the first week)

Only after you have graded paper fills:

1. Dedicated **hot wallet** (never the main wallet)
2. Secret card: `WALLET_SECRET_KEY`, `HELIUS_RPC_URL`
3. You type `MODE=LIVE` and `MASTER_ENABLED=true` in `.env` yourself
4. Small `dailyBudgetSol` in `policy.json`
5. `/kill` tested so you can halt entries

Chief’s description forbids inventing LIVE/MASTER. If a Bot offers to go live, refuse.

---

## Quick map: who you talk to

| You want… | Ping |
|-----------|------|
| Start/stop paper agent, board, clone, `.env` | `@Chief` |
| Handles, CAs, empty sources | `@Scout` |
| Hold vs sell, tape, stops | `@Sentinel` |
| Thesis / research | `@Grok` |
| Grades, lessons, `rules.yaml` | `@Scholar` |
| See handoffs | Night desk **group** |

---

## If it fails

| Symptom | Fix |
|---------|-----|
| Grok Bot will not start | Privacy mode; eligible plan; same Cursor email |
| Sign-in loop | [Sign-in help](https://cursor.com/help/grok-bot/sign-in) |
| `git clone` 404 | GitHub plugin + private repo access |
| Board on your Mac is empty | 8787 is on **Agent Computer**, not localhost on your laptop |
| Two agents fighting | `@Chief pkill -f apps/agent` then start one |
| Grok cannot research | `XAI_API_KEY` in `.env` via secret card |
| Scout idle | Fill `config/sources.yaml` |

Computer broken: **Settings → Beta → Recover Agent Computer** before Reset. Clone again if `/workspace` was wiped.
