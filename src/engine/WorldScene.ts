import Phaser from 'phaser';
import { BUILDINGS } from '../data/buildings.data';
import { RoadType } from '../data/roads.data';
import { DepositType, FeatureType } from '../data/trees.data';
import type { CoreEngine } from '../core/CoreEngine';
import { BiomeId, ChunkData, TileFlag } from '../core/GameState';
import {
  CHUNK_SIZE,
  chunkKey,
  chunkToGrid,
  gridToChunk,
  gridToIso,
  isoToGridApprox,
} from '../core/IsoMath';
import type { PerfMonitor } from '../persistence/PerfMonitor';
import { ATLAS_KEY, generateWorldAtlas } from './AtlasGenerator';
import type { AudioSystem } from './AudioSystem';
import { CameraInputController } from './CameraInputController';
import { VfxPool } from './VfxPool';

export type InteractionTool =
  | { mode: 'inspect_chop' }
  | { mode: 'land_unlock' }
  | { mode: 'build'; defId: string }
  | { mode: 'move'; buildingId: number }
  | { mode: 'road'; roadType: RoadType }
  | { mode: 'replant' }
  | { mode: 'demolish' };

import type { PlacementValidation } from '../systems/BuildingSystem';

export interface SceneCallbacks {
  onSelectTile: (gx: number, gy: number) => void;
  onSelectBuilding: (buildingId: number) => void;
  onGhostUpdated: (gx: number, gy: number, validation: PlacementValidation) => void;
  onMoveCompleted?: (buildingId: number) => void;
  onToolError: (reason: string) => void;
}

interface ChunkRenderSlot {
  key: string;
  cx: number;
  cy: number;
  rt: Phaser.GameObjects.RenderTexture;
  originSx: number;
  originSy: number;
  lastUsedFrame: number;
}

const CHUNK_TEX_W = 1088;
const CHUNK_TEX_H = 620;
const CHUNK_OFFSET_X = 544;
const CHUNK_OFFSET_Y = 96;
const MAX_RENDER_TEXTURES = 24;

const SMOKE_BUILDINGS = new Set([
  'timber_cottage',
  'brick_townhouse',
  'bakery',
  'brick_kiln',
  'iron_smelter',
  'copper_smelter',
  'steelworks',
  'coal_power_plant',
  'glassworks',
  'pottery_workshop',
  'mint_foundry',
]);

export class WorldScene extends Phaser.Scene {
  private engine!: CoreEngine;
  private audio!: AudioSystem;
  private perf!: PerfMonitor;
  private sceneCallbacks!: SceneCallbacks;

  private cameraCtrl!: CameraInputController;
  private vfx!: VfxPool;

  private chunkTextures = new Map<string, ChunkRenderSlot>();
  private featureSprites: Phaser.GameObjects.Image[] = [];
  private featureCoords: Array<{ gx: number; gy: number }> = [];
  private activeFeatureCount = 0;

  private depositSprites: Phaser.GameObjects.Image[] = [];
  private waterRippleSprites: Phaser.GameObjects.Image[] = [];
  private waterTileCenters: Array<{ sx: number; sy: number; gx: number; gy: number }> = [];
  private roadLightTiles: Array<{ sx: number; sy: number; gx: number; gy: number }> = [];
  private hasWaterVisible = false;

  private citizenSprites: Phaser.GameObjects.Image[] = [];
  private cargoSprites: Phaser.GameObjects.Image[] = [];
  private lightSprites: Phaser.GameObjects.Image[] = [];
  private windowLightSprites: Phaser.GameObjects.Image[] = [];
  private starSprites: Array<{ img: Phaser.GameObjects.Image; rx: number; ry: number; phase: number }> = [];
  private smokeSprites: Phaser.GameObjects.Image[] = [];

  private buildingSprites = new Map<number, Phaser.GameObjects.Image>();
  private statusMarkers = new Map<number, Phaser.GameObjects.Text>();
  private ambientSprites: Array<{ img: Phaser.GameObjects.Image; phase: number; baseX: number; baseY: number }> = [];
  private boatSprites: Array<{ img: Phaser.GameObjects.Image; phase: number }> = [];
  private deerSprites: Array<{ img: Phaser.GameObjects.Image; phase: number; gx: number; gy: number }> = [];
  private fireflySprites: Array<{ img: Phaser.GameObjects.Image; phase: number; baseX: number; baseY: number }> = [];
  private lanternSprites: Array<{ img: Phaser.GameObjects.Image; phase: number; baseX: number; baseY: number }> = [];

  private selectedCursor!: Phaser.GameObjects.Image;
  private ghostFootprintSprites: Phaser.GameObjects.Image[] = [];
  private ghostBuildingSprite!: Phaser.GameObjects.Image;
  private skyWashOverlay!: Phaser.GameObjects.Rectangle;
  private ambientOverlay!: Phaser.GameObjects.Rectangle;
  private weatherOverlay!: Phaser.GameObjects.Rectangle;
  private weatherDrops: Array<{ rect: Phaser.GameObjects.Rectangle; rx: number; ry: number; speed: number }> = [];

  private tool: InteractionTool = { mode: 'inspect_chop' };
  private selectedTile: { gx: number; gy: number } | null = null;
  private ghostCoord: { gx: number; gy: number } | null = null;
  private frameCounter = 0;
  private entityRefreshTimer = 0;
  private forceEntitySync = true;
  private lowPowerMode = false;
  private animClockSec = 0;

  constructor() {
    super({ key: 'WorldScene' });
  }

  public configure(
    engine: CoreEngine,
    audio: AudioSystem,
    perf: PerfMonitor,
    callbacks: SceneCallbacks
  ): void {
    this.engine = engine;
    this.audio = audio;
    this.perf = perf;
    this.sceneCallbacks = callbacks;
  }

  public setTool(tool: InteractionTool): void {
    const prevMode = this.tool.mode;
    this.tool = tool;
    if (tool.mode !== 'build' && tool.mode !== 'move') {
      this.ghostCoord = null;
      this.hideGhost();
    } else if (tool.mode === 'move') {
      const b = this.engine.state.buildings.find((item) => item.id === tool.buildingId);
      if (b) {
        this.ghostCoord = { gx: b.gx, gy: b.gy };
        this.updateGhostPreview();
      } else {
        this.ghostCoord = null;
        this.hideGhost();
      }
    } else {
      this.ghostCoord = null;
      this.hideGhost();
    }
    if ((prevMode === 'land_unlock') !== (tool.mode === 'land_unlock')) {
      this.invalidateAllChunkTextures();
    }
    this.forceEntitySync = true;
  }

  public confirmGhostPlacement(): void {
    if (!this.ghostCoord) return;

    if (this.tool.mode === 'build') {
      const res = this.engine.dispatch({
        type: 'PLACE_BUILDING',
        defId: this.tool.defId,
        gx: this.ghostCoord.gx,
        gy: this.ghostCoord.gy,
      });
      if (res.ok) {
        this.audio.play('build');
        const { sx, sy } = gridToIso(this.ghostCoord.gx, this.ghostCoord.gy, 2);
        this.vfx.spawnText(sx, sy - 20, 'Constructing!', '#86efac');
        this.forceEntitySync = true;
      } else {
        this.audio.play('error');
        this.sceneCallbacks.onToolError(res.reason ?? 'Cannot build here');
      }
      return;
    }

    if (this.tool.mode === 'move') {
      const targetBuildingId = this.tool.buildingId;
      const res = this.engine.dispatch({
        type: 'MOVE_BUILDING',
        buildingId: targetBuildingId,
        gx: this.ghostCoord.gx,
        gy: this.ghostCoord.gy,
      });
      if (res.ok) {
        this.audio.play('move');
        const { sx, sy } = gridToIso(this.ghostCoord.gx, this.ghostCoord.gy, 2);
        this.vfx.spawnText(sx, sy - 24, 'Relocated!', '#93c5fd');
        this.ghostCoord = null;
        this.hideGhost();
        this.tool = { mode: 'inspect_chop' };
        this.forceEntitySync = true;
        this.sceneCallbacks.onMoveCompleted?.(targetBuildingId);
      } else {
        this.audio.play('error');
        this.sceneCallbacks.onToolError(res.reason ?? 'Cannot move building here');
      }
    }
  }

  public centerOnOrigin(): void {
    if (this.cameraCtrl) {
      this.cameraCtrl.centerOnGrid(2, 1);
    }
  }

  public focusOnGrid(gx: number, gy: number, label = 'Target'): void {
    if (this.cameraCtrl) {
      this.cameraCtrl.centerOnGrid(gx, gy);
    }
    this.selectedTile = { gx, gy };
    const elev = this.getTileElev(gx, gy);
    const { sx, sy } = gridToIso(gx, gy, elev);
    this.selectedCursor.setPosition(sx, sy).setVisible(true);
    this.vfx?.spawnText(sx, sy - 26, label, '#fde047');
    this.forceEntitySync = true;
  }

  public zoomBy(factor: number): void {
    if (this.cameraCtrl) {
      this.cameraCtrl.zoomByStep(factor);
    }
  }

  public invalidateAllChunkTextures(): void {
    for (const slot of this.chunkTextures.values()) {
      this.engine.chunks.markRenderDirty(slot.cx, slot.cy);
    }
  }

  public create(): void {
    generateWorldAtlas(this);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#07150e');
    cam.setZoom(Math.max(1.18, this.engine.state.camera.zoom || 1.28));

    this.vfx = new VfxPool(this);

    // Pre-allocate large tree/feature pool (720) with frustum culling so trees never hide on pan/zoom
    for (let i = 0; i < 720; i++) {
      const f = this.add.image(0, 0, ATLAS_KEY, `feat_${FeatureType.JungleHardwood}`);
      f.setOrigin(0.5, 0.82).setVisible(false);
      this.featureSprites.push(f);
      this.featureCoords.push({ gx: 0, gy: 0 });
    }
    for (let i = 0; i < 90; i++) {
      const d = this.add.image(0, 0, ATLAS_KEY, `dep_${DepositType.Stone}`);
      d.setOrigin(0.5, 0.5).setVisible(false);
      this.depositSprites.push(d);
    }

    // Water animated ripple pool
    for (let i = 0; i < 180; i++) {
      const w = this.add.image(0, 0, ATLAS_KEY, 'water_ripple').setDepth(-9000).setVisible(false);
      this.waterRippleSprites.push(w);
    }

    // Autonomous Citizen villager + cargo pools
    for (let i = 0; i < 48; i++) {
      const c = this.add
        .image(0, 0, ATLAS_KEY, 'cit_laborer_0')
        .setOrigin(0.5, 0.9)
        .setVisible(false);
      this.citizenSprites.push(c);

      const cg = this.add
        .image(0, 0, ATLAS_KEY, 'cargo_wood')
        .setOrigin(0.5, 0.5)
        .setVisible(false);
      this.cargoSprites.push(cg);
    }

    // Chimney smoke puffs pool
    for (let i = 0; i < 36; i++) {
      const sm = this.add.image(0, 0, ATLAS_KEY, 'smoke_puff').setVisible(false);
      this.smokeSprites.push(sm);
    }

    // Warm additive night light halos pool (streetlamps, plazas, citizen lanterns)
    for (let i = 0; i < 140; i++) {
      const lt = this.add
        .image(0, 0, ATLAS_KEY, 'light_halo')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(960000)
        .setVisible(false);
      this.lightSprites.push(lt);
    }

    // Illuminated building window glow pool
    for (let i = 0; i < 80; i++) {
      const wg = this.add
        .image(0, 0, ATLAS_KEY, 'window_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(960500)
        .setVisible(false);
      this.windowLightSprites.push(wg);
    }

    // Twinkling night sky starfield pool
    for (let i = 0; i < 28; i++) {
      const st = this.add
        .image(0, 0, ATLAS_KEY, 'sky_star')
        .setScrollFactor(0)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(946500)
        .setVisible(false);
      const rx = ((i * 73 + 19) % 100) / 100;
      const ry = ((i * 41 + 11) % 45) / 100;
      this.starSprites.push({ img: st, rx, ry, phase: i * 0.9 });
    }

    this.selectedCursor = this.add
      .image(0, 0, ATLAS_KEY, 'tile_selected')
      .setOrigin(0.5, 0)
      .setDepth(800000)
      .setVisible(false);

    for (let i = 0; i < 16; i++) {
      const g = this.add
        .image(0, 0, ATLAS_KEY, 'tile_valid')
        .setOrigin(0.5, 0)
        .setDepth(810000)
        .setVisible(false);
      this.ghostFootprintSprites.push(g);
    }

    this.ghostBuildingSprite = this.add
      .image(0, 0, ATLAS_KEY, 'bldg_leaf_hut')
      .setOrigin(0.5, 1)
      .setAlpha(0.78)
      .setDepth(820000)
      .setVisible(false);

    // Secondary twilight / sunrise horizon wash
    this.skyWashOverlay = this.add
      .rectangle(0, 0, 4000, 4000, 0xf97316, 0)
      .setScrollFactor(0)
      .setDepth(944000);

    // Day/Night ambient darkness & sunset tint overlay
    this.ambientOverlay = this.add
      .rectangle(0, 0, 4000, 4000, 0x040b1d, 0)
      .setScrollFactor(0)
      .setDepth(945000);

    // Weather screen tint
    this.weatherOverlay = this.add
      .rectangle(0, 0, 4000, 4000, 0x0f172a, 0)
      .setScrollFactor(0)
      .setDepth(950000);

    // Pooled rain streaks & snow flakes (screen-space)
    for (let i = 0; i < 42; i++) {
      const rect = this.add
        .rectangle(0, 0, 2, 11, 0xbae6fd, 0.55)
        .setScrollFactor(0)
        .setDepth(951000)
        .setVisible(false);
      this.weatherDrops.push({
        rect,
        rx: ((i * 53 + 17) % 100) / 100,
        ry: ((i * 29 + 7) % 100) / 100,
        speed: 0.75 + (i % 5) * 0.14,
      });
    }

    // Pooled ambient birds & river boats
    for (let i = 0; i < 8; i++) {
      const img = this.add
        .image(0, 0, ATLAS_KEY, 'amb_bird')
        .setDepth(850000)
        .setVisible(false);
      this.ambientSprites.push({
        img,
        phase: i * 1.1,
        baseX: (i - 4) * 90,
        baseY: (i % 3) * 70 - 40,
      });
    }
    for (let i = 0; i < 3; i++) {
      const boat = this.add.image(0, 0, ATLAS_KEY, 'amb_boat').setVisible(false);
      this.boatSprites.push({ img: boat, phase: i * 2.1 });
    }
    for (let i = 0; i < 5; i++) {
      const deer = this.add.image(0, 0, ATLAS_KEY, 'wild_deer').setVisible(false);
      this.deerSprites.push({
        img: deer,
        phase: i * 1.4,
        gx: (i - 2) * 3.5 + 1.5,
        gy: ((i % 3) - 1) * 3.2 + 1.5,
      });
    }
    for (let i = 0; i < 18; i++) {
      const ff = this.add
        .image(0, 0, ATLAS_KEY, 'firefly_glow')
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(955000)
        .setVisible(false);
      this.fireflySprites.push({
        img: ff,
        phase: i * 0.75,
        baseX: ((i % 6) - 2.5) * 95,
        baseY: (Math.floor(i / 6) - 1) * 75,
      });
    }
    for (let i = 0; i < 14; i++) {
      const lan = this.add
        .image(0, 0, ATLAS_KEY, 'festival_lantern')
        .setDepth(952000)
        .setVisible(false);
      this.lanternSprites.push({
        img: lan,
        phase: i * 0.65,
        baseX: ((i % 7) - 3) * 75,
        baseY: (Math.floor(i / 7) - 0.5) * 90,
      });
    }

    this.cameraCtrl = new CameraInputController(this, this.engine.chunks, {
      onTapTile: (gx, gy) => this.handleTapTile(gx, gy),
      onLongPressTile: (gx, gy) => {
        this.selectedTile = { gx, gy };
        this.sceneCallbacks.onSelectTile(gx, gy);
      },
      onDragPaintTile: (gx, gy) => this.handlePaintTile(gx, gy),
      isPaintMode: () =>
        this.tool.mode === 'road' || this.tool.mode === 'land_unlock' || this.tool.mode === 'demolish',
      onUserGestureAudioUnlock: () => this.audio.unlock(),
      onCameraMoved: (x, y, z) => {
        this.engine.dispatch({ type: 'SET_CAMERA', x, y, zoom: z });
        this.forceEntitySync = true;
      },
    });

    this.cameraCtrl.centerOnGrid(2, 1);

    // Subscribe to engine events for immediate VFX & dirty sync
    this.engine.subscribe((ev) => {
      if (ev.type === 'CHOP_HIT') {
        const { sx, sy } = gridToIso(ev.gx, ev.gy, 2);
        this.vfx.spawnChips(sx, sy - 6, 0xa16207, ev.cleared ? 8 : 3);
        if (ev.cleared) {
          if (!ev.fromCitizen) this.audio.play('tree_clear');
          const msg = ev.wood > 0 ? `+${ev.wood} Wood  +${ev.coins}C` : `+${ev.coins}C`;
          this.vfx.spawnText(sx, sy - 24, msg, '#bef264');
        } else if (!ev.fromCitizen) {
          this.audio.play('chop');
        }
        this.forceEntitySync = true;
      } else if (ev.type === 'AUTO_DELIVERY') {
        const { sx, sy } = gridToIso(ev.gx, ev.gy, 2);
        this.vfx.spawnText(sx, sy - 26, ev.label, ev.color);
      } else if (ev.type === 'TILE_UNLOCKED') {
        const { sx, sy } = gridToIso(ev.gx, ev.gy, 2);
        this.audio.play('unlock');
        this.vfx.spawnText(sx, sy - 10, 'Unlocked', '#fde047');
        this.cameraCtrl.clampCamera();
        this.forceEntitySync = true;
      } else if (ev.type === 'BUILDING_COMPLETED') {
        const { sx, sy } = gridToIso(ev.gx, ev.gy, 2);
        this.audio.play('coin');
        this.vfx.spawnText(sx, sy - 28, `+${ev.xp} XP`, '#93c5fd');
        this.forceEntitySync = true;
      } else if (ev.type === 'RUIN_EXPLORED') {
        const { sx, sy } = gridToIso(ev.gx, ev.gy, 2);
        this.audio.play('discovery');
        this.vfx.spawnChips(sx, sy - 10, 0xfde047, 10);
        this.vfx.spawnText(sx, sy - 32, `+${ev.coins}C  +${ev.rp} RP`, '#fde047');
        this.forceEntitySync = true;
      } else if (ev.type === 'FESTIVAL_STARTED') {
        this.audio.play('festival');
        const cam = this.cameras.main;
        this.vfx.spawnText(cam.scrollX + cam.width * 0.5, cam.scrollY + cam.height * 0.4, 'City Festival!', '#fde047');
      } else if (ev.type === 'BUILDING_MOVED') {
        this.forceEntitySync = true;
      } else if (ev.type === 'ROAD_REMOVED') {
        const { sx, sy } = gridToIso(ev.gx, ev.gy, 2);
        this.vfx.spawnChips(sx, sy, 0x94a3b8, 5);
        this.vfx.spawnText(
          sx,
          sy - 16,
          ev.refundCoins > 0 ? `Removed +${ev.refundCoins}C` : 'Removed',
          '#fca5a5'
        );
        this.forceEntitySync = true;
      } else if (ev.type === 'LEVEL_UP') {
        this.audio.play('levelup');
      } else if (ev.type === 'STATE_CHANGED') {
        this.cameraCtrl.clampCamera();
        this.forceEntitySync = true;
      }
    });

    this.game.canvas.addEventListener('webglcontextlost', () => {
      this.engine.dispatch({ type: 'SET_SPEED', speed: 0 });
    });
    this.game.canvas.addEventListener('webglcontextrestored', () => {
      this.invalidateAllChunkTextures();
      this.forceEntitySync = true;
    });
  }

  private handleTapTile(gx: number, gy: number): void {
    this.selectedTile = { gx, gy };
    const { sx, sy } = gridToIso(gx, gy, this.getTileElev(gx, gy));
    this.selectedCursor.setPosition(sx, sy).setVisible(true);

    if (this.tool.mode === 'build' || this.tool.mode === 'move') {
      if (this.ghostCoord && this.ghostCoord.gx === gx && this.ghostCoord.gy === gy) {
        this.confirmGhostPlacement();
        return;
      }
      this.ghostCoord = { gx, gy };
      this.updateGhostPreview();
      return;
    }

    if (this.tool.mode === 'road') {
      const res = this.engine.dispatch({ type: 'PLACE_ROAD', roadType: this.tool.roadType, gx, gy });
      if (res.ok) {
        this.audio.play('road');
      } else {
        this.audio.play('error');
        this.sceneCallbacks.onToolError(res.reason ?? 'Cannot build road');
      }
      return;
    }

    if (this.tool.mode === 'land_unlock') {
      const res = this.engine.dispatch({ type: 'UNLOCK_TILE', gx, gy });
      if (!res.ok) {
        this.audio.play('error');
        this.sceneCallbacks.onToolError(res.reason ?? 'Cannot unlock tile');
      }
      return;
    }

    if (this.tool.mode === 'replant') {
      const res = this.engine.dispatch({ type: 'REPLANT_TILE', gx, gy });
      if (res.ok) {
        this.audio.play('unlock');
        this.vfx.spawnText(sx, sy - 10, 'Sapling', '#86efac');
      } else {
        this.audio.play('error');
        this.sceneCallbacks.onToolError(res.reason ?? 'Cannot plant here');
      }
      return;
    }

    if (this.tool.mode === 'demolish') {
      const info = this.engine.inspectTile(gx, gy);
      if (info.building) {
        const res = this.engine.dispatch({ type: 'DEMOLISH_BUILDING', buildingId: info.building.id });
        if (res.ok) {
          this.audio.play('demolish');
          this.vfx.spawnChips(sx, sy - 8, 0xf87171, 8);
          this.vfx.spawnText(sx, sy - 22, 'Demolished', '#fca5a5');
        } else {
          this.audio.play('error');
          this.sceneCallbacks.onToolError(res.reason ?? 'Cannot remove building');
        }
        return;
      }
      if (info.roadType !== RoadType.None) {
        const res = this.engine.dispatch({ type: 'REMOVE_ROAD', gx, gy });
        if (res.ok) {
          this.audio.play('demolish');
        } else {
          this.audio.play('error');
          this.sceneCallbacks.onToolError(res.reason ?? 'Cannot remove road');
        }
        return;
      }
      if (info.unlocked && info.featureType !== FeatureType.None) {
        this.engine.dispatch({ type: 'CHOP_TILE', gx, gy, isManualTap: true });
        return;
      }
      this.audio.play('error');
      this.sceneCallbacks.onToolError('Tap a road, tree, or building to remove');
      return;
    }

    const info = this.engine.inspectTile(gx, gy);
    if (info.building) {
      this.audio.play('ui');
      this.sceneCallbacks.onSelectBuilding(info.building.id);
      return;
    }
    if (info.unlocked && info.featureType !== FeatureType.None) {
      this.engine.dispatch({ type: 'CHOP_TILE', gx, gy, isManualTap: true });
      return;
    }
    this.audio.play('ui');
    this.sceneCallbacks.onSelectTile(gx, gy);
  }

  private handlePaintTile(gx: number, gy: number): void {
    if (this.tool.mode === 'road') {
      const res = this.engine.dispatch({ type: 'PLACE_ROAD', roadType: this.tool.roadType, gx, gy });
      if (res.ok) this.audio.play('road');
    } else if (this.tool.mode === 'land_unlock') {
      this.engine.dispatch({ type: 'UNLOCK_TILE', gx, gy });
    } else if (this.tool.mode === 'demolish') {
      const info = this.engine.inspectTile(gx, gy);
      if (info.roadType !== RoadType.None) {
        const res = this.engine.dispatch({ type: 'REMOVE_ROAD', gx, gy });
        if (res.ok) this.audio.play('demolish');
      }
    }
  }

  private updateGhostPreview(): void {
    if ((this.tool.mode !== 'build' && this.tool.mode !== 'move') || !this.ghostCoord) {
      this.hideGhost();
      return;
    }

    let defId: string;
    if (this.tool.mode === 'build') {
      defId = this.tool.defId;
    } else {
      const moveId = this.tool.buildingId;
      const b = this.engine.state.buildings.find((item) => item.id === moveId);
      if (!b) {
        this.hideGhost();
        return;
      }
      defId = b.defId;
    }

    const def = BUILDINGS[defId];
    if (!def) return;

    const { gx, gy } = this.ghostCoord;
    const val =
      this.tool.mode === 'build'
        ? this.engine.buildingSys.validateBuildingPlacement(
            def.id,
            gx,
            gy,
            this.engine.state,
            this.engine.chunks
          )
        : this.engine.buildingSys.validateBuildingMove(
            this.tool.buildingId,
            gx,
            gy,
            this.engine.state,
            this.engine.chunks
          );

    const frame = val.valid ? 'tile_valid' : 'tile_invalid';
    let idx = 0;
    for (let dx = 0; dx < def.width; dx++) {
      for (let dy = 0; dy < def.height; dy++) {
        const sprite = this.ghostFootprintSprites[idx++];
        if (!sprite) break;
        const elev = this.getTileElev(gx + dx, gy + dy);
        const { sx, sy } = gridToIso(gx + dx, gy + dy, elev);
        sprite.setFrame(frame).setPosition(sx, sy).setVisible(true);
      }
    }
    for (let i = idx; i < this.ghostFootprintSprites.length; i++) {
      this.ghostFootprintSprites[i].setVisible(false);
    }

    const southX = gx + def.width - 1;
    const southY = gy + def.height - 1;
    const elev = this.getTileElev(gx, gy);
    const anchor = gridToIso(southX, southY, elev);
    this.ghostBuildingSprite
      .setFrame(`bldg_${def.id}`)
      .setPosition(anchor.sx, anchor.sy + 32)
      .setTint(val.valid ? (this.tool.mode === 'move' ? 0xbae6fd : 0xffffff) : 0xfca5a5)
      .setVisible(true);

    this.sceneCallbacks.onGhostUpdated(gx, gy, val);
  }

  private hideGhost(): void {
    for (const g of this.ghostFootprintSprites) g.setVisible(false);
    this.ghostBuildingSprite.setVisible(false);
  }

  private getTileElev(gx: number, gy: number): number {
    const { chunk, index } = this.engine.chunks.getTile(gx, gy);
    return chunk.elevation[index];
  }

  public update(_time: number, delta: number): void {
    this.frameCounter += 1;
    this.perf.recordFrameDelta(delta);

    const settings = this.engine.state.settings;
    const wantLowPower = settings.graphicsMode === 'low_power';
    if (wantLowPower !== this.lowPowerMode) {
      this.lowPowerMode = wantLowPower;
      this.perf.setLowPowerActive(wantLowPower);
      this.game.loop.targetFps = wantLowPower ? 30 : 60;
    }

    const simStart = performance.now();
    const didTick = this.engine.advanceFrame(delta);
    if (didTick) {
      this.perf.recordSimDuration(
        performance.now() - simStart,
        this.engine.chunks.getLoadedChunkCount()
      );
    }

    const dtSec = Math.min(0.1, delta / 1000);
    if (this.engine.state.speed > 0) {
      this.animClockSec += dtSec * Math.max(1, this.engine.state.speed * 0.65);
    }

    this.cameraCtrl.update(dtSec);
    this.vfx.update(dtSec);

    // Sync audio volumes & continuous city/nature soundscape
    this.audio.setVolumes(settings.masterVolume, settings.sfxVolume, settings.ambientVolume ?? 0.65);
    this.audio.updateAmbient(dtSec, {
      population: this.engine.state.population.total,
      activeBuildings: this.engine.state.buildings.filter((b) => b.status === 'active').length,
      timeOfDayHours: this.engine.state.timeOfDayHours,
      weather: this.engine.state.weather,
      speed: this.engine.state.speed,
      hasWaterVisible: this.hasWaterVisible,
      festivalActive: (this.engine.state.festivalTicksRemaining ?? 0) > 0,
    });

    this.syncVisibleChunks();

    this.entityRefreshTimer += delta;
    if (this.forceEntitySync || this.entityRefreshTimer >= 160) {
      this.forceEntitySync = false;
      this.entityRefreshTimer = 0;
      this.syncDynamicEntities();
      if ((this.tool.mode === 'build' || this.tool.mode === 'move') && this.ghostCoord) {
        this.updateGhostPreview();
      }
    }

    // 60fps smooth animations: citizens, water waves, chimney smoke, tree sway, day/night lights
    this.syncCitizens();
    this.updateWaterAndSmoke();
    this.updateDayNightLightingAndWeather(dtSec);
  }

  private getCameraWorldFrustum(): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } {
    const cam = this.cameras.main;
    const tl = cam.getWorldPoint(0, 0);
    const tr = cam.getWorldPoint(cam.width, 0);
    const bl = cam.getWorldPoint(0, cam.height);
    const br = cam.getWorldPoint(cam.width, cam.height);
    return {
      minX: Math.min(tl.x, tr.x, bl.x, br.x),
      maxX: Math.max(tl.x, tr.x, bl.x, br.x),
      minY: Math.min(tl.y, tr.y, bl.y, br.y),
      maxY: Math.max(tl.y, tr.y, bl.y, br.y),
    };
  }

  private getVisibleGridBounds(): {
    minGx: number;
    maxGx: number;
    minGy: number;
    maxGy: number;
  } {
    const cam = this.cameras.main;
    const corners = [
      cam.getWorldPoint(0, 0),
      cam.getWorldPoint(cam.width, 0),
      cam.getWorldPoint(0, cam.height),
      cam.getWorldPoint(cam.width, cam.height),
    ];

    let minGx = Infinity;
    let maxGx = -Infinity;
    let minGy = Infinity;
    let maxGy = -Infinity;

    for (const pt of corners) {
      const g = isoToGridApprox(pt.x, pt.y + 32);
      if (g.gx < minGx) minGx = g.gx;
      if (g.gx > maxGx) maxGx = g.gx;
      if (g.gy < minGy) minGy = g.gy;
      if (g.gy > maxGy) maxGy = g.gy;
    }

    return {
      minGx: Math.floor(minGx) - 4,
      maxGx: Math.ceil(maxGx) + 4,
      minGy: Math.floor(minGy) - 4,
      maxGy: Math.ceil(maxGy) + 5,
    };
  }

  private syncVisibleChunks(): void {
    const bounds = this.getVisibleGridBounds();
    const cMin = gridToChunk(bounds.minGx, bounds.minGy);
    const cMax = gridToChunk(bounds.maxGx, bounds.maxGy);

    const dirtyKeys = new Set(this.engine.chunks.consumeDirtyRenderKeys());

    const minCx = Math.min(cMin.cx, cMax.cx) - 1;
    const maxCx = Math.max(cMin.cx, cMax.cx) + 1;
    const minCy = Math.min(cMin.cy, cMax.cy) - 1;
    const maxCy = Math.max(cMin.cy, cMax.cy) + 1;

    const visibleKeys = new Set<string>();

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = chunkKey(cx, cy);
        visibleKeys.add(key);
        const chunk = this.engine.chunks.getOrCreateChunk(cx, cy);
        let slot = this.chunkTextures.get(key);
        if (!slot) {
          slot = this.acquireChunkRenderSlot(cx, cy, chunk);
          dirtyKeys.add(key);
        }
        slot.lastUsedFrame = this.frameCounter;
        slot.rt.setVisible(true);
        if (dirtyKeys.has(key)) {
          this.bakeChunkTexture(chunk, slot);
        }
      }
    }

    for (const [key, slot] of this.chunkTextures.entries()) {
      if (!visibleKeys.has(key)) {
        slot.rt.setVisible(false);
      }
    }
  }

  private acquireChunkRenderSlot(cx: number, cy: number, _chunk: ChunkData): ChunkRenderSlot {
    const key = chunkKey(cx, cy);
    const origin = chunkToGrid(cx, cy, 0, 0);
    const isoOrigin = gridToIso(origin.gx, origin.gy, 0);

    if (this.chunkTextures.size >= MAX_RENDER_TEXTURES) {
      let oldestKey: string | null = null;
      let oldestFrame = Infinity;
      for (const [k, s] of this.chunkTextures.entries()) {
        if (!s.rt.visible && s.lastUsedFrame < oldestFrame) {
          oldestFrame = s.lastUsedFrame;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        const recycled = this.chunkTextures.get(oldestKey)!;
        this.chunkTextures.delete(oldestKey);
        recycled.key = key;
        recycled.cx = cx;
        recycled.cy = cy;
        recycled.originSx = isoOrigin.sx;
        recycled.originSy = isoOrigin.sy;
        recycled.rt.setPosition(isoOrigin.sx - CHUNK_OFFSET_X, isoOrigin.sy - CHUNK_OFFSET_Y);
        recycled.rt.setDepth((cx + cy) * 10 - 50000);
        this.chunkTextures.set(key, recycled);
        return recycled;
      }
    }

    const rt = this.add.renderTexture(
      isoOrigin.sx - CHUNK_OFFSET_X,
      isoOrigin.sy - CHUNK_OFFSET_Y,
      CHUNK_TEX_W,
      CHUNK_TEX_H
    );
    rt.setOrigin(0, 0);
    rt.setDepth((cx + cy) * 10 - 50000);

    const slot: ChunkRenderSlot = {
      key,
      cx,
      cy,
      rt,
      originSx: isoOrigin.sx,
      originSy: isoOrigin.sy,
      lastUsedFrame: this.frameCounter,
    };
    this.chunkTextures.set(key, slot);
    return slot;
  }

  private bakeChunkTexture(chunk: ChunkData, slot: ChunkRenderSlot): void {
    const rt = slot.rt;
    rt.clear();

    const showFrontier = this.tool.mode === 'land_unlock';

    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const idx = ly * CHUNK_SIZE + lx;
        const { gx, gy } = chunkToGrid(chunk.cx, chunk.cy, lx, ly);
        const elev = chunk.elevation[idx];
        const biome = chunk.biomeId[idx];
        const { sx, sy } = gridToIso(gx, gy, elev);

        const localX = sx - slot.originSx + CHUNK_OFFSET_X;
        const localY = sy - slot.originSy + CHUNK_OFFSET_Y;

        rt.stamp(ATLAS_KEY, `biome_${biome}`, localX, localY, { originX: 0.5, originY: 0 });

        const unlocked = (chunk.flags[idx] & TileFlag.Unlocked) !== 0;
        if (unlocked) {
          rt.stamp(ATLAS_KEY, 'tile_owned', localX, localY, { originX: 0.5, originY: 0 });
          if (!this.engine.chunks.isUnlocked(gx, gy - 1)) {
            rt.stamp(ATLAS_KEY, 'border_ne', localX, localY, { originX: 0.5, originY: 0 });
          }
          if (!this.engine.chunks.isUnlocked(gx - 1, gy)) {
            rt.stamp(ATLAS_KEY, 'border_nw', localX, localY, { originX: 0.5, originY: 0 });
          }
          if (!this.engine.chunks.isUnlocked(gx + 1, gy)) {
            rt.stamp(ATLAS_KEY, 'border_se', localX, localY, { originX: 0.5, originY: 0 });
          }
          if (!this.engine.chunks.isUnlocked(gx, gy + 1)) {
            rt.stamp(ATLAS_KEY, 'border_sw', localX, localY, { originX: 0.5, originY: 0 });
          }
        } else {
          if (showFrontier && this.engine.chunks.isAdjacentToUnlocked(gx, gy)) {
            rt.stamp(ATLAS_KEY, 'tile_frontier', localX, localY, { originX: 0.5, originY: 0 });
          } else {
            rt.stamp(ATLAS_KEY, 'tile_locked', localX, localY, { originX: 0.5, originY: 0 });
            if (this.engine.chunks.isAdjacentToUnlocked(gx, gy)) {
              rt.stamp(ATLAS_KEY, 'tile_frontier_subtle', localX, localY, { originX: 0.5, originY: 0 });
            }
          }
        }

        const road = chunk.roadType[idx] as RoadType;
        if (road !== RoadType.None) {
          rt.stamp(ATLAS_KEY, `road_${road}`, localX, localY, { originX: 0.5, originY: 0 });
        }
      }
    }

    rt.render();
  }

  private syncDynamicEntities(): void {
    const bounds = this.getVisibleGridBounds();
    const frustum = this.getCameraWorldFrustum();
    const fMinX = frustum.minX - 96;
    const fMaxX = frustum.maxX + 96;
    const fMinY = frustum.minY - 120;
    const fMaxY = frustum.maxY + 140;

    let featIdx = 0;
    let depIdx = 0;
    this.waterTileCenters.length = 0;
    this.roadLightTiles.length = 0;

    for (let gy = bounds.minGy; gy <= bounds.maxGy; gy++) {
      for (let gx = bounds.minGx; gx <= bounds.maxGx; gx++) {
        const { chunk, index } = this.engine.chunks.getTile(gx, gy);
        const elev = chunk.elevation[index];
        const { sx, sy } = gridToIso(gx, gy, elev);

        // Frustum cull offscreen corner tiles so pooled tree sprites NEVER run out while panning!
        if (sx < fMinX || sx > fMaxX || sy < fMinY || sy > fMaxY) continue;

        const unlocked = (chunk.flags[index] & TileFlag.Unlocked) !== 0;
        const explored = (chunk.flags[index] & TileFlag.Explored) !== 0;
        const biome = chunk.biomeId[index] as BiomeId;
        const depthBase = (gx + gy) * 100 + elev * 2;

        if (biome === BiomeId.River || biome === BiomeId.DeepWater) {
          this.waterTileCenters.push({ sx, sy: sy + 16, gx, gy });
        }

        const road = chunk.roadType[index] as RoadType;
        if (road !== RoadType.None && (road >= RoadType.Stone || ((gx + gy) & 1) === 0)) {
          this.roadLightTiles.push({ sx, sy: sy + 8, gx, gy });
        }

        const dep = chunk.depositType[index] as DepositType;
        if (
          (unlocked || explored) &&
          dep !== DepositType.None &&
          chunk.buildingRef[index] === -1 &&
          depIdx < this.depositSprites.length
        ) {
          const ds = this.depositSprites[depIdx++];
          ds.setFrame(`dep_${dep}`)
            .setPosition(sx, sy + 16)
            .setDepth(depthBase + 1)
            .setAlpha(unlocked ? 1 : 0.78)
            .setVisible(true);
        }

        const ft = chunk.featureType[index] as FeatureType;
        if (ft !== FeatureType.None && featIdx < this.featureSprites.length) {
          const fs = this.featureSprites[featIdx];
          this.featureCoords[featIdx] = { gx, gy };
          featIdx++;
          fs.setFrame(`feat_${ft}`)
            .setPosition(sx, sy + 24)
            .setDepth(depthBase + 15)
            .setTint(unlocked ? 0xffffff : 0x94a3b8)
            .setAlpha(unlocked ? 1 : 0.86)
            .setVisible(true);
        }
      }
    }

    this.activeFeatureCount = featIdx;
    this.hasWaterVisible = this.waterTileCenters.length > 0;

    for (let i = featIdx; i < this.featureSprites.length; i++) {
      this.featureSprites[i].setVisible(false);
    }
    for (let i = depIdx; i < this.depositSprites.length; i++) {
      this.depositSprites[i].setVisible(false);
    }

    // Sync Buildings
    const activeIds = new Set<number>();
    for (const b of this.engine.state.buildings) {
      const def = BUILDINGS[b.defId];
      if (!def) continue;
      activeIds.add(b.id);

      const inBounds =
        b.gx + def.width >= bounds.minGx &&
        b.gx <= bounds.maxGx &&
        b.gy + def.height >= bounds.minGy &&
        b.gy <= bounds.maxGy;

      let sprite = this.buildingSprites.get(b.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, ATLAS_KEY, `bldg_${def.id}`).setOrigin(0.5, 1);
        this.buildingSprites.set(b.id, sprite);
      }

      if (!inBounds) {
        sprite.setVisible(false);
        this.statusMarkers.get(b.id)?.setVisible(false);
        continue;
      }

      const elev = this.getTileElev(b.gx, b.gy);
      const southX = b.gx + def.width - 1;
      const southY = b.gy + def.height - 1;
      const anchor = gridToIso(southX, southY, elev);

      const isBeingMoved = this.tool.mode === 'move' && this.tool.buildingId === b.id;
      const frameName = b.status === 'constructing' ? 'bldg_constructing' : `bldg_${def.id}`;
      sprite
        .setFrame(frameName)
        .setPosition(anchor.sx, anchor.sy + 32)
        .setDepth((southX + southY) * 100 + elev * 2 + 25)
        .setTint(isBeingMoved ? 0x93c5fd : 0xffffff)
        .setAlpha(isBeingMoved ? 0.42 : b.enabled ? 1 : 0.6)
        .setVisible(true);

      let marker = this.statusMarkers.get(b.id);
      const showMarker =
        b.status === 'constructing' ||
        b.status === 'no_workers' ||
        b.status === 'no_road' ||
        b.status === 'no_inputs' ||
        b.status === 'no_power';

      if (showMarker) {
        if (!marker) {
          marker = this.add
            .text(0, 0, '', {
              fontSize: '10px',
              fontStyle: 'bold',
              backgroundColor: 'rgba(15, 23, 42, 0.85)',
              color: '#fde047',
              padding: { x: 4, y: 2 },
            })
            .setOrigin(0.5, 1);
          this.statusMarkers.set(b.id, marker);
        }
        const label =
          b.status === 'constructing'
            ? `${Math.round(b.buildProgress * 100)}%`
            : b.status === 'no_workers'
              ? 'NO WORKERS'
              : b.status === 'no_road'
                ? 'NO ROAD'
                : b.status === 'no_power'
                  ? 'NO POWER'
                  : 'NO INPUT';
        marker
          .setText(label)
          .setPosition(anchor.sx, anchor.sy - 20)
          .setDepth(sprite.depth + 2)
          .setVisible(true);
      } else if (marker) {
        marker.setVisible(false);
      }
    }

    for (const [id, sprite] of this.buildingSprites.entries()) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.buildingSprites.delete(id);
        this.statusMarkers.get(id)?.destroy();
        this.statusMarkers.delete(id);
      }
    }
  }

  private syncCitizens(): void {
    const agents = this.engine.citizens.agents;
    const count = Math.min(agents.length, this.citizenSprites.length);

    for (let i = 0; i < count; i++) {
      const a = agents[i];
      const cs = this.citizenSprites[i];
      const cg = this.cargoSprites[i];

      const { chunk, index } = this.engine.chunks.getTile(Math.round(a.gx), Math.round(a.gy));
      const elev = chunk.elevation[index];
      const { sx, sy } = gridToIso(a.gx, a.gy, elev);
      const bob = a.task === 'working' || a.task === 'idle_stroll' ? 0 : Math.abs(Math.sin(a.stridePhase)) * 2.4;

      let frame = `cit_${a.role}_${Math.floor(a.stridePhase) % 2}`;
      if (a.task === 'chopping' && Math.sin(a.stridePhase * 1.4) > 0) {
        frame = 'cit_laborer_chop';
      }

      const depth = (Math.round(a.gx) + Math.round(a.gy)) * 100 + elev * 2 + 28;
      cs.setFrame(frame)
        .setPosition(sx, sy + 20 - bob)
        .setFlipX(a.facing < 0)
        .setDepth(depth)
        .setVisible(true);

      if (a.carrying !== 'none') {
        cg.setFrame(`cargo_${a.carrying}`)
          .setPosition(sx + a.facing * 5, sy + 3 - bob)
          .setDepth(depth + 1)
          .setVisible(true);
      } else {
        cg.setVisible(false);
      }
    }

    for (let i = count; i < this.citizenSprites.length; i++) {
      this.citizenSprites[i].setVisible(false);
      this.cargoSprites[i].setVisible(false);
    }
  }

  private updateWaterAndSmoke(): void {
    const reduced = this.lowPowerMode || this.engine.state.settings.reducedAnimations;
    const t = this.animClockSec;

    // 1. Subtle wind sway on dense forest canopy
    if (!reduced) {
      const swayAmp = this.engine.state.weather === 'storm' ? 0.055 : 0.024;
      for (let i = 0; i < this.activeFeatureCount; i++) {
        const coord = this.featureCoords[i];
        this.featureSprites[i].setRotation(
          Math.sin(t * 1.7 + coord.gx * 0.65 + coord.gy * 0.45) * swayAmp
        );
      }
    } else {
      for (let i = 0; i < this.activeFeatureCount; i++) {
        this.featureSprites[i].setRotation(0);
      }
    }

    // 2. Animated flowing water ripples across River & DeepWater tiles
    let wIdx = 0;
    if (!reduced) {
      const maxRipples = Math.min(this.waterTileCenters.length, this.waterRippleSprites.length);
      for (let i = 0; i < maxRipples; i++) {
        const tile = this.waterTileCenters[i];
        const phase = t * 1.3 + tile.gx * 0.8 + tile.gy * 0.6;
        const driftX = ((phase * 8) % 18) - 9;
        const driftY = driftX * 0.42;
        const alpha = 0.22 + (Math.sin(phase * 2.1) * 0.5 + 0.5) * 0.45;
        this.waterRippleSprites[wIdx++]
          .setPosition(tile.sx + driftX, tile.sy + driftY)
          .setAlpha(alpha)
          .setScale(0.75 + Math.sin(phase) * 0.12)
          .setVisible(true);
      }
    }
    for (let i = wIdx; i < this.waterRippleSprites.length; i++) {
      this.waterRippleSprites[i].setVisible(false);
    }

    // 3. River boats gliding along nearby river tiles
    let boatIdx = 0;
    if (!reduced && this.waterTileCenters.length >= 3) {
      for (const b of this.boatSprites) {
        const tile = this.waterTileCenters[(boatIdx * 3) % this.waterTileCenters.length];
        const p = t * 0.65 + b.phase;
        b.img
          .setPosition(tile.sx + Math.sin(p) * 14, tile.sy - 2 + Math.cos(p * 1.3) * 5)
          .setDepth((tile.gx + tile.gy) * 100 + 8)
          .setFlipX(Math.cos(p) < 0)
          .setVisible(true);
        boatIdx++;
      }
    }
    for (let i = boatIdx; i < this.boatSprites.length; i++) {
      this.boatSprites[i].img.setVisible(false);
    }

    // 4. Chimney smoke puffs rising from active cottages/bakeries/factories
    let sIdx = 0;
    if (!reduced) {
      for (const b of this.engine.state.buildings) {
        if (b.status !== 'active' || !SMOKE_BUILDINGS.has(b.defId)) continue;
        const def = BUILDINGS[b.defId];
        if (!def) continue;
        const elev = this.getTileElev(b.gx, b.gy);
        const anchor = gridToIso(b.gx + def.width - 1, b.gy + def.height - 1, elev);
        for (let k = 0; k < 2 && sIdx < this.smokeSprites.length; k++) {
          const p = (t * 0.55 + b.id * 0.37 + k * 0.5) % 1;
          this.smokeSprites[sIdx++]
            .setPosition(anchor.sx + 4 + p * 9, anchor.sy - 22 - p * 26)
            .setAlpha((1 - p) * 0.52)
            .setScale(0.55 + p * 0.9)
            .setDepth((b.gx + b.gy + def.width) * 100 + 60)
            .setVisible(true);
        }
      }
    }
    for (let i = sIdx; i < this.smokeSprites.length; i++) {
      this.smokeSprites[i].setVisible(false);
    }
  }

  private updateDayNightLightingAndWeather(dtSec: number): void {
    const reduced = this.lowPowerMode || this.engine.state.settings.reducedAnimations;
    for (const a of this.ambientSprites) {
      if (reduced) {
        a.img.setVisible(false);
        continue;
      }
      a.phase += dtSec * 0.85;
      a.img
        .setPosition(a.baseX + Math.sin(a.phase) * 140, a.baseY + Math.cos(a.phase * 0.7) * 70)
        .setVisible(true);
    }

    const h = this.engine.state.timeOfDayHours;
    const isDay = h >= 6.5 && h < 18.5;
    for (const d of this.deerSprites) {
      if (reduced || !isDay) {
        d.img.setVisible(false);
        continue;
      }
      d.phase += dtSec * 0.35;
      const gx = d.gx + Math.sin(d.phase) * 1.1;
      const gy = d.gy + Math.cos(d.phase * 0.8) * 1.1;
      const { chunk, index } = this.engine.chunks.getTile(Math.round(gx), Math.round(gy));
      if (this.engine.chunks.isWaterBiome(chunk.biomeId[index])) {
        d.img.setVisible(false);
        continue;
      }
      const { sx, sy } = gridToIso(gx, gy, chunk.elevation[index]);
      d.img
        .setPosition(sx, sy + 18)
        .setFlipX(Math.cos(d.phase) < 0)
        .setDepth((Math.round(gx) + Math.round(gy)) * 100 + 20)
        .setVisible(true);
    }

    const isDuskOrNight = h >= 18.0 || h < 5.5;
    for (const ff of this.fireflySprites) {
      if (reduced || !isDuskOrNight) {
        ff.img.setVisible(false);
        continue;
      }
      ff.phase += dtSec * 1.4;
      ff.img
        .setPosition(ff.baseX + Math.sin(ff.phase) * 38, ff.baseY + Math.cos(ff.phase * 1.3) * 24)
        .setAlpha(0.35 + (Math.sin(ff.phase * 2.5) * 0.5 + 0.5) * 0.65)
        .setVisible(true);
    }

    const festivalActive = (this.engine.state.festivalTicksRemaining ?? 0) > 0;
    for (const lan of this.lanternSprites) {
      if (reduced || !festivalActive) {
        lan.img.setVisible(false);
        continue;
      }
      lan.phase += dtSec * 0.55;
      const rise = ((lan.phase * 36) % 180);
      lan.img
        .setPosition(lan.baseX + Math.sin(lan.phase * 2) * 14, lan.baseY + 80 - rise)
        .setAlpha(Math.min(1, (180 - rise) / 45) * 0.9)
        .setVisible(true);
    }

    // Real-time 5-minute 24h Day/Night 6-Phase Atmospheric Lighting Curve
    let overlayColor = 0x040b1d;
    let overlayAlpha = 0;
    let washColor = 0xf97316;
    let washAlpha = 0;
    let skyHex = '#07150e';
    let lampPower = 0;
    let starOpacity = 0;

    if (h >= 19.75 || h < 4.25) {
      // Phase 6: Deep Starlit Moonlit Night
      overlayColor = 0x040b1d;
      overlayAlpha = 0.62;
      washAlpha = 0;
      skyHex = '#020612';
      lampPower = 1.0;
      starOpacity = 0.92;
    } else if (h >= 4.25 && h < 6.0) {
      // Phase 1: Dawn Rose & Indigo Sunrise
      const k = (h - 4.25) / 1.75;
      overlayColor = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x040b1d),
        Phaser.Display.Color.ValueToColor(0x7c2d12),
        100,
        Math.round(k * 100)
      ).color;
      overlayAlpha = 0.62 - k * 0.42;
      washColor = 0xfb7185;
      washAlpha = Math.sin(k * Math.PI) * 0.14;
      skyHex = '#191024';
      lampPower = 1.0 - k * 0.65;
      starOpacity = Math.max(0, 0.92 * (1 - k * 1.4));
    } else if (h >= 6.0 && h < 8.0) {
      // Phase 2: Warm Morning Gold -> Crisp Daylight
      const k = (h - 6.0) / 2.0;
      overlayColor = 0xfbbf24;
      overlayAlpha = 0.16 * (1 - k);
      washColor = 0xfde68a;
      washAlpha = 0.08 * (1 - k);
      skyHex = '#0a1f15';
      lampPower = Math.max(0, 0.35 * (1 - k * 1.3));
      starOpacity = 0;
    } else if (h >= 16.0 && h < 18.25) {
      // Phase 4: Golden Hour Amber Sunset
      const k = (h - 16.0) / 2.25;
      overlayColor = 0xd97706;
      overlayAlpha = k * 0.28;
      washColor = 0xea580c;
      washAlpha = Math.sin(k * Math.PI * 0.7) * 0.14;
      skyHex = '#231312';
      lampPower = k * 0.72;
      starOpacity = 0;
    } else if (h >= 18.25 && h < 19.75) {
      // Phase 5: Violet Dusk / Twilight -> Night
      const k = (h - 18.25) / 1.5;
      overlayColor = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x6b21a8),
        Phaser.Display.Color.ValueToColor(0x040b1d),
        100,
        Math.round(k * 100)
      ).color;
      overlayAlpha = 0.28 + k * 0.34;
      washColor = 0xc026d3;
      washAlpha = (1 - k) * 0.12;
      skyHex = '#090b1d';
      lampPower = 0.72 + k * 0.28;
      starOpacity = Math.max(0, (k - 0.2) * 1.15);
    } else {
      // Phase 3: Crisp Sunlit Tropical Midday (08:00 .. 16:00)
      overlayAlpha = 0;
      washAlpha = 0;
      skyHex = '#07150e';
      lampPower = 0;
      starOpacity = 0;
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor(skyHex);
    this.ambientOverlay.setFillStyle(overlayColor, overlayAlpha);
    this.skyWashOverlay.setFillStyle(washColor, washAlpha);

    // Twinkling stars across the upper sky during twilight & night
    if (!reduced && starOpacity > 0.04) {
      for (const st of this.starSprites) {
        const twinkle = 0.45 + (Math.sin(this.animClockSec * 2.4 + st.phase) * 0.5 + 0.5) * 0.55;
        st.img
          .setPosition(st.rx * cam.width, st.ry * cam.height)
          .setAlpha(starOpacity * twinkle)
          .setScale(0.65 + twinkle * 0.4)
          .setVisible(true);
      }
    } else {
      for (const st of this.starSprites) {
        st.img.setVisible(false);
      }
    }

    // Warm glowing lights on buildings, illuminated windows, streetlights & citizen lanterns at dusk/night
    let lIdx = 0;
    let wIdx = 0;
    if (lampPower > 0.04) {
      for (const b of this.engine.state.buildings) {
        if (b.status === 'constructing' || !b.enabled) continue;
        const def = BUILDINGS[b.defId];
        if (!def) continue;
        const elev = this.getTileElev(b.gx, b.gy);
        const anchor = gridToIso(b.gx + def.width - 1, b.gy + def.height - 1, elev);
        const flicker = 0.92 + Math.sin(this.animClockSec * 3.4 + b.id * 1.7) * 0.08;
        const isNightMarket = def.id === 'night_market' || def.id === 'festival_plaza' || def.id === 'fountain_plaza';

        if (lIdx < this.lightSprites.length) {
          this.lightSprites[lIdx++]
            .setPosition(anchor.sx, anchor.sy + 2)
            .setScale((0.72 + def.width * 0.34 + (isNightMarket ? 0.35 : 0)) * flicker)
            .setAlpha(lampPower * (isNightMarket ? 0.88 : 0.72))
            .setVisible(true);
        }

        if (!this.lowPowerMode && wIdx < this.windowLightSprites.length) {
          this.windowLightSprites[wIdx++]
            .setPosition(anchor.sx, anchor.sy + 14)
            .setScale(0.75 + def.width * 0.16)
            .setAlpha(lampPower * 0.85 * flicker)
            .setVisible(true);
        }
      }

      for (const r of this.roadLightTiles) {
        if (lIdx >= this.lightSprites.length) break;
        this.lightSprites[lIdx++]
          .setPosition(r.sx, r.sy)
          .setScale(0.58)
          .setAlpha(lampPower * 0.52)
          .setVisible(true);
      }

      for (let i = 0; i < this.engine.citizens.agents.length && lIdx < this.lightSprites.length; i += 2) {
        const a = this.engine.citizens.agents[i];
        const { chunk, index } = this.engine.chunks.getTile(Math.round(a.gx), Math.round(a.gy));
        const { sx, sy } = gridToIso(a.gx, a.gy, chunk.elevation[index]);
        this.lightSprites[lIdx++]
          .setPosition(sx, sy + 8)
          .setScale(0.38)
          .setAlpha(lampPower * 0.56)
          .setVisible(true);
      }
    }
    for (let i = lIdx; i < this.lightSprites.length; i++) {
      this.lightSprites[i].setVisible(false);
    }
    for (let i = wIdx; i < this.windowLightSprites.length; i++) {
      this.windowLightSprites[i].setVisible(false);
    }

    // Weather tint & animated rain/snow precipitation streaks
    if (this.lowPowerMode || reduced) {
      this.weatherOverlay.setFillStyle(0x0f172a, 0);
      for (const drop of this.weatherDrops) drop.rect.setVisible(false);
      return;
    }
    const w = this.engine.state.weather;
    if (w === 'rain') {
      this.weatherOverlay.setFillStyle(0x0c4a6e, 0.14);
    } else if (w === 'storm') {
      this.weatherOverlay.setFillStyle(0x0f172a, 0.24);
    } else if (w === 'drought') {
      this.weatherOverlay.setFillStyle(0xb45309, 0.11);
    } else if (w === 'snow') {
      this.weatherOverlay.setFillStyle(0xe2e8f0, 0.14);
    } else {
      this.weatherOverlay.setFillStyle(0x0f172a, 0);
    }

    if (w === 'rain' || w === 'storm' || w === 'snow') {
      const isSnow = w === 'snow';
      const isStorm = w === 'storm';
      const activeDrops = isStorm ? this.weatherDrops.length : 28;
      for (let i = 0; i < this.weatherDrops.length; i++) {
        const drop = this.weatherDrops[i];
        if (i >= activeDrops) {
          drop.rect.setVisible(false);
          continue;
        }
        drop.ry = (drop.ry + dtSec * (isSnow ? 0.18 : isStorm ? 1.4 : 0.95) * drop.speed) % 1;
        drop.rx = (drop.rx + dtSec * (isSnow ? Math.sin(this.animClockSec * 2 + i) * 0.04 : -0.18) + 1) % 1;
        drop.rect
          .setSize(isSnow ? 3.5 : 1.6, isSnow ? 3.5 : isStorm ? 16 : 11)
          .setFillStyle(isSnow ? 0xf8fafc : 0xbae6fd, isSnow ? 0.72 : isStorm ? 0.58 : 0.42)
          .setRotation(isSnow ? 0 : 0.22)
          .setPosition(drop.rx * cam.width, drop.ry * cam.height)
          .setVisible(true);
      }
    } else {
      for (const drop of this.weatherDrops) {
        drop.rect.setVisible(false);
      }
    }
  }
}
