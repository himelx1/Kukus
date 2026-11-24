import { BUILDINGS, WorkerClass } from '../data/buildings.data';
import { FeatureType, isTreeFeature } from '../data/trees.data';
import type { ChunkManager } from '../core/ChunkManager';
import { BuildingInstance, TileFlag, WorldEngineState } from '../core/GameState';
import { CHUNK_SIZE, chunkToGrid } from '../core/IsoMath';
import type { ChopOutcome, ForestrySystem } from './ForestrySystem';
import { ResourceSystem } from './ResourceSystem';
import { ROADS, RoadType } from '../data/roads.data';
import { GridPoint, PathfindingSystem, TransportMode } from './PathfindingSystem';

export type CitizenTask =
  | 'idle_stroll'
  | 'walk_to_tree'
  | 'chopping'
  | 'walk_to_work'
  | 'working'
  | 'carrying_home';

export type CargoKind = 'none' | 'wood' | 'food' | 'stone' | 'goods';

export interface CitizenAgent {
  id: number;
  role: WorkerClass;
  homeBuildingId: number | null;
  workBuildingId: number | null;
  gx: number;
  gy: number;
  targetGx: number;
  targetGy: number;
  goalGx: number;
  goalGy: number;
  path: GridPoint[];
  pathMode: TransportMode;
  task: CitizenTask;
  carrying: CargoKind;
  taskTimer: number;
  stridePhase: number;
  facing: 1 | -1;
  targetTileGx: number;
  targetTileGy: number;
}

export interface CitizenWorkEvents {
  onChopHit: (gx: number, gy: number, outcome: ChopOutcome) => void;
  onAutoDelivery: (gx: number, gy: number, label: string, color: string) => void;
}

const MAX_VISIBLE_CITIZENS = 48;

export class CitizenSystem {
  public readonly agents: CitizenAgent[] = [];
  private nextAgentId = 1;
  private syncTimer = 0;

  public reset(): void {
    this.agents.length = 0;
    this.nextAgentId = 1;
    this.syncTimer = 0;
  }

  public update(
    dtSec: number,
    state: WorldEngineState,
    chunks: ChunkManager,
    forestry: ForestrySystem,
    events?: CitizenWorkEvents
  ): void {
    this.syncTimer += dtSec;
    const targetCount = Math.min(MAX_VISIBLE_CITIZENS, Math.max(0, state.population.total));

    if (this.agents.length !== targetCount || this.syncTimer >= 1.5) {
      this.syncTimer = 0;
      this.syncAgentsToPopulation(targetCount, state, chunks);
    }

    if (this.agents.length === 0) return;

    const isNight = state.timeOfDayHours >= 20 || state.timeOfDayHours < 5.5;

    for (const agent of this.agents) {
      this.stepAgent(agent, dtSec, isNight, state, chunks, forestry, events);
    }
  }

  private findSafeSpawnTile(home: BuildingInstance | null, idx: number, chunks: ChunkManager): GridPoint {
    if (home) {
      const ent = PathfindingSystem.findBuildingEntrance(home, chunks, 'citizen');
      if (ent) return ent;
    }
    const b = chunks.getUnlockedGridBounds();
    for (let gy = b.minGy; gy <= b.maxGy; gy++) {
      for (let gx = b.minGx; gx <= b.maxGx; gx++) {
        if (PathfindingSystem.isTilePassable(gx + (idx % 2), gy, chunks, 'citizen')) {
          return { gx: gx + (idx % 2), gy };
        }
        if (PathfindingSystem.isTilePassable(gx, gy, chunks, 'citizen')) {
          return { gx, gy };
        }
      }
    }
    return { gx: 2, gy: 1 };
  }

  private syncAgentsToPopulation(targetCount: number, state: WorldEngineState, chunks: ChunkManager): void {
    const homes = state.buildings.filter(
      (b) => b.status !== 'constructing' && BUILDINGS[b.defId]?.category === 'residential'
    );
    const workplaces = state.buildings.filter(
      (b) => b.status !== 'constructing' && b.enabled && b.assignedWorkers > 0
    );

    // Spawn missing citizens at safe building entrances or dry passable tiles
    while (this.agents.length < targetCount) {
      const home = homes.length > 0 ? homes[this.agents.length % homes.length] : null;
      const spawn = this.findSafeSpawnTile(home, this.agents.length, chunks);
      const id = this.nextAgentId++;
      this.agents.push({
        id,
        role: 'laborer',
        homeBuildingId: home?.id ?? null,
        workBuildingId: null,
        gx: spawn.gx,
        gy: spawn.gy,
        targetGx: spawn.gx,
        targetGy: spawn.gy,
        goalGx: spawn.gx,
        goalGy: spawn.gy,
        path: [],
        pathMode: 'citizen',
        task: 'idle_stroll',
        carrying: 'none',
        taskTimer: 0.2 + (id % 5) * 0.15,
        stridePhase: id * 1.1,
        facing: 1,
        targetTileGx: spawn.gx,
        targetTileGy: spawn.gy,
      });
    }

    if (this.agents.length > targetCount) {
      this.agents.length = targetCount;
    }

    // Rebalance roles & workplaces proportionally
    const total = Math.max(1, state.population.total);
    const artShare = state.population.classes.artisan / total;
    const engShare = state.population.classes.engineer / total;

    const workSlots: number[] = [];
    for (const wb of workplaces) {
      for (let k = 0; k < wb.assignedWorkers; k++) {
        workSlots.push(wb.id);
      }
    }

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const frac = i / Math.max(1, this.agents.length);
      if (frac < engShare) a.role = 'engineer';
      else if (frac < engShare + artShare) a.role = 'artisan';
      else a.role = 'laborer';

      if (homes.length > 0 && (!a.homeBuildingId || !homes.some((h) => h.id === a.homeBuildingId))) {
        a.homeBuildingId = homes[i % homes.length].id;
      }
      a.workBuildingId = i < workSlots.length ? workSlots[i] : null;
    }
  }

  private assignPathTo(
    agent: CitizenAgent,
    goalGx: number,
    goalGy: number,
    chunks: ChunkManager
  ): boolean {
    const startX = Math.round(agent.gx);
    const startY = Math.round(agent.gy);

    // If citizen is somehow standing on a newly blocked tile, nudge to nearest passable neighbor
    if (!PathfindingSystem.isTilePassable(startX, startY, chunks, agent.pathMode)) {
      const safe = this.findSafeSpawnTile(null, agent.id, chunks);
      agent.gx = safe.gx;
      agent.gy = safe.gy;
    }

    const path = PathfindingSystem.findPath(
      Math.round(agent.gx),
      Math.round(agent.gy),
      Math.round(goalGx),
      Math.round(goalGy),
      chunks,
      agent.pathMode
    );
    if (!path || path.length === 0) return false;
    agent.goalGx = Math.round(goalGx);
    agent.goalGy = Math.round(goalGy);
    agent.path = path;
    agent.targetGx = path[0].gx;
    agent.targetGy = path[0].gy;
    return true;
  }

  private stepAgent(
    agent: CitizenAgent,
    dtSec: number,
    isNight: boolean,
    state: WorldEngineState,
    chunks: ChunkManager,
    forestry: ForestrySystem,
    events?: CitizenWorkEvents
  ): void {
    // Follow A* waypoints while strictly validating tile passability before stepping
    if (agent.path.length > 0) {
      const wp = agent.path[0];
      if (!PathfindingSystem.isTilePassable(wp.gx, wp.gy, chunks, agent.pathMode)) {
        // Obstacle appeared on active route -> reroute immediately around it
        const rerouted = this.assignPathTo(agent, agent.goalGx, agent.goalGy, chunks);
        if (!rerouted) {
          agent.path = [];
          agent.task = 'idle_stroll';
          agent.taskTimer = 0.6;
          this.pickNextTask(agent, isNight, state, chunks);
        }
        return;
      }
      agent.targetGx = wp.gx;
      agent.targetGy = wp.gy;
    }

    const dx = agent.targetGx - agent.gx;
    const dy = agent.targetGy - agent.gy;
    const dist = Math.hypot(dx, dy);

    if (dist > 0.08) {
      const curTile = chunks.getTile(Math.round(agent.gx), Math.round(agent.gy));
      const road = curTile.chunk.roadType[curTile.index] as RoadType;
      const roadBoost = road !== RoadType.None ? Math.min(1.85, ROADS[road]?.speedMultiplier ?? 1.1) : 1.0;
      const baseSpeed = agent.carrying !== 'none' ? 1.25 : 1.55;
      const step = Math.min(dist, baseSpeed * roadBoost * dtSec);
      const vx = (dx / dist) * step;
      const vy = (dy / dist) * step;
      agent.gx += vx;
      agent.gy += vy;
      agent.facing = vx - vy >= 0 ? 1 : -1;
      agent.stridePhase += dtSec * 10 * roadBoost;
      return;
    }

    // Reached current waypoint
    agent.gx = agent.targetGx;
    agent.gy = agent.targetGy;
    if (agent.path.length > 0) {
      agent.path.shift();
      if (agent.path.length > 0) {
        agent.targetGx = agent.path[0].gx;
        agent.targetGy = agent.path[0].gy;
        return;
      }
    }

    if (agent.task === 'chopping') {
      agent.taskTimer -= dtSec;
      agent.stridePhase += dtSec * 12;
      if (agent.taskTimer > 0) return;

      const outcome = forestry.chopTile(agent.targetTileGx, agent.targetTileGy, 18, chunks, state);
      if (outcome.hit) {
        events?.onChopHit(agent.targetTileGx, agent.targetTileGy, outcome);
        if (outcome.cleared) {
          agent.carrying = outcome.bonusName === 'berries' ? 'food' : 'wood';
          this.sendToDeposit(agent, state, chunks, isNight);
        } else {
          agent.taskTimer = 1.1;
        }
      } else {
        this.pickNextTask(agent, isNight, state, chunks);
      }
      return;
    }

    if (agent.task === 'walk_to_tree') {
      const tile = chunks.getTile(agent.targetTileGx, agent.targetTileGy);
      const ft = tile.chunk.featureType[tile.index] as FeatureType;
      if (ft !== FeatureType.None && ft !== FeatureType.Sapling) {
        agent.task = 'chopping';
        agent.taskTimer = 1.0;
      } else {
        this.pickNextTask(agent, isNight, state, chunks);
      }
      return;
    }

    if (agent.task === 'walk_to_work') {
      agent.task = 'working';
      agent.taskTimer = 2.6;
      return;
    }

    if (agent.task === 'working') {
      agent.taskTimer -= dtSec;
      agent.stridePhase += dtSec * 8;
      if (agent.taskTimer > 0) return;

      const workB = this.findBuilding(state, agent.workBuildingId);
      const def = workB ? BUILDINGS[workB.defId] : null;
      if (def) {
        if (def.category === 'agricultural') agent.carrying = 'food';
        else if (
          def.id === 'stone_quarry' ||
          def.id === 'gold_mine' ||
          def.id === 'silver_mine' ||
          def.id === 'coal_mine' ||
          def.category === 'industrial'
        ) {
          agent.carrying = 'stone';
        } else if (
          def.id === 'woodcutter_camp' ||
          def.id === 'lumber_mill' ||
          def.id === 'bamboo_grove' ||
          def.id === 'rubber_tapper'
        ) {
          agent.carrying = 'wood';
        } else {
          agent.carrying = 'goods';
        }
      }
      this.sendToDeposit(agent, state, chunks, isNight);
      return;
    }

    if (agent.task === 'carrying_home') {
      if (agent.carrying === 'wood') {
        const added = ResourceSystem.addClamped(state, 'wood', 1);
        if (added > 0) events?.onAutoDelivery(agent.gx, agent.gy, '+1 Wood', '#bef264');
      } else if (agent.carrying === 'food') {
        const added = ResourceSystem.addClamped(state, 'berries', 1);
        if (added > 0) events?.onAutoDelivery(agent.gx, agent.gy, '+1 Berries', '#fdba74');
      } else if (agent.carrying === 'stone') {
        const added = ResourceSystem.addClamped(state, 'stone', 1);
        if (added > 0) events?.onAutoDelivery(agent.gx, agent.gy, '+1 Stone', '#cbd5e1');
      } else if (agent.carrying === 'goods') {
        state.coins += 2;
        state.stats.totalCoinsEarned += 2;
        events?.onAutoDelivery(agent.gx, agent.gy, '+2C', '#fde047');
      }
      agent.carrying = 'none';
      this.pickNextTask(agent, isNight, state, chunks);
      return;
    }

    agent.taskTimer -= dtSec;
    if (agent.taskTimer <= 0) {
      this.pickNextTask(agent, isNight, state, chunks);
    }
  }

  private sendToDeposit(
    agent: CitizenAgent,
    state: WorldEngineState,
    chunks: ChunkManager,
    isNight: boolean
  ): void {
    const dropoff =
      state.buildings.find(
        (b) =>
          b.status !== 'constructing' &&
          (BUILDINGS[b.defId]?.category === 'storage' ||
            b.defId === 'market_stall' ||
            b.defId === 'main_town_hall' ||
            b.defId === 'sub_town_hall')
      ) ?? this.findBuilding(state, agent.homeBuildingId);

    const entrance = dropoff ? PathfindingSystem.findBuildingEntrance(dropoff, chunks, 'citizen') : null;
    if (entrance && this.assignPathTo(agent, entrance.gx, entrance.gy, chunks)) {
      agent.task = 'carrying_home';
      return;
    }
    agent.carrying = 'none';
    this.pickNextTask(agent, isNight, state, chunks);
  }

  private pickNextTask(
    agent: CitizenAgent,
    isNight: boolean,
    state: WorldEngineState,
    chunks: ChunkManager
  ): void {
    const workB = this.findBuilding(state, agent.workBuildingId);
    const workDef = workB ? BUILDINGS[workB.defId] : null;

    // 1. Woodcutters, Gatherers, Foresters & idle Laborers harvest unlocked passable trees
    const isHarvester =
      !workB ||
      workB.defId === 'woodcutter_camp' ||
      workB.defId === 'gatherer_hut' ||
      workB.defId === 'forester_hut';

    if (isHarvester && (!isNight || workB !== null)) {
      const treeTile = this.findNearestUnlockedTree(agent.gx, agent.gy, chunks);
      if (treeTile && this.assignPathTo(agent, treeTile.gx, treeTile.gy, chunks)) {
        agent.task = 'walk_to_tree';
        agent.targetTileGx = treeTile.gx;
        agent.targetTileGy = treeTile.gy;
        return;
      }
    }

    // 2. Workers commute to workplace entrance via roads & bridges
    if (workB && workDef && (!isNight || agent.id % 3 === 0)) {
      const workEnt = PathfindingSystem.findBuildingEntrance(workB, chunks, 'citizen');
      if (workEnt && this.assignPathTo(agent, workEnt.gx, workEnt.gy, chunks)) {
        agent.task = 'walk_to_work';
        return;
      }
    }

    // 3. Return to home entrance at night if reachable
    const home = this.findBuilding(state, agent.homeBuildingId);
    if (isNight && home) {
      const homeEnt = PathfindingSystem.findBuildingEntrance(home, chunks, 'citizen');
      if (homeEnt && this.assignPathTo(agent, homeEnt.gx, homeEnt.gy, chunks)) {
        agent.task = 'idle_stroll';
        agent.taskTimer = 2.5;
        return;
      }
    }

    // 4. Stroll strictly on passable road/dry tiles
    const strollTile = this.findRandomUnlockedWalkTile(agent, chunks);
    if (strollTile && this.assignPathTo(agent, strollTile.gx, strollTile.gy, chunks)) {
      agent.task = 'idle_stroll';
      agent.taskTimer = 1.2 + ((agent.id * 17) % 10) * 0.15;
      return;
    }

    agent.task = 'idle_stroll';
    agent.taskTimer = 1.4;
  }

  private findNearestUnlockedTree(
    fromGx: number,
    fromGy: number,
    chunks: ChunkManager
  ): { gx: number; gy: number } | null {
    let best: { gx: number; gy: number } | null = null;
    let bestDist = Infinity;

    for (const chunk of chunks.getAllLoadedChunks()) {
      if (!chunk.isModified) continue;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        if ((chunk.flags[i] & TileFlag.Unlocked) === 0) continue;
        const ft = chunk.featureType[i] as FeatureType;
        if (!isTreeFeature(ft) && ft !== FeatureType.StoneOutcrop) continue;
        const { gx, gy } = chunkToGrid(chunk.cx, chunk.cy, i % CHUNK_SIZE, Math.floor(i / CHUNK_SIZE));
        if (!PathfindingSystem.isTilePassable(gx, gy, chunks, 'citizen')) continue;
        const d = Math.hypot(gx - fromGx, gy - fromGy);
        if (d < bestDist) {
          bestDist = d;
          best = { gx, gy };
        }
      }
    }
    return best;
  }

  private findRandomUnlockedWalkTile(
    agent: CitizenAgent,
    chunks: ChunkManager
  ): GridPoint | null {
    const b = chunks.getUnlockedGridBounds();
    for (let tries = 0; tries < 10; tries++) {
      const h1 = Math.abs(Math.sin(agent.id * 12.9898 + tries * 78.233 + agent.stridePhase));
      const h2 = Math.abs(Math.cos(agent.id * 45.164 + tries * 19.17 + agent.stridePhase));
      const gx = b.minGx + Math.floor((h1 % 1) * (b.maxGx - b.minGx + 1));
      const gy = b.minGy + Math.floor((h2 % 1) * (b.maxGy - b.minGy + 1));
      if (PathfindingSystem.isTilePassable(gx, gy, chunks, 'citizen')) {
        return { gx, gy };
      }
    }
    return null;
  }

  private findBuilding(state: WorldEngineState, id: number | null): BuildingInstance | undefined {
    if (id === null) return undefined;
    return state.buildings.find((b) => b.id === id);
  }
}
