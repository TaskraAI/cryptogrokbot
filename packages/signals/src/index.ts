import type { TokenMetrics } from "@night/shared";

const DEX = "https://api.dexscreener.com";
const JUP_PRICE = "https://lite-api.jup.ag/price/v2";
const JUP_QUOTE = "https://lite-api.jup.ag/swap/v1/quote";
const SOL = "So11111111111111111111111111111111111111112";

export interface DexPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h1?: number; m5?: number; h24?: number };
  txns?: { m5?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
}

export async function fetchDexToken(mint: string): Promise<DexPair | null> {
  const res = await fetch(`${DEX}/latest/dex/tokens/${mint}`, {
    headers: { accept: "application/json", "user-agent": "CryptoTrading/paper" },
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { pairs?: DexPair[] };
  const pairs = (body.pairs ?? []).filter((p) => p.chainId === "solana");
  if (pairs.length === 0) return null;
  return pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
}

export async function fetchDexSearch(q: string): Promise<DexPair[]> {
  const res = await fetch(`${DEX}/latest/dex/search?q=${encodeURIComponent(q)}`, {
    headers: { accept: "application/json", "user-agent": "CryptoTrading/paper" },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { pairs?: DexPair[] };
  return (body.pairs ?? []).filter((p) => p.chainId === "solana").slice(0, 20);
}

export async function jupiterPrice(mint: string): Promise<number | null> {
  const res = await fetch(`${JUP_PRICE}?ids=${mint}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: Record<string, { price?: string }> };
  const p = body.data?.[mint]?.price;
  return p ? Number(p) : null;
}

export async function jupiterQuote(opts: {
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
}): Promise<{ outAmount: number; priceImpactPct: number } | null> {
  const url = new URL(JUP_QUOTE);
  url.searchParams.set("inputMint", opts.inputMint);
  url.searchParams.set("outputMint", opts.outputMint);
  url.searchParams.set("amount", String(Math.max(1, Math.floor(opts.amount))));
  url.searchParams.set("slippageBps", String(opts.slippageBps));
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { outAmount?: string; priceImpactPct?: string };
  if (!body.outAmount) return null;
  return { outAmount: Number(body.outAmount), priceImpactPct: Number(body.priceImpactPct ?? 0) };
}

export async function simulateSell(mint: string, rawAmount: number, slippageBps: number): Promise<boolean> {
  const q = await jupiterQuote({
    inputMint: mint,
    outputMint: SOL,
    amount: rawAmount,
    slippageBps,
  });
  return Boolean(q && q.outAmount > 0);
}

export function pairToMetrics(pair: DexPair, extras?: Partial<TokenMetrics>): TokenMetrics {
  const created = pair.pairCreatedAt ?? Date.now();
  const buys = pair.txns?.m5?.buys ?? 0;
  const sells = pair.txns?.m5?.sells ?? 0;
  return {
    mint: pair.baseToken.address,
    ticker: pair.baseToken.symbol,
    name: pair.baseToken.name,
    priceUsd: Number(pair.priceUsd ?? 0),
    marketCapUsd: pair.marketCap ?? pair.fdv ?? 0,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    volume1h: pair.volume?.h1 ?? 0,
    volume5m: pair.volume?.m5 ?? 0,
    holders: extras?.holders ?? 0,
    creatorPct: extras?.creatorPct ?? 0,
    top10HolderPct: extras?.top10HolderPct ?? 0,
    buyImpactPct: extras?.buyImpactPct ?? 0,
    ageMinutes: Math.max(0, (Date.now() - created) / 60000),
    mintAuthorityRevoked: extras?.mintAuthorityRevoked ?? true,
    freezeAuthorityRevoked: extras?.freezeAuthorityRevoked ?? true,
    sellSimOk: extras?.sellSimOk ?? true,
    graduated: (pair.liquidity?.usd ?? 0) > 0,
  };
}

export function buySellRatio(pair: DexPair): number {
  const buys = pair.txns?.m5?.buys ?? 0;
  const sells = pair.txns?.m5?.sells ?? 0;
  const t = buys + sells;
  return t === 0 ? 0.5 : buys / t;
}

export async function fetchPumpNewTokens(): Promise<Array<{ mint: string; name: string; symbol: string }>> {
  try {
    const res = await fetch("https://frontend-api-v3.pump.fun/coins?offset=0&limit=20&sort=created_timestamp&order=DESC&includeNsfw=false");
    if (!res.ok) return [];
    const body = (await res.json()) as Array<{ mint?: string; name?: string; symbol?: string }>;
    return (body ?? [])
      .filter((c) => c.mint)
      .map((c) => ({ mint: c.mint as string, name: c.name ?? "", symbol: c.symbol ?? "" }));
  } catch {
    return [];
  }
}

export async function heliusHealth(rpcUrl: string): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { result?: string };
    return body.result === "ok";
  } catch {
    return false;
  }
}
