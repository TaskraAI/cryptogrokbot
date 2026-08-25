import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Mode } from "@night/shared";

const SOL = "So11111111111111111111111111111111111111112";
const JUP_SWAP = "https://lite-api.jup.ag/swap/v1";

export interface ExecResult {
  paper: boolean;
  signature?: string;
  sol: number;
  tokens: number;
  error?: string;
}

export function loadKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error("WALLET_SECRET_KEY is empty");
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

export async function jupiterSwap(opts: {
  connection: Connection;
  keypair: Keypair;
  inputMint: string;
  outputMint: string;
  amount: number;
  slippageBps: number;
}): Promise<string> {
  const quoteUrl = new URL(`${JUP_SWAP}/quote`);
  quoteUrl.searchParams.set("inputMint", opts.inputMint);
  quoteUrl.searchParams.set("outputMint", opts.outputMint);
  quoteUrl.searchParams.set("amount", String(Math.max(1, Math.floor(opts.amount))));
  quoteUrl.searchParams.set("slippageBps", String(opts.slippageBps));
  const quoteRes = await fetch(quoteUrl);
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed: ${quoteRes.status}`);
  const quote = await quoteRes.json();
  const swapRes = await fetch(`${JUP_SWAP}/swap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: opts.keypair.publicKey.toBase58(),
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap build failed: ${swapRes.status}`);
  const { swapTransaction } = (await swapRes.json()) as { swapTransaction?: string };
  if (!swapTransaction) throw new Error("Jupiter returned no swapTransaction");
  const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
  tx.sign([opts.keypair]);
  const sig = await opts.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  return sig;
}

export async function pumpLocalTrade(opts: {
  apiKey: string;
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  amount: number;
  denominatedInSol: boolean;
  slippage: number;
}): Promise<string> {
  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      publicKey: opts.publicKey,
      action: opts.action,
      mint: opts.mint,
      amount: opts.amount,
      denominatedInSol: opts.denominatedInSol ? "true" : "false",
      slippage: opts.slippage,
      priorityFee: 0.00005,
      pool: "auto",
    }),
  });
  if (!res.ok) throw new Error(`PumpPortal local trade failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

export async function executeBuy(opts: {
  mode: Mode;
  graduated: boolean;
  mint: string;
  sol: number;
  slippagePct: number;
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
}): Promise<ExecResult> {
  if (opts.mode === "PAPER") {
    return { paper: true, sol: opts.sol, tokens: estimateTokens(opts.sol) };
  }
  if (!opts.connection || !opts.keypair) {
    return { paper: false, sol: 0, tokens: 0, error: "wallet or RPC missing" };
  }
  try {
    const lamports = Math.floor(opts.sol * 1e9);
    const slippageBps = Math.floor(opts.slippagePct * 100);
    if (!opts.graduated && opts.pumpApiKey) {
      const raw = await pumpLocalTrade({
        apiKey: opts.pumpApiKey,
        publicKey: opts.keypair.publicKey.toBase58(),
        action: "buy",
        mint: opts.mint,
        amount: opts.sol,
        denominatedInSol: true,
        slippage: opts.slippagePct,
      });
      const tx = VersionedTransaction.deserialize(Buffer.from(raw, "base64"));
      tx.sign([opts.keypair]);
      const sig = await opts.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      return { paper: false, signature: sig, sol: opts.sol, tokens: estimateTokens(opts.sol) };
    }
    const sig = await jupiterSwap({
      connection: opts.connection,
      keypair: opts.keypair,
      inputMint: SOL,
      outputMint: opts.mint,
      amount: lamports,
      slippageBps,
    });
    return { paper: false, signature: sig, sol: opts.sol, tokens: estimateTokens(opts.sol) };
  } catch (err) {
    return { paper: false, sol: 0, tokens: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function executeSell(opts: {
  mode: Mode;
  graduated: boolean;
  mint: string;
  tokens: number;
  tokenDecimals?: number;
  slippagePct: number;
  solEstimate: number;
  connection?: Connection;
  keypair?: Keypair;
  pumpApiKey?: string;
}): Promise<ExecResult> {
  if (opts.mode === "PAPER") {
    return { paper: true, sol: opts.solEstimate, tokens: opts.tokens };
  }
  if (!opts.connection || !opts.keypair) {
    return { paper: false, sol: 0, tokens: 0, error: "wallet or RPC missing" };
  }
  try {
    const decimals = opts.tokenDecimals ?? 6;
    const raw = Math.floor(opts.tokens * 10 ** decimals);
    const slippageBps = Math.floor(opts.slippagePct * 100);
    if (!opts.graduated && opts.pumpApiKey) {
      const encoded = await pumpLocalTrade({
        apiKey: opts.pumpApiKey,
        publicKey: opts.keypair.publicKey.toBase58(),
        action: "sell",
        mint: opts.mint,
        amount: opts.tokens,
        denominatedInSol: false,
        slippage: opts.slippagePct,
      });
      const tx = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
      tx.sign([opts.keypair]);
      const sig = await opts.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      return { paper: false, signature: sig, sol: opts.solEstimate, tokens: opts.tokens };
    }
    const sig = await jupiterSwap({
      connection: opts.connection,
      keypair: opts.keypair,
      inputMint: opts.mint,
      outputMint: SOL,
      amount: raw,
      slippageBps,
    });
    return { paper: false, signature: sig, sol: opts.solEstimate, tokens: opts.tokens };
  } catch (err) {
    return { paper: false, sol: 0, tokens: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function estimateTokens(sol: number): number {
  return sol * 1_000_000;
}
