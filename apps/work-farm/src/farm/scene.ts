import Phaser from "phaser";
import { GrokFarmSim } from "../sim/engine";
import { syncLiveDesk } from "../sim/live";
import type { FarmAgent, FarmSnapshot } from "../sim/types";
import { generateTextures, paintMap } from "./assets";
import { renderHud } from "../ui/hud";

type AgentView = {
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
};

export class FarmScene extends Phaser.Scene {
  private sim = new GrokFarmSim();
  private views = new Map<string, AgentView>();
  private bob = 0;
  private liveAcc = 0;

  constructor() {
    super("farm");
  }

  create(): void {
    generateTextures(this);
    paintMap(this);

    this.cameras.main.setBounds(0, 0, 48 * 16, 32 * 16);
    this.cameras.main.centerOn(24 * 16, 15 * 16);
    this.cameras.main.setZoom(1.05);

    this.tweens.add({
      targets: this.cameras.main,
      scrollX: this.cameras.main.scrollX + 8,
      scrollY: this.cameras.main.scrollY + 4,
      duration: 16000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    const snap = this.sim.snapshot();
    renderHud(snap);
    this.syncAgents(snap);

    void syncLiveDesk(this.sim);
  }

  update(_time: number, delta: number): void {
    this.bob += delta;
    this.liveAcc += delta;
    if (this.liveAcc >= 4000) {
      this.liveAcc = 0;
      void syncLiveDesk(this.sim);
    }

    const snap = this.sim.update(delta);
    renderHud(snap);
    this.syncAgents(snap);

    for (const agent of snap.agents) {
      const view = this.views.get(agent.id);
      if (!view) continue;
      if (agent.motion === "working") {
        view.sprite.y = agent.y - 8 + Math.sin(this.bob / 120 + agent.x) * 1.5;
      }
      view.label.setPosition(agent.x, agent.y - 22);
      view.label.setDepth(agent.y + 5);
    }
  }

  private syncAgents(snap: FarmSnapshot): void {
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
      view.label.setText(agent.name);
      if (agent.path[agent.pathIndex]) {
        const tx = agent.path[agent.pathIndex]!.x;
        view.sprite.setFlipX(tx < agent.x);
      }
      view.sprite.setAlpha(agent.crewStatus === "error" ? 0.7 : 1);
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        view.sprite.destroy();
        view.label.destroy();
        this.views.delete(id);
      }
    }
  }

  private spawnView(agent: FarmAgent): AgentView {
    const sprite = this.add
      .image(agent.x, agent.y - 8, `agent-${agent.hat}`)
      .setOrigin(0.5, 1)
      .setDepth(agent.y)
      .setTint(agent.color);
    sprite.setScale(0);
    this.tweens.add({ targets: sprite, scale: 1.15, duration: 280, ease: "Back.easeOut" });

    const label = this.add
      .text(agent.x, agent.y - 22, agent.name, {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: "7px",
        color: "#f8fafc",
        stroke: "#0f172a",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setDepth(agent.y + 5);

    return { sprite, label };
  }
}
