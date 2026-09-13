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
  dashboardEmail: string;
  dashboardEmailFile: string;
  dashboardTotpFile: string;
  dashboardAccessFile: string;
  dashboardSecureCookie: boolean;
  allowExtraBudget: boolean;
  resendApiKey: string;
  resendFrom: string;
  walletSecretsPath: string;
  databasePath: string;
  configDir: string;
  policyPath: string;
  sourcesPath: string;
  guardrailsPath: string;
  lessonsPath: string;
  patternStatsPath: string;
  rulesPath: string;
  challengePath: string;
  deskRiskPath: string;
}

export function isLoopbackBind(bind: string): boolean {
  const b = bind.trim().toLowerCase();
  return b === "127.0.0.1" || b === "::1" || b === "localhost" || b === "0:0:0:0:0:0:0:1";
}

/** Secure cookie is on when not bound to loopback, unless explicitly set. */
export function resolveDashboardSecureCookie(env: NodeJS.ProcessEnv, bind: string): boolean {
  if (env.DASHBOARD_SECURE_COOKIE === "true") return true;
  if (env.DASHBOARD_SECURE_COOKIE === "false") return false;
  return !isLoopbackBind(bind);
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = resolve(env.CONFIG_DIR ?? "./config");
  const dashboardBind = env.DASHBOARD_BIND ?? "127.0.0.1";
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
    dashboardBind,
    dashboardHost: env.DASHBOARD_HOST ?? "cryptogrokbot.com",
    dashboardPassword: env.DASHBOARD_PASSWORD ?? "",
    dashboardPasswordFile: resolve(env.DASHBOARD_PASSWORD_FILE ?? "./data/.dashboard-password"),
    dashboardEmail: env.DASHBOARD_EMAIL ?? "",
    dashboardEmailFile: resolve(env.DASHBOARD_EMAIL_FILE ?? "./data/.dashboard-email"),
    dashboardTotpFile: resolve(env.DASHBOARD_TOTP_FILE ?? "./data/.dashboard-totp"),
    dashboardAccessFile: resolve(env.DASHBOARD_ACCESS_FILE ?? "./data/dashboard-access.json"),
    dashboardSecureCookie: resolveDashboardSecureCookie(env, dashboardBind),
    allowExtraBudget: env.ALLOW_EXTRA_BUDGET === "true",
    resendApiKey: env.RESEND_API_KEY ?? "",
    resendFrom: env.RESEND_FROM?.trim() || "CryptoGrokBot <hello@taskra.ai>",
    walletSecretsPath: resolve(env.WALLET_SECRETS_PATH ?? "./data/wallet-secrets.json"),
    databasePath: resolve(env.DATABASE_PATH ?? "./data/night-agent.db"),
    configDir,
    policyPath: resolve(configDir, "policy.json"),
    sourcesPath: resolve(configDir, "sources.yaml"),
    guardrailsPath: resolve(configDir, "guardrails.yaml"),
    lessonsPath: resolve(configDir, "lessons.md"),
    patternStatsPath: resolve(configDir, "pattern-stats.json"),
    rulesPath: resolve(configDir, "rules.yaml"),
    challengePath: resolve(configDir, "challenge.json"),
    deskRiskPath: resolve(configDir, "desk-risk.json"),
  };
}

export function loadPolicy(path: string): Policy {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Policy>;
  return { ...DEFAULT_POLICY, ...raw };
}
