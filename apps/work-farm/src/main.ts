import "./style.css";
import Phaser from "phaser";
import { FarmScene } from "./farm/scene";
import { MAP_H, MAP_W, TILE } from "./sim/types";

const width = MAP_W * TILE;
const height = MAP_H * TILE;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "farm-root",
  width,
  height,
  backgroundColor: "#3f6f36",
  pixelArt: true,
  antialias: false,
  scene: [FarmScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  fps: {
    target: 60,
  },
});

// Keep a handle for debugging in the browser console.
(window as unknown as { __workFarm?: Phaser.Game }).__workFarm = game;
