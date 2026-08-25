import "dotenv/config";
import { resolve } from "node:path";
import { dayKey } from "@night/shared";
import { openStore, setFlag } from "@night/storage";
import { createTelegramBot } from "@night/telegram";
import { loadAppConfig, loadPolicy } from "./config.ts";
import { AgentRuntime } from "./loop.ts";
import { pulseAuditorFromStore, startCrewServer, type DashboardContext } from "./board.ts";
import { loadTotpSecret, resolveDashboardEmail, resolveDashboardPassword } from "./auth.ts";
import { buyChosenMint, sellChosen } from "./trade.ts";
import { probeCloudflare, formatCloudflareProbe } from "./cloudflare.ts";
import { runAuditorScan } from "./auditor.ts";

async function main(): Promise<void> {
  const cfg = loadAppConfig();
  const policy = loadPolicy(cfg.policyPath);
  const store = openStore(cfg.databasePath);
  setFlag(store, "master", String(cfg.masterEnabled));
  const runtime = new AgentRuntime(cfg, policy, store);

  const pw = resolveDashboardPassword({
    envPassword: cfg.dashboardPassword,
    filePath: cfg.dashboardPasswordFile,
  });
  const em = resolveDashboardEmail({
    envEmail: cfg.dashboardEmail,
    filePath: cfg.dashboardEmailFile,
    fallback: "hello@taskra.ai",
  });
  if (pw.generated) {
    console.log(`Dashboard password (generated once, gitignored ${cfg.dashboardPasswordFile}): ${pw.password}`);
  } else if (pw.source === "file") {
    console.log(`Dashboard login: password loaded from ${cfg.dashboardPasswordFile} (not printed)`);
  } else {
    console.log("Dashboard login: DASHBOARD_PASSWORD is set (not printed)");
  }
  console.log(`Dashboard login email: ${em.email}`);
  const totpOn = Boolean(loadTotpSecret(cfg.dashboardTotpFile));
  console.log(
    totpOn
      ? "Dashboard 2FA: enrolled (Authenticator)"
      : "Dashboard 2FA: not enrolled — first login will show a setup code",
  );

  const dash: DashboardContext = {
    store,
    crew: runtime.crew,
    cfg,
    policy,
    flags: () => runtime.currentFlags(),
    password: pw.password,
    email: em.email,
    totpFile: cfg.dashboardTotpFile,
    repoRoot: resolve("."),
    buy: (opts) =>
      buyChosenMint({
        store,
        policy,
        flags: runtime.currentFlags(),
        mint: opts.mint,
        sol: opts.sol,
        force: opts.force,
        extraRulesPath: cfg.rulesPath,
        dayKey: dayKey(Date.now(), policy.timezone),
        connection: runtime.connection,
        keypair: runtime.keypair,
        pumpApiKey: cfg.pumpApiKey,
      }),
    sell: (idOrMint) =>
      sellChosen({
        store,
        policy,
        idOrMint,
        flags: runtime.currentFlags(),
        connection: runtime.connection,
        keypair: runtime.keypair,
        pumpApiKey: cfg.pumpApiKey,
      }),
  };
  startCrewServer(runtime.crew, cfg.crewPort, dash);
  pulseAuditorFromStore(dash);

  console.log(
    `Night agent starting mode=${cfg.mode} master=${cfg.masterEnabled} db=${cfg.databasePath} host=${cfg.dashboardHost}`,
  );
  console.warn("Not financial advice. Paper mode until MODE=LIVE and MASTER_ENABLED=true.");

  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  if (token) {
    void probeCloudflare({ token, domain: cfg.dashboardHost })
      .then((p) => console.log(formatCloudflareProbe(p)))
      .catch(() => console.log("Cloudflare probe failed (zone lookup skipped)"));
  } else {
    console.log("CLOUDFLARE_API_TOKEN unset; skipped cryptogrokbot.com zone lookup.");
  }

  if (cfg.telegramToken) {
    const bot = createTelegramBot(cfg.telegramToken, cfg.telegramChatId, {
      store,
      policy: () => runtime.policy,
      flags: () => runtime.currentFlags(),
      paths: { lessons: cfg.lessonsPath, guardrails: cfg.guardrailsPath, rules: cfg.rulesPath },
      onSellAll: () => runtime.sellAll(),
      onResearch: (mint) => runtime.research(mint),
      crew: () => runtime.crew,
      dayKey: () => new Date().toISOString().slice(0, 10),
    });
    bot.start({
      onStart: (info) => console.log(`Telegram bot @${info.username}`),
    });
  } else {
    console.log("TELEGRAM_BOT_TOKEN unset; cockpit disabled. Logs only.");
  }

  const once = process.argv.includes("--once");
  if (!once) {
    void runAuditorScan({ store, repoRoot: resolve("."), includeSubprocess: false })
      .then((r) => {
        if (r.ok) runtime.crew.idle("auditor", r.summary);
        else runtime.crew.error("auditor", r.summary);
      })
      .catch((err) => runtime.crew.error("auditor", err instanceof Error ? err.message : "scan failed"));
  }

  const run = async () => {
    try {
      const logs = await runtime.tick();
      for (const line of logs) console.log(line);
    } catch (err) {
      console.error("tick failed", err);
    }
  };

  await run();
  if (once) {
    process.exit(0);
  }
  setInterval(() => {
    void run();
  }, 15_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
