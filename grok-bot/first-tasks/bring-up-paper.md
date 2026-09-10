Paste this as the first message to **Chief** (not the group):

---

Clone my private GitHub repo TaskraAI/CryptoTrading. Checkout branch `cursor/solana-meme-night-agent-1f38` if main does not have the agent yet.

Then on this Agent Computer:

1. `npm install`
2. `bash scripts/prepare-restore.sh` if `.env` is missing (or copy `.env.example`). Leave MODE=PAPER. Do **not** set MASTER_ENABLED or LIVE. Do **not** create a wallet. Fresh-disk secrets: see `grok-bot/RESTORE.md`.
3. Start `MODE=PAPER npm run agent` and keep it running.
4. Open the browser to `http://127.0.0.1:8787/` and show me the crew board (Chief, Scout, Sentinel, Grok, Scholar ticking).
5. Show me the terminal so I can see the five desks in the log.

If git clone fails, tell me exactly the error so I can connect GitHub in Grok Bot settings.

If 8787 is empty, run `MODE=PAPER npm run agent -- --once` and then start the long-running agent.

I want to watch agents work. Stay in paper. Do not trade live.
