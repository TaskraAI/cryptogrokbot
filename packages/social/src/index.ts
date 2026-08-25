import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { SourceHit, SourceWeight } from "@night/shared";

export interface WatchlistEntry {
  mint: string;
  ticker?: string;
  weight?: SourceWeight;
  notes?: string;
}

export interface SourcesConfig {
  watchlist: WatchlistEntry[];
  x_accounts: Array<{ handle: string; weight: SourceWeight; notes?: string }>;
  x_queries: Array<{ query: string }>;
  telegram: Array<{ name: string; id_or_username: string; weight: SourceWeight }>;
  discord: Array<{ server: string; channel: string; weight: SourceWeight }>;
  sites: Array<{ url: string; type: string; notes?: string }>;
  wallets: Array<{ address: string; action: "copy" | "ignore" | "fade"; notes?: string }>;
  mute: Array<{ type: string; value: string }>;
}

export function loadSources(path: string): SourcesConfig {
  const parsed = parseYaml(readFileSync(path, "utf8")) as Partial<SourcesConfig> | null;
  return {
    watchlist: (parsed?.watchlist ?? []).filter((w) => Boolean(w?.mint)),
    x_accounts: parsed?.x_accounts ?? [],
    x_queries: parsed?.x_queries ?? [],
    telegram: parsed?.telegram ?? [],
    discord: parsed?.discord ?? [],
    sites: parsed?.sites ?? [],
    wallets: parsed?.wallets ?? [],
    mute: parsed?.mute ?? [],
  };
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function extractMints(text: string): string[] {
  const found = new Set<string>();
  const re = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[0];
    if (![...token].every((c) => BASE58.includes(c))) continue;
    if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(token)) found.add(token);
  }
  return [...found];
}

export function isMuted(mute: SourcesConfig["mute"], hit: { mint?: string; ticker?: string; key?: string; snippet?: string }): boolean {
  const snippet = (hit.snippet ?? "").toLowerCase();
  for (const rule of mute) {
    const v = rule.value.toLowerCase();
    if (rule.type === "mint" && hit.mint?.toLowerCase() === v) return true;
    if (rule.type === "ticker" && hit.ticker?.toLowerCase() === v) return true;
    if (rule.type === "handle" && hit.key?.toLowerCase().replace(/^@/, "") === v.replace(/^@/, "")) return true;
    if (rule.type === "keyword" && snippet.includes(v)) return true;
  }
  return false;
}

export function dedupeHits(hits: SourceHit[], windowMs = 30 * 60 * 1000): SourceHit[] {
  const seen = new Map<string, SourceHit>();
  for (const hit of hits) {
    if (!hit.mint) continue;
    const key = `${hit.mint}:${Math.floor(hit.at / windowMs)}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, hit);
      continue;
    }
    if (hit.weight === "trusted" && prev.weight !== "trusted") seen.set(key, hit);
  }
  return [...seen.values()];
}

export async function ingestX(opts: {
  sources: SourcesConfig;
  bearer?: string;
  now?: number;
}): Promise<SourceHit[]> {
  if (!opts.bearer) return [];
  const now = opts.now ?? Date.now();
  const hits: SourceHit[] = [];
  for (const acct of opts.sources.x_accounts) {
    const handle = acct.handle.replace(/^@/, "");
    try {
      const userRes = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(handle)}`, {
        headers: { Authorization: `Bearer ${opts.bearer}` },
      });
      if (!userRes.ok) continue;
      const user = (await userRes.json()) as { data?: { id: string } };
      const id = user.data?.id;
      if (!id) continue;
      const tl = await fetch(
        `https://api.x.com/2/users/${id}/tweets?max_results=10&tweet.fields=created_at,text`,
        { headers: { Authorization: `Bearer ${opts.bearer}` } },
      );
      if (!tl.ok) continue;
      const body = (await tl.json()) as { data?: Array<{ id: string; text: string }> };
      for (const tweet of body.data ?? []) {
        const mints = extractMints(tweet.text);
        hits.push({
          platform: "x",
          key: `@${handle}`,
          weight: acct.weight,
          permalink: `https://x.com/${handle}/status/${tweet.id}`,
          snippet: tweet.text.slice(0, 280),
          at: now,
          mint: mints[0],
        });
      }
    } catch {
      // adapter failure is non-fatal
    }
  }
  for (const q of opts.sources.x_queries) {
    try {
      const res = await fetch(
        `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(q.query)}&max_results=10`,
        { headers: { Authorization: `Bearer ${opts.bearer}` } },
      );
      if (!res.ok) continue;
      const body = (await res.json()) as { data?: Array<{ id: string; text: string }> };
      for (const tweet of body.data ?? []) {
        const mints = extractMints(tweet.text);
        hits.push({
          platform: "x",
          key: `search:${q.query}`,
          weight: "watch",
          permalink: `https://x.com/i/web/status/${tweet.id}`,
          snippet: tweet.text.slice(0, 280),
          at: now,
          mint: mints[0],
        });
      }
    } catch {
      // ignore
    }
  }
  return hits.filter((h) => !isMuted(opts.sources.mute, h));
}

export async function ingestRssSites(opts: { sources: SourcesConfig; now?: number }): Promise<SourceHit[]> {
  const now = opts.now ?? Date.now();
  const hits: SourceHit[] = [];
  for (const site of opts.sources.sites) {
    if (site.type !== "rss") continue;
    try {
      const res = await fetch(site.url);
      if (!res.ok) continue;
      const xml = await res.text();
      const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/g)].slice(0, 10);
      for (const item of items) {
        const text = item[0].replace(/<[^>]+>/g, " ");
        const mints = extractMints(text);
        hits.push({
          platform: "rss",
          key: site.url,
          weight: "watch",
          permalink: site.url,
          snippet: text.slice(0, 280),
          at: now,
          mint: mints[0],
        });
      }
    } catch {
      // ignore
    }
  }
  return hits.filter((h) => !isMuted(opts.sources.mute, h));
}

export function hitsForMint(hits: SourceHit[], mint: string): SourceHit[] {
  return hits.filter((h) => h.mint === mint);
}

export function watchlistHits(sources: SourcesConfig, now = Date.now()): SourceHit[] {
  return sources.watchlist.map((w) => ({
    platform: "dexscreener" as const,
    key: `watchlist:${(w.ticker || w.mint).toLowerCase()}`,
    weight: w.weight ?? "trusted",
    snippet: w.notes || `watchlist ${w.ticker ?? w.mint}`,
    at: now,
    mint: w.mint,
    ticker: w.ticker,
  }));
}

/** Social hits plus a synthetic trusted hit when the mint is on the user's watchlist. */
export function hitsForCandidate(
  socialHits: SourceHit[],
  sources: SourcesConfig,
  mint: string,
  now = Date.now(),
): SourceHit[] {
  const social = hitsForMint(socialHits, mint);
  const listed = watchlistHits(sources, now).filter((h) => h.mint === mint);
  return [...social, ...listed];
}
