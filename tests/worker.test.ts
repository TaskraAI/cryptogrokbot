import { describe, expect, it } from "vitest";
// @ts-expect-error worker module is plain JavaScript
import { repairDashboardHtml } from "../workers/cryptogrokbot.js";

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
