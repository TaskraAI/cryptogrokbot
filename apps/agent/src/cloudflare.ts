/**
 * Cloudflare helpers. Reads CLOUDFLARE_API_TOKEN from env only.
 * Never logs the token. Never writes credentials to disk.
 */
export interface CloudflareProbe {
  zoneFound: boolean;
  zoneId: string;
  zoneName: string;
  zoneStatus: string;
  nameServers: string[];
  originalNameServers: string[];
  dnsListOk: boolean;
  dnsCreateOk: boolean;
  dnsError: string;
  workersListOk: boolean;
  r2ApiOk: boolean;
  r2Error: string;
  notes: string[];
}

async function cf(path: string, token: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { ok: res.ok && body.success === true, status: res.status, body };
}

export async function probeCloudflare(opts: {
  token: string;
  domain?: string;
}): Promise<CloudflareProbe> {
  const domain = opts.domain ?? "cryptogrokbot.com";
  const notes: string[] = [];
  const out: CloudflareProbe = {
    zoneFound: false,
    zoneId: "",
    zoneName: domain,
    zoneStatus: "",
    nameServers: [],
    originalNameServers: [],
    dnsListOk: false,
    dnsCreateOk: false,
    dnsError: "",
    workersListOk: false,
    r2ApiOk: false,
    r2Error: "",
    notes,
  };
  if (!opts.token) {
    notes.push("CLOUDFLARE_API_TOKEN unset — skipped zone lookup");
    return out;
  }
  const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`, opts.token);
  const result = Array.isArray(zones.body.result) ? (zones.body.result as Array<Record<string, unknown>>) : [];
  const zone = result[0];
  if (!zone) {
    notes.push(`zone ${domain} not found (token may lack Zone.Read, or domain is on another account)`);
    return out;
  }
  out.zoneFound = true;
  out.zoneId = String(zone.id ?? "");
  out.zoneName = String(zone.name ?? domain);
  out.zoneStatus = String(zone.status ?? "");
  out.nameServers = Array.isArray(zone.name_servers) ? (zone.name_servers as string[]) : [];
  out.originalNameServers = Array.isArray(zone.original_name_servers)
    ? (zone.original_name_servers as string[])
    : [];
  if (out.zoneStatus === "pending") {
    notes.push(
      `Zone is pending. Point the registrar at Cloudflare NS: ${out.nameServers.join(", ") || "(unknown)"}. Currently still on ${out.originalNameServers.join(", ") || "registrar NS"}.`,
    );
  }
  const dns = await cf(`/zones/${out.zoneId}/dns_records?per_page=5`, opts.token);
  out.dnsListOk = dns.ok;
  if (!dns.ok) {
    const err = Array.isArray(dns.body.errors) ? (dns.body.errors as Array<{ message?: string }>)[0]?.message : "";
    out.dnsError = err || `dns list HTTP ${dns.status}`;
    notes.push(`DNS API not permitted (${out.dnsError}). Add Zone.DNS Edit on the API token, then create an A/CNAME or a Cloudflare Tunnel hostname.`);
  }
  const workers = await cf(`/accounts/${String((zone.account as { id?: string } | undefined)?.id ?? "")}/workers/scripts`, opts.token);
  out.workersListOk = workers.ok;
  const accountId = String((zone.account as { id?: string } | undefined)?.id ?? "");
  if (accountId) {
    const r2 = await cf(`/accounts/${accountId}/r2/buckets`, opts.token);
    out.r2ApiOk = r2.ok;
    if (!r2.ok) {
      const err = Array.isArray(r2.body.errors) ? (r2.body.errors as Array<{ message?: string }>)[0]?.message : "";
      out.r2Error = err || `r2 HTTP ${r2.status}`;
      notes.push(`R2 not usable via API (${out.r2Error}). Enable R2 in the dashboard if you want static assets there.`);
    }
  }
  notes.push(
    "This cloud VM is not a 24/7 origin. After nameservers activate, the durable path is a Cloudflare Tunnel (cloudflared) from a machine that stays on, or a Worker/Pages proxy in front of that tunnel. Local dashboard: npm run agent then http://127.0.0.1:8787/",
  );
  return out;
}

export function formatCloudflareProbe(p: CloudflareProbe): string {
  const lines = [
    `Cloudflare ${p.zoneName}: zone ${p.zoneFound ? "found" : "NOT found"} id=${p.zoneId || "—"} status=${p.zoneStatus || "—"}`,
    p.nameServers.length ? `  CF NS: ${p.nameServers.join(", ")}` : "  CF NS: (none)",
    `  DNS list: ${p.dnsListOk ? "ok" : "no"} ${p.dnsError}`.trimEnd(),
    `  Workers list: ${p.workersListOk ? "ok" : "no"}  R2: ${p.r2ApiOk ? "ok" : "no"} ${p.r2Error}`.trimEnd(),
    ...p.notes.map((n) => `  ${n}`),
  ];
  return lines.join("\n");
}
