import { execFile, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { insertAuditorScan, lastAuditorScan, type Store } from "@night/storage";
import { loadAppConfig } from "./config.ts";

const execFileAsync = promisify(execFile);

export interface AuditorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface AuditorResult {
  ok: boolean;
  summary: string;
  checks: AuditorCheck[];
  at: number;
}

function assignmentLooksSecret(text: string): boolean {
  const re =
    /(?:WALLET_SECRET_KEY|CLOUDFLARE_API_TOKEN|CF_R2_SECRET_ACCESS_KEY|CF_R2_ACCESS_KEY_ID|DASHBOARD_PASSWORD|TELEGRAM_BOT_TOKEN|XAI_API_KEY|OPENAI_API_KEY|PUMPPORTAL_API_KEY)\s*=\s*(\S+)/g;
  for (const m of text.matchAll(re)) {
    const v = (m[1] ?? "").replace(/^["']|["']$/g, "");
    if (!v || v.startsWith("#") || v === "false" || v === "PAPER" || v === "true") continue;
    if (v.length >= 8) return true;
  }
  return false;
}

const SECRET_BLOB = /\b(cfat_[A-Za-z0-9]+|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY)\b/;

function trackedFiles(repoRoot: string): string[] {
  try {
    const out = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8", timeout: 15_000 });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function checkEnvExample(repoRoot: string): AuditorCheck {
  const path = resolve(repoRoot, ".env.example");
  if (!existsSync(path)) {
    return { id: "env-example", ok: false, detail: ".env.example missing" };
  }
  const text = readFileSync(path, "utf8");
  const modePaper = /^\s*MODE\s*=\s*PAPER\s*$/m.test(text);
  const masterOff = /^\s*MASTER_ENABLED\s*=\s*false\s*$/m.test(text);
  const liveDefault = /^\s*MODE\s*=\s*LIVE\s*$/m.test(text);
  const ok = modePaper && masterOff && !liveDefault;
  return {
    id: "paper-default",
    ok,
    detail: ok
      ? "MODE=PAPER and MASTER_ENABLED=false in .env.example"
      : "paper/live defaults drifted in .env.example",
  };
}

function checkGitignore(repoRoot: string): AuditorCheck {
  const gi = existsSync(resolve(repoRoot, ".gitignore"))
    ? readFileSync(resolve(repoRoot, ".gitignore"), "utf8")
    : "";
  const dataIgnored = /^data\/?$/m.test(gi) || /^data$/m.test(gi);
  const envIgnored = /^\.env$/m.test(gi);
  const ok = dataIgnored && envIgnored;
  return {
    id: "gitignore",
    ok,
    detail: ok ? "data/ and .env are gitignored" : ".gitignore must ignore data/ and .env (wallet secrets, db, password file)",
  };
}

function checkNoSecretsInGit(repoRoot: string): AuditorCheck {
  const files = trackedFiles(repoRoot);
  const hits: string[] = [];
  for (const rel of files) {
    if (rel.endsWith(".lock") || rel.includes("node_modules/") || rel.endsWith(".png")) continue;
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) continue;
    let text = "";
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    if (assignmentLooksSecret(text) || SECRET_BLOB.test(text)) {
      if (rel === ".env.example") continue;
      hits.push(rel);
    }
    if (rel.includes("wallet-secrets")) hits.push(rel);
  }
  const secretsTracked = files.some((f) => f.includes("wallet-secrets") || f === "data/.dashboard-password");
  const ok = hits.length === 0 && !secretsTracked;
  return {
    id: "no-secrets-in-git",
    ok,
    detail: ok ? "no wallet secrets or API tokens in tracked files" : `tracked secret-looking files: ${hits.slice(0, 8).join(", ")}`,
  };
}

function checkLiveFailClosed(repoRoot: string): AuditorCheck {
  const cfg = loadAppConfig({ MODE: "PAPER", MASTER_ENABLED: "false" } as NodeJS.ProcessEnv);
  const defaultsOk = cfg.mode === "PAPER" && cfg.masterEnabled === false;
  const liveNeedsBoth = loadAppConfig({ MODE: "LIVE" } as NodeJS.ProcessEnv).masterEnabled === false;
  const trade = readFileSync(resolve(repoRoot, "apps/agent/src/trade.ts"), "utf8");
  const refuses =
    trade.includes("LIVE buy refused: MASTER_ENABLED") && trade.includes("LIVE buy refused: WALLET_SECRET_KEY");
  const ok = defaultsOk && liveNeedsBoth && refuses;
  return {
    id: "live-fail-closed",
    ok,
    detail: ok
      ? "LIVE buys require MODE=LIVE and MASTER_ENABLED=true and a wallet"
      : "live fail-closed invariants missing",
  };
}

async function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  try {
    await execFileAsync(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 2_000_000 });
    return { ok: true, detail: `${cmd} ${args.join(" ")} ok` };
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const blob = `${e.stderr ?? ""} ${e.stdout ?? ""} ${e.message ?? ""}`.replace(/\s+/g, " ").trim();
    return { ok: false, detail: blob.slice(0, 240) || `${cmd} failed` };
  }
}

export async function runAuditorScan(opts: {
  store: Store;
  repoRoot?: string;
  includeSubprocess?: boolean;
}): Promise<AuditorResult> {
  const repoRoot = opts.repoRoot ?? resolve(".");
  const checks: AuditorCheck[] = [
    checkEnvExample(repoRoot),
    checkGitignore(repoRoot),
    checkNoSecretsInGit(repoRoot),
    checkLiveFailClosed(repoRoot),
  ];
  if (opts.includeSubprocess) {
    const tsc = await runCmd("npx", ["tsc", "--noEmit"], repoRoot, 120_000);
    checks.push({ id: "typecheck", ok: tsc.ok, detail: tsc.detail });
    const test = await runCmd("npx", ["vitest", "run", "tests/trade.test.ts", "tests/guardrails.test.ts"], repoRoot, 120_000);
    checks.push({ id: "tests", ok: test.ok, detail: test.detail });
  }
  const ok = checks.every((c) => c.ok);
  const failed = checks.filter((c) => !c.ok).map((c) => c.id);
  const summary = ok ? `all ${checks.length} checks passed (paper default, secrets off git)` : `fail: ${failed.join(", ")}`;
  const result: AuditorResult = { ok, summary, checks, at: Date.now() };
  insertAuditorScan(opts.store, { ok, summary, details: checks });
  return result;
}

export function auditorPulseDetail(store: Store): string {
  const last = lastAuditorScan(store);
  if (!last) return "no scan yet — tap Run scan";
  const age = Math.max(0, Math.round((Date.now() - last.at) / 1000));
  return `${last.ok ? "ok" : "FAIL"} ${last.summary} (${age}s ago)`;
}
