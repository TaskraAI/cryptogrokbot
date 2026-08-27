import Phaser from "phaser";
import {
  BUILDING_ANCHORS,
  MAP_H,
  MAP_W,
  STAGE_COLOR,
  STAGE_ICON,
  STAGE_LABEL,
  STAGES,
  TILE,
  type StageId,
} from "../sim/types";

function px(g: Phaser.GameObjects.Graphics, color: number, x: number, y: number, w = 1, h = 1): void {
  g.fillStyle(color, 1);
  g.fillRect(x, y, w, h);
}

function shade(color: number, amount: number): number {
  const r = Math.min(255, Math.max(0, ((color >> 16) & 0xff) * (1 + amount)));
  const g = Math.min(255, Math.max(0, ((color >> 8) & 0xff) * (1 + amount)));
  const b = Math.min(255, Math.max(0, (color & 0xff) * (1 + amount)));
  return (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b);
}

export function generateTextures(scene: Phaser.Scene): void {
  // Grass tile variants
  for (const [key, base] of [
    ["grass", 0x4a7c3f],
    ["grass2", 0x3f6f36],
    ["path", 0xc4a574],
    ["path2", 0xb89564],
    ["water", 0x3b82c4],
    ["water2", 0x2f6aa8],
  ] as const) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    px(g, base, 0, 0, TILE, TILE);
    if (key.startsWith("grass")) {
      px(g, base + 0x0a1208, 3, 5, 1, 1);
      px(g, base + 0x081006, 11, 9, 1, 1);
      px(g, 0x6b9a52, 7, 2, 1, 2);
    } else if (key.startsWith("path")) {
      px(g, 0xa88454, 2, 3, 2, 1);
      px(g, 0xd2b48c, 9, 10, 2, 1);
      px(g, 0x8b6914, 12, 4, 1, 1);
    } else {
      px(g, 0x60a5fa, 4, 6, 2, 1);
      px(g, 0x93c5fd, 10, 3, 1, 1);
    }
    g.generateTexture(key, TILE, TILE);
    g.destroy();
  }

  // Tree
  {
    const g = scene.make.graphics({ x: 0, y: 0 });
    px(g, 0x5b3a1a, 7, 18, 3, 6);
    px(g, 0x1f6b2e, 2, 8, 13, 10);
    px(g, 0x2f8f3e, 4, 4, 9, 8);
    px(g, 0x49b85a, 6, 2, 5, 4);
    g.generateTexture("tree", 16, 24);
    g.destroy();
  }

  // Lamp
  {
    const g = scene.make.graphics({ x: 0, y: 0 });
    px(g, 0x374151, 7, 8, 2, 12);
    px(g, 0xfbbf24, 5, 2, 6, 6);
    px(g, 0xfde68a, 6, 3, 4, 4);
    g.generateTexture("lamp", 16, 20);
    g.destroy();
  }

  // Fountain
  {
    const g = scene.make.graphics({ x: 0, y: 0 });
    px(g, 0x9ca3af, 2, 10, 28, 8);
    px(g, 0x60a5fa, 6, 12, 20, 4);
    px(g, 0xd1d5db, 12, 4, 8, 8);
    px(g, 0x93c5fd, 14, 2, 4, 4);
    g.generateTexture("fountain", 32, 20);
    g.destroy();
  }

  // Agent body templates by hat style
  for (let hat = 0; hat < 5; hat++) {
    const g = scene.make.graphics({ x: 0, y: 0 });
    // placeholder white body — tinted per agent
    px(g, 0xffffff, 4, 6, 8, 8);
    px(g, 0xffffff, 5, 3, 6, 4);
    px(g, 0x1f2937, 6, 14, 2, 3);
    px(g, 0x1f2937, 9, 14, 2, 3);
    px(g, 0x111827, 6, 5, 2, 2);
    px(g, 0x111827, 9, 5, 2, 2);
    const hatColors = [0xef4444, 0x3b82f6, 0xf59e0b, 0x22c55e, 0xa855f7];
    px(g, hatColors[hat]!, 4, 1, 8, 3);
    if (hat === 1) px(g, hatColors[hat]!, 11, 0, 3, 2);
    if (hat === 2) px(g, 0xfde68a, 6, 0, 4, 2);
    g.generateTexture(`agent-${hat}`, 16, 18);
    g.destroy();
  }

  // Status bubbles
  for (const stage of STAGES) {
    drawBubble(scene, `bubble-${stage}`, STAGE_COLOR[stage], STAGE_ICON[stage]);
  }

  // Buildings
  for (const stage of STAGES) {
    drawBuilding(scene, stage, STAGE_COLOR[stage]);
  }
}

function drawBubble(scene: Phaser.Scene, key: string, color: number, icon: string): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  px(g, 0x111827, 1, 1, 14, 12);
  px(g, color, 2, 2, 12, 10);
  px(g, 0x111827, 7, 13, 2, 2);
  g.generateTexture(key, 16, 16);
  g.destroy();
  // icon drawn later as text over building
  void icon;
}

function drawBuilding(scene: Phaser.Scene, stage: StageId, roof: number): void {
  const g = scene.make.graphics({ x: 0, y: 0 });
  const w = 48;
  const h = 40;
  // shadow
  px(g, 0x000000, 4, h - 4, w - 4, 3);
  // walls
  px(g, 0xe7d7b1, 4, 16, 40, 20);
  px(g, 0xd2b48c, 4, 34, 40, 2);
  // roof
  const roofDark = shade(roof, -0.22);
  const roofLight = shade(roof, 0.18);
  px(g, roof, 2, 8, 44, 10);
  px(g, roofDark, 8, 4, 32, 6);
  px(g, roofLight, 14, 2, 20, 4);
  // door
  px(g, 0x5b3a1a, 20, 26, 8, 10);
  px(g, 0xfbbf24, 25, 30, 1, 1);
  // windows
  px(g, 0x7dd3fc, 8, 22, 6, 6);
  px(g, 0x7dd3fc, 34, 22, 6, 6);
  px(g, 0xffffff, 9, 23, 2, 2);
  // chimney for some
  if (stage === "research" || stage === "check") {
    px(g, 0x6b7280, 36, 0, 4, 10);
  }
  g.generateTexture(`building-${stage}`, w, h);
  g.destroy();
}

export function paintMap(scene: Phaser.Scene): void {
  const ground = scene.add.layer();
  ground.setDepth(0);

  // Base grass
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const key = (x + y) % 5 === 0 ? "grass2" : "grass";
      ground.add(scene.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, key).setOrigin(0.5));
    }
  }

  // Paths (simple network connecting buildings through plaza)
  const pathCells = new Set<string>();
  const markPath = (x0: number, y0: number, x1: number, y1: number) => {
    let x = x0;
    let y = y0;
    while (x !== x1 || y !== y1) {
      pathCells.add(`${x},${y}`);
      pathCells.add(`${x},${y + 1}`);
      if (x < x1) x++;
      else if (x > x1) x--;
      else if (y < y1) y++;
      else if (y > y1) y--;
    }
    pathCells.add(`${x1},${y1}`);
  };

  const doorTiles = Object.fromEntries(
    STAGES.map((s) => {
      const a = BUILDING_ANCHORS[s];
      return [s, { x: Math.floor(a.x / TILE), y: Math.floor(a.y / TILE) + 1 }];
    }),
  ) as Record<StageId, { x: number; y: number }>;

  const plaza = { x: 24, y: 14 };
  for (const s of STAGES) {
    markPath(plaza.x, plaza.y, doorTiles[s].x, doorTiles[s].y);
  }
  // ring around plaza
  for (let i = -3; i <= 3; i++) {
    pathCells.add(`${plaza.x + i},${plaza.y}`);
    pathCells.add(`${plaza.x},${plaza.y + i}`);
  }

  for (const key of pathCells) {
    const [xs, ys] = key.split(",");
    const x = Number(xs);
    const y = Number(ys);
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
    const img = scene.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, (x + y) % 2 ? "path" : "path2");
    ground.add(img);
  }

  // Water strip bottom-right
  for (let y = 24; y < MAP_H; y++) {
    for (let x = 40; x < MAP_W; x++) {
      ground.add(
        scene.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, (x + y) % 2 ? "water" : "water2"),
      );
    }
  }
  // waterfall corner
  for (let y = 0; y < 6; y++) {
    for (let x = 44; x < MAP_W; x++) {
      ground.add(
        scene.add.image(x * TILE + TILE / 2, y * TILE + TILE / 2, (x + y) % 2 ? "water" : "water2"),
      );
    }
  }

  // Decor
  const decorSpots = [
    [5, 12], [6, 20], [15, 12], [20, 22], [30, 14], [33, 6], [42, 14], [10, 24], [22, 10], [27, 24],
  ];
  for (const [tx, ty] of decorSpots) {
    scene.add.image(tx! * TILE, ty! * TILE, "tree").setDepth(ty! * TILE).setOrigin(0.5, 1);
  }
  for (const [tx, ty] of [
    [14, 14], [34, 12], [20, 16], [28, 18], [8, 16],
  ]) {
    scene.add.image(tx! * TILE, ty! * TILE, "lamp").setDepth(ty! * TILE).setOrigin(0.5, 1);
  }

  scene.add.image(PLAZA_X(), PLAZA_Y(), "fountain").setDepth(PLAZA_Y()).setOrigin(0.5, 0.5);

  // Buildings + labels + status bubbles
  for (const stage of STAGES) {
    const a = BUILDING_ANCHORS[stage];
    const b = scene.add.image(a.x, a.y - 8, `building-${stage}`).setDepth(a.y).setOrigin(0.5, 1);
    void b;
    scene.add
      .text(a.labelX, a.labelY, STAGE_LABEL[stage], {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: "8px",
        color: "#f8fafc",
        stroke: "#0f172a",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(a.y + 2);

    const bubble = scene.add.image(a.x + 18, a.y - 36, `bubble-${stage}`).setDepth(a.y + 3);
    scene.tweens.add({
      targets: bubble,
      y: bubble.y - 3,
      duration: 900 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
}

function PLAZA_X(): number {
  return 24 * TILE;
}
function PLAZA_Y(): number {
  return 14 * TILE;
}
