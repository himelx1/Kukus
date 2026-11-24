import type Phaser from 'phaser';
import { BUILDING_LIST, BuildingDef } from '../data/buildings.data';
import { BUILDABLE_ROADS, RoadDef, RoadType } from '../data/roads.data';
import { DepositType, FeatureType } from '../data/trees.data';
import { BiomeId } from '../core/GameState';
import { TILE_HEIGHT, TILE_WIDTH } from '../core/IsoMath';

export const ATLAS_KEY = 'kukus-atlas';

interface BiomePalette {
  topA: string;
  topB: string;
  lip: string;
  left: string;
  right: string;
  strata: string;
  detailA: string;
  detailB: string;
}

const BIOME_PALETTES: Record<BiomeId, BiomePalette> = {
  [BiomeId.DeepWater]: {
    topA: '#13608a',
    topB: '#0b4263',
    lip: '#1c7db0',
    left: '#07304a',
    right: '#041f31',
    strata: '#0e4c70',
    detailA: '#38bdf8',
    detailB: '#bae6fd',
  },
  [BiomeId.River]: {
    topA: '#2892bf',
    topB: '#187099',
    lip: '#44aedb',
    left: '#105475',
    right: '#0a3a52',
    strata: '#1d759c',
    detailA: '#7dd3fc',
    detailB: '#e0f2fe',
  },
  [BiomeId.Beach]: {
    topA: '#f0da9e',
    topB: '#dec17a',
    lip: '#f8e7b8',
    left: '#b59457',
    right: '#8a6c39',
    strata: '#9c7d44',
    detailA: '#fef08a',
    detailB: '#c29b57',
  },
  [BiomeId.Grassland]: {
    topA: '#6bbf59',
    topB: '#4ea145',
    lip: '#80cf6c',
    left: '#785538',
    right: '#523823',
    strata: '#614229',
    detailA: '#a3e635',
    detailB: '#fef08a',
  },
  [BiomeId.Fertile]: {
    topA: '#4ba856',
    topB: '#378742',
    lip: '#62bf6a',
    left: '#5f422b',
    right: '#3f2a1a',
    strata: '#4c3421',
    detailA: '#6ee7b7',
    detailB: '#34d399',
  },
  [BiomeId.Jungle]: {
    topA: '#38914b',
    topB: '#267038',
    lip: '#4aa65c',
    left: '#5c4028',
    right: '#3d2817',
    strata: '#4b331e',
    detailA: '#4ade80',
    detailB: '#166534',
  },
  [BiomeId.Forest]: {
    topA: '#4b9e56',
    topB: '#377d42',
    lip: '#62b36b',
    left: '#684a31',
    right: '#46301e',
    strata: '#543b25',
    detailA: '#86efac',
    detailB: '#22c55e',
  },
  [BiomeId.Swamp]: {
    topA: '#4e734c',
    topB: '#3a5738',
    lip: '#60875d',
    left: '#493d2b',
    right: '#2f271b',
    strata: '#3c3223',
    detailA: '#a3e635',
    detailB: '#65a30d',
  },
  [BiomeId.Desert]: {
    topA: '#e6bd6e',
    topB: '#cc9d4f',
    lip: '#f3cf87',
    left: '#a37c3b',
    right: '#785826',
    strata: '#8c6930',
    detailA: '#fde68a',
    detailB: '#b45309',
  },
  [BiomeId.Mountain]: {
    topA: '#969ca3',
    topB: '#737980',
    lip: '#b0b7bf',
    left: '#575c63',
    right: '#3b3f45',
    strata: '#474b52',
    detailA: '#e2e8f0',
    detailB: '#475569',
  },
};

export function generateWorldAtlas(scene: Phaser.Scene): void {
  if (scene.textures.exists(ATLAS_KEY)) return;
  const ct = scene.textures.createCanvas(ATLAS_KEY, 2048, 2048);
  if (!ct) return;
  const ctx = ct.getContext();
  ctx.clearRect(0, 0, 2048, 2048);

  let curX = 2;
  let curY = 2;
  let rowH = 0;

  const alloc = (w: number, h: number, name: string): { x: number; y: number } => {
    if (curX + w + 2 > 2046) {
      curX = 2;
      curY += rowH + 2;
      rowH = 0;
    }
    const pos = { x: curX, y: curY };
    ct.add(name, 0, pos.x, pos.y, w, h);
    curX += w + 2;
    if (h > rowH) rowH = h;
    return pos;
  };

  // 1. Biome Tiles (64x56: 32px isometric diamond + 24px layered cliff skirt)
  const tileW = TILE_WIDTH;
  const tileH = 56;
  for (let b = 0; b <= 9; b++) {
    const pal = BIOME_PALETTES[b as BiomeId];
    const { x, y } = alloc(tileW, tileH, `biome_${b}`);
    drawIsoBlock(ctx, x, y, tileW, TILE_HEIGHT, 22, pal, b as BiomeId);
  }

  // 2. Tile overlays & surveyed perimeter borders (sharp visual contrast between Owned vs Locked land)
  drawLockedWildernessTile(ctx, alloc(64, 34, 'tile_locked'));
  drawIsoDiamondOutline(
    ctx,
    alloc(64, 34, 'tile_owned'),
    64,
    32,
    'rgba(254, 249, 195, 0.08)',
    'rgba(255, 255, 255, 0.08)',
    0.8
  );
  drawFrontierSubtleTile(ctx, alloc(64, 34, 'tile_frontier_subtle'));
  drawIsoDiamondOutline(
    ctx,
    alloc(64, 34, 'tile_frontier'),
    64,
    32,
    'rgba(245, 158, 11, 0.28)',
    '#fbbf24',
    2
  );
  drawIsoDiamondOutline(
    ctx,
    alloc(64, 34, 'tile_selected'),
    64,
    32,
    'rgba(255, 255, 255, 0.18)',
    '#fef08a',
    2
  );
  drawIsoDiamondOutline(
    ctx,
    alloc(64, 34, 'tile_valid'),
    64,
    32,
    'rgba(34, 197, 94, 0.34)',
    '#4ade80',
    2
  );
  drawIsoDiamondOutline(
    ctx,
    alloc(64, 34, 'tile_invalid'),
    64,
    32,
    'rgba(239, 68, 68, 0.36)',
    '#f87171',
    2
  );

  // Surveyed estate border edges (rendered along unlocked tiles bordering locked wilderness)
  drawSurveyBorderEdge(ctx, alloc(64, 34, 'border_ne'), 'ne');
  drawSurveyBorderEdge(ctx, alloc(64, 34, 'border_nw'), 'nw');
  drawSurveyBorderEdge(ctx, alloc(64, 34, 'border_se'), 'se');
  drawSurveyBorderEdge(ctx, alloc(64, 34, 'border_sw'), 'sw');

  // 3. Textured Roads, Bridges & Railways (64x36)
  for (const road of BUILDABLE_ROADS) {
    const pos = alloc(64, 36, `road_${road.id}`);
    drawRoadTile(ctx, pos.x, pos.y, road);
  }

  // 4. Lush Volumetric Trees, Bamboo, Ancient Ruins & Outcrops (76x92)
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.JungleHardwood}`), 'hardwood');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.TropicalPalm}`), 'palm');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.FruitTree}`), 'fruit');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.AncientMahogany}`), 'mahogany');
  drawBoulderSprite(ctx, alloc(76, 92, `feat_${FeatureType.StoneOutcrop}`));
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.Sapling}`), 'sapling');
  drawBambooFeature(ctx, alloc(76, 92, `feat_${FeatureType.BambooCluster}`));
  drawAncientRuinFeature(ctx, alloc(76, 92, `feat_${FeatureType.AncientRuin}`));
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.OakTree}`), 'oak');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.PineTree}`), 'pine');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.BirchTree}`), 'birch');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.CypressTree}`), 'cypress');
  drawTreeSprite(ctx, alloc(76, 92, `feat_${FeatureType.AcaciaTree}`), 'acacia');

  // 5. Mineral Deposits (48x30)
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.Stone}`), '#cbd5e1', '#64748b', '#e2e8f0');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.Clay}`), '#d97706', '#92400e', '#fbbf24');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.Sand}`), '#fde047', '#ca8a04', '#fef9c3');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.IronOre}`), '#94a3b8', '#334155', '#38bdf8');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.CopperOre}`), '#fb923c', '#9a3412', '#fdba74');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.Coal}`), '#334155', '#0f172a', '#64748b');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.Gold}`), '#facc15', '#92400e', '#fef08a');
  drawDepositBadge(ctx, alloc(48, 30, `dep_${DepositType.Silver}`), '#f1f5f9', '#475569', '#ffffff');

  // 6. Construction scaffolding (72x64)
  drawConstructionFrame(ctx, alloc(72, 64, 'bldg_constructing'));

  // 7. Bespoke 2.5D Architectural Sprites for every building
  for (const def of BUILDING_LIST) {
    const span = def.width + def.height;
    const asymPad = Math.abs(def.width - def.height) * 32;
    const frameW = Math.max(80, span * 32 + asymPad + 20);
    const frameH = Math.max(94, span * 16 + 72);
    const pos = alloc(frameW, frameH, `bldg_${def.id}`);
    drawBuildingSprite(ctx, pos.x, pos.y, frameW, frameH, def);
  }

  // 8. Pooled ambient sprites
  drawAmbientSprites(ctx, alloc(24, 24, 'amb_bird'), 'bird');
  drawAmbientSprites(ctx, alloc(28, 24, 'amb_cart'), 'cart');
  drawRiverBoat(ctx, alloc(32, 22, 'amb_boat'));
  drawWildlifeDeer(ctx, alloc(26, 24, 'wild_deer'));
  drawFireflyGlow(ctx, alloc(16, 16, 'firefly_glow'));
  drawFestivalLantern(ctx, alloc(16, 22, 'festival_lantern'));

  // 9. Citizens (28x38), carried cargo (16x14), water ripple (44x20), smoke puff (24x24), light halo (128x128)
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_laborer_0'), '#d97706', '#fde047', 0, false);
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_laborer_1'), '#d97706', '#fde047', 1, false);
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_laborer_chop'), '#d97706', '#fde047', 0, true);
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_artisan_0'), '#2563eb', '#f8fafc', 0, false);
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_artisan_1'), '#2563eb', '#f8fafc', 1, false);
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_engineer_0'), '#0d9488', '#facc15', 0, false);
  drawCitizenSprite(ctx, alloc(28, 38, 'cit_engineer_1'), '#0d9488', '#facc15', 1, false);

  drawCargoSprite(ctx, alloc(16, 14, 'cargo_wood'), 'wood');
  drawCargoSprite(ctx, alloc(16, 14, 'cargo_food'), 'food');
  drawCargoSprite(ctx, alloc(16, 14, 'cargo_stone'), 'stone');
  drawCargoSprite(ctx, alloc(16, 14, 'cargo_goods'), 'goods');

  drawWaterRipple(ctx, alloc(44, 20, 'water_ripple'));
  drawSmokePuff(ctx, alloc(24, 24, 'smoke_puff'));
  drawLightHalo(ctx, alloc(128, 128, 'light_halo'));
  drawWindowGlow(ctx, alloc(48, 36, 'window_glow'));
  drawSkyStar(ctx, alloc(12, 12, 'sky_star'));

  ct.refresh();
}

function drawIsoBlock(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  w: number,
  h: number,
  depth: number,
  pal: BiomePalette,
  biome: BiomeId
): void {
  const hw = w / 2;
  const hh = h / 2;

  // Left cliff wall with strata band
  ctx.fillStyle = pal.left;
  ctx.beginPath();
  ctx.moveTo(ox, oy + hh);
  ctx.lineTo(ox + hw, oy + h);
  ctx.lineTo(ox + hw, oy + h + depth);
  ctx.lineTo(ox, oy + hh + depth);
  ctx.closePath();
  ctx.fill();

  // Topsoil overhang lip on left wall
  ctx.fillStyle = shadeHex(pal.topB, -18);
  ctx.beginPath();
  ctx.moveTo(ox, oy + hh);
  ctx.lineTo(ox + hw, oy + h);
  ctx.lineTo(ox + hw, oy + h + 3);
  ctx.lineTo(ox, oy + hh + 3);
  ctx.closePath();
  ctx.fill();

  // Horizontal cliff rock stratum on left wall
  ctx.fillStyle = pal.strata;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(ox, oy + hh + 9);
  ctx.lineTo(ox + hw, oy + h + 9);
  ctx.lineTo(ox + hw, oy + h + 13);
  ctx.lineTo(ox, oy + hh + 13);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  // Right cliff wall (deeper shadow)
  ctx.fillStyle = pal.right;
  ctx.beginPath();
  ctx.moveTo(ox + hw, oy + h);
  ctx.lineTo(ox + w, oy + hh);
  ctx.lineTo(ox + w, oy + hh + depth);
  ctx.lineTo(ox + hw, oy + h + depth);
  ctx.closePath();
  ctx.fill();

  // Topsoil overhang lip on right wall
  ctx.fillStyle = shadeHex(pal.topB, -30);
  ctx.beginPath();
  ctx.moveTo(ox + hw, oy + h);
  ctx.lineTo(ox + w, oy + hh);
  ctx.lineTo(ox + w, oy + hh + 3);
  ctx.lineTo(ox + hw, oy + h + 3);
  ctx.closePath();
  ctx.fill();

  // Top diamond directional gradient (lit from top-left)
  const grad = ctx.createLinearGradient(ox + 6, oy + 2, ox + w - 6, oy + h - 2);
  grad.addColorStop(0, pal.topA);
  grad.addColorStop(1, pal.topB);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(ox + hw, oy);
  ctx.lineTo(ox + w, oy + hh);
  ctx.lineTo(ox + hw, oy + h);
  ctx.lineTo(ox, oy + hh);
  ctx.closePath();
  ctx.fill();

  // Top-left sunlit rim bevel
  ctx.strokeStyle = pal.lip;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(ox + 1, oy + hh);
  ctx.lineTo(ox + hw, oy + 0.8);
  ctx.lineTo(ox + w - 1, oy + hh);
  ctx.stroke();

  // Subtle ambient shadow rim along bottom edges
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox + 1, oy + hh);
  ctx.lineTo(ox + hw, oy + h - 0.6);
  ctx.lineTo(ox + w - 1, oy + hh);
  ctx.stroke();

  // Biome surface micro-details
  if (biome === BiomeId.DeepWater || biome === BiomeId.River) {
    ctx.strokeStyle = pal.detailB;
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ox + 20, oy + 14);
    ctx.quadraticCurveTo(ox + 28, oy + 12, ox + 36, oy + 14);
    ctx.moveTo(ox + 26, oy + 21);
    ctx.quadraticCurveTo(ox + 34, oy + 19, ox + 42, oy + 21);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (biome === BiomeId.Mountain) {
    // Faceted rock crest
    ctx.fillStyle = pal.detailA;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(ox + hw, oy + 6);
    ctx.lineTo(ox + hw + 10, oy + 14);
    ctx.lineTo(ox + hw, oy + 17);
    ctx.lineTo(ox + hw - 9, oy + 13);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (biome === BiomeId.Desert || biome === BiomeId.Beach) {
    ctx.strokeStyle = pal.detailA;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(ox + 18, oy + 16);
    ctx.quadraticCurveTo(ox + 32, oy + 12, ox + 45, oy + 16);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    // Grass tufts & fern speckles
    ctx.fillStyle = pal.detailA;
    ctx.globalAlpha = 0.36;
    ctx.fillRect(ox + hw - 10, oy + hh - 3, 2, 3);
    ctx.fillRect(ox + hw - 7, oy + hh - 2, 2, 2);
    ctx.fillRect(ox + hw + 6, oy + hh + 2, 2, 3);
    ctx.fillStyle = pal.detailB;
    ctx.fillRect(ox + hw + 1, oy + hh - 6, 2, 2);
    ctx.globalAlpha = 1;
  }
}

function drawIsoDiamondOutline(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  w: number,
  h: number,
  fill: string,
  stroke: string,
  lineWidth: number
): void {
  const hw = w / 2;
  const hh = h / 2;
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(pos.x + hw, pos.y + 1);
  ctx.lineTo(pos.x + w - 1, pos.y + hh + 1);
  ctx.lineTo(pos.x + hw, pos.y + h + 1);
  ctx.lineTo(pos.x + 1, pos.y + hh + 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawLockedWildernessTile(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const w = 64;
  const h = 32;
  const hw = w / 2;
  const hh = h / 2;
  ctx.fillStyle = 'rgba(5, 19, 28, 0.56)';
  ctx.beginPath();
  ctx.moveTo(pos.x + hw, pos.y + 1);
  ctx.lineTo(pos.x + w - 1, pos.y + hh + 1);
  ctx.lineTo(pos.x + hw, pos.y + h + 1);
  ctx.lineTo(pos.x + 1, pos.y + hh + 1);
  ctx.closePath();
  ctx.fill();

  // Subtle misty diagonal hatch marks inside locked tiles for immediate distinction
  ctx.strokeStyle = 'rgba(148, 197, 214, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pos.x + 18, pos.y + 14);
  ctx.lineTo(pos.x + 28, pos.y + 19);
  ctx.moveTo(pos.x + 34, pos.y + 13);
  ctx.lineTo(pos.x + 44, pos.y + 18);
  ctx.stroke();
}

function drawFrontierSubtleTile(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  // Subtle amber-tinted mist & survey markers on unlockable adjacent tiles
  const w = 64;
  const h = 32;
  const hw = w / 2;
  const hh = h / 2;
  ctx.fillStyle = 'rgba(245, 158, 11, 0.08)';
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.34)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pos.x + hw, pos.y + 2);
  ctx.lineTo(pos.x + w - 3, pos.y + hh + 1);
  ctx.lineTo(pos.x + hw, pos.y + h);
  ctx.lineTo(pos.x + 3, pos.y + hh + 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSurveyBorderEdge(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  edge: 'ne' | 'nw' | 'se' | 'sw'
): void {
  const pTop = { x: pos.x + 32, y: pos.y + 1 };
  const pRight = { x: pos.x + 63, y: pos.y + 17 };
  const pBottom = { x: pos.x + 32, y: pos.y + 33 };
  const pLeft = { x: pos.x + 1, y: pos.y + 17 };

  const [a, b] =
    edge === 'ne'
      ? [pTop, pRight]
      : edge === 'nw'
        ? [pLeft, pTop]
        : edge === 'se'
          ? [pRight, pBottom]
          : [pLeft, pBottom];

  // Dark contrast drop line
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y + 1);
  ctx.lineTo(b.x, b.y + 1);
  ctx.stroke();

  // Golden-ivory surveyed perimeter border
  ctx.strokeStyle = '#fde047';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Tiny corner wooden survey stakes
  const mx = (a.x + b.x) * 0.5;
  const my = (a.y + b.y) * 0.5;
  ctx.fillStyle = '#fef08a';
  ctx.beginPath();
  ctx.arc(mx, my, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawRoadTile(ctx: CanvasRenderingContext2D, ox: number, oy: number, road: RoadDef): void {
  const hw = 32;
  const hh = 16;

  // Textured isometric road diamond
  ctx.fillStyle = road.color;
  ctx.strokeStyle = road.trimColor;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(ox + hw, oy + 3);
  ctx.lineTo(ox + 56, oy + hh + 1);
  ctx.lineTo(ox + hw, oy + 29);
  ctx.lineTo(ox + 8, oy + hh + 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (road.id === RoadType.Dirt || road.id === RoadType.Gravel) {
    ctx.fillStyle = road.trimColor;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(ox + 22, oy + 14, 3, 2);
    ctx.fillRect(ox + 34, oy + 18, 4, 2);
    ctx.fillRect(ox + 29, oy + 11, 3, 2);
    ctx.globalAlpha = 1;
  } else if (road.id === RoadType.Bridge) {
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + hw + i * 4 - 6, oy + hh + 1 + i * 2 - 3);
      ctx.lineTo(ox + hw + i * 4 + 6, oy + hh + 1 + i * 2 + 3);
      ctx.stroke();
    }
  } else if (road.id === RoadType.Stone) {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + 18, oy + 11);
    ctx.lineTo(ox + 44, oy + 23);
    ctx.moveTo(ox + 18, oy + 23);
    ctx.lineTo(ox + 44, oy + 11);
    ctx.stroke();
  } else if (road.id === RoadType.Rail) {
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(ox + hw + i * 4 - 5, oy + hh + 1 + i * 2 + 2.5);
      ctx.lineTo(ox + hw + i * 4 + 5, oy + hh + 1 + i * 2 - 2.5);
      ctx.stroke();
    }
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ox + 16, oy + 10);
    ctx.lineTo(ox + 46, oy + 24);
    ctx.moveTo(ox + 20, oy + 8);
    ctx.lineTo(ox + 50, oy + 22);
    ctx.stroke();
  } else {
    // Paved / Highway lane markings
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(ox + 17, oy + 10);
    ctx.lineTo(ox + 47, oy + 24);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawTreeSprite(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  kind: 'hardwood' | 'palm' | 'fruit' | 'mahogany' | 'sapling' | 'oak' | 'pine' | 'birch' | 'cypress' | 'acacia'
): void {
  const cx = pos.x + 38;
  const baseY = pos.y + 74;

  // Soft grounded contact shadow
  ctx.fillStyle = 'rgba(5, 16, 10, 0.34)';
  ctx.beginPath();
  ctx.ellipse(cx + 3, baseY + 1, kind === 'sapling' ? 7 : 17, kind === 'sapling' ? 3.5 : 8, 0, 0, Math.PI * 2);
  ctx.fill();

  if (kind === 'pine') {
    ctx.fillStyle = '#57331b';
    ctx.fillRect(cx - 2.5, baseY - 16, 5, 16);
    const tiers = [
      { y: baseY - 13, w: 18, h: 18, col: '#14532d' },
      { y: baseY - 25, w: 14, h: 17, col: '#166534' },
      { y: baseY - 37, w: 10, h: 16, col: '#15803d' },
    ];
    for (const t of tiers) {
      ctx.fillStyle = t.col;
      ctx.beginPath();
      ctx.moveTo(cx, t.y - t.h);
      ctx.lineTo(cx + t.w, t.y);
      ctx.lineTo(cx - t.w, t.y);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  if (kind === 'birch') {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(cx - 2.5, baseY - 26, 5, 26);
    ctx.fillStyle = '#334155';
    ctx.fillRect(cx - 2.5, baseY - 20, 3, 2);
    ctx.fillRect(cx - 0.5, baseY - 12, 3, 2);
    ctx.fillStyle = '#65a30d';
    ctx.beginPath();
    ctx.arc(cx - 5, baseY - 28, 10, 0, Math.PI * 2);
    ctx.arc(cx + 5, baseY - 27, 9, 0, Math.PI * 2);
    ctx.arc(cx, baseY - 36, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#bef264';
    ctx.beginPath();
    ctx.arc(cx - 2, baseY - 38, 5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (kind === 'cypress') {
    ctx.fillStyle = '#452b18';
    ctx.beginPath();
    ctx.moveTo(cx - 6, baseY);
    ctx.lineTo(cx - 2, baseY - 26);
    ctx.lineTo(cx + 2, baseY - 26);
    ctx.lineTo(cx + 6, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1e5631';
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 34, 9, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a7d44';
    ctx.beginPath();
    ctx.ellipse(cx - 2, baseY - 36, 5, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (kind === 'acacia') {
    ctx.strokeStyle = '#6b4226';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.lineTo(cx, baseY - 22);
    ctx.lineTo(cx - 10, baseY - 31);
    ctx.moveTo(cx, baseY - 20);
    ctx.lineTo(cx + 11, baseY - 30);
    ctx.stroke();
    ctx.fillStyle = '#4d7c0f';
    ctx.beginPath();
    ctx.ellipse(cx, baseY - 33, 21, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#84cc16';
    ctx.beginPath();
    ctx.ellipse(cx - 3, baseY - 35, 14, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (kind === 'oak') {
    ctx.fillStyle = '#5c3a21';
    ctx.fillRect(cx - 4, baseY - 22, 8, 22);
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.arc(cx - 10, baseY - 27, 12, 0, Math.PI * 2);
    ctx.arc(cx + 10, baseY - 27, 12, 0, Math.PI * 2);
    ctx.arc(cx, baseY - 37, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(cx - 4, baseY - 40, 7, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (kind === 'sapling') {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(cx - 1.5, baseY - 14, 3, 14);
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.arc(cx - 3, baseY - 16, 5.5, 0, Math.PI * 2);
    ctx.arc(cx + 3, baseY - 17, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#86efac';
    ctx.beginPath();
    ctx.arc(cx - 1, baseY - 19, 3.2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (kind === 'palm') {
    // Segmented curving coconut trunk
    ctx.strokeStyle = '#7c4a21';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, baseY);
    ctx.quadraticCurveTo(cx + 6, baseY - 22, cx - 2, baseY - 44);
    ctx.stroke();

    ctx.strokeStyle = '#a1622e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 1, baseY - 4);
    ctx.quadraticCurveTo(cx + 4, baseY - 22, cx - 3, baseY - 43);
    ctx.stroke();

    // Coconuts under crown
    ctx.fillStyle = '#451a03';
    ctx.beginPath();
    ctx.arc(cx - 4, baseY - 42, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 1, baseY - 41, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 6 arched feathered palm fronds
    const fronds = [
      { dx: -26, dy: 12, color: '#15803d' },
      { dx: 26, dy: 12, color: '#15803d' },
      { dx: -20, dy: -8, color: '#22c55e' },
      { dx: 21, dy: -7, color: '#22c55e' },
      { dx: -9, dy: -16, color: '#4ade80' },
      { dx: 11, dy: -15, color: '#4ade80' },
    ];
    for (const f of fronds) {
      ctx.fillStyle = f.color;
      ctx.beginPath();
      ctx.moveTo(cx - 2, baseY - 45);
      ctx.quadraticCurveTo(cx + f.dx * 0.55, baseY - 54 + f.dy * 0.3, cx + f.dx, baseY - 42 + f.dy);
      ctx.quadraticCurveTo(cx + f.dx * 0.45, baseY - 45 + f.dy * 0.35, cx - 2, baseY - 43);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  // Broad-canopy rainforest trees (hardwood / fruit / mahogany)
  const trunkH = kind === 'mahogany' ? 30 : 21;
  const trunkW = kind === 'mahogany' ? 9 : 6.5;

  // Flared root buttresses
  ctx.fillStyle = '#57331b';
  ctx.beginPath();
  ctx.moveTo(cx - trunkW * 0.9, baseY + 1);
  ctx.lineTo(cx - trunkW * 0.4, baseY - trunkH);
  ctx.lineTo(cx + trunkW * 0.4, baseY - trunkH);
  ctx.lineTo(cx + trunkW * 0.9, baseY + 1);
  ctx.closePath();
  ctx.fill();

  // Lit left bark strip
  ctx.fillStyle = '#85512c';
  ctx.fillRect(cx - trunkW * 0.35, baseY - trunkH, trunkW * 0.38, trunkH - 1);

  const deepColor = kind === 'mahogany' ? '#0f3d23' : '#14532d';
  const midColor = kind === 'mahogany' ? '#15803d' : kind === 'fruit' ? '#16a34a' : '#15803d';
  const hiColor = kind === 'mahogany' ? '#4ade80' : '#4ade80';
  const topY = baseY - trunkH;
  const scale = kind === 'mahogany' ? 1.24 : 1.0;

  // Back shadow canopy cluster
  const drawPuff = (px: number, py: number, r: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  };

  drawPuff(cx + 8 * scale, topY - 10 * scale, 13 * scale, deepColor);
  drawPuff(cx - 9 * scale, topY - 9 * scale, 13 * scale, deepColor);
  drawPuff(cx, topY - 19 * scale, 15 * scale, deepColor);

  // Mid volumetric lobes
  drawPuff(cx - 8 * scale, topY - 13 * scale, 11 * scale, midColor);
  drawPuff(cx + 7 * scale, topY - 14 * scale, 10 * scale, midColor);
  drawPuff(cx - 1 * scale, topY - 22 * scale, 12.5 * scale, midColor);

  // Sunlit top-left highlights
  drawPuff(cx - 5 * scale, topY - 24 * scale, 8 * scale, hiColor);
  drawPuff(cx - 10 * scale, topY - 15 * scale, 5.5 * scale, hiColor);
  ctx.fillStyle = '#bbf7d0';
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(cx - 6 * scale, topY - 26 * scale, 3.8 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  if (kind === 'mahogany') {
    // Golden-olive crest blossoms on Ancient Mahogany
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(cx - 2, topY - 29, 2.2, 0, Math.PI * 2);
    ctx.arc(cx + 7, topY - 21, 2, 0, Math.PI * 2);
    ctx.arc(cx - 11, topY - 19, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'fruit') {
    // Bright ripe tropical fruits
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(cx - 7, topY - 12, 2.6, 0, Math.PI * 2);
    ctx.arc(cx + 6, topY - 14, 2.6, 0, Math.PI * 2);
    ctx.arc(cx + 1, topY - 22, 2.5, 0, Math.PI * 2);
    ctx.arc(cx - 2, topY - 8, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(cx - 8, topY - 13, 1.5, 1.5);
    ctx.fillRect(cx + 5, topY - 15, 1.5, 1.5);
  }
}

function drawBoulderSprite(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 38;
  const by = pos.y + 74;

  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx + 2, by, 17, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Dark base boulder
  ctx.fillStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(cx - 16, by - 2);
  ctx.lineTo(cx - 10, by - 22);
  ctx.lineTo(cx + 3, by - 25);
  ctx.lineTo(cx + 16, by - 6);
  ctx.lineTo(cx + 3, by + 4);
  ctx.closePath();
  ctx.fill();

  // Sunlit left facet
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(cx - 16, by - 2);
  ctx.lineTo(cx - 10, by - 22);
  ctx.lineTo(cx + 3, by - 25);
  ctx.lineTo(cx - 1, by - 8);
  ctx.lineTo(cx - 11, by - 4);
  ctx.closePath();
  ctx.fill();

  // Top quartz highlight
  ctx.fillStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(cx - 9, by - 20);
  ctx.lineTo(cx + 3, by - 25);
  ctx.lineTo(cx + 6, by - 14);
  ctx.lineTo(cx - 4, by - 12);
  ctx.closePath();
  ctx.fill();

  // Moss tuft on rock base
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(cx - 12, by - 5, 5, 3);
}

function drawDepositBadge(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  primary: string,
  dark: string,
  glint: string
): void {
  const cx = pos.x + 24;
  const cy = pos.y + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 5, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy + 4);
  ctx.lineTo(cx - 5, cy - 8);
  ctx.lineTo(cx + 5, cy - 7);
  ctx.lineTo(cx + 12, cy + 4);
  ctx.lineTo(cx, cy + 8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy + 2);
  ctx.lineTo(cx - 5, cy - 8);
  ctx.lineTo(cx + 3, cy - 6);
  ctx.lineTo(cx, cy + 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = glint;
  ctx.fillRect(cx - 4, cy - 5, 3, 3);
  ctx.fillRect(cx + 3, cy - 2, 2.5, 2.5);
}

function drawConstructionFrame(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 36;
  const by = pos.y + 52;

  // Dirt construction pad
  ctx.fillStyle = '#785538';
  ctx.beginPath();
  ctx.moveTo(cx, by - 22);
  ctx.lineTo(cx + 26, by - 9);
  ctx.lineTo(cx, by + 4);
  ctx.lineTo(cx - 26, by - 9);
  ctx.closePath();
  ctx.fill();

  // Timber scaffolding posts & crossbars
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(cx - 16, by - 32, 32, 22);
  ctx.strokeStyle = '#d97706';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(cx - 16, by - 32);
  ctx.lineTo(cx + 16, by - 10);
  ctx.moveTo(cx + 16, by - 32);
  ctx.lineTo(cx - 16, by - 10);
  ctx.stroke();

  // Timber plank deck
  ctx.fillStyle = '#b45309';
  ctx.fillRect(cx - 18, by - 23, 36, 3);
}

function drawBuildingSprite(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  fw: number,
  fh: number,
  def: BuildingDef
): void {
  const halfTileW = TILE_WIDTH * 0.5;
  const halfTileH = TILE_HEIGHT * 0.5;

  // Align southmost vertex pBottom cleanly at bottom-center (ox + fw*0.5, oy + fh - 3)
  // so WorldScene's origin(0.5, 1) snaps exact footprint corners to the map grid!
  const pBottom = { x: ox + fw * 0.5, y: oy + fh - 3 };
  const pTop = {
    x: pBottom.x - (def.width - def.height) * halfTileW,
    y: pBottom.y - (def.width + def.height) * halfTileH,
  };
  const pRight = { x: pTop.x + def.width * halfTileW, y: pTop.y + def.width * halfTileH };
  const pLeft = { x: pTop.x - def.height * halfTileW, y: pTop.y + def.height * halfTileH };

  // Soft ambient ground shadow & stone plinth pad
  ctx.fillStyle = 'rgba(4, 12, 8, 0.32)';
  ctx.beginPath();
  ctx.moveTo(pTop.x + 4, pTop.y + 3);
  ctx.lineTo(pRight.x + 5, pRight.y + 3);
  ctx.lineTo(pBottom.x + 4, pBottom.y + 3);
  ctx.lineTo(pLeft.x - 1, pLeft.y + 3);
  ctx.closePath();
  ctx.fill();

  const cx = (pTop.x + pBottom.x) * 0.5;
  const cy = (pTop.y + pBottom.y) * 0.5;

  // Agricultural & Park grounds
  if (def.category === 'agricultural' || def.id === 'village_park') {
    drawAgriculturalOrPark(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }

  // Stone foundation slab (raised 3px)
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#64748b', '#475569');

  // Specialized iconic silhouettes
  if (def.id === 'leaf_hut') {
    drawLeafHut(ctx, cx, cy);
    return;
  }
  if (def.id === 'windmill') {
    drawWindmill(ctx, cx, cy, def);
    return;
  }
  if (def.id === 'wind_turbine') {
    drawWindTurbine(ctx, cx, cy, def);
    return;
  }
  if (def.id === 'solar_array') {
    drawSolarPlant(ctx, pTop, pRight, pBottom, pLeft, def);
    return;
  }
  if (def.id === 'water_well') {
    drawWaterWell(ctx, cx, cy);
    return;
  }
  if (def.id === 'water_tower') {
    drawWaterTower(ctx, cx, cy, def);
    return;
  }
  if (def.id === 'aqueduct_cistern') {
    drawAqueductCistern(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'water_treatment') {
    drawWaterTreatment(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'granary') {
    drawGranarySilos(ctx, cx, cy, def);
    return;
  }
  if (def.id === 'grand_monument') {
    drawGrandMonument(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'market_stall') {
    drawMarketStall(ctx, cx, cy, def);
    return;
  }
  if (def.id === 'night_market') {
    drawNightMarket(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'festival_plaza') {
    drawFestivalPlaza(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'fountain_plaza') {
    drawFountainPlaza(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'botanical_garden') {
    drawBotanicalGarden(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'marble_quarry') {
    drawMarbleQuarry(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (
    def.id === 'stone_quarry' ||
    def.id === 'clay_pit' ||
    def.id === 'sand_quarry' ||
    def.id === 'iron_mine' ||
    def.id === 'copper_mine' ||
    def.id === 'coal_mine' ||
    def.id === 'gold_mine' ||
    def.id === 'silver_mine'
  ) {
    drawMineOrQuarry(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'fishing_pier' || def.id === 'harbor_dock') {
    drawCoastalPort(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'train_station' || def.id === 'airport' || def.id === 'cart_depot') {
    drawTransportHub(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'coal_power_plant') {
    drawCoalPowerPlant(ctx, pTop, pRight, pBottom, pLeft, cx, cy, def);
    return;
  }
  if (def.id === 'watchtower') {
    drawWatchtower(ctx, cx, cy, def);
    return;
  }
  if (def.id === 'rubber_tapper') {
    drawRubberTapper(ctx, cx, cy, def);
    return;
  }

  // Standard inset architectural footprint lifted 4px above plinth
  const inset = 0.82;
  const lift = 4;
  const shrink = (pt: { x: number; y: number }) => ({
    x: cx + (pt.x - cx) * inset,
    y: cy + (pt.y - cy) * inset - lift,
  });

  const bTop = shrink(pTop);
  const bRight = shrink(pRight);
  const bBottom = shrink(pBottom);
  const bLeft = shrink(pLeft);

  const bHeight =
    def.isMainHq
      ? 36
      : def.id === 'modern_apartment'
        ? 42
        : def.id === 'brick_townhouse' ||
            def.id === 'hospital' ||
            def.id === 'town_hall' ||
            def.id === 'luxury_atelier' ||
            def.id === 'civic_theater' ||
            def.isSubOffice
          ? 28
          : def.category === 'industrial' || def.category === 'energy' || def.category === 'educational'
            ? 24
            : 19;

  // Extruded isometric walls with subtle top-to-bottom lighting gradient
  drawLitIsoWalls(ctx, bTop, bRight, bBottom, bLeft, bHeight, def.wallColor);

  // Architectural facade details (windows, doors, timber beams, loading bays)
  drawWallFacadeDetails(ctx, bLeft, bBottom, bRight, bHeight, def);

  // Half-timber framing on timber cottages and brick townhouses
  if (def.id === 'timber_cottage' || def.id === 'brick_townhouse') {
    ctx.strokeStyle = def.id === 'timber_cottage' ? '#78350f' : '#e2e8f0';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(bLeft.x, bLeft.y - bHeight + 1);
    ctx.lineTo(bBottom.x, bBottom.y - bHeight + 1);
    ctx.lineTo(bRight.x, bRight.y - bHeight + 1);
    ctx.stroke();
  }

  // Roof structure tailored by building type/category
  if (
    def.category === 'residential' ||
    def.id === 'bakery' ||
    def.id === 'gatherer_hut' ||
    def.id === 'woodcutter_camp' ||
    def.id === 'coffee_roastery' ||
    def.id === 'forester_hut'
  ) {
    if (def.id === 'modern_apartment') {
      drawFlatTerraceRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
    } else {
      drawGabledOverhangRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
      // Warm stone chimney on cottages & bakeries
      if (def.id === 'timber_cottage' || def.id === 'brick_townhouse' || def.id === 'bakery') {
        const chY = cy - lift - bHeight - 10;
        ctx.fillStyle = def.id === 'bakery' ? '#9a3412' : '#64748b';
        ctx.fillRect(cx + 6, chY - 9, 5, 11);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(cx + 5, chY - 10, 7, 2);
      }
      // Bread dome oven on Bakery
      if (def.id === 'bakery') {
        ctx.fillStyle = '#c2410c';
        ctx.beginPath();
        ctx.arc(bBottom.x - 10, bBottom.y - 3, 5.5, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = '#fb923c';
        ctx.fillRect(bBottom.x - 12, bBottom.y - 6, 4, 3);
      }
    }
  } else if (def.id === 'herbalist_clinic' || def.id === 'hospital' || def.id === 'apothecary') {
    drawFlatTerraceRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
    const rx = cx;
    const ry = cy - lift - bHeight;
    if (def.id === 'hospital') {
      // Helipad ring + crisp red cross
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 11, 5.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = def.id === 'apothecary' ? '#10b981' : '#ef4444';
    ctx.fillRect(rx - 2.5, ry - 7, 5, 14);
    ctx.fillRect(rx - 7, ry - 2.5, 14, 5);
  } else if (def.id === 'fire_station') {
    drawGabledOverhangRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
    // Arched engine bay door + brass bell & red beacon tower
    const bayX = (bLeft.x + bBottom.x) * 0.5;
    const bayY = (bLeft.y + bBottom.y) * 0.5;
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.arc(bayX, bayY - 7, 5.5, Math.PI, 0);
    ctx.lineTo(bayX + 5.5, bayY);
    ctx.lineTo(bayX - 5.5, bayY);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(cx - 5, cy - lift - bHeight - 17, 10, 13);
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(cx, cy - lift - bHeight - 10, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, cy - lift - bHeight - 19, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (
    def.id === 'university' ||
    def.id === 'library' ||
    def.id === 'observatory' ||
    def.id === 'royal_archive'
  ) {
    drawFlatTerraceRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
    drawCivicColumns(ctx, bLeft, bBottom, bHeight);
    const rx = cx;
    const ry = cy - lift - bHeight - 2;
    ctx.fillStyle =
      def.id === 'observatory'
        ? '#e2e8f0'
        : def.id === 'royal_archive'
          ? '#fbbf24'
          : def.id === 'university'
            ? '#38bdf8'
            : def.accentColor;
    ctx.beginPath();
    ctx.arc(rx, ry, def.id === 'observatory' || def.id === 'royal_archive' ? 12 : 10, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    if (def.id === 'observatory') {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rx + 2, ry - 6);
      ctx.lineTo(rx + 14, ry - 15);
      ctx.stroke();
    } else if (def.id === 'royal_archive') {
      ctx.fillStyle = '#0d9488';
      ctx.beginPath();
      ctx.arc(rx - 13, ry + 3, 5, Math.PI, 0);
      ctx.arc(rx + 13, ry + 3, 5, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 12);
      ctx.lineTo(rx, ry - 20);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.arc(rx - 3, ry - 4, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (def.id === 'town_hall' || def.id === 'civic_theater' || def.isMainHq || def.isSubOffice) {
    drawGabledOverhangRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
    drawCivicColumns(ctx, bLeft, bBottom, bHeight);
    ctx.fillStyle = shadeHex(def.wallColor, 10);
    ctx.fillRect(cx - 5, cy - lift - bHeight - 22, 10, 14);
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(cx, cy - lift - bHeight - 15, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.accentColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy - lift - bHeight - 33);
    ctx.lineTo(cx + 8, cy - lift - bHeight - 22);
    ctx.lineTo(cx - 8, cy - lift - bHeight - 22);
    ctx.closePath();
    ctx.fill();
  } else if (
    def.category === 'industrial' ||
    def.id === 'brick_kiln' ||
    def.id === 'mint_foundry' ||
    def.id === 'silver_smelter' ||
    def.id === 'pottery_workshop'
  ) {
    drawFactoryRooftopAndGear(ctx, bTop, bRight, bBottom, bLeft, cx, cy - lift, bHeight, def);
  } else {
    drawPitchedHipRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def.roofColor, def.accentColor);
    if (def.id === 'lumber_mill') {
      // Exterior timber saw wheel
      const wx = bBottom.x - 10;
      const wy = bBottom.y - 9;
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wx, wy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wx - 7, wy);
      ctx.lineTo(wx + 7, wy);
      ctx.moveTo(wx, wy - 7);
      ctx.lineTo(wx, wy + 7);
      ctx.stroke();
    }
  }

  // Category-specific exterior props
  if (def.id === 'woodcutter_camp' || def.id === 'lumber_mill') {
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.arc(bBottom.x - 10, bBottom.y - 2, 3, 0, Math.PI * 2);
    ctx.arc(bBottom.x - 6, bBottom.y - 2, 3, 0, Math.PI * 2);
    ctx.arc(bBottom.x - 8, bBottom.y - 5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d97706';
    ctx.fillRect(bBottom.x - 11, bBottom.y - 3, 2, 2);
    ctx.fillRect(bBottom.x - 7, bBottom.y - 3, 2, 2);
  } else if (
    def.id === 'trading_post' ||
    def.id === 'coffee_roastery' ||
    def.id === 'shopping_district'
  ) {
    ctx.fillStyle = def.id === 'coffee_roastery' ? '#92400e' : '#ef4444';
    ctx.fillRect(bLeft.x + 4, bLeft.y - 10, 14, 4);
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(bLeft.x + 8, bLeft.y - 10, 5, 4);
  } else if (def.id === 'pottery_workshop') {
    ctx.fillStyle = '#c2410c';
    ctx.beginPath();
    ctx.arc(bBottom.x - 8, bBottom.y - 2, 3.2, 0, Math.PI * 2);
    ctx.arc(bBottom.x - 2, bBottom.y - 1, 2.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (def.id === 'mint_foundry') {
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(cx, cy - lift - bHeight + 6, 4.8, 0, Math.PI * 2);
    ctx.fill();
  } else if (def.id === 'silk_loom' || def.id === 'textile_mill') {
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(bLeft.x + 6, bLeft.y - 12, 4, 9);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(bLeft.x + 12, bLeft.y - 11, 4, 8);
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(bLeft.x + 18, bLeft.y - 10, 4, 7);
  } else if (def.id === 'toolsmith') {
    // Glowing forge hearth at side entrance
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.arc(bBottom.x - 8, bBottom.y - 4, 4, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(bBottom.x - 9, bBottom.y - 5, 2, 2);
  } else if (def.id === 'luxury_atelier') {
    // Gilded facade banner
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(bLeft.x + 6, bLeft.y - 14, 10, 3);
  }
}

function drawCivicColumns(
  ctx: CanvasRenderingContext2D,
  bLeft: { x: number; y: number },
  bBottom: { x: number; y: number },
  bHeight: number
): void {
  ctx.fillStyle = '#f8fafc';
  for (const t of [0.22, 0.42, 0.62, 0.8]) {
    const px = bLeft.x + (bBottom.x - bLeft.x) * t;
    const py = bLeft.y + (bBottom.y - bLeft.y) * t;
    ctx.fillRect(px - 1.2, py - bHeight + 3, 2.4, bHeight - 3);
  }
}

function drawFactoryRooftopAndGear(
  ctx: CanvasRenderingContext2D,
  bTop: { x: number; y: number },
  bRight: { x: number; y: number },
  bBottom: { x: number; y: number },
  bLeft: { x: number; y: number },
  cx: number,
  baseCy: number,
  bHeight: number,
  def: BuildingDef
): void {
  drawFlatTerraceRoof(ctx, bTop, bRight, bBottom, bLeft, bHeight, def);
  const stackY = baseCy - bHeight;

  // Sawtooth skylight ridge on heavy factories
  if (def.id === 'machine_factory' || def.id === 'electronics_plant' || def.id === 'steelworks') {
    ctx.fillStyle = def.id === 'electronics_plant' ? '#38bdf8' : '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(cx - 14, stackY + 2);
    ctx.lineTo(cx - 6, stackY - 7);
    ctx.lineTo(cx + 12, stackY - 2);
    ctx.lineTo(cx + 4, stackY + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Molten furnace glow domes on Smelters & Brick Kiln & Glassworks
  if (
    def.id === 'iron_smelter' ||
    def.id === 'copper_smelter' ||
    def.id === 'brick_kiln' ||
    def.id === 'glassworks'
  ) {
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(cx + 6, stackY + 1, 8, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = def.id === 'glassworks' ? '#38bdf8' : '#f97316';
    ctx.beginPath();
    ctx.arc(cx + 6, stackY + 1, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Rotary kiln cylinder on Cement Plant
  if (def.id === 'cement_plant') {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cx - 12, stackY - 5, 22, 6);
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(cx - 3, stackY - 5, 4, 6);
  }

  drawSmokestack(ctx, cx - 8, stackY, 20, def.accentColor);
  if (def.width >= 2 && def.id !== 'electronics_plant') {
    drawSmokestack(ctx, cx + 9, stackY + 3, 24, def.accentColor);
  }
}

function drawMineOrQuarry(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  const isPit = def.id === 'clay_pit' || def.id === 'sand_quarry' || def.id === 'stone_quarry';
  drawIsoPlinth(
    ctx,
    pTop,
    pRight,
    pBottom,
    pLeft,
    4,
    def.id === 'sand_quarry' ? '#fde68a' : def.id === 'clay_pit' ? '#b45309' : '#64748b',
    '#475569'
  );

  // Dark excavated quarry/shaft pit
  ctx.fillStyle = def.id === 'sand_quarry' ? '#d97706' : def.id === 'clay_pit' ? '#7c2d12' : '#1e293b';
  ctx.beginPath();
  ctx.ellipse(cx - 3, cy - 3, 18, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mine rails leading out of pit
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 2);
  ctx.lineTo(cx + 15, cy + 5);
  ctx.moveTo(cx - 1, cy - 4);
  ctx.lineTo(cx + 19, cy + 2);
  ctx.stroke();

  if (isPit) {
    // Timber crane / hopper gantry
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(cx + 8, cy);
    ctx.lineTo(cx + 8, cy - 26);
    ctx.lineTo(cx - 7, cy - 18);
    ctx.stroke();
    ctx.fillStyle = def.accentColor;
    ctx.fillRect(cx - 12, cy - 17, 9, 6);
  } else {
    // Classic A-frame mine shaft headframe with pulley wheel & lantern
    ctx.strokeStyle = def.id === 'gold_mine' ? '#fbbf24' : '#94a3b8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 11, cy - 2);
    ctx.lineTo(cx - 1, cy - 34);
    ctx.lineTo(cx + 9, cy - 2);
    ctx.stroke();
    // Pulley wheel
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx - 1, cy - 29, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    // Ore wagon filled with glowing ore
    ctx.fillStyle = '#475569';
    ctx.fillRect(cx + 5, cy - 3, 11, 7);
    ctx.fillStyle = def.accentColor;
    ctx.beginPath();
    ctx.arc(cx + 10.5, cy - 3, 4, Math.PI, 0);
    ctx.fill();
    // Warm timber shack beside minehead
    drawSmallIsoBarn(ctx, cx - 15, cy - 4, def.wallColor, def.roofColor);
  }
}

function drawCoastalPort(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#92400e', '#78350f');
  if (def.id === 'fishing_pier') {
    // Timber deck planks & moored fishing skiff
    ctx.fillStyle = '#b45309';
    ctx.fillRect(cx - 14, cy - 8, 28, 8);
    drawSmallIsoBarn(ctx, cx - 6, cy - 9, def.wallColor, def.roofColor);
    ctx.fillStyle = '#0284c7';
    ctx.fillRect(cx + 7, cy - 6, 10, 4);
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(cx + 12, cy - 17);
    ctx.lineTo(cx + 18, cy - 7);
    ctx.lineTo(cx + 12, cy - 7);
    ctx.closePath();
    ctx.fill();
  } else {
    // Harbor Dock warehouse + red/yellow gantry crane
    drawSmallIsoBarn(ctx, cx - 12, cy - 6, def.wallColor, def.roofColor);
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 10, cy - 34);
    ctx.lineTo(cx + 26, cy - 28);
    ctx.stroke();
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cx - 2, cy - 6, 10, 6);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(cx + 9, cy - 6, 10, 6);
  }
}

function drawTransportHub(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#64748b', '#475569');
  if (def.id === 'airport') {
    // Runway apron + hangar + ATC radar tower
    ctx.fillStyle = '#334155';
    ctx.fillRect(cx - 28, cy - 4, 56, 8);
    ctx.strokeStyle = '#f8fafc';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy);
    ctx.lineTo(cx + 24, cy);
    ctx.stroke();
    ctx.setLineDash([]);
    // Vaulted hangar
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.arc(cx - 10, cy - 8, 16, Math.PI, 0);
    ctx.fill();
    // ATC Control Tower
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(cx + 12, cy - 38, 8, 30);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(cx + 9, cy - 44, 14, 7);
  } else if (def.id === 'train_station') {
    // Arched crimson train shed + clock gable
    drawLitIsoWalls(ctx, pTop, pRight, pBottom, pLeft, 16, def.wallColor);
    ctx.fillStyle = def.roofColor;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 18, 22, 11, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(cx, cy - 26, 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Cart Depot timber freight shed
    drawLitIsoWalls(ctx, pTop, pRight, pBottom, pLeft, 14, def.wallColor);
    drawGabledOverhangRoof(ctx, pTop, pRight, pBottom, pLeft, 14, def);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(cx - 6, cy - 7, 12, 6);
  }
}

function drawCoalPowerPlant(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#475569', '#334155');
  drawLitIsoWalls(ctx, pTop, pRight, pBottom, pLeft, 16, def.wallColor);
  // Twin hyperbolic cooling towers
  for (const dx of [-12, 10]) {
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(cx + dx - 9, cy - 14);
    ctx.quadraticCurveTo(cx + dx - 5, cy - 32, cx + dx - 7, cy - 44);
    ctx.lineTo(cx + dx + 7, cy - 44);
    ctx.quadraticCurveTo(cx + dx + 5, cy - 32, cx + dx + 9, cy - 14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(cx + dx - 7, cy - 43, 14, 3);
  }
}

function drawWaterTreatment(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  _def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#e2e8f0', '#94a3b8');
  for (const dx of [-12, 12]) {
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.ellipse(cx + dx, cy - 6, 12, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.ellipse(cx + dx, cy - 7, 9, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + dx - 8, cy - 7);
    ctx.lineTo(cx + dx + 8, cy - 7);
    ctx.stroke();
  }
}

function drawWatchtower(ctx: CanvasRenderingContext2D, cx: number, cy: number, def: BuildingDef): void {
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - 8, cy - 36, 16, 34);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(cx, cy - 36, 8, 34);
  // Battlement parapet & beacon fire
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(cx - 10, cy - 42, 20, 6);
  ctx.fillStyle = def.roofColor;
  ctx.fillRect(cx - 6, cy - 49, 12, 7);
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.arc(cx, cy - 52, 3.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawIsoPlinth(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  h: number,
  topCol: string,
  sideCol: string
): void {
  // Left & right plinth skirts
  ctx.fillStyle = sideCol;
  ctx.beginPath();
  ctx.moveTo(pLeft.x, pLeft.y);
  ctx.lineTo(pBottom.x, pBottom.y);
  ctx.lineTo(pBottom.x, pBottom.y - h);
  ctx.lineTo(pLeft.x, pLeft.y - h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = shadeHex(sideCol, -18);
  ctx.beginPath();
  ctx.moveTo(pBottom.x, pBottom.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pRight.x, pRight.y - h);
  ctx.lineTo(pBottom.x, pBottom.y - h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = topCol;
  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y - h);
  ctx.lineTo(pRight.x, pRight.y - h);
  ctx.lineTo(pBottom.x, pBottom.y - h);
  ctx.lineTo(pLeft.x, pLeft.y - h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLitIsoWalls(
  ctx: CanvasRenderingContext2D,
  bTop: { x: number; y: number },
  bRight: { x: number; y: number },
  bBottom: { x: number; y: number },
  bLeft: { x: number; y: number },
  h: number,
  wallColor: string
): void {
  // Left wall (sunlit)
  const gL = ctx.createLinearGradient(0, bLeft.y - h, 0, bBottom.y);
  gL.addColorStop(0, shadeHex(wallColor, 10));
  gL.addColorStop(1, shadeHex(wallColor, -10));
  ctx.fillStyle = gL;
  ctx.beginPath();
  ctx.moveTo(bLeft.x, bLeft.y);
  ctx.lineTo(bBottom.x, bBottom.y);
  ctx.lineTo(bBottom.x, bBottom.y - h);
  ctx.lineTo(bLeft.x, bLeft.y - h);
  ctx.closePath();
  ctx.fill();

  // Right wall (shaded)
  const gR = ctx.createLinearGradient(0, bBottom.y - h, 0, bRight.y);
  gR.addColorStop(0, shadeHex(wallColor, -18));
  gR.addColorStop(1, shadeHex(wallColor, -34));
  ctx.fillStyle = gR;
  ctx.beginPath();
  ctx.moveTo(bBottom.x, bBottom.y);
  ctx.lineTo(bRight.x, bRight.y);
  ctx.lineTo(bRight.x, bRight.y - h);
  ctx.lineTo(bBottom.x, bBottom.y - h);
  ctx.closePath();
  ctx.fill();

  // Corner vertical seam highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bBottom.x, bBottom.y);
  ctx.lineTo(bBottom.x, bBottom.y - h);
  ctx.stroke();
}

function drawWallFacadeDetails(
  ctx: CanvasRenderingContext2D,
  bLeft: { x: number; y: number },
  bBottom: { x: number; y: number },
  bRight: { x: number; y: number },
  bHeight: number,
  def: BuildingDef
): void {
  const floors = bHeight >= 36 ? 3 : bHeight >= 25 ? 2 : 1;
  // Warm amber glowing windows along left & right walls
  for (let f = 0; f < floors; f++) {
    const fy = bHeight * (0.28 + f * 0.25);
    const cols = def.width >= 2 ? 2 : 1;
    for (let c = 0; c < cols; c++) {
      const t = (c + 1) / (cols + 1);
      const wxL = bLeft.x + (bBottom.x - bLeft.x) * t;
      const wyL = bLeft.y + (bBottom.y - bLeft.y) * t - fy;
      ctx.fillStyle = def.id === 'modern_apartment' ? '#bae6fd' : '#fef08a';
      ctx.fillRect(wxL - 2.5, wyL - 3, 5, 5);
      ctx.strokeStyle = 'rgba(15,23,42,0.45)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(wxL - 2.5, wyL - 3, 5, 5);

      const wxR = bBottom.x + (bRight.x - bBottom.x) * t;
      const wyR = bBottom.y + (bRight.y - bBottom.y) * t - fy;
      ctx.fillStyle = def.id === 'modern_apartment' ? '#7dd3fc' : '#fde047';
      ctx.fillRect(wxR - 2.5, wyR - 3, 5, 5);
      ctx.strokeRect(wxR - 2.5, wyR - 3, 5, 5);
    }
  }

  // Timber entry door on bottom-left wall
  const dx = (bLeft.x + bBottom.x) * 0.5;
  const dy = (bLeft.y + bBottom.y) * 0.5;
  ctx.fillStyle = '#451a03';
  ctx.fillRect(dx - 3, dy - 9, 6, 9);
}

function drawGabledOverhangRoof(
  ctx: CanvasRenderingContext2D,
  bTop: { x: number; y: number },
  bRight: { x: number; y: number },
  bBottom: { x: number; y: number },
  bLeft: { x: number; y: number },
  h: number,
  def: BuildingDef
): void {
  const cx = (bTop.x + bBottom.x) * 0.5;
  const cy = (bTop.y + bBottom.y) * 0.5 - h;
  const expand = (pt: { x: number; y: number }) => ({
    x: cx + (pt.x - cx) * 1.14,
    y: cy + (pt.y - (bTop.y + bBottom.y) * 0.5) * 1.14,
  });
  const rTop = expand(bTop);
  const rRight = expand(bRight);
  const rBottom = expand(bBottom);
  const rLeft = expand(bLeft);
  const ridgeA = { x: (rTop.x + rLeft.x) * 0.5, y: (rTop.y + rLeft.y) * 0.5 - 12 };
  const ridgeB = { x: (rRight.x + rBottom.x) * 0.5, y: (rRight.y + rBottom.y) * 0.5 - 12 };

  // Sunlit roof slope
  ctx.fillStyle = shadeHex(def.roofColor, 10);
  ctx.beginPath();
  ctx.moveTo(rLeft.x, rLeft.y + 2);
  ctx.lineTo(rBottom.x, rBottom.y + 2);
  ctx.lineTo(ridgeB.x, ridgeB.y);
  ctx.lineTo(ridgeA.x, ridgeA.y);
  ctx.closePath();
  ctx.fill();

  // Back/Right roof slope
  ctx.fillStyle = shadeHex(def.roofColor, -18);
  ctx.beginPath();
  ctx.moveTo(rTop.x, rTop.y + 2);
  ctx.lineTo(rRight.x, rRight.y + 2);
  ctx.lineTo(ridgeB.x, ridgeB.y);
  ctx.lineTo(ridgeA.x, ridgeA.y);
  ctx.closePath();
  ctx.fill();

  // Front gable triangle
  ctx.fillStyle = shadeHex(def.wallColor, -6);
  ctx.beginPath();
  ctx.moveTo(rBottom.x, rBottom.y + 2);
  ctx.lineTo(rRight.x, rRight.y + 2);
  ctx.lineTo(ridgeB.x, ridgeB.y);
  ctx.closePath();
  ctx.fill();

  // Ridge beam highlight
  ctx.strokeStyle = shadeHex(def.accentColor, 20);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ridgeA.x, ridgeA.y);
  ctx.lineTo(ridgeB.x, ridgeB.y);
  ctx.stroke();
}

function drawPitchedHipRoof(
  ctx: CanvasRenderingContext2D,
  bTop: { x: number; y: number },
  bRight: { x: number; y: number },
  bBottom: { x: number; y: number },
  bLeft: { x: number; y: number },
  h: number,
  roofColor: string,
  accent: string
): void {
  const cx = (bTop.x + bBottom.x) * 0.5;
  const cy = (bTop.y + bBottom.y) * 0.5 - h;
  const peakY = cy - 11;

  // 4 faceted pyramid/hip slopes
  const slopes = [
    { a: bTop, b: bLeft, col: shadeHex(roofColor, 14) },
    { a: bLeft, b: bBottom, col: shadeHex(roofColor, 4) },
    { a: bBottom, b: bRight, col: shadeHex(roofColor, -22) },
    { a: bRight, b: bTop, col: shadeHex(roofColor, -10) },
  ];
  for (const s of slopes) {
    ctx.fillStyle = s.col;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y - h);
    ctx.lineTo(s.b.x, s.b.y - h);
    ctx.lineTo(cx, peakY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, peakY, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawFlatTerraceRoof(
  ctx: CanvasRenderingContext2D,
  bTop: { x: number; y: number },
  bRight: { x: number; y: number },
  bBottom: { x: number; y: number },
  bLeft: { x: number; y: number },
  h: number,
  def: BuildingDef
): void {
  ctx.fillStyle = def.roofColor;
  ctx.beginPath();
  ctx.moveTo(bTop.x, bTop.y - h);
  ctx.lineTo(bRight.x, bRight.y - h);
  ctx.lineTo(bBottom.x, bBottom.y - h);
  ctx.lineTo(bLeft.x, bLeft.y - h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = def.accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Rooftop garden/HVAC box on apartments
  if (def.id === 'modern_apartment') {
    const cx = (bTop.x + bBottom.x) * 0.5;
    const cy = (bTop.y + bBottom.y) * 0.5 - h;
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.ellipse(cx - 6, cy, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cx + 4, cy - 6, 8, 6);
  }
}

function drawSmokestack(ctx: CanvasRenderingContext2D, x: number, baseY: number, h: number, band: string): void {
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(x - 4, baseY);
  ctx.lineTo(x + 4, baseY);
  ctx.lineTo(x + 2.8, baseY - h);
  ctx.lineTo(x - 2.8, baseY - h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = band;
  ctx.fillRect(x - 3.2, baseY - h + 2, 6.4, 3);
  ctx.fillStyle = '#e2e8f0';
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.arc(x + 2, baseY - h - 4, 3.2, 0, Math.PI * 2);
  ctx.arc(x + 5, baseY - h - 8, 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawLeafHut(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // Timber stilts & woven circular hut body
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cx - 12, cy - 10, 3, 12);
  ctx.fillRect(cx + 9, cy - 10, 3, 12);
  ctx.fillStyle = '#a16207';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 11, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#92400e';
  ctx.fillRect(cx - 13, cy - 22, 26, 12);

  // Glowing hut doorway
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(cx - 4, cy - 17, 6, 8);

  // Layered tropical thatch cone roof
  ctx.fillStyle = '#3f6212';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 42);
  ctx.lineTo(cx + 21, cy - 19);
  ctx.quadraticCurveTo(cx, cy - 12, cx - 21, cy - 19);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#65a30d';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 42);
  ctx.lineTo(cx + 4, cy - 18);
  ctx.lineTo(cx - 21, cy - 19);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#a3e635';
  ctx.beginPath();
  ctx.arc(cx, cy - 42, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawWindmill(ctx: CanvasRenderingContext2D, cx: number, cy: number, def: BuildingDef): void {
  // Tapered whitewashed stone tower
  ctx.fillStyle = '#d6d3d1';
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy + 2);
  ctx.lineTo(cx + 13, cy + 2);
  ctx.lineTo(cx + 8, cy - 30);
  ctx.lineTo(cx - 8, cy - 30);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#e7e5e4';
  ctx.beginPath();
  ctx.moveTo(cx - 13, cy + 2);
  ctx.lineTo(cx, cy + 2);
  ctx.lineTo(cx, cy - 30);
  ctx.lineTo(cx - 8, cy - 30);
  ctx.closePath();
  ctx.fill();

  // Conical red cap
  ctx.fillStyle = def.roofColor;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 43);
  ctx.lineTo(cx + 11, cy - 29);
  ctx.lineTo(cx - 11, cy - 29);
  ctx.closePath();
  ctx.fill();

  // 4 diagonal lattice sails
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 16, cy - 42);
  ctx.lineTo(cx + 16, cy - 14);
  ctx.moveTo(cx + 16, cy - 42);
  ctx.lineTo(cx - 16, cy - 14);
  ctx.stroke();

  ctx.fillStyle = 'rgba(254, 249, 195, 0.9)';
  ctx.fillRect(cx - 16, cy - 41, 7, 5);
  ctx.fillRect(cx + 9, cy - 41, 7, 5);
  ctx.fillRect(cx - 16, cy - 20, 7, 5);
  ctx.fillRect(cx + 9, cy - 20, 7, 5);
}

function drawWindTurbine(ctx: CanvasRenderingContext2D, cx: number, cy: number, _def: BuildingDef): void {
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy + 2);
  ctx.lineTo(cx + 4, cy + 2);
  ctx.lineTo(cx + 2, cy - 44);
  ctx.lineTo(cx - 2, cy - 44);
  ctx.closePath();
  ctx.fill();

  // Nacelle & 3 swept blades
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(cx, cy - 45, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 45);
  ctx.lineTo(cx, cy - 64);
  ctx.moveTo(cx, cy - 45);
  ctx.lineTo(cx - 16, cy - 34);
  ctx.moveTo(cx, cy - 45);
  ctx.lineTo(cx + 16, cy - 34);
  ctx.stroke();
}

function drawSolarPlant(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 3, '#475569', '#334155');
  const cx = (pTop.x + pBottom.x) * 0.5;
  const cy = (pTop.y + pBottom.y) * 0.5 - 5;
  // Tilted photovoltaic arrays
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const px = cx + (col - row) * 14;
      const py = cy + (col + row) * 7;
      ctx.fillStyle = '#1d4ed8';
      ctx.beginPath();
      ctx.moveTo(px - 8, py);
      ctx.lineTo(px + 2, py - 5);
      ctx.lineTo(px + 10, py + 1);
      ctx.lineTo(px, py + 6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = def.accentColor;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
}

function drawWaterWell(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  // Stone ring
  ctx.fillStyle = '#64748b';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 4, 12, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0ea5e9';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Roofed timber frame
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cx - 10, cy - 22, 2.5, 16);
  ctx.fillRect(cx + 7.5, cy - 22, 2.5, 16);
  ctx.fillStyle = '#b45309';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 31);
  ctx.lineTo(cx + 14, cy - 20);
  ctx.lineTo(cx - 14, cy - 20);
  ctx.closePath();
  ctx.fill();
}

function drawWaterTower(ctx: CanvasRenderingContext2D, cx: number, cy: number, def: BuildingDef): void {
  // Steel X-truss legs
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx - 6, cy - 24);
  ctx.moveTo(cx + 10, cy);
  ctx.lineTo(cx + 6, cy - 24);
  ctx.moveTo(cx - 9, cy - 4);
  ctx.lineTo(cx + 7, cy - 20);
  ctx.moveTo(cx + 9, cy - 4);
  ctx.lineTo(cx - 7, cy - 20);
  ctx.stroke();

  // Elevated cylindrical tank
  ctx.fillStyle = def.wallColor;
  ctx.fillRect(cx - 12, cy - 38, 24, 15);
  ctx.fillStyle = def.roofColor;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 48);
  ctx.lineTo(cx + 14, cy - 38);
  ctx.lineTo(cx - 14, cy - 38);
  ctx.closePath();
  ctx.fill();
}

function drawGranarySilos(ctx: CanvasRenderingContext2D, cx: number, cy: number, def: BuildingDef): void {
  for (const dx of [-10, 6]) {
    ctx.fillStyle = shadeHex(def.wallColor, dx < 0 ? 0 : -15);
    ctx.fillRect(cx + dx - 7, cy - 26, 14, 24);
    ctx.fillStyle = def.roofColor;
    ctx.beginPath();
    ctx.arc(cx + dx, cy - 26, 7, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMarketStall(ctx: CanvasRenderingContext2D, cx: number, cy: number, def: BuildingDef): void {
  // Wooden stall counters
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cx - 16, cy - 10, 32, 8);
  ctx.fillStyle = '#fb923c';
  ctx.fillRect(cx - 13, cy - 12, 6, 3);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(cx - 4, cy - 12, 6, 3);
  ctx.fillStyle = '#4ade80';
  ctx.fillRect(cx + 5, cy - 12, 6, 3);

  // Striped canopy awning
  ctx.fillStyle = def.roofColor;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 28);
  ctx.lineTo(cx + 20, cy - 18);
  ctx.lineTo(cx - 20, cy - 18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fef3c7';
  ctx.fillRect(cx - 14, cy - 21, 5, 4);
  ctx.fillRect(cx - 2, cy - 21, 5, 4);
  ctx.fillRect(cx + 9, cy - 21, 5, 4);
}

function drawGrandMonument(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  _def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 6, '#e2e8f0', '#94a3b8');
  // Stepped golden ziggurat tiers
  for (let tier = 0; tier < 3; tier++) {
    const s = 0.72 - tier * 0.18;
    const h = 11;
    const lift = 6 + tier * h;
    const shrink = (pt: { x: number; y: number }) => ({
      x: cx + (pt.x - cx) * s,
      y: cy + (pt.y - cy) * s - lift,
    });
    drawLitIsoWalls(
      ctx,
      shrink(pTop),
      shrink(pRight),
      shrink(pBottom),
      shrink(pLeft),
      h,
      tier === 2 ? '#fbbf24' : '#cbd5e1'
    );
  }
  // Golden obelisk spire
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 68);
  ctx.lineTo(cx + 6, cy - 39);
  ctx.lineTo(cx - 6, cy - 39);
  ctx.closePath();
  ctx.fill();
}

function drawAgriculturalOrPark(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  _cx: number,
  _cy: number,
  def: BuildingDef
): void {
  // Raised soil / stone plot bed
  drawIsoPlinth(
    ctx,
    pTop,
    pRight,
    pBottom,
    pLeft,
    3,
    def.id === 'village_park' ? '#4ade80' : '#654321',
    '#4a3219'
  );

  // Inner planted diamond
  ctx.fillStyle = def.roofColor;
  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y - 1);
  ctx.lineTo(pRight.x - 5, pRight.y - 3);
  ctx.lineTo(pBottom.x, pBottom.y - 5);
  ctx.lineTo(pLeft.x + 5, pLeft.y - 3);
  ctx.closePath();
  ctx.fill();

  if (def.id === 'village_park') {
    // Central stone fountain & ornamental trees
    const fx = (pTop.x + pBottom.x) * 0.5;
    const fy = (pTop.y + pBottom.y) * 0.5 - 3;
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 11, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.ellipse(fx, fy - 1, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.arc(pLeft.x + 14, pLeft.y - 9, 6, 0, Math.PI * 2);
    ctx.arc(pRight.x - 14, pRight.y - 9, 6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Lush crop furrows & plant tufts
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const x1 = pTop.x + (pLeft.x - pTop.x) * t + 4;
    const y1 = pTop.y + (pLeft.y - pTop.y) * t - 2;
    const x2 = pRight.x + (pBottom.x - pRight.x) * t - 4;
    const y2 = pRight.y + (pBottom.y - pRight.y) * t - 4;

    ctx.strokeStyle = '#3b2613';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    ctx.fillStyle = def.accentColor;
    for (let s = 1; s <= 4; s++) {
      const k = s / 5;
      const sx = x1 + (x2 - x1) * k;
      const sy = y1 + (y2 - y1) * k;
      ctx.beginPath();
      ctx.arc(sx, sy - 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Farmhouse shed or livestock barn at north corner
  drawSmallIsoBarn(ctx, pTop.x, pTop.y + 8, def.wallColor, def.accentColor);
}

function drawSmallIsoBarn(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  wall: string,
  roof: string
): void {
  ctx.fillStyle = wall;
  ctx.fillRect(cx - 8, cy - 11, 8, 10);
  ctx.fillStyle = shadeHex(wall, -20);
  ctx.fillRect(cx, cy - 11, 8, 10);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 18);
  ctx.lineTo(cx + 10, cy - 11);
  ctx.lineTo(cx - 10, cy - 11);
  ctx.closePath();
  ctx.fill();
}

function drawAmbientSprites(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  kind: 'bird' | 'cart'
): void {
  const cx = pos.x + 12;
  const cy = pos.y + 12;
  if (kind === 'bird') {
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.quadraticCurveTo(cx - 2, cy - 4, cx, cy);
    ctx.quadraticCurveTo(cx + 2, cy - 4, cx + 5, cy);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#92400e';
    ctx.fillRect(cx - 6, cy - 4, 12, 6);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(cx - 4, cy - 7, 8, 3);
    ctx.fillStyle = '#1c1917';
    ctx.beginPath();
    ctx.arc(cx - 4, cy + 3, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 4, cy + 3, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCitizenSprite(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  tunicColor: string,
  hatColor: string,
  strideFrame: 0 | 1,
  chopping: boolean
): void {
  const cx = pos.x + 14;
  const by = pos.y + 34;

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, by, 6, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs (animated stride)
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (strideFrame === 0) {
    ctx.moveTo(cx - 2, by - 9);
    ctx.lineTo(cx - 4, by - 1);
    ctx.moveTo(cx + 2, by - 9);
    ctx.lineTo(cx + 4, by - 2);
  } else {
    ctx.moveTo(cx - 2, by - 9);
    ctx.lineTo(cx + 1, by - 1);
    ctx.moveTo(cx + 2, by - 9);
    ctx.lineTo(cx - 1, by - 3);
  }
  ctx.stroke();

  // Tunic body
  ctx.fillStyle = tunicColor;
  ctx.beginPath();
  ctx.roundRect(cx - 4.5, by - 21, 9, 13, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Head
  ctx.fillStyle = '#f1c27d';
  ctx.beginPath();
  ctx.arc(cx, by - 24.5, 4, 0, Math.PI * 2);
  ctx.fill();

  // Hat / Helmet
  ctx.fillStyle = hatColor;
  ctx.beginPath();
  ctx.ellipse(cx, by - 27.5, 6.2, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, by - 28.5, 3.4, Math.PI, 0);
  ctx.fill();

  if (chopping) {
    // Raised arm + axe!
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + 3, by - 18);
    ctx.lineTo(cx + 10, by - 26);
    ctx.stroke();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(cx + 8, by - 28);
    ctx.lineTo(cx + 12, by - 25);
    ctx.lineTo(cx + 9, by - 23);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCargoSprite(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  kind: 'wood' | 'food' | 'stone' | 'goods'
): void {
  const cx = pos.x + 8;
  const cy = pos.y + 7;
  if (kind === 'wood') {
    ctx.fillStyle = '#78350f';
    ctx.fillRect(cx - 6, cy - 3, 12, 6);
    ctx.fillStyle = '#d97706';
    ctx.fillRect(cx - 6, cy - 3, 3, 6);
  } else if (kind === 'food') {
    ctx.fillStyle = '#a16207';
    ctx.fillRect(cx - 5, cy - 1, 10, 5);
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(cx - 2, cy - 2, 2.5, 0, Math.PI * 2);
    ctx.arc(cx + 2, cy - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'stone') {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(cx - 5, cy - 3, 10, 6);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(cx - 4, cy - 3, 4, 3);
  } else {
    ctx.fillStyle = '#b45309';
    ctx.fillRect(cx - 5, cy - 3, 10, 6);
    ctx.fillStyle = '#fde047';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
  }
}

function drawRiverBoat(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 16;
  const cy = pos.y + 13;
  ctx.fillStyle = 'rgba(224, 242, 254, 0.35)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, 13, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.moveTo(cx - 11, cy);
  ctx.lineTo(cx + 11, cy);
  ctx.lineTo(cx + 7, cy + 4);
  ctx.lineTo(cx - 7, cy + 4);
  ctx.closePath();
  ctx.fill();

  // Tiny white sail
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 10);
  ctx.lineTo(cx + 6, cy - 1);
  ctx.lineTo(cx, cy - 1);
  ctx.closePath();
  ctx.fill();
}

function drawWaterRipple(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 22;
  const cy = pos.y + 10;
  ctx.strokeStyle = 'rgba(224, 242, 254, 0.85)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy);
  ctx.quadraticCurveTo(cx - 6, cy - 3, cx, cy);
  ctx.quadraticCurveTo(cx + 6, cy + 3, cx + 12, cy);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(125, 211, 252, 0.65)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy + 4);
  ctx.quadraticCurveTo(cx, cy + 2, cx + 8, cy + 4);
  ctx.stroke();
}

function drawSmokePuff(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 12;
  const cy = pos.y + 12;
  const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 10);
  grad.addColorStop(0, 'rgba(241, 245, 249, 0.65)');
  grad.addColorStop(1, 'rgba(241, 245, 249, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 10, 0, Math.PI * 2);
  ctx.fill();
}

function drawLightHalo(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 64;
  const cy = pos.y + 64;
  const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 62);
  grad.addColorStop(0, 'rgba(255, 240, 185, 0.94)');
  grad.addColorStop(0.28, 'rgba(251, 176, 64, 0.44)');
  grad.addColorStop(0.66, 'rgba(217, 119, 6, 0.14)');
  grad.addColorStop(1, 'rgba(217, 119, 6, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(pos.x, pos.y, 128, 128);
}

function drawWindowGlow(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 24;
  const cy = pos.y + 18;
  const grad = ctx.createRadialGradient(cx, cy, 1, cx, cy, 21);
  grad.addColorStop(0, 'rgba(254, 240, 138, 0.85)');
  grad.addColorStop(0.45, 'rgba(245, 158, 11, 0.34)');
  grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(pos.x, pos.y, 48, 36);

  // Twin warm lit window panes
  ctx.fillStyle = 'rgba(254, 249, 195, 0.96)';
  ctx.fillRect(cx - 7, cy - 3, 5, 5);
  ctx.fillRect(cx + 2, cy - 1, 5, 5);
}

function drawSkyStar(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 6;
  const cy = pos.y + 6;
  const g = ctx.createRadialGradient(cx, cy, 0.4, cx, cy, 5);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
  g.addColorStop(0.4, 'rgba(186, 230, 253, 0.55)');
  g.addColorStop(1, 'rgba(186, 230, 253, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(pos.x, pos.y, 12, 12);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy);
  ctx.lineTo(cx + 4, cy);
  ctx.moveTo(cx, cy - 4);
  ctx.lineTo(cx, cy + 4);
  ctx.stroke();
}

function drawBambooFeature(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 38;
  const baseY = pos.y + 74;
  ctx.fillStyle = 'rgba(5, 16, 10, 0.3)';
  ctx.beginPath();
  ctx.ellipse(cx, baseY + 1, 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const stalks = [
    { dx: -7, h: 38, tilt: -2 },
    { dx: -1, h: 44, tilt: 1 },
    { dx: 6, h: 35, tilt: 3 },
  ];
  for (const s of stalks) {
    ctx.strokeStyle = '#65a30d';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(cx + s.dx, baseY);
    ctx.lineTo(cx + s.dx + s.tilt, baseY - s.h);
    ctx.stroke();

    ctx.strokeStyle = '#bef264';
    ctx.lineWidth = 1.4;
    for (let y = 8; y < s.h; y += 9) {
      ctx.beginPath();
      ctx.moveTo(cx + s.dx - 2, baseY - y);
      ctx.lineTo(cx + s.dx + 2, baseY - y);
      ctx.stroke();
    }

    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(cx + s.dx + s.tilt - 4, baseY - s.h + 4, 6, 2.2, -0.4, 0, Math.PI * 2);
    ctx.ellipse(cx + s.dx + s.tilt + 5, baseY - s.h + 8, 6, 2.2, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAncientRuinFeature(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 38;
  const by = pos.y + 74;
  ctx.fillStyle = 'rgba(0,0,0,0.34)';
  ctx.beginPath();
  ctx.ellipse(cx, by + 1, 20, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Mossy stone temple base & twin pillars
  ctx.fillStyle = '#64748b';
  ctx.fillRect(cx - 17, by - 7, 34, 8);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(cx - 13, by - 26, 7, 20);
  ctx.fillRect(cx + 6, by - 26, 7, 20);
  // Broken lintel crossbar
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(cx - 15, by - 32, 30, 7);
  // Golden glowing temple relic rune
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(cx, by - 16, 4.2, 0, Math.PI * 2);
  ctx.fill();
  // Vine moss accents
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(cx - 14, by - 32, 9, 3);
  ctx.fillRect(cx + 6, by - 15, 6, 4);
}

function drawFestivalPlaza(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#fef3c7', '#b45309');
  // Gazebo stage canopy in center
  ctx.fillStyle = '#78350f';
  ctx.fillRect(cx - 12, cy - 18, 2.5, 16);
  ctx.fillRect(cx + 9.5, cy - 18, 2.5, 16);
  ctx.fillStyle = def.roofColor;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 34);
  ctx.lineTo(cx + 18, cy - 18);
  ctx.lineTo(cx - 18, cy - 18);
  ctx.closePath();
  ctx.fill();
  // Hanging festive lanterns
  for (const dx of [-13, -4, 4, 13]) {
    ctx.fillStyle = dx % 2 === 0 ? '#fde047' : '#ef4444';
    ctx.beginPath();
    ctx.arc(cx + dx, cy - 16, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBotanicalGarden(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  _def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#86efac', '#15803d');
  // Lush plants visible inside
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.arc(cx - 9, cy - 6, 6, 0, Math.PI * 2);
  ctx.arc(cx + 8, cy - 6, 6, 0, Math.PI * 2);
  ctx.arc(cx, cy - 11, 7, 0, Math.PI * 2);
  ctx.fill();
  // Translucent cyan glass conservatory dome
  ctx.fillStyle = 'rgba(125, 211, 252, 0.58)';
  ctx.strokeStyle = '#e0f2fe';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 6, 22, 16, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawWildlifeDeer(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 13;
  const by = pos.y + 20;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx, by, 7, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Legs
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - 4, by - 5);
  ctx.lineTo(cx - 4, by);
  ctx.moveTo(cx + 4, by - 5);
  ctx.lineTo(cx + 4, by);
  ctx.stroke();
  // Body & neck
  ctx.fillStyle = '#b45309';
  ctx.fillRect(cx - 5, by - 9, 10, 5);
  ctx.fillRect(cx + 3, by - 14, 3, 6);
  ctx.beginPath();
  ctx.arc(cx + 5, by - 14.5, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // Tiny antlers
  ctx.strokeStyle = '#fef3c7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 4, by - 17);
  ctx.lineTo(cx + 3, by - 20);
  ctx.moveTo(cx + 6, by - 17);
  ctx.lineTo(cx + 7, by - 20);
  ctx.stroke();
}

function drawFireflyGlow(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 8;
  const cy = pos.y + 8;
  const g = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, 7);
  g.addColorStop(0, '#fef08a');
  g.addColorStop(0.5, 'rgba(190, 242, 100, 0.65)');
  g.addColorStop(1, 'rgba(190, 242, 100, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fill();
}

function drawFestivalLantern(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }): void {
  const cx = pos.x + 8;
  const cy = pos.y + 11;
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 1, 3, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawNightMarket(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#78350f', '#451a03');
  // Twin crimson pagoda canopies + glowing golden lantern garlands
  for (const offset of [-14, 14]) {
    const sx = cx + offset;
    const sy = cy - 4;
    ctx.fillStyle = '#451a03';
    ctx.fillRect(sx - 10, sy - 11, 20, 9);
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(sx - 7, sy - 8, 14, 3);
    ctx.fillStyle = def.roofColor;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 25);
    ctx.lineTo(sx + 15, sy - 13);
    ctx.lineTo(sx - 15, sy - 13);
    ctx.closePath();
    ctx.fill();
  }
  // Overhead festive lantern string
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 18, cy - 22);
  ctx.quadraticCurveTo(cx, cy - 15, cx + 18, cy - 22);
  ctx.stroke();
  for (const lx of [-12, -4, 4, 12]) {
    ctx.fillStyle = lx % 8 === 0 ? '#fde047' : '#fb7185';
    ctx.beginPath();
    ctx.arc(cx + lx, cy - 18, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFountainPlaza(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  _def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#f8fafc', '#cbd5e1');
  // Marble basin & cascading azure water
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 5, 19, 9.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.ellipse(cx, cy - 7, 14, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Central tiered marble pedestal & water plume
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(cx - 3, cy - 20, 6, 13);
  ctx.beginPath();
  ctx.ellipse(cx, cy - 16, 8, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#bae6fd';
  ctx.beginPath();
  ctx.arc(cx, cy - 23, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // Corner ornamental emerald shrubs
  ctx.fillStyle = '#16a34a';
  ctx.beginPath();
  ctx.arc(pLeft.x + 14, pLeft.y - 6, 5, 0, Math.PI * 2);
  ctx.arc(pRight.x - 14, pRight.y - 6, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawAqueductCistern(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 5, '#e2e8f0', '#94a3b8');
  // Limestone reservoir walls + bright turquoise water basin
  const bHeight = 20;
  drawLitIsoWalls(ctx, pTop, pRight, pBottom, pLeft, bHeight, def.wallColor);
  ctx.fillStyle = '#0284c7';
  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y - bHeight + 2);
  ctx.lineTo(pRight.x - 6, pRight.y - bHeight + 2);
  ctx.lineTo(pBottom.x, pBottom.y - bHeight + 2);
  ctx.lineTo(pLeft.x + 6, pLeft.y - bHeight + 2);
  ctx.closePath();
  ctx.fill();
  // Roman arch cutouts along front left wall
  ctx.fillStyle = '#334155';
  for (const t of [0.3, 0.7]) {
    const ax = pLeft.x + (pBottom.x - pLeft.x) * t;
    const ay = pLeft.y + (pBottom.y - pLeft.y) * t - 2;
    ctx.beginPath();
    ctx.arc(ax, ay - 6, 4.5, Math.PI, 0);
    ctx.lineTo(ax + 4.5, ay);
    ctx.lineTo(ax - 4.5, ay);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#7dd3fc';
  ctx.fillRect(cx - 8, cy - bHeight - 1, 16, 2);
}

function drawMarbleQuarry(
  ctx: CanvasRenderingContext2D,
  pTop: { x: number; y: number },
  pRight: { x: number; y: number },
  pBottom: { x: number; y: number },
  pLeft: { x: number; y: number },
  cx: number,
  cy: number,
  _def: BuildingDef
): void {
  drawIsoPlinth(ctx, pTop, pRight, pBottom, pLeft, 4, '#f1f5f9', '#94a3b8');
  // Stepped white marble quarry tiers
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(cx - 22, cy - 16, 44, 14);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(cx - 16, cy - 26, 30, 11);
  // Cut marble blocks stacked in yard
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - 18, cy - 4, 10, 7);
  ctx.fillRect(cx - 5, cy - 3, 10, 7);
  // Timber quarry crane mast
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx + 10, cy);
  ctx.lineTo(cx + 10, cy - 36);
  ctx.lineTo(cx - 8, cy - 28);
  ctx.stroke();
}

function drawRubberTapper(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  def: BuildingDef
): void {
  // Timber collection shack
  drawSmallIsoBarn(ctx, cx + 10, cy - 2, def.wallColor, def.roofColor);
  // Pale bark rubber trees with latex buckets
  for (const dx of [-13, -2]) {
    const tx = cx + dx;
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(tx - 2.5, cy - 24, 5, 22);
    ctx.fillStyle = '#15803d';
    ctx.beginPath();
    ctx.arc(tx, cy - 27, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(tx + 1, cy - 10, 3.5, 4);
  }
}

function shadeHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return hex;
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (num & 255) + amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
