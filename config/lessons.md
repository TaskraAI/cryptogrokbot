# Lessons for the AI

Write lasting improvements here, or add them with Telegram `/lesson`.
Newest lessons are injected into the LLM prompt first.

## What good looks like

- Two independent sources or one trusted source plus a passing on-chain score.
- Creator supply low, liquidity real, sell simulation succeeds.

## What to fade

- Single DexScreener boost with no trusted mention.
- Migration / tax / honeypot language.
- Dips where sentiment is only one weak reply and volume is dead.

- 2026-08-25T20:44:25.519Z FAIL-CLOSE LUNCHCLUB mint BJcx3evyAPCJ4HuZYENN1GHhXXHafizG4iR94i8upump. Scholar NO-GO: age ~2m, holders 2 (min 30), 5m vol $5.74 (min $1500), bonding-curve only, Token-2022, serial deployer Fef4dTHku3fBXXk59pFmhYwyoCr8QRT2wscHjiAeKYPx. Do not buy. Paper only.

- 2026-08-25T20:45:34.199Z FAIL-CLOSE GENNY mint 2aQrEKjqj2AF5cJnJQX4gTyc5FS3NMHd4ixxrHxYpump. Scholar NO-GO: Rugcheck danger creator rugged-history (score 9601), graphInsidersDetected 8, creator 4A4xF6cJrhySBHAtFXzLBjYmYwzazjZhPcEHJMyvTtQx with four prior dead pumps, Token-2022, LP 100% Pump AMM, 5m bsr 0.44 sell-side after +249% 1h. Mechanical size/liq pass, still a hard no. Do not buy. Paper only.

- 2026-08-25T21:52:37.984Z FAIL-CLOSE GrokBot mint GeSfrQiscfsEv4Hx2TKaB9Nfid12qND1YYRYS1vSpump. Impersonates xAI Grok Bot (site x.ai/bot, twitter GrokBotMemes), not official. graphInsidersDetected 732, serial Pump.fun deployer, late +115% 24h MC ~$9.7M. Mechanical LP lock is not enough. Do not buy. Paper only. Live stays off.

- 2026-08-25T21:55:21.432Z EXCEPTION (user override) GrokBot mint GeSfrQiscfsEv4Hx2TKaB9Nfid12qND1YYRYS1vSpump: PAPER buy only, 0.1 SOL, 4th-bag exception. LIVE still fail-closed. MASTER stays false. Exits: 40% at +25%, 30% at +50%, 30% moon bag, -20% stop on the rest. Block any LIVE attempt on this mint.

- 2026-08-25T21:58:09.749Z DESIGNATED LIVE HOT WALLET (public only): AqjSSUeqsEatVjwYVVRjyxSyM5DKxPPeLqqF7yAgmPRW. Verified empty: 0 SOL, no txs. LIVE stays fail-closed until funded AND WALLET_SECRET_KEY is in .env on the agent computer (never in chat). Any live tx must come from this address only. Not the main wallet. GrokBot paper exception unchanged.

- 2026-08-25T22:02:36.509Z NOT a hard fail-close: GASSPAS mint GCr352ouzNZkNQd3KZqs6jFuQb8LiYnWsEJSUpSfpump. Mechanicals pass. Scholar NO-GO for trusted watchlist only, not a risk block. Paper. Live stays off.

- 2026-08-25T22:08:56.231Z PAPER daily cap exception (user-ordered): 0.5 → 0.6 for one 0.1 GrokBot PAPER buy (GeSfrQiscfsEv4Hx2TKaB9Nfid12qND1YYRYS1vSpump). Live budget unchanged. MASTER false. After fill, freeze extra budget back to 0. Not a live raise.

- 2026-08-25T22:20:32.812Z HOT WALLET CHECK: AqjSSUeqsEatVjwYVVRjyxSyM5DKxPPeLqqF7yAgmPRW still 0 native SOL. Holds 49.790844 CASH (CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH, Token-2022) with permanent delegate E7JdFMP5AqdndJKstZV2mHdekLwAQbNWRHMpoozyB3qw. CASH is not live funding. LIVE stays fail-closed until native SOL is in that address.

- 2026-08-25T22:32:08.103Z LIVE RULES (user, via Chief): hot wallet AqjSSUeqsEatVjwYVVRjyxSyM5DKxPPeLqqF7yAgmPRW reported 0.509 SOL. LIVE still fail-closed until WALLET_SECRET_KEY is in host .env (never chat) AND MASTER is explicitly enabled for 0.05 SOL first size only. Do not allow 0.1 live. GrokBot stays PAPER not live. Scale only after wins.

- 2026-08-25T22:55:00.000Z LIVE ENABLED (user): MODE=LIVE and MASTER_ENABLED=true on the agent host. Signer is only AqjSSUeqsEatVjwYVVRjyxSyM5DKxPPeLqqF7yAgmPRW. maxSolPerTrade=0.05 (not 0.1). GrokBot mint GeSfrQiscfsEv4Hx2TKaB9Nfid12qND1YYRYS1vSpump muted + /never. Paper bags stay paper-exits. Scale only after wins.

- 2026-08-25T23:00:00.000Z TEST SIZE (user, via app): keep buys tiny until Taskra raises limits. maxSolPerTrade=0.01, dailyBudgetSol=0.05, dailyLossCapSol=0.03. Grok Bot on the app may change the desk when Taskra tells it to. Do not raise size, daily cap, or 0.1 tickets unless Taskra explicitly increases buy limits.

- 2026-08-25T23:15:00.000Z HIGH SENTIMENT SIZE ASK (user): if sentiment is high, Grok Bot must ask Taskra in the app whether to increase trade size **before investing**. Do not auto-bump. Keep 0.01 unless they confirm a one-shot 0.02 or 0.05 (`sizeAskCeilingSol`). Never 0.1. Home **Grok asks** + `GET/POST /api/size-asks`.

- 2026-08-25T23:20:00.000Z BUDGET SPLIT (bugfix): PAPER spend must not count toward the LIVE daily budget (and vice versa). Live daily cap stays 0.05 SOL. Do not raise live size. GrokBot mint stays muted / never live.

- 2026-08-26T00:58:00.000Z MASTER KILL + GROKBOT-ONLY ORDERS (user): MASTER off. Auto Scout/Sentinel must not send live buy/sell. Dashboard Home has Kill MASTER / Resume CONFIRM (env `MASTER_ENABLED=false` also kills on boot; boot must not revive a kill). Only Grok Bot Bearer (`cgbot_…`) can place buy/sell (paper and live). Owner cookie 403. Grok Bot explicit live orders still work while MASTER is off. Do not raise live size. GrokBot impersonator mint stays muted / never live.

- 2026-08-26T16:59:00.000Z CRYPTO ONLY (user): rung challenge stays Solana-only for now. Do not research or trade Polymarket until Taskra says it is time. polymarketEnabled=false. Intel Polymarket desk hidden. Same size cap / MASTER off / Grok Bot Bearer orders.



