import Phaser from "phaser";
import { FarmSim } from "../sim/engine";
import type { Agent, SimSnapshot } from "../sim/types";
import { generateTextures, paintMap } from "./assets";
import { renderHud } from "../ui/hud";

type AgentView = {
  sprite: Phaser.GameObjects.Image;
  label?: Phaser.GameObjects.Text;
};

export class FarmScene extends Phaser.Scene {
  private sim = new FarmSim(15);
  private views = new Map<string, AgentView>();
  private lastSnap: SimSnapshot | null = null;
  private bob = 0;

  constructor() {
    super("farm");
  }

  create(): void {
    generateTextures(this);
    paintMap(this);

    this.cameras.main.setBounds(0, 0, 48 * 16, 32 * 16);
    this.cameras.main.centerOn(24 * 16, 15 * 16);
    this.cameras.main.setZoom(1.05);

    // gentle camera drift for life — keep all buildings framed
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: this.cameras.main.scrollX + 8,
      scrollY: this.cameras.main.scrollY + 4,
      duration: 16000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.lastSnap = this.sim.snapshot();
    renderHud(this.lastSnap);
    this.syncAgents(this.lastSnap);
  }

  update(_time: number, delta: number): void {
    this.bob += delta;
    const snap = this.sim.update(delta);
    this.lastSnap = snap;
    renderHud(snap);
    this.syncAgents(snap);

    // subtle bob for working agents
    for (const agent of snap.agents) {
      const view = this.views.get(agent.id);
      if (!view) continue;
      if (agent.status === "working") {
        view.sprite.y = agent.y - 8 + Math.sin(this.bob / 120 + agent.x) * 1.5;
      }
    }
  }

  private syncAgents(snap: SimSnapshot): void {
    const seen = new Set<string>();
    for (const agent of snap.agents) {
      seen.add(agent.id);
      let view = this.views.get(agent.id);
      if (!view) {
        view = this.spawnView(agent);
        this.views.set(agent.id, view);
      }
      view.sprite.setPosition(agent.x, agent.y - 8);
      view.sprite.setDepth(agent.y);
      view.sprite.setTint(agent.color);
      // facing hint via flip
      if (agent.path[agent.pathIndex]) {
        const tx = agent.path[agent.pathIndex]!.x;
        view.sprite.setFlipX(tx < agent.x);
      }
      if (agent.status === "working") {
        view.sprite.setAlpha(1);
      } else if (agent.status === "idle") {
        view.sprite.setAlpha(0.85);
      } else {
        view.sprite.setAlpha(1);
      }
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        view.sprite.destroy();
        view.label?.destroy();
        this.views.delete(id);
      }
    }
  }

  private spawnView(agent: Agent): AgentView {
    const sprite = this.add
      .image(agent.x, agent.y - 8, `agent-${agent.hat}`)
      .setOrigin(0.5, 1)
      .setDepth(agent.y)
      .setTint(agent.color);
    // pop-in
    sprite.setScale(0);
    this.tweens.add({ targets: sprite, scale: 1, duration: 280, ease: "Back.easeOut" });
    return { sprite };
  }
}
