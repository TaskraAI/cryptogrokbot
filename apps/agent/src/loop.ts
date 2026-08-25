import { Connection } from "@solana/web3.js";
import { dayKey, type Mode, type Policy, type RuntimeFlags, type SourceHit } from "@night/shared";
import { consecutiveLosses, loadExtraRules, loadGuardrails } from "@night/risk";
import { applyRealizedPnl } from "@night/risk";
import { buildSnapshot } from "@night/tape";
import { loadSources, ingestX, ingestRssSites, isMuted, hitsForCandidate, watchlistHits, type SourcesConfig } from "@night/social";
import {
  buySellRatio,
  fetchDexSearch,
  fetchDexToken,
  fetchPumpNewTokens,
  heliusHealth,
  jupiterPrice,
  pairToMetrics,
} from "@night/signals";
import { loadKeypair } from "@night/execution";
import {
  getBudget,
  getFlag,
  listAllClosed,
  listClosedSince,
  listOpenPositions,
  recentSourceHits,
  updatePosition,
  upsertBudget,
  type Store,
} from "@night/storage";
import { applyNightlyLearning, askGrokResearch, askLlm, lessonPrompt, loadLessons, similarFewShots, tagMistake } from "@night/learning";
import { notify } from "@night/telegram";
import { CrewBoard } from "@night/crew";
import type { AppConfig } from "./config.ts";
import { tryEnter } from "./entries.ts";
import { managePosition, rowToPosition } from "./watchman.ts";

export class AgentRuntime {
  flags: RuntimeFlags;
  lastNightly = 0;
  lastSocial = 0;
  connection?: Connection;
  fallback?: Connection;
  keypair?: ReturnType<typeof loadKeypair>;
  crew = new CrewBoard();

  constructor(
    public cfg: AppConfig,
    public policy: Policy,
    public store: Store,
  ) {
    this.flags = {
      mode: cfg.mode,
      masterEnabled: cfg.masterEnabled,
      rpcHealthy: true,
      jupiterHealthy: true,
      telegramHealthy: Boolean(cfg.telegramToken),
    };
    try {
      this.connection = new Connection(cfg.heliusRpc, "confirmed");
      this.fallback = new Connection(cfg.fallbackRpc, "confirmed");
      if (cfg.walletSecret) this.keypair = loadKeypair(cfg.walletSecret);
    } catch (err) {
      console.warn("wallet/rpc init", err);
    }
  }

  currentFlags(): RuntimeFlags {
    const master = getFlag(this.store, "master", String(this.flags.masterEnabled)) === "true";
    return { ...this.flags, masterEnabled: master, mode: this.cfg.mode };
  }

  async tick(): Promise<string[]> {
    const logs: string[] = [];
    this.crew.start("chief", "dispatching scout + sentinel + scholar");
    await this.refreshHealth();
    const sources = loadSources(this.cfg.sourcesPath);
    const guardrails = loadGuardrails(this.cfg.guardrailsPath);
    const extraRules = loadExtraRules(this.cfg.rulesPath);
    const now = Date.now();

    const scoutLogs: string[] = [];
    const sentinelLogs: string[] = [];
    const scholarLogs: string[] = [];

    const scout =
      now - this.lastSocial > 60_000
        ? this.runScout(sources, guardrails, extraRules, scoutLogs)
        : Promise.resolve();
    const sentinel = this.watchOpen(sentinelLogs);
    const scholar = this.runScholar(scholarLogs);

    await Promise.all([scout, sentinel, scholar]);
    logs.push(...scoutLogs, ...sentinelLogs, ...scholarLogs);
    this.crew.idle("chief", `tick done lines=${logs.length}`);
    return logs;
  }

  private async runScout(
    sources: SourcesConfig,
    guardrails: ReturnType<typeof loadGuardrails>,
    extraRules: ReturnType<typeof loadExtraRules>,
    logs: string[],
  ): Promise<void> {
    this.crew.start("scout", "polling X / RSS / Pump / Dex");
    try {
      const now = Date.now();
      const socialHits = [
        ...(await ingestX({ sources, bearer: this.cfg.xBearer, now })),
        ...(await ingestRssSites({ sources, now })),
      ];
      this.lastSocial = now;
      logs.push(`scout: social hits ${socialHits.length} watchlist ${sources.watchlist.length}`);
      await this.considerWatchlist(guardrails, extraRules, sources, logs);
      await this.considerEntries(socialHits, guardrails, extraRules, sources, logs);
      await this.considerPumpAndDex(socialHits, guardrails, extraRules, sources, logs);
      this.crew.idle("scout", `${socialHits.length} hits processed`);
    } catch (err) {
      this.crew.error("scout", err instanceof Error ? err.message : "scout failed");
    }
  }

  private async runScholar(logs: string[]): Promise<void> {
    this.crew.start("scholar", "shadow marks + nightly stats");
    try {
      await this.shadowMark(logs);
      this.maybeNightly();
      this.crew.idle("scholar", "journal up to date");
    } catch (err) {
      this.crew.error("scholar", err instanceof Error ? err.message : "scholar failed");
    }
  }

  private async refreshHealth(): Promise<void> {
    this.flags.rpcHealthy = await heliusHealth(this.cfg.heliusRpc);
    const px = await jupiterPrice("So11111111111111111111111111111111111111112");
    this.flags.jupiterHealthy = px != null;
  }

  private async considerWatchlist(
    guardrails: ReturnType<typeof loadGuardrails>,
    extraRules: ReturnType<typeof loadExtraRules>,
    sourcesCfg: SourcesConfig,
    logs: string[],
  ): Promise<void> {
    const now = Date.now();
    for (const hit of watchlistHits(sourcesCfg, now)) {
      if (!hit.mint || isMuted(sourcesCfg.mute, hit)) continue;
      const pair = await fetchDexToken(hit.mint);
      if (!pair) {
        logs.push(`watchlist ${hit.ticker ?? hit.mint.slice(0, 8)}: no DexScreener market`);
        continue;
      }
      const msg = await tryEnter({
        ...this.enterContext(guardrails, extraRules, sourcesCfg, [hit], buySellRatio(pair)),
        token: pairToMetrics(pair),
      });
      logs.push(msg);
      if (msg.startsWith("bought")) {
        await notify(this.cfg.telegramToken, this.cfg.telegramChatId, msg);
      }
    }
  }

  private async considerEntries(
    hits: SourceHit[],
    guardrails: ReturnType<typeof loadGuardrails>,
    extraRules: ReturnType<typeof loadExtraRules>,
    sourcesCfg: SourcesConfig,
    logs: string[],
  ): Promise<void> {
    const byMint = new Map<string, SourceHit[]>();
    for (const hit of hits) {
      if (!hit.mint) continue;
      if (isMuted(sourcesCfg.mute, hit)) continue;
      const list = byMint.get(hit.mint) ?? [];
      list.push(hit);
      byMint.set(hit.mint, list);
    }
    for (const [mint, mintHits] of byMint) {
      const pair = await fetchDexToken(mint);
      if (!pair) continue;
      const metrics = pairToMetrics(pair);
      const msg = await tryEnter({
        ...this.enterContext(guardrails, extraRules, sourcesCfg, mintHits, buySellRatio(pair)),
        token: metrics,
      });
      logs.push(msg);
      if (msg.startsWith("bought")) {
        await notify(this.cfg.telegramToken, this.cfg.telegramChatId, msg);
      }
    }
  }

  private async considerPumpAndDex(
    socialHits: SourceHit[],
    guardrails: ReturnType<typeof loadGuardrails>,
    extraRules: ReturnType<typeof loadExtraRules>,
    sourcesCfg: SourcesConfig,
    logs: string[],
  ): Promise<void> {
    const pump = await fetchPumpNewTokens();
    const trending = await fetchDexSearch("SOL");
    const candidates = [
      ...pump.map((p) => p.mint),
      ...trending.map((p) => p.baseToken.address),
    ];
    for (const mint of [...new Set(candidates)].slice(0, 8)) {
      const hits = hitsForCandidate(socialHits, sourcesCfg, mint);
      if (hits.length === 0) continue;
      const pair = await fetchDexToken(mint);
      if (!pair) continue;
      const msg = await tryEnter({
        ...this.enterContext(guardrails, extraRules, sourcesCfg, hits, buySellRatio(pair)),
        token: pairToMetrics(pair),
      });
      logs.push(msg);
    }
  }

  private enterContext(
    guardrails: ReturnType<typeof loadGuardrails>,
    extraRules: ReturnType<typeof loadExtraRules>,
    sourcesCfg: SourcesConfig,
    mintHits: SourceHit[],
    ratio: number,
  ) {
    const closed = listAllClosed(this.store);
    const nets = closed.slice(0, 12).map((r) => r.net_sol ?? 0);
    return {
      store: this.store,
      policy: this.policy,
      flags: this.currentFlags(),
      sources: mintHits,
      guardrails,
      extraRules,
      copyWallets: sourcesCfg.wallets.filter((w) => w.action === "copy").map((w) => w.address),
      fadeWallets: sourcesCfg.wallets.filter((w) => w.action === "fade").map((w) => w.address),
      consecutiveLosses: consecutiveLosses(nets),
      buySellRatio: ratio,
      dayKey: dayKey(Date.now(), this.policy.timezone),
      connection: this.connection,
      keypair: this.keypair,
      pumpApiKey: this.cfg.pumpApiKey,
    };
  }

  private async watchOpen(logs: string[]): Promise<void> {
    this.crew.start("sentinel", "watching open bags");
    const open = listOpenPositions(this.store);
    const sourcesCfg = loadSources(this.cfg.sourcesPath);
    const recentHits = recentSourceHits(this.store, Date.now() - 2 * 3600_000).map((h) => ({
      platform: h.platform as SourceHit["platform"],
      key: h.key,
      weight: h.weight as SourceHit["weight"],
      permalink: h.permalink ?? undefined,
      snippet: h.snippet,
      at: h.at,
      mint: h.mint ?? undefined,
      ticker: h.ticker ?? undefined,
    }));
    const lessons = loadLessons(this.cfg.lessonsPath);
    const closed = listAllClosed(this.store);

    if (!open.length) {
      this.crew.idle("sentinel", "no open positions");
      this.crew.idle("grok", "waiting for a runner");
      void sourcesCfg;
      return;
    }

    for (const row of open) {
      const pair = await fetchDexToken(row.mint);
      if (!pair) {
        logs.push(`no market data for ${row.ticker}; skip tick (no buy)`);
        continue;
      }
      const pos = rowToPosition(row);
      const snap = buildSnapshot({
        position: pos,
        market: {
          priceUsd: Number(pair.priceUsd ?? row.entry_price_usd),
          marketCapUsd: pair.marketCap ?? pair.fdv ?? 0,
          volume5m: pair.volume?.m5 ?? 0,
          volume1h: pair.volume?.h1 ?? 0,
          liquidityUsd: pair.liquidity?.usd ?? 0,
          buySellRatio: buySellRatio(pair),
        },
        social: { hits: recentHits.filter((h) => !h.mint || h.mint === row.mint) },
      });
      const few = similarFewShots(closed, row.last_pattern ?? "chop");
      this.crew.start("grok", `thesis ${row.ticker}`);
      const llm = await askLlm({
        apiKey: this.cfg.openaiKey,
        xaiKey: this.cfg.xaiKey,
        model: this.cfg.xaiKey ? this.cfg.grokModel : this.cfg.openaiModel,
        timeoutMs: this.cfg.llmTimeoutMs,
        system: lessonPrompt(lessons, few),
        user: JSON.stringify({
          mint: row.mint,
          snap,
          principalRecovered: row.principal_recovered_sol >= row.principal_sol,
        }),
      });
      this.crew.idle("grok", llm ? `${llm.action ?? "hold"} ${(llm.confidence ?? 0).toFixed(2)}` : "no Grok key / timeout");
      const conn = this.flags.rpcHealthy ? this.connection : this.fallback;
      const msg = await managePosition({
        store: this.store,
        row,
        snap,
        policy: this.policy,
        llm: llm
          ? { pattern: llm.pattern as never, action: llm.action, confidence: llm.confidence }
          : undefined,
        connection: conn,
        keypair: this.keypair,
        pumpApiKey: this.cfg.pumpApiKey,
      });
      logs.push(msg);
      if (msg.startsWith("closed") || msg.startsWith("returned") || msg.startsWith("trimmed")) {
        await notify(
          this.cfg.telegramToken,
          this.cfg.telegramChatId,
          `${msg}\nGrade with /grade ${row.id} win|meh|fail`,
        );
        if (msg.startsWith("closed")) {
          const b = getBudget(this.store, dayKey(Date.now(), this.policy.timezone));
          const netMatch = /net=([-\d.]+)/.exec(msg);
          if (netMatch) {
            const net = Number(netMatch[1]);
            let extra = b.extra_budget_sol;
            if (this.policy.compoundWins && net > 0) {
              extra += net * this.policy.compoundWinsFraction;
            }
            const next = applyRealizedPnl(
              {
                dayKey: b.day_key,
                spentSol: b.spent_sol,
                trades: b.trades,
                realizedLossSol: b.realized_loss_sol,
                lastEntryAt: b.last_entry_at,
                extraBudgetSol: extra,
              },
              net,
            );
            upsertBudget(this.store, {
              day_key: next.dayKey,
              spent_sol: next.spentSol,
              trades: next.trades,
              realized_loss_sol: next.realizedLossSol,
              last_entry_at: next.lastEntryAt,
              extra_budget_sol: next.extraBudgetSol,
            });
          }
        }
      }
    }
    this.crew.idle("sentinel", `${open.length} bags checked`);
  }

  async research(mint: string): Promise<string> {
    this.crew.start("grok", `multi-agent research ${mint.slice(0, 8)}…`);
    const pair = await fetchDexToken(mint);
    const text = await askGrokResearch({
      xaiKey: this.cfg.xaiKey,
      mint,
      ticker: pair?.baseToken.symbol,
    });
    this.crew.idle("grok", "research done");
    return text ?? "Set XAI_API_KEY to run Grok multi-agent research.";
  }

  async sellAll(): Promise<string> {
    const open = listOpenPositions(this.store);
    const out: string[] = [];
    for (const row of open) {
      const pair = await fetchDexToken(row.mint);
      const pos = rowToPosition(row);
      const snap = buildSnapshot({
        position: pos,
        market: {
          priceUsd: Number(pair?.priceUsd ?? row.entry_price_usd),
          marketCapUsd: pair?.marketCap ?? 0,
          volume5m: pair?.volume?.m5 ?? 0,
          volume1h: pair?.volume?.h1 ?? 0,
          liquidityUsd: pair?.liquidity?.usd ?? 0,
        },
        social: { hits: [] },
      });
      out.push(
        await managePosition({
          store: this.store,
          row,
          snap,
          policy: this.policy,
          sellAll: true,
          connection: this.connection,
          keypair: this.keypair,
          pumpApiKey: this.cfg.pumpApiKey,
        }),
      );
    }
    return out.join("\n") || "no positions";
  }

  private maybeNightly(): void {
    const now = Date.now();
    if (now - this.lastNightly < 6 * 3600_000) return;
    this.lastNightly = now;
    applyNightlyLearning({
      store: this.store,
      statsPath: this.cfg.patternStatsPath,
      policy: this.policy,
    });
  }

  private async shadowMark(logs: string[]): Promise<void> {
    const since = Date.now() - 24 * 3600_000;
    const closed = listClosedSince(this.store, since);
    for (const row of closed) {
      if (row.post_exit_price_usd != null) continue;
      if (!row.closed_at) continue;
      if (Date.now() - row.closed_at < this.policy.postExitMarkMinutes * 60_000) continue;
      const pair = await fetchDexToken(row.mint);
      const price = Number(pair?.priceUsd ?? 0);
      if (!price || !row.entry_price_usd) continue;
      const vsExit = row.peak_price_usd
        ? ((price - row.peak_price_usd) / row.peak_price_usd) * 100
        : ((price - row.entry_price_usd) / row.entry_price_usd) * 100;
      const mistake = tagMistake({
        exitReason: row.exit_reason,
        lastPattern: row.last_pattern,
        postExitPctChange: vsExit,
        netSol: row.net_sol ?? 0,
      });
      updatePosition(this.store, row.id, {
        post_exit_price_usd: price,
        mistake: mistake ?? row.mistake,
      });
      logs.push(`shadow-mark #${row.id} price=${price} mistake=${mistake ?? row.mistake ?? "-"}`);
    }
  }
}

export type { Mode };
