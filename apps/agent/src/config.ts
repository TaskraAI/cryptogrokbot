import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_POLICY, type Mode, type Policy } from "@night/shared";

export interface AppConfig {
  mode: Mode;
  masterEnabled: boolean;
  walletSecret: string;
  heliusRpc: string;
  fallbackRpc: string;
  telegramToken: string;
  telegramChatId: string;
  xBearer: string;
  pumpApiKey: string;
  openaiKey: string;
  openaiModel: string;
  llmTimeoutMs: number;
  databasePath: string;
  configDir: string;
  policyPath: string;
  sourcesPath: string;
  guardrailsPath: string;
  lessonsPath: string;
  patternStatsPath: string;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = resolve(env.CONFIG_DIR ?? "./config");
  return {
    mode: env.MODE === "LIVE" ? "LIVE" : "PAPER",
    masterEnabled: env.MASTER_ENABLED === "true",
    walletSecret: env.WALLET_SECRET_KEY ?? "",
    heliusRpc: env.HELIUS_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    fallbackRpc: env.FALLBACK_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    telegramToken: env.TELEGRAM_BOT_TOKEN ?? "",
    telegramChatId: env.TELEGRAM_CHAT_ID ?? "",
    xBearer: env.X_BEARER_TOKEN ?? "",
    pumpApiKey: env.PUMPPORTAL_API_KEY ?? "",
    openaiKey: env.OPENAI_API_KEY ?? "",
    openaiModel: env.OPENAI_MODEL ?? "gpt-4.1-mini",
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 4000),
    databasePath: resolve(env.DATABASE_PATH ?? "./data/night-agent.db"),
    configDir,
    policyPath: resolve(configDir, "policy.json"),
    sourcesPath: resolve(configDir, "sources.yaml"),
    guardrailsPath: resolve(configDir, "guardrails.yaml"),
    lessonsPath: resolve(configDir, "lessons.md"),
    patternStatsPath: resolve(configDir, "pattern-stats.json"),
  };
}

export function loadPolicy(path: string): Policy {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Policy>;
  return { ...DEFAULT_POLICY, ...raw };
}
