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
  xaiKey: string;
  grokModel: string;
  llmTimeoutMs: number;
  crewPort: number;
  dashboardBind: string;
  dashboardHost: string;
  dashboardPassword: string;
  dashboardPasswordFile: string;
  dashboardSecureCookie: boolean;
  walletSecretsPath: string;
  databasePath: string;
  configDir: string;
  policyPath: string;
  sourcesPath: string;
  guardrailsPath: string;
  lessonsPath: string;
  patternStatsPath: string;
  rulesPath: string;
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
    xaiKey: env.XAI_API_KEY ?? env.GROK_API_KEY ?? "",
    grokModel: env.GROK_MODEL ?? "grok-4-fast",
    llmTimeoutMs: Number(env.LLM_TIMEOUT_MS ?? 4000),
    crewPort: Number(env.CREW_PORT ?? 8787),
    dashboardBind: env.DASHBOARD_BIND ?? "0.0.0.0",
    dashboardHost: env.DASHBOARD_HOST ?? "cryptogrokbot.com",
    dashboardPassword: env.DASHBOARD_PASSWORD ?? "",
    dashboardPasswordFile: resolve(env.DASHBOARD_PASSWORD_FILE ?? "./data/.dashboard-password"),
    dashboardSecureCookie: env.DASHBOARD_SECURE_COOKIE === "true",
    walletSecretsPath: resolve(env.WALLET_SECRETS_PATH ?? "./data/wallet-secrets.json"),
    databasePath: resolve(env.DATABASE_PATH ?? "./data/night-agent.db"),
    configDir,
    policyPath: resolve(configDir, "policy.json"),
    sourcesPath: resolve(configDir, "sources.yaml"),
    guardrailsPath: resolve(configDir, "guardrails.yaml"),
    lessonsPath: resolve(configDir, "lessons.md"),
    patternStatsPath: resolve(configDir, "pattern-stats.json"),
    rulesPath: resolve(configDir, "rules.yaml"),
  };
}

export function loadPolicy(path: string): Policy {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Policy>;
  return { ...DEFAULT_POLICY, ...raw };
}
