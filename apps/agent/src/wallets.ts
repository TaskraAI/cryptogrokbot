import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Store, WalletRow } from "@night/storage";
import { deleteWallet, insertWallet, listWallets, updateWalletSecretFlag } from "@night/storage";

interface SecretFile {
  [id: string]: string;
}

function loadSecrets(path: string): SecretFile {
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as SecretFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveSecrets(path: string, secrets: SecretFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(secrets, null, 2) + "\n", { mode: 0o600 });
}

export interface PublicWallet {
  id: number;
  label: string;
  publicKey: string;
  connected: boolean;
  assignedDesk: string;
  createdAt: number;
  solBalance: number | null;
}

function toPublic(row: WalletRow, solBalance: number | null = null): PublicWallet {
  return {
    id: row.id,
    label: row.label,
    publicKey: row.public_key,
    connected: row.has_secret === 1,
    assignedDesk: row.assigned_desk,
    createdAt: row.created_at,
    solBalance,
  };
}

export function addWallet(opts: {
  store: Store;
  secretsPath: string;
  label: string;
  publicKey: string;
  secret?: string;
  assignedDesk?: string;
}): PublicWallet {
  const secret = (opts.secret ?? "").trim();
  const row = insertWallet(opts.store, {
    label: opts.label.trim() || "wallet",
    publicKey: opts.publicKey.trim(),
    hasSecret: Boolean(secret),
    assignedDesk: (opts.assignedDesk ?? "").trim(),
  });
  if (secret) {
    const secrets = loadSecrets(opts.secretsPath);
    secrets[String(row.id)] = secret;
    saveSecrets(opts.secretsPath, secrets);
  }
  return toPublic(row);
}

export function removeWallet(store: Store, secretsPath: string, id: number): boolean {
  const secrets = loadSecrets(secretsPath);
  if (secrets[String(id)]) {
    delete secrets[String(id)];
    saveSecrets(secretsPath, secrets);
  }
  return deleteWallet(store, id);
}

export function walletHasSecretOnDisk(secretsPath: string, id: number): boolean {
  const secrets = loadSecrets(secretsPath);
  return Boolean(secrets[String(id)]);
}

export async function listPublicWallets(opts: {
  store: Store;
  rpcUrl: string;
}): Promise<PublicWallet[]> {
  const rows = listWallets(opts.store);
  const out: PublicWallet[] = [];
  let connection: Connection | undefined;
  try {
    connection = new Connection(opts.rpcUrl, "confirmed");
  } catch {
    connection = undefined;
  }
  for (const row of rows) {
    let sol: number | null = null;
    if (row.public_key && connection) {
      try {
        const pk = new PublicKey(row.public_key);
        const lamports = await connection.getBalance(pk);
        sol = lamports / 1e9;
      } catch {
        sol = null;
      }
    }
    out.push(toPublic(row, sol));
  }
  return out;
}

export function attachSecret(opts: { store: Store; secretsPath: string; id: number; secret: string }): boolean {
  const secret = opts.secret.trim();
  if (!secret) return false;
  const secrets = loadSecrets(opts.secretsPath);
  secrets[String(opts.id)] = secret;
  saveSecrets(opts.secretsPath, secrets);
  updateWalletSecretFlag(opts.store, opts.id, true);
  return true;
}
