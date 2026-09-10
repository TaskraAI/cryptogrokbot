import { describe, expect, it } from "vitest";
// @ts-expect-error worker module is plain JavaScript
import { fallbackDeskHtml, looksLikeTunnelHtml, repairDashboardHtml, shouldRetryOriginFetch } from "../workers/cryptogrokbot.js";

describe("cryptogrokbot worker HTML repair", () => {
  it("unhides login and repairs the broken invite regex so the page is not blank", () => {
    const broken = `<div id="login" class="login hidden"></div>
<script>
  const m = raw.match(//invite/([^/?#]+)/);
</script>`;
    const fixed = repairDashboardHtml(broken);
    expect(fixed).toContain('id="login" class="login"');
    expect(fixed).not.toContain('class="login hidden"');
    expect(fixed).toContain('raw.match(new RegExp("/invite/([^/?#]+)"))');
    expect(fixed).not.toContain("match(//invite");
    expect(() => new Function(fixed.slice(fixed.indexOf("<script>") + 8, fixed.indexOf("</script>")))).not.toThrow();
  });
});

describe("tunnel HTML must not leak into login errors", () => {
  it("detects localhost.run 503 pages", () => {
    expect(looksLikeTunnelHtml("<h1>no tunnel here :(</h1>")).toBe(true);
    expect(looksLikeTunnelHtml('{"ok":false,"error":"Invalid email or password."}')).toBe(false);
  });
});

describe("origin fetch retries", () => {
  it("retries GET/HEAD tunnel failures and never retries POST", () => {
    expect(shouldRetryOriginFetch("GET", 503)).toBe(true);
    expect(shouldRetryOriginFetch("HEAD", 530)).toBe(true);
    expect(shouldRetryOriginFetch("GET", 200)).toBe(false);
    expect(shouldRetryOriginFetch("POST", 503)).toBe(false);
    expect(shouldRetryOriginFetch("POST", 0)).toBe(false);
  });
});

describe("fallback desk page stays up when the origin is down", () => {
  it("serves a login form with forgot password and no extra banners", () => {
    const html = fallbackDeskHtml();
    expect(html).toContain("Log in");
    expect(html).toContain("Forgot password");
    expect(html).toContain("/api/forgot-password");
    expect(html).toContain("function friendlyError");
    expect(html).toContain("Still connecting. Tap Log in again.");
    expect(html).toContain("health.origin === \"down\"");
    expect(html).toContain("hello@taskra.ai");
    expect(html).not.toContain("Email code");
    expect(html).not.toContain("Auto-trade is off");
    expect(html).not.toContain("no 2FA");
    expect(html).not.toContain("Grok Bot / AI invite");
    expect(() => new Function(html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>")))).not.toThrow();
  });
});
