import { readFileSync, writeFileSync } from "node:fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SourceHit } from "@night/shared";

export interface Guardrail {
  id: string;
  type: "source" | "mint" | "ticker" | "keyword" | "creator_pct" | "pattern";
  value: string;
  origin: "manual" | "learned";
  createdAt: number;
  note?: string;
}

export interface GuardrailFile {
  rules: Guardrail[];
}

export function loadGuardrails(path: string): Guardrail[] {
  const raw = readFileSync(path, "utf8");
  const parsed = parseYaml(raw) as GuardrailFile | null;
  return parsed?.rules ?? [];
}

export function saveGuardrails(path: string, rules: Guardrail[]): void {
  writeFileSync(path, stringifyYaml({ rules }), "utf8");
}

export function addGuardrail(path: string, rule: Omit<Guardrail, "id" | "createdAt"> & { id?: string }): Guardrail {
  const rules = loadGuardrails(path);
  const created: Guardrail = {
    id: rule.id ?? `g-${Date.now()}`,
    type: rule.type,
    value: rule.value,
    origin: rule.origin,
    createdAt: Date.now(),
    note: rule.note,
  };
  rules.push(created);
  saveGuardrails(path, rules);
  return created;
}

export function removeGuardrail(path: string, id: string): boolean {
  const rules = loadGuardrails(path);
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return false;
  saveGuardrails(path, next);
  return true;
}

export function parseNeverRule(text: string): Omit<Guardrail, "id" | "createdAt" | "origin"> | null {
  const raw = text.trim();
  const creator = raw.match(/creator_pct\s*>\s*([\d.]+)/i);
  if (creator) return { type: "creator_pct", value: creator[1] };
  const kv = raw.match(/^(source|mint|ticker|keyword|pattern)\s*[:=]\s*(.+)$/i);
  if (kv) {
    return { type: kv[1].toLowerCase() as Guardrail["type"], value: kv[2].trim() };
  }
  if (raw.startsWith("@")) return { type: "source", value: raw };
  return { type: "keyword", value: raw };
}

export function matchGuardrail(
  rules: Guardrail[],
  ctx: {
    mint?: string;
    ticker?: string;
    creatorPct?: number;
    sources?: SourceHit[];
    text?: string;
    pattern?: string;
  },
): Guardrail | undefined {
  const blob = `${ctx.text ?? ""} ${ctx.sources?.map((s) => s.snippet).join(" ") ?? ""}`.toLowerCase();
  const sourceKeys = new Set((ctx.sources ?? []).map((s) => s.key.toLowerCase()));
  for (const rule of rules) {
    const v = rule.value.toLowerCase();
    if (rule.type === "mint" && ctx.mint && ctx.mint.toLowerCase() === v) return rule;
    if (rule.type === "ticker" && ctx.ticker && ctx.ticker.toLowerCase() === v) return rule;
    if (rule.type === "source") {
      const handle = v.replace(/^@/, "");
      if ([...sourceKeys].some((k) => k.replace(/^@/, "") === handle)) return rule;
    }
    if (rule.type === "keyword" && blob.includes(v)) return rule;
    if (rule.type === "pattern" && ctx.pattern && ctx.pattern.toLowerCase() === v) return rule;
    if (rule.type === "creator_pct" && ctx.creatorPct != null && ctx.creatorPct > Number(rule.value)) return rule;
  }
  return undefined;
}
