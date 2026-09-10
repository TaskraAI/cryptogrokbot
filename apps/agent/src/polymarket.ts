const GAMMA = "https://gamma-api.polymarket.com";
const UA = "CryptoGrokBot/1.0 (+https://cryptogrokbot.com; research only)";

export type PolymarketMarketCard = {
  question: string;
  slug: string;
  url: string;
  endDate: string;
  volume24hr: number;
  liquidity: number;
  outcomes: Array<{ name: string; price: number | null }>;
};

export type PolymarketEventCard = {
  title: string;
  slug: string;
  url: string;
  volume24hr: number;
  liquidity: number;
  markets: PolymarketMarketCard[];
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function marketUrl(slug: string): string {
  return slug ? `https://polymarket.com/event/${slug}` : "https://polymarket.com";
}

function publicMarket(raw: Record<string, unknown>, eventSlug: string): PolymarketMarketCard {
  const names = arr(raw.outcomes).map((x) => String(x));
  const prices = arr(raw.outcomePrices).map((x) => {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  });
  const slug = String(raw.slug ?? eventSlug ?? "");
  return {
    question: String(raw.question ?? raw.groupItemTitle ?? slug),
    slug,
    url: marketUrl(eventSlug || slug),
    endDate: String(raw.endDate ?? ""),
    volume24hr: num(raw.volume24hr),
    liquidity: num(raw.liquidity),
    outcomes: names.map((name, i) => ({ name, price: prices[i] ?? null })),
  };
}

function publicEvent(raw: Record<string, unknown>): PolymarketEventCard {
  const slug = String(raw.slug ?? "");
  const markets = arr(raw.markets)
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .slice(0, 6)
    .map((m) => publicMarket(m, slug));
  return {
    title: String(raw.title ?? slug),
    slug,
    url: marketUrl(slug),
    volume24hr: num(raw.volume24hr),
    liquidity: num(raw.liquidity),
    markets,
  };
}

async function gammaGet(path: string): Promise<unknown> {
  const res = await fetch(`${GAMMA}${path}`, {
    headers: { accept: "application/json", "user-agent": UA },
  });
  if (!res.ok) throw new Error(`polymarket ${res.status}`);
  return res.json();
}

export async function searchPolymarket(query: string, limit = 8): Promise<PolymarketEventCard[]> {
  const q = query.trim().slice(0, 80);
  if (q.length >= 2) {
    const data = (await gammaGet(`/public-search?q=${encodeURIComponent(q)}`)) as { events?: unknown[] };
    return (data.events ?? [])
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
      .slice(0, limit)
      .map(publicEvent);
  }
  const data = (await gammaGet(
    `/events?closed=false&limit=${Math.min(20, Math.max(1, limit))}&order=volume24hr&ascending=false`,
  )) as unknown;
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object")
    .slice(0, limit)
    .map(publicEvent);
}

export function formatPolymarketGrounding(events: PolymarketEventCard[]): string {
  if (!events.length) return "No Polymarket events returned.";
  const lines: string[] = ["Live Polymarket (research only — do not place CLOB orders):"];
  for (const ev of events.slice(0, 8)) {
    lines.push(`- ${ev.title} vol24h=$${Math.round(ev.volume24hr)} liq=$${Math.round(ev.liquidity)} ${ev.url}`);
    for (const m of ev.markets.slice(0, 3)) {
      const book = m.outcomes
        .filter((o) => o.price != null)
        .map((o) => `${o.name}=${(o.price! * 100).toFixed(1)}¢`)
        .join(" ");
      lines.push(`    ${m.question}${book ? ` ${book}` : ""}`);
    }
  }
  return lines.join("\n");
}
