import { BUILDINGS, BuildingCategory } from '../data/buildings.data';
import { POLICY_MAP } from '../data/policies.data';
import { FeatureType, TREE_SPECIES } from '../data/trees.data';
import { BIOME_NAMES, ChunkManager } from './ChunkManager';
import type { CommandResult, GameCommand } from './CommandTypes';
import {
  BiomeId,
  ChunkData,
  SCHEMA_VERSION,
  TileFlag,
  TileInspection,
  WorldEngineState,
} from './GameState';
import { gridToChunk } from './IsoMath';
import { BuildingSystem } from '../systems/BuildingSystem';
import { EconomySystem } from '../systems/EconomySystem';
import { EnvironmentSystem } from '../systems/EnvironmentSystem';
import { ForestrySystem } from '../systems/ForestrySystem';
import { PopulationSystem } from '../systems/PopulationSystem';
import { ProductionSystem } from '../systems/ProductionSystem';
import { ProgressionSystem } from '../systems/ProgressionSystem';
import { ResourceSystem } from '../systems/ResourceSystem';
import { RoadNetworkSystem } from '../systems/RoadNetworkSystem';
import { TechSystem } from '../systems/TechSystem';
import { WorkforceSystem } from '../systems/WorkforceSystem';
import { CitizenSystem } from '../systems/CitizenSystem';

export type EngineEvent =
  | { type: 'CHOP_HIT'; gx: number; gy: number; cleared: boolean; wood: number; coins: number; xp: number; fromCitizen?: boolean }
  | { type: 'AUTO_DELIVERY'; gx: number; gy: number; label: string; color: string }
  | { type: 'RUIN_EXPLORED'; gx: number; gy: number; coins: number; rp: number }
  | { type: 'FESTIVAL_STARTED' }
  | { type: 'TILE_UNLOCKED'; gx: number; gy: number }
  | { type: 'BUILDING_PLACED'; buildingId: number; defId: string; gx: number; gy: number }
  | { type: 'BUILDING_MOVED'; buildingId: number; defId: string; gx: number; gy: number }
  | { type: 'BUILDING_COMPLETED'; buildingId: number; defId: string; gx: number; gy: number; xp: number }
  | { type: 'ROAD_PLACED'; gx: number; gy: number }
  | { type: 'ROAD_REMOVED'; gx: number; gy: number; refundCoins: number }
  | { type: 'LEVEL_UP'; level: number; rewardCoins: number }
  | { type: 'TECH_UNLOCKED'; techId: string; name: string }
  | { type: 'STATE_CHANGED' };

export class CoreEngine {
  public state: WorldEngineState;
  public chunks: ChunkManager;

  public readonly roadNet = new RoadNetworkSystem();
  public readonly forestry = new ForestrySystem();
  public readonly buildingSys = new BuildingSystem();
  public readonly populationSys = new PopulationSystem();
  public readonly workforce = new WorkforceSystem();
  public readonly productionSys = new ProductionSystem();
  public readonly progression = new ProgressionSystem();
  public readonly citizens = new CitizenSystem();
  private drivingViaAdvanceFrame = false;

  private listeners = new Set<(ev: EngineEvent) => void>();
  private tickAccumulatorMs = 0;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff) + 1) {
    this.state = CoreEngine.createInitialState(seed);
    this.chunks = new ChunkManager(seed);
    this.state.stats.unlockedTiles = this.chunks.countUnlockedTiles();
  }

  public static createInitialState(seed: number): WorldEngineState {
    const { resources, capacities } = ResourceSystem.createInitialResources();
    const priorities: Record<BuildingCategory, number> = {
      energy: 5,
      agricultural: 5,
      healthcare: 4,
      environmental: 4,
      production: 4,
      industrial: 3,
      commercial: 3,
      educational: 3,
      government: 3,
      transportation: 3,
      storage: 2,
      recreational: 2,
      residential: 1,
    };

    return {
      schemaVersion: SCHEMA_VERSION,
      worldSeed: seed,
      tick: 0,
      speed: 1,
      coins: 500,
      xp: 0,
      level: 1,
      researchPoints: 0,
      activeTechId: null,
      activeTechProgress: 0,
      unlockedTechIds: [],
      completedQuestIds: [],
      trackedQuestId: null,
      unlockedAchievements: [],
      resources,
      capacities,
      netRatesPerMin: {},
      buildings: [],
      nextBuildingId: 1,
      workforcePriorities: priorities,
      taxRate: 1.0,
      marketPrices: EconomySystem.createInitialMarketPrices(),
      marketPrevPrices: {},
      autoTradeRules: {},
      ledger: [],
      season: 'spring',
      dayInSeason: 1,
      year: 1,
      timeOfDayHours: 8.5,
      weather: 'clear',
      nextWeather: 'rain',
      weatherTicksRemaining: 90,
      activePolicies: [],
      festivalTicksRemaining: 0,
      festivalCooldownTicks: 0,
      activeEvent: null,
      population: {
        total: 0,
        capacity: 0,
        happiness: 75,
        classes: { laborer: 0, artisan: 0, engineer: 0 },
        employed: 0,
        unemployed: 0,
        growthAccumulator: 0,
        needs: {
          food: 1,
          water: 1,
          healthcare: 1,
          education: 0,
          safety: 1,
          recreation: 0.5,
        },
      },
      environment: {
        forestCoveragePct: 90,
        avgPollution: 0,
        waterQuality: 100,
        biodiversity: 95,
        sustainability: 92,
      },
      powerGenerated: 0,
      powerDemand: 0,
      waterGenerated: 0,
      waterDemand: 0,
      roadConnectedCount: 0,
      stats: {
        treesCut: 0,
        unlockedTiles: 20,
        buildingsBuilt: 0,
        roadsBuilt: 0,
        maxPopulation: 0,
        totalCoinsEarned: 0,
        tradesCompleted: 0,
        playTimeSeconds: 0,
        ruinsExplored: 0,
        festivalsHeld: 0,
        buildingsMoved: 0,
      },
      camera: { x: 0, y: 64, zoom: 1.15 },
      settings: {
        cityName: 'Kukus Valley',
        difficulty: 'standard',
        masterVolume: 0.7,
        sfxVolume: 0.85,
        ambientVolume: 0.35,
        graphicsMode: 'auto',
        reducedAnimations: false,
        mildDisasters: true,
        haptics: true,
        timeMode: 'normal',
        weatherMode: 'random',
      },
    };
  }

  public subscribe(listener: (ev: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(ev: EngineEvent): void {
    for (const l of this.listeners) l(ev);
  }

  public loadState(savedState: WorldEngineState, persistedChunks: ChunkData[]): void {
    if (typeof savedState.timeOfDayHours !== 'number') {
      savedState.timeOfDayHours = 8.5;
    }
    savedState.activePolicies ??= [];
    savedState.trackedQuestId ??= null;
    savedState.marketPrevPrices ??= {};
    savedState.nextWeather ??= 'rain';
    savedState.festivalTicksRemaining ??= 0;
    savedState.festivalCooldownTicks ??= 0;
    savedState.activeEvent ??= null;
    savedState.stats.ruinsExplored ??= 0;
    savedState.stats.festivalsHeld ??= 0;
    savedState.stats.buildingsMoved ??= 0;
    savedState.stats.tradesCompleted ??= 0;
    this.state = savedState;
    this.chunks = new ChunkManager(savedState.worldSeed);
    this.chunks.setTick(savedState.tick);
    this.chunks.loadPersistedChunks(persistedChunks);
    this.roadNet.markDirty();
    this.roadNet.recomputeIfDirty(this.chunks, this.state);
    ResourceSystem.recalculateCapacities(this.state);
    this.citizens.reset();
    this.emit({ type: 'STATE_CHANGED' });
  }

  public resetNewWorld(cityName = 'Kukus Valley', difficulty: 'standard' | 'relaxed' = 'standard'): void {
    const newSeed = Math.floor(Math.random() * 0x7fffffff) + 1;
    const fresh = CoreEngine.createInitialState(newSeed);
    fresh.settings.cityName = cityName;
    fresh.settings.difficulty = difficulty;
    this.state = fresh;
    this.chunks = new ChunkManager(newSeed);
    this.roadNet.markDirty();
    this.citizens.reset();
    this.tickAccumulatorMs = 0;
    this.emit({ type: 'STATE_CHANGED' });
  }

  public advanceFrame(deltaMs: number): boolean {
    if (this.state.speed === 0) return false;
    const clamped = Math.min(250, Math.max(0, deltaMs));
    const realDtSec = clamped / 1000;

    // Real-time day/night clock or locked time mode
    if (this.state.settings.timeMode === 'always_day') {
      this.state.timeOfDayHours = 12.0;
    } else if (this.state.settings.timeMode === 'always_night') {
      this.state.timeOfDayHours = 22.0;
    } else {
      this.state.timeOfDayHours = (this.state.timeOfDayHours + realDtSec * (24 / 300)) % 24;
    }

    if (this.state.settings.weatherMode === 'always_clear') {
      this.state.weather = 'clear';
    }

    // Smooth 60fps autonomous citizen movement & automated tree/resource collection
    this.citizens.update(realDtSec * this.state.speed, this.state, this.chunks, this.forestry, {
      onChopHit: (gx, gy, outcome) => {
        if (outcome.cleared) {
          this.state.xp += outcome.xpGained;
        }
        this.emit({
          type: 'CHOP_HIT',
          gx,
          gy,
          cleared: outcome.cleared,
          wood: outcome.woodGained,
          coins: outcome.coinsGained,
          xp: outcome.xpGained,
          fromCitizen: true,
        });
      },
      onAutoDelivery: (gx, gy, label, color) => {
        this.emit({ type: 'AUTO_DELIVERY', gx, gy, label, color });
      },
    });

    this.drivingViaAdvanceFrame = true;
    this.tickAccumulatorMs += clamped * this.state.speed;
    let ticked = false;
    let safety = 0;
    while (this.tickAccumulatorMs >= 1000 && safety < 5) {
      this.tickAccumulatorMs -= 1000;
      this.stepSimulationTick();
      ticked = true;
      safety++;
    }
    this.drivingViaAdvanceFrame = false;
    return ticked;
  }

  public stepSimulationTick(): void {
    this.state.tick += 1;
    this.state.stats.playTimeSeconds += 1;
    if (!this.drivingViaAdvanceFrame) {
      if (this.state.settings.timeMode === 'always_day') {
        this.state.timeOfDayHours = 12.0;
      } else if (this.state.settings.timeMode === 'always_night') {
        this.state.timeOfDayHours = 22.0;
      } else {
        this.state.timeOfDayHours = (this.state.timeOfDayHours + 24 / 300) % 24;
      }
      this.citizens.update(1, this.state, this.chunks, this.forestry);
    }
    if (this.state.settings.weatherMode === 'always_clear') {
      this.state.weather = 'clear';
    }
    this.chunks.setTick(this.state.tick);

    if (this.state.festivalTicksRemaining > 0) this.state.festivalTicksRemaining -= 1;
    if (this.state.festivalCooldownTicks > 0) this.state.festivalCooldownTicks -= 1;

    const techMods = TechSystem.getAggregatedModifiers(this.state);
    EnvironmentSystem.tickSeasonAndWeather(this.state);
    const evOut = EnvironmentSystem.tickWorldEvents(this.state);
    if (evOut.startedTitle) {
      this.progression.pushNotification(this.state, 'info', evOut.startedTitle, evOut.startedDesc ?? '');
    }
    const climate = EnvironmentSystem.getClimateModifiers(this.state);

    this.forestry.tickRegrowth(this.chunks, this.state, climate.treeRegrowthMult);

    this.buildingSys.tickConstruction(
      this.state,
      techMods.buildSpeedMult,
      climate.buildSpeedMult,
      (b, xp) => {
        this.state.xp += xp;
        this.emit({
          type: 'BUILDING_COMPLETED',
          buildingId: b.id,
          defId: b.defId,
          gx: b.gx,
          gy: b.gy,
          xp,
        });
      }
    );

    this.roadNet.recomputeIfDirty(this.chunks, this.state);
    this.populationSys.tickPopulation(this.state, climate.waterDemandMult);
    this.workforce.assignWorkers(this.state, techMods.workerNeedReduction);
    this.productionSys.tickProduction(
      this.state,
      this.chunks,
      this.roadNet,
      this.workforce,
      techMods,
      climate
    );

    EnvironmentSystem.tickEnvironment(this.state, this.chunks, techMods.pollutionReduction);
    EconomySystem.tickEconomy(this.state);

    TechSystem.tickResearch(this.state, techMods, (tech) => {
      this.state.xp += tech.xpReward;
      this.progression.pushNotification(
        this.state,
        'milestone',
        `Researched: ${tech.name}`,
        tech.effectSummary
      );
      this.emit({ type: 'TECH_UNLOCKED', techId: tech.id, name: tech.name });
    });

    this.progression.tickProgression(this.state, (newLevel, reward) => {
      this.emit({ type: 'LEVEL_UP', level: newLevel, rewardCoins: reward });
    });

    this.emit({ type: 'STATE_CHANGED' });
  }

  public dispatch(cmd: GameCommand): CommandResult {
    switch (cmd.type) {
      case 'CHOP_TILE': {
        const mods = TechSystem.getAggregatedModifiers(this.state);
        const dmg = (cmd.isManualTap ? 15 : 10) * mods.chopDamageMult;
        const out = this.forestry.chopTile(cmd.gx, cmd.gy, dmg, this.chunks, this.state);
        if (!out.hit) return { ok: false, reason: 'Nothing to harvest on unlocked tile' };
        if (out.cleared) {
          this.state.xp += out.xpGained;
          this.progression.tickProgression(this.state, (lvl, rew) => {
            this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
          });
        }
        this.emit({
          type: 'CHOP_HIT',
          gx: cmd.gx,
          gy: cmd.gy,
          cleared: out.cleared,
          wood: out.woodGained,
          coins: out.coinsGained,
          xp: out.xpGained,
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'REPLANT_TILE': {
        const ok = this.forestry.replantTile(cmd.gx, cmd.gy, this.chunks);
        if (!ok) return { ok: false, reason: 'Cannot plant sapling here' };
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'EXPLORE_RUIN': {
        const res = this.forestry.exploreRuin(cmd.gx, cmd.gy, this.chunks, this.state);
        if (!res.ok) return { ok: false, reason: res.reason };
        this.state.xp += res.xp;
        this.progression.pushNotification(
          this.state,
          'milestone',
          'Ancient Ruin Explored',
          `Recovered +${res.coins}C, +${res.rp} RP, +${res.stone} Stone, +${res.wood} Wood!`
        );
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'RUIN_EXPLORED', gx: cmd.gx, gy: cmd.gy, coins: res.coins, rp: res.rp });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'UNLOCK_TILE': {
        if (!this.chunks.canUnlockTile(cmd.gx, cmd.gy)) {
          return { ok: false, reason: 'Must border an already-unlocked tile' };
        }
        const cost = this.chunks.computeUnlockCost(cmd.gx, cmd.gy);
        if (this.state.coins < cost) {
          return { ok: false, reason: `Needs ${cost} Coins` };
        }
        this.state.coins -= cost;
        this.chunks.unlockTile(cmd.gx, cmd.gy);
        this.state.stats.unlockedTiles += 1;
        this.state.xp += 12;
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'TILE_UNLOCKED', gx: cmd.gx, gy: cmd.gy });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'UNLOCK_BATCH_FRONTIER': {
        let unlockedAny = 0;
        // Two passes so radial cluster unlocks outward cleanly
        for (let pass = 0; pass < 2; pass++) {
          for (let dy = -cmd.radius; dy <= cmd.radius; dy++) {
            for (let dx = -cmd.radius; dx <= cmd.radius; dx++) {
              const tx = cmd.centerGx + dx;
              const ty = cmd.centerGy + dy;
              if (!this.chunks.canUnlockTile(tx, ty)) continue;
              const cost = this.chunks.computeUnlockCost(tx, ty);
              if (this.state.coins < cost) continue;
              this.state.coins -= cost;
              this.chunks.unlockTile(tx, ty);
              this.state.stats.unlockedTiles += 1;
              this.state.xp += 12;
              unlockedAny++;
              this.emit({ type: 'TILE_UNLOCKED', gx: tx, gy: ty });
            }
          }
        }
        if (unlockedAny === 0) return { ok: false, reason: 'No affordable frontier tiles in range' };
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'PLACE_BUILDING': {
        const res = this.buildingSys.placeBuilding(
          cmd.defId,
          cmd.gx,
          cmd.gy,
          this.state,
          this.chunks,
          this.roadNet
        );
        if (!res.ok || !res.building) return { ok: false, reason: res.reason };
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({
          type: 'BUILDING_PLACED',
          buildingId: res.building.id,
          defId: cmd.defId,
          gx: cmd.gx,
          gy: cmd.gy,
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'MOVE_BUILDING': {
        const res = this.buildingSys.moveBuilding(
          cmd.buildingId,
          cmd.gx,
          cmd.gy,
          this.state,
          this.chunks,
          this.roadNet
        );
        if (!res.ok || !res.building) return { ok: false, reason: res.reason };
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({
          type: 'BUILDING_MOVED',
          buildingId: res.building.id,
          defId: res.building.defId,
          gx: cmd.gx,
          gy: cmd.gy,
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'PLACE_ROAD': {
        const res = this.buildingSys.placeRoad(
          cmd.roadType,
          cmd.gx,
          cmd.gy,
          this.state,
          this.chunks,
          this.roadNet
        );
        if (!res.ok) return { ok: false, reason: res.reason };
        this.state.xp += res.xpGained;
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'ROAD_PLACED', gx: cmd.gx, gy: cmd.gy });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'REMOVE_ROAD': {
        const res = this.buildingSys.removeRoad(
          cmd.gx,
          cmd.gy,
          this.state,
          this.chunks,
          this.roadNet
        );
        if (!res.ok) return { ok: false, reason: res.reason };
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'ROAD_REMOVED', gx: cmd.gx, gy: cmd.gy, refundCoins: res.refundCoins });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'UPGRADE_BUILDING': {
        const res = this.buildingSys.upgradeBuilding(cmd.buildingId, this.state);
        if (!res.ok) return { ok: false, reason: res.reason };
        this.state.xp += res.xpGained;
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'RUSH_CONSTRUCTION': {
        const res = this.buildingSys.rushConstruction(cmd.buildingId, this.state);
        if (!res.ok || !res.building) return { ok: false, reason: res.reason };
        this.state.xp += res.xpGained;
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({
          type: 'BUILDING_COMPLETED',
          buildingId: res.building.id,
          defId: res.building.defId,
          gx: res.building.gx,
          gy: res.building.gy,
          xp: res.xpGained,
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'BUY_MISSING_FOR_BUILDING': {
        const req = BuildingSystem.getGlobalBuildRequirements(cmd.defId, this.state);
        if (req.missingMaterials.length === 0) {
          return { ok: false, reason: 'You already have all required materials' };
        }
        const items = req.missingMaterials.map((m) => ({
          resourceId: m.resourceId,
          amount: m.missing,
        }));
        const res = EconomySystem.buyMissingMaterials(
          this.state,
          items,
          cmd.allowEmergency ?? true
        );
        if (!res.ok) return { ok: false, reason: res.reason };
        this.progression.pushNotification(
          this.state,
          'info',
          'Materials Delivered',
          `Purchased missing supplies for ${res.cost} Coins.`
        );
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'CLEAR_AREA_OBSTACLES': {
        let clearedAny = 0;
        for (const t of cmd.tiles) {
          if (!this.chunks.isUnlocked(t.gx, t.gy)) continue;
          const info = this.inspectTile(t.gx, t.gy);
          if (info.featureType === FeatureType.None) continue;
          if (info.featureType === FeatureType.AncientRuin) {
            const ruinRes = this.forestry.exploreRuin(t.gx, t.gy, this.chunks, this.state);
            if (ruinRes.ok) {
              this.state.xp += ruinRes.xp;
              this.emit({ type: 'RUIN_EXPLORED', gx: t.gx, gy: t.gy, coins: ruinRes.coins, rp: ruinRes.rp });
              clearedAny++;
            }
          } else {
            const out = this.forestry.chopTile(t.gx, t.gy, 999, this.chunks, this.state);
            if (out.hit) {
              this.state.xp += out.xpGained;
              this.emit({
                type: 'CHOP_HIT',
                gx: t.gx,
                gy: t.gy,
                cleared: out.cleared,
                wood: out.woodGained,
                coins: out.coinsGained,
                xp: out.xpGained,
              });
              clearedAny++;
            }
          }
        }
        if (clearedAny === 0) return { ok: false, reason: 'No unlocked obstacles on footprint' };
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'DEMOLISH_BUILDING': {
        const ok = this.buildingSys.demolishBuilding(cmd.buildingId, this.state, this.chunks);
        if (!ok) return { ok: false, reason: 'Cannot demolish' };
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'TOGGLE_BUILDING': {
        const b = this.state.buildings.find((item) => item.id === cmd.buildingId);
        if (!b) return { ok: false };
        b.enabled = !b.enabled;
        if (b.status !== 'constructing') {
          b.status = b.enabled ? 'active' : 'disabled';
        }
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'RESUME_ALL_BUILDINGS': {
        let resumed = 0;
        for (const b of this.state.buildings) {
          if (!b.enabled) {
            b.enabled = true;
            if (b.status === 'disabled') b.status = 'active';
            resumed++;
          }
        }
        if (resumed === 0) return { ok: false, reason: 'No paused buildings' };
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'SET_BUILDING_WORKERS': {
        const b = this.state.buildings.find((item) => item.id === cmd.buildingId);
        if (!b) return { ok: false };
        const def = BUILDINGS[b.defId];
        if (!def) return { ok: false };
        b.lockedWorkers =
          cmd.lockedWorkers === null
            ? null
            : Math.max(0, Math.min(def.maxWorkers, cmd.lockedWorkers));
        this.workforce.assignWorkers(this.state);
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'SET_WORKFORCE_PRIORITY': {
        this.state.workforcePriorities[cmd.category] = Math.max(1, Math.min(5, cmd.priority));
        this.workforce.assignWorkers(this.state);
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'SET_TAX_RATE': {
        this.state.taxRate = Math.max(0.5, Math.min(2.0, cmd.rate));
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'TOGGLE_POLICY': {
        const pDef = POLICY_MAP[cmd.policyId];
        if (!pDef) return { ok: false, reason: 'Unknown policy' };
        if (this.state.level < pDef.unlockLevel) {
          return { ok: false, reason: `Requires Level ${pDef.unlockLevel}` };
        }
        this.state.activePolicies ??= [];
        const idx = this.state.activePolicies.indexOf(cmd.policyId);
        if (idx >= 0) {
          this.state.activePolicies.splice(idx, 1);
        } else {
          this.state.activePolicies.push(cmd.policyId);
        }
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'START_FESTIVAL': {
        if ((this.state.festivalTicksRemaining ?? 0) > 0) {
          return { ok: false, reason: 'Festival already underway' };
        }
        if ((this.state.festivalCooldownTicks ?? 0) > 0) {
          return { ok: false, reason: `Cooldown: ${this.state.festivalCooldownTicks}s remaining` };
        }
        const baseCost = 120 + this.state.population.total * 3;
        const hasPlaza = this.state.buildings.some(
          (b) => b.defId === 'festival_plaza' && b.status !== 'constructing'
        );
        const cost = hasPlaza ? Math.round(baseCost * 0.5) : baseCost;
        if (this.state.coins < cost) {
          return { ok: false, reason: `Needs ${cost} Coins to host Festival` };
        }
        this.state.coins -= cost;
        this.state.festivalTicksRemaining = 60;
        this.state.festivalCooldownTicks = 120;
        this.state.stats.festivalsHeld += 1;
        this.state.xp += 35;
        this.progression.pushNotification(
          this.state,
          'milestone',
          'City Festival Launched',
          '+15..22 Happiness, +50% Tax revenue, and +35% growth for 60s!'
        );
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'FESTIVAL_STARTED' });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'BUY_RESOURCE': {
        const res = EconomySystem.buyResource(this.state, cmd.resourceId, cmd.amount);
        if (res.ok) {
          this.progression.tickProgression(this.state, (lvl, rew) => {
            this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
          });
        }
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: res.ok, reason: res.reason };
      }

      case 'SELL_RESOURCE': {
        const res = EconomySystem.sellResource(this.state, cmd.resourceId, cmd.amount);
        if (res.ok) {
          this.progression.tickProgression(this.state, (lvl, rew) => {
            this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
          });
        }
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: res.ok, reason: res.reason };
      }

      case 'SELL_ALL_EXCESS': {
        const res = EconomySystem.sellAllExcess(this.state, cmd.keepAmount);
        if (res.ok) {
          this.progression.pushNotification(
            this.state,
            'info',
            'Bulk Export Complete',
            `Sold ${res.itemsSold} surplus goods for +${res.totalEarned} Coins.`
          );
          this.progression.tickProgression(this.state, (lvl, rew) => {
            this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
          });
        }
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: res.ok, reason: res.reason };
      }

      case 'SET_AUTO_TRADE': {
        this.state.autoTradeRules[cmd.rule.resourceId] = cmd.rule;
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'START_TECH': {
        const res = TechSystem.startTech(this.state, cmd.techId);
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'STATE_CHANGED' });
        return res;
      }

      case 'SET_SPEED': {
        this.state.speed = cmd.speed;
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'SET_TIME_OF_DAY': {
        if (!Number.isFinite(cmd.hours)) return { ok: false, reason: 'Invalid hour' };
        this.state.timeOfDayHours = ((cmd.hours % 24) + 24) % 24;
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'UPDATE_SETTINGS': {
        this.state.settings = { ...this.state.settings, ...cmd.partial };
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'SET_CAMERA': {
        this.state.camera = { x: cmd.x, y: cmd.y, zoom: cmd.zoom };
        return { ok: true };
      }

      case 'SET_TRACKED_QUEST': {
        this.state.trackedQuestId = cmd.questId;
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }

      case 'TERRAFORM_TILE': {
        const cost = 75;
        if (this.state.coins < cost) {
          return { ok: false, reason: `Needs ${cost} Coins to terraform` };
        }
        const ok = this.chunks.terraformTile(cmd.gx, cmd.gy, cmd.action);
        if (!ok) return { ok: false, reason: 'Cannot terraform here (unlocked tile without building required)' };
        this.state.coins -= cost;
        this.state.xp += 15;
        this.progression.tickProgression(this.state, (lvl, rew) => {
          this.emit({ type: 'LEVEL_UP', level: lvl, rewardCoins: rew });
        });
        this.emit({ type: 'STATE_CHANGED' });
        return { ok: true };
      }
    }
  }

  public inspectTile(gx: number, gy: number): TileInspection {
    const { cx, cy, index } = gridToChunk(gx, gy);
    const chunk = this.chunks.getOrCreateChunk(cx, cy);
    const biomeId = chunk.biomeId[index] as BiomeId;
    const unlocked = (chunk.flags[index] & TileFlag.Unlocked) !== 0;
    const featureType = chunk.featureType[index] as FeatureType;
    const species = TREE_SPECIES[featureType];
    const bRef = chunk.buildingRef[index];
    const building = bRef >= 0 ? this.state.buildings.find((b) => b.id === bRef) ?? null : null;

    return {
      gx,
      gy,
      biomeId,
      biomeName: BIOME_NAMES[biomeId] ?? 'Wilderness',
      elevation: chunk.elevation[index],
      moisture: chunk.moisture[index],
      unlocked,
      canUnlock: !unlocked && this.chunks.isAdjacentToUnlocked(gx, gy),
      unlockCost: this.chunks.computeUnlockCost(gx, gy),
      featureType,
      featureHp: chunk.featureHp[index],
      featureMaxHp: species?.maxHp ?? 0,
      depositType: chunk.depositType[index],
      depositQty: chunk.depositQty[index],
      roadType: chunk.roadType[index],
      building,
      pollution: chunk.pollution[index],
    };
  }
}
