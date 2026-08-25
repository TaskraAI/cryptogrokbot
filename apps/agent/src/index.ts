import "dotenv/config";
import { openStore, setFlag } from "@night/storage";
import { createTelegramBot } from "@night/telegram";
import { loadAppConfig, loadPolicy } from "./config.ts";
import { AgentRuntime } from "./loop.ts";
import { startCrewServer } from "./board.ts";

async function main(): Promise<void> {
  const cfg = loadAppConfig();
  const policy = loadPolicy(cfg.policyPath);
  const store = openStore(cfg.databasePath);
  setFlag(store, "master", String(cfg.masterEnabled));
  const runtime = new AgentRuntime(cfg, policy, store);
  startCrewServer(runtime.crew, cfg.crewPort);

  console.log(
    `Night agent starting mode=${cfg.mode} master=${cfg.masterEnabled} db=${cfg.databasePath}`,
  );
  console.warn("Not financial advice. Paper mode until MODE=LIVE and MASTER_ENABLED=true.");

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
