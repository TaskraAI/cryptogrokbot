import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type AccessKind = "owner" | "human" | "grokbot";

export type AccessGrant = {
  id: string;
  email: string;
  label: string;
  kind: AccessKind;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  redeemedAt?: number;
};

export type AccessFile = {
  grants: AccessGrant[];
};

const DEFAULT_TTL_MS = 30 * 24 * 3600 * 1000;

export function emptyAccess(): AccessFile {
  return { grants: [] };
}

export function loadAccess(filePath: string): AccessFile {
  if (!existsSync(filePath)) return emptyAccess();
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as AccessFile;
    if (!parsed || !Array.isArray(parsed.grants)) return emptyAccess();
    return { grants: parsed.grants };
  } catch {
    return emptyAccess();
  }
}

export function saveAccess(filePath: string, data: AccessFile): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token.trim()).digest("hex");
}

export function publicGrants(data: AccessFile, now = Date.now()): Array<{
  id: string;
  email: string;
  label: string;
  kind: AccessKind;
  createdAt: number;
  expiresAt: number;
  active: boolean;
}> {
  return data.grants.map((g) => ({
    id: g.id,
    email: g.email,
    label: g.label,
    kind: g.kind,
    createdAt: g.createdAt,
    expiresAt: g.expiresAt,
    active: g.expiresAt > now,
  }));
}

export function createGrant(opts: {
  email: string;
  label: string;
  kind: Exclude<AccessKind, "owner">;
  ttlMs?: number;
  now?: number;
}): { grant: AccessGrant; token: string } {
  const now = opts.now ?? Date.now();
  const token = `cgbot_${randomBytes(24).toString("base64url")}`;
  const grant: AccessGrant = {
    id: randomBytes(8).toString("hex"),
    email: opts.email.trim().toLowerCase(),
    label: opts.label.trim() || (opts.kind === "grokbot" ? "Grok Bot" : opts.email),
    kind: opts.kind,
    tokenHash: hashAccessToken(token),
    createdAt: now,
    expiresAt: now + (opts.ttlMs ?? DEFAULT_TTL_MS),
  };
  return { grant, token };
}

export function addGrant(filePath: string, grant: AccessGrant): AccessFile {
  const data = loadAccess(filePath);
  data.grants = data.grants.filter((g) => g.tokenHash !== grant.tokenHash);
  data.grants.push(grant);
  saveAccess(filePath, data);
  return data;
}

export function revokeGrant(filePath: string, id: string): AccessFile {
  const data = loadAccess(filePath);
  data.grants = data.grants.filter((g) => g.id !== id);
  saveAccess(filePath, data);
  return data;
}

export function findGrantByEmail(filePath: string, email: string, now = Date.now()): AccessGrant | undefined {
  const want = email.trim().toLowerCase();
  return loadAccess(filePath).grants.find((g) => g.email === want && g.expiresAt > now);
}

export function findGrantByToken(filePath: string, token: string, now = Date.now()): AccessGrant | undefined {
  const hash = hashAccessToken(token);
  return loadAccess(filePath).grants.find((g) => g.tokenHash === hash && g.expiresAt > now);
}

export function markRedeemed(filePath: string, id: string, now = Date.now()): void {
  const data = loadAccess(filePath);
  const row = data.grants.find((g) => g.id === id);
  if (!row) return;
  row.redeemedAt = now;
  saveAccess(filePath, data);
}

export function grokBotEmail(): string {
  return "grokbot@cryptogrokbot.com";
}
