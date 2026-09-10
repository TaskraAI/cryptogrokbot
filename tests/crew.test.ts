import { describe, expect, it } from "vitest";
import { CrewBoard, crewHtml } from "@night/crew";

describe("crew board", () => {
  it("tracks parallel agents and renders a live board", () => {
    const board = new CrewBoard();
    board.start("scout", "polling X");
    board.start("sentinel", "watching bags");
    board.idle("scout", "3 hits");
    const snap = board.snapshot();
    expect(snap.find((p) => p.id === "scout")?.status).toBe("idle");
    expect(snap.find((p) => p.id === "sentinel")?.status).toBe("running");
    const text = board.formatText();
    expect(text).toMatch(/Scout/);
    expect(text).toMatch(/Sentinel/);
    expect(text).toMatch(/Auditor/);
    expect(board.snapshot().map((p) => p.id)).toContain("auditor");
    expect(crewHtml(board)).toMatch(/Night Agent crew/);
  });
});
