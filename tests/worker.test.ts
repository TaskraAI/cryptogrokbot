import { describe, expect, it } from "vitest";
// @ts-expect-error worker module is plain JavaScript
import { looksLikeTunnelHtml, repairDashboardHtml } from "../workers/cryptogrokbot.js";

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
