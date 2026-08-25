import { createServer } from "node:http";
import { crewHtml, type CrewBoard } from "@night/crew";

export function startCrewServer(board: CrewBoard, port: number): void {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url.startsWith("/crew.json") || url.startsWith("/api/crew")) {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ pulses: board.snapshot(), log: board.recentLog(40) }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(crewHtml(board));
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(`Crew board http://127.0.0.1:${port}/  (JSON /crew.json)`);
  });
}
