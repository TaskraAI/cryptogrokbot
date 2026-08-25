import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SourceHit, TokenMetrics } from "@night/shared";

export type ExtraRuleType =
  | "min_age_minutes"
  | "max_age_minutes"
  | "min_holders"
  | "min_volume_5m_usd"
  | "min_market_cap_usd"
  | "max_market_cap_usd"
  | "min_buy_sell_ratio"
  | "min_liquidity_usd"
  | "require_mint_revoked"
  | "require_freeze_revoked"
  | "require_graduated"
  | "hours_utc"
  | "max_consecutive_losses"
  | "block_keyword"
  | "require_copy_wallet"
  | "fade_wallet"
  | "max_name_length";

export interface ExtraRule {
  id: string;
  type: ExtraRuleType;
  value: string | number | boolean;
  enabled: boolean;
  when?: "entry" | "exit";
  note?: string;
}

export interface ExtraRuleFile {
  rules: ExtraRule[];
}

export interface ExtraRuleContext {
  token: TokenMetrics;
  sources: SourceHit[];
  now?: number;
  consecutiveLosses?: number;
  copyWallets?: string[];
  fadeWallets?: string[];
  buySellRatio?: number;
}

export function loadExtraRules(path: string): ExtraRule[] {
  const parsed = parseYaml(readFileSync(path, "utf8")) as ExtraRuleFile | null;
  return parsed?.rules ?? [];
}

export function saveExtraRules(path: string, rules: ExtraRule[]): void {
  writeFileSync(path, stringifyYaml({ rules }), "utf8");
}

export function setExtraRuleEnabled(path: string, id: string, enabled: boolean): boolean {
  const rules = loadExtraRules(path);
  const hit = rules.find((r) => r.id === id);
  if (!hit) return false;
  hit.enabled = enabled;
  saveExtraRules(path, rules);
  return true;
}

export function addExtraRule(path: string, rule: ExtraRule): ExtraRule {
  const rules = loadExtraRules(path);
  rules.push(rule);
  saveExtraRules(path, rules);
  return rule;
}

export function evaluateExtraRules(
  rules: ExtraRule[],
  ctx: ExtraRuleContext,
): { ok: boolean; reason: string; fired?: ExtraRule } {
  const now = ctx.now ?? Date.now();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.when && rule.when !== "entry") continue;
    const fail = fire(rule, ctx, now);
    if (fail) return { ok: false, reason: fail, fired: rule };
  }
  return { ok: true, reason: "extra rules passed" };
}

function fire(rule: ExtraRule, ctx: ExtraRuleContext, now: number): string | null {
  const t = ctx.token;
  const n = num(rule.value);
  switch (rule.type) {
    case "min_age_minutes":
      return t.ageMinutes < n ? `rule ${rule.id}: age ${t.ageMinutes.toFixed(1)}m < ${n}` : null;
    case "max_age_minutes":
      return t.ageMinutes > n ? `rule ${rule.id}: age ${t.ageMinutes.toFixed(1)}m > ${n}` : null;
    case "min_holders":
      return t.holders < n ? `rule ${rule.id}: holders ${t.holders} < ${n}` : null;
    case "min_volume_5m_usd":
      return t.volume5m < n ? `rule ${rule.id}: vol5m ${t.volume5m} < ${n}` : null;
    case "min_market_cap_usd":
      return t.marketCapUsd < n ? `rule ${rule.id}: mcap ${t.marketCapUsd} < ${n}` : null;
    case "max_market_cap_usd":
      return t.marketCapUsd > n ? `rule ${rule.id}: mcap ${t.marketCapUsd} > ${n}` : null;
    case "min_liquidity_usd":
      return t.liquidityUsd < n ? `rule ${rule.id}: liq ${t.liquidityUsd} < ${n}` : null;
    case "min_buy_sell_ratio":
      return (ctx.buySellRatio ?? 0.5) < n ? `rule ${rule.id}: buy/sell ${(ctx.buySellRatio ?? 0.5).toFixed(2)} < ${n}` : null;
    case "require_mint_revoked":
      return rule.value && !t.mintAuthorityRevoked ? `rule ${rule.id}: mint authority still live` : null;
    case "require_freeze_revoked":
      return rule.value && !t.freezeAuthorityRevoked ? `rule ${rule.id}: freeze authority still live` : null;
    case "require_graduated":
      return rule.value && !t.graduated ? `rule ${rule.id}: still on bonding curve` : null;
    case "hours_utc":
      return inHours(String(rule.value), new Date(now).getUTCHours()) ? null : `rule ${rule.id}: outside hours_utc ${rule.value}`;
    case "max_consecutive_losses":
      return (ctx.consecutiveLosses ?? 0) >= n ? `rule ${rule.id}: ${ctx.consecutiveLosses} consecutive losses` : null;
    case "block_keyword": {
      const kw = String(rule.value).toLowerCase();
      const blob = `${t.ticker} ${t.name ?? ""} ${ctx.sources.map((s) => s.snippet).join(" ")}`.toLowerCase();
      return blob.includes(kw) ? `rule ${rule.id}: keyword ${kw}` : null;
    }
    case "require_copy_wallet": {
      const copies = (ctx.copyWallets ?? []).map((w) => w.toLowerCase());
      if (!copies.length) return null;
      const hit = ctx.sources.some((s) => copies.includes(s.key.toLowerCase()) || copies.includes((s.mint ?? "").toLowerCase()));
      return hit ? null : `rule ${rule.id}: no copy-wallet hit`;
    }
    case "fade_wallet": {
      const fades = (ctx.fadeWallets ?? []).map((w) => w.toLowerCase());
      const hit = ctx.sources.some((s) => fades.includes(s.key.toLowerCase()));
      return hit ? `rule ${rule.id}: fade wallet in sources` : null;
    }
    case "max_name_length":
      return (t.name ?? t.ticker).length > n ? `rule ${rule.id}: name too long` : null;
    default:
      return null;
  }
}

function num(v: string | number | boolean): number {
  return typeof v === "number" ? v : Number(v);
}

/** "13-23" or "22-4" wrapping midnight. */
export function inHours(spec: string, hour: number): boolean {
  const m = spec.trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!m) return true;
  const a = Number(m[1]) % 24;
  const b = Number(m[2]) % 24;
  if (a === b) return true;
  if (a < b) return hour >= a && hour < b;
  return hour >= a || hour < b;
}

export function consecutiveLosses(nets: number[]): number {
  let n = 0;
  for (const v of nets) {
    if (v < 0) n += 1;
    else break;
  }
  return n;
}
