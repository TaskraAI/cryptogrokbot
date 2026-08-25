import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const SESSION_COOKIE = "cg_dash";
export const PENDING_COOKIE = "cg_pending";
const MAX_AGE_SEC = 14 * 24 * 3600;
const PENDING_AGE_SEC = 5 * 60;

export function emailsEqual(a: string, b: string): boolean {
  return passwordsEqual(a.trim().toLowerCase(), b.trim().toLowerCase());
}

export function resolveDashboardEmail(opts: { envEmail: string; filePath: string; fallback: string }): {
  email: string;
  source: "env" | "file" | "default";
} {
  const fromEnv = opts.envEmail.trim().toLowerCase();
  if (fromEnv) return { email: fromEnv, source: "env" };
  mkdirSync(dirname(opts.filePath), { recursive: true });
  if (existsSync(opts.filePath)) {
    const fromFile = readFileSync(opts.filePath, "utf8").trim().toLowerCase();
    if (fromFile) return { email: fromFile, source: "file" };
  }
  const email = opts.fallback.trim().toLowerCase();
  writeFileSync(opts.filePath, `${email}\n`, { mode: 0o600 });
  return { email, source: "default" };
}

export function loadTotpSecret(filePath: string): string {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8").trim().replace(/\s/g, "");
}

export function saveTotpSecret(filePath: string, secret: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${secret.trim()}\n`, { mode: 0o600 });
}

export function resolveDashboardPassword(opts: { envPassword: string; filePath: string }): {
  password: string;
  generated: boolean;
  source: "env" | "file" | "generated";
} {
  const fromEnv = opts.envPassword.trim();
  if (fromEnv) return { password: fromEnv, generated: false, source: "env" };
  mkdirSync(dirname(opts.filePath), { recursive: true });
  if (existsSync(opts.filePath)) {
    const fromFile = readFileSync(opts.filePath, "utf8").trim();
    if (fromFile) return { password: fromFile, generated: false, source: "file" };
  }
  const password = randomBytes(18).toString("base64url");
  writeFileSync(opts.filePath, `${password}\n`, { mode: 0o600 });
  return { password, generated: true, source: "generated" };
}

export function cookieSecretFromPassword(password: string): string {
  return createHmac("sha256", "cryptogrokbot-dashboard").update(password).digest("hex");
}

export function signSession(password: string, now = Date.now()): string {
  const exp = now + MAX_AGE_SEC * 1000;
  const nonce = randomBytes(12).toString("base64url");
  const payload = `v1.${exp}.${nonce}`;
  const sig = createHmac("sha256", cookieSecretFromPassword(password)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string, password: string, now = Date.now()): boolean {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 1) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const parts = payload.split(".");
  if (parts[0] !== "v1" || parts.length !== 3) return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = createHmac("sha256", cookieSecretFromPassword(password)).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    const dummy = Buffer.alloc(left.length);
    timingSafeEqual(left, dummy);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookieHeader(token: string, secure: boolean): string {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SEC}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function pendingCookieHeader(token: string, secure: boolean): string {
  const bits = [
    `${PENDING_COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${PENDING_AGE_SEC}`,
  ];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearSessionCookieHeader(secure: boolean): string {
  const bits = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearPendingCookieHeader(secure: boolean): string {
  const bits = [`${PENDING_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function signPending(password: string, step: "enroll" | "totp", extra = "", now = Date.now()): string {
  const exp = now + PENDING_AGE_SEC * 1000;
  const nonce = randomBytes(12).toString("base64url");
  const payload = `p1.${step}.${exp}.${nonce}.${extra}`;
  const sig = createHmac("sha256", cookieSecretFromPassword(password)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyPending(
  token: string,
  password: string,
  step: "enroll" | "totp",
  now = Date.now(),
): { ok: boolean; extra: string } {
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 1) return { ok: false, extra: "" };
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  const parts = payload.split(".");
  if (parts[0] !== "p1" || parts[1] !== step || parts.length !== 5) return { ok: false, extra: "" };
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp < now) return { ok: false, extra: "" };
  const expected = createHmac("sha256", cookieSecretFromPassword(password)).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, extra: "" };
  return { ok: true, extra: parts[4] ?? "" };
}
