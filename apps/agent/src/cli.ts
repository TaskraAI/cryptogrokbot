import "dotenv/config";
import { Connection } from "@solana/web3.js";
import { dayKey } from "@night/shared";
import { openStore } from "@night/storage";
import { loadKeypair } from "@night/execution";
import { loadAppConfig, loadPolicy } from "./config.ts";
import { buyChosenMint, positionsReport, quoteMint, scanMemeCoins, sellChosen, statusReport } from "./trade.ts";

const HELP = `CryptoTrading — discover / buy / sell Solana meme coins

Usage:
  npm run trade -- scan [query]          Dex + Pump.fun names (no buy)
  npm run trade -- quote <mint>          Jupiter quote (no tx)
  npm run trade -- buy <mint> [--sol N] [--strict] [--force]
  npm run trade -- sell <id|mint>
  npm run trade -- positions
  npm run trade -- status

Defaults (from .env):
  MODE=PAPER          dry-run ledger only; no chain tx
  MASTER_ENABLED=false
  Live spend requires MODE=LIVE and MASTER_ENABLED=true and WALLET_SECRET_KEY.

Flags:
  --sol N     size, capped by policy.json maxSolPerTrade
  --strict    also apply config/rules.yaml (night-agent filters)
  --force     skip score (PAPER only) — still no chain tx
  --json      machine-readable scan/buy/sell

Not financial advice. Meme coins rug.
`;

function parse(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      flags.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-") && key !== "strict" && key !== "force" && key !== "json") {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  return { cmd: rest[0], args: rest.slice(1), flags };
}

async function main(): Promise<void> {
  const { cmd, args, flags } = parse(process.argv.slice(2));
  if (!cmd || flags.help) {
    process.stdout.write(HELP);
    process.exit(cmd ? 0 : 1);
  }

  const cfg = loadAppConfig();
  const policy = loadPolicy(cfg.policyPath);
  const store = openStore(cfg.databasePath);
  const flagsRun = {
    mode: cfg.mode,
    masterEnabled: cfg.masterEnabled,
    rpcHealthy: true,
    jupiterHealthy: true,
    telegramHealthy: Boolean(cfg.telegramToken),
  };
  let connection: Connection | undefined;
  let keypair: ReturnType<typeof loadKeypair> | undefined;
  try {
    connection = new Connection(cfg.heliusRpc, "confirmed");
    if (cfg.walletSecret) keypair = loadKeypair(cfg.walletSecret);
  } catch (err) {
    if (cfg.mode === "LIVE") {
      console.error("wallet/rpc init failed", err);
      process.exit(1);
    }
  }

  const json = Boolean(flags.json);

  if (cmd === "scan") {
    const rows = await scanMemeCoins(args[0] || "SOL");
    if (json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (!rows.length) {
      console.log("scan returned nothing (network?). Try: npm run trade -- scan BONK");
      process.exit(1);
    }
    console.log("venue  ticker     mcapUSD      liqUSD      vol5m  mint");
    for (const r of rows) {
      const mcap = r.marketCapUsd ? r.marketCapUsd.toFixed(0) : "-";
      const liq = r.liquidityUsd ? r.liquidityUsd.toFixed(0) : "-";
      const vol = r.volume5m ? r.volume5m.toFixed(0) : "-";
      console.log(
        `${r.venue.padEnd(5)} ${r.ticker.padEnd(10)} ${String(mcap).padStart(10)} ${String(liq).padStart(10)} ${String(vol).padStart(10)}  ${r.mint}`,
      );
    }
    console.log("\nBuy paper: npm run trade -- buy <mint>");
    return;
  }

  if (cmd === "quote") {
    const mint = args[0];
    if (!mint) {
      console.error("usage: npm run trade -- quote <mint>");
      process.exit(1);
    }
    console.log(await quoteMint(mint, Number(flags.sol) || 0.1));
    return;
  }

  if (cmd === "buy") {
    const mint = args[0];
    if (!mint) {
      console.error("usage: npm run trade -- buy <mint> [--sol 0.1]");
      process.exit(1);
    }
    const result = await buyChosenMint({
      store,
      policy,
      flags: flagsRun,
      mint,
      sol: flags.sol ? Number(flags.sol) : undefined,
      strict: Boolean(flags.strict),
      force: Boolean(flags.force),
      extraRulesPath: cfg.rulesPath,
      dayKey: dayKey(Date.now(), policy.timezone),
      connection,
      keypair,
      pumpApiKey: cfg.pumpApiKey,
    });
    if (json) console.log(JSON.stringify(result));
    else console.log(result.message);
    process.exit(result.ok ? 0 : 1);
  }

  if (cmd === "sell") {
    const idOrMint = args[0];
    if (!idOrMint) {
      console.error("usage: npm run trade -- sell <id|mint>");
      process.exit(1);
    }
    const result = await sellChosen({
      store,
      policy,
      idOrMint,
      connection,
      keypair,
      pumpApiKey: cfg.pumpApiKey,
    });
    if (json) console.log(JSON.stringify(result));
    else console.log(result.message);
    process.exit(result.ok ? 0 : 1);
  }

  if (cmd === "positions") {
    console.log(positionsReport(store));
    return;
  }

  if (cmd === "status") {
    console.log(
      statusReport({
        flags: flagsRun,
        policy,
        store,
        tz: policy.timezone,
      }),
    );
    console.log(`db ${cfg.databasePath}`);
    return;
  }

  console.error(`unknown command ${cmd}\n`);
  process.stdout.write(HELP);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
