import { BUILDINGS, WorkerClass } from '../data/buildings.data';
import { FeatureType } from '../data/trees.data';
import type { ChunkManager } from '../core/ChunkManager';
import { BuildingInstance, TileFlag, WorldEngineState } from '../core/GameState';
import { CHUNK_SIZE, chunkToGrid, gridToChunk } from '../core/IsoMath';
import type { ChopOutcome, ForestrySystem } from './ForestrySystem';
import { ResourceSystem } from './ResourceSystem';
import { ROADS, RoadType } from '../data/roads.data';

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
      this.syncAgentsToPopulation(targetCount, state);
    }

    if (this.agents.length === 0) return;

    const isNight = state.timeOfDayHours >= 20 || state.timeOfDayHours < 5.5;

    for (const agent of this.agents) {
      this.stepAgent(agent, dtSec, isNight, state, chunks, forestry, events);
    }
  }

  private syncAgentsToPopulation(targetCount: number, state: WorldEngineState): void {
    const homes = state.buildings.filter(
      (b) => b.status !== 'constructing' && BUILDINGS[b.defId]?.category === 'residential'
    );
    const workplaces = state.buildings.filter(
      (b) => b.status !== 'constructing' && b.enabled && b.assignedWorkers > 0
    );

    // Spawn missing citizens near a home or town clearing
    while (this.agents.length < targetCount) {
      const home = homes.length > 0 ? homes[this.agents.length % homes.length] : null;
      const startGx = home ? home.gx + 0.5 : 2 + ((this.agents.length * 0.7) % 2);
      const startGy = home ? home.gy + 0.5 : 1 + ((this.agents.length * 0.5) % 2);
      const id = this.nextAgentId++;
      this.agents.push({
        id,
        role: 'laborer',
        homeBuildingId: home?.id ?? null,
        workBuildingId: null,
        gx: startGx,
        gy: startGy,
        targetGx: startGx,
        targetGy: startGy,
        task: 'idle_stroll',
        carrying: 'none',
        taskTimer: 0.2 + (id % 5) * 0.15,
        stridePhase: id * 1.1,
        facing: 1,
        targetTileGx: Math.round(startGx),
        targetTileGy: Math.round(startGy),
      });
    }

    if (this.agents.length > targetCount) {
      this.agents.length = targetCount;
    }

    // Rebalance roles & workplaces proportionally
    const total = Math.max(1, state.population.total);
    const artShare = state.population.classes.artisan / total;
    const engShare = state.population.classes.engineer / total;

    // Build flat workplace slot list
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

  private stepAgent(
    agent: CitizenAgent,
    dtSec: number,
    isNight: boolean,
    state: WorldEngineState,
    chunks: ChunkManager,
    forestry: ForestrySystem,
    events?: CitizenWorkEvents
  ): void {
    const dx = agent.targetGx - agent.gx;
    const dy = agent.targetGy - agent.gy;
    const dist = Math.hypot(dx, dy);

    if (dist > 0.08) {
      // Check tile speed boost from road beneath current grid pos
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

    // Arrived at target
    agent.gx = agent.targetGx;
    agent.gy = agent.targetGy;

    if (agent.task === 'chopping') {
      agent.taskTimer -= dtSec;
      agent.stridePhase += dtSec * 12;
      if (agent.taskTimer > 0) return;

      // Perform real chop hit on tree!
      const outcome = forestry.chopTile(agent.targetTileGx, agent.targetTileGy, 18, chunks, state);
      if (outcome.hit) {
        events?.onChopHit(agent.targetTileGx, agent.targetTileGy, outcome);
        if (outcome.cleared) {
          agent.carrying = outcome.bonusName === 'berries' ? 'food' : 'wood';
          this.sendToDeposit(agent, state);
        } else {
          // Keep chopping same tree
          agent.taskTimer = 1.1;
        }
      } else {
        // Tree already gone; pick next job
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

      // Pick up produced haul & deliver to nearest storage / house / market
      const workB = this.findBuilding(state, agent.workBuildingId);
      const def = workB ? BUILDINGS[workB.defId] : null;
      if (def) {
        if (def.category === 'agricultural') agent.carrying = 'food';
        else if (
          def.id === 'stone_quarry' ||
          def.id === 'gold_mine' ||
          def.id === 'marble_quarry' ||
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
      this.sendToDeposit(agent, state);
      return;
    }

    if (agent.task === 'carrying_home') {
      // Deliver cargo for tangible automated haul bonus!
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

    // idle_stroll cooldown
    agent.taskTimer -= dtSec;
    if (agent.taskTimer <= 0) {
      this.pickNextTask(agent, isNight, state, chunks);
    }
  }

  private sendToDeposit(agent: CitizenAgent, state: WorldEngineState): void {
    const dropoff =
      state.buildings.find(
        (b) =>
          b.status !== 'constructing' &&
          (BUILDINGS[b.defId]?.category === 'storage' ||
            b.defId === 'market_stall' ||
            b.defId === 'town_hall')
      ) ?? this.findBuilding(state, agent.homeBuildingId);

    agent.task = 'carrying_home';
    if (dropoff) {
      const def = BUILDINGS[dropoff.defId];
      agent.targetGx = dropoff.gx + (def ? def.width * 0.5 : 0.4);
      agent.targetGy = dropoff.gy + (def ? def.height * 0.5 : 0.4);
    } else {
      agent.targetGx = 2;
      agent.targetGy = 1.5;
    }
  }

  private pickNextTask(
    agent: CitizenAgent,
    isNight: boolean,
    state: WorldEngineState,
    chunks: ChunkManager
  ): void {
    const workB = this.findBuilding(state, agent.workBuildingId);
    const workDef = workB ? BUILDINGS[workB.defId] : null;

    // 1. Woodcutters, Gatherers, Foresters & idle Laborers harvest unlocked trees automatically
    const isHarvester =
      !workB ||
      workB.defId === 'woodcutter_camp' ||
      workB.defId === 'gatherer_hut' ||
      workB.defId === 'forester_hut';

    if (isHarvester && (!isNight || workB !== null)) {
      const treeTile = this.findNearestUnlockedTree(agent.gx, agent.gy, chunks);
      if (treeTile) {
        agent.task = 'walk_to_tree';
        agent.targetTileGx = treeTile.gx;
        agent.targetTileGy = treeTile.gy;
        agent.targetGx = treeTile.gx + 0.15;
        agent.targetGy = treeTile.gy + 0.15;
        return;
      }
    }

    // 2. Workers with an active building commute there and produce/haul goods
    if (workB && workDef && (!isNight || agent.id % 3 === 0)) {
      agent.task = 'walk_to_work';
      agent.targetGx = workB.gx + workDef.width * 0.5;
      agent.targetGy = workB.gy + workDef.height * 0.5;
      return;
    }

    // 3. Stroll near roads / unlocked settlement clearing (or return home at night)
    const home = this.findBuilding(state, agent.homeBuildingId);
    if (isNight && home) {
      agent.task = 'idle_stroll';
      agent.targetGx = home.gx + 0.3;
      agent.targetGy = home.gy + 0.3;
      agent.taskTimer = 2.5;
      return;
    }

    const strollTile = this.findRandomUnlockedWalkTile(agent, chunks);
    agent.task = 'idle_stroll';
    agent.targetGx = strollTile.gx;
    agent.targetGy = strollTile.gy;
    agent.taskTimer = 1.2 + ((agent.id * 17) % 10) * 0.15;
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
        if (ft === FeatureType.None || ft === FeatureType.Sapling || ft === FeatureType.AncientRuin) continue;
        const { gx, gy } = chunkToGrid(chunk.cx, chunk.cy, i % CHUNK_SIZE, Math.floor(i / CHUNK_SIZE));
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
  ): { gx: number; gy: number } {
    const b = chunks.getUnlockedGridBounds();
    for (let tries = 0; tries < 6; tries++) {
      const h1 = Math.abs(Math.sin(agent.id * 12.9898 + tries * 78.233 + agent.stridePhase));
      const h2 = Math.abs(Math.cos(agent.id * 45.164 + tries * 19.17 + agent.stridePhase));
      const gx = b.minGx + Math.floor((h1 % 1) * (b.maxGx - b.minGx + 1));
      const gy = b.minGy + Math.floor((h2 % 1) * (b.maxGy - b.minGy + 1));
      const t = chunks.getTile(gx, gy);
      const { index, chunk } = t;
      if ((chunk.flags[index] & TileFlag.Unlocked) !== 0 && !chunks.isWaterBiome(chunk.biomeId[index])) {
        return { gx: gx + ((h1 % 0.6) - 0.3), gy: gy + ((h2 % 0.6) - 0.3) };
      }
    }
    const fallback = gridToChunk(2, 1);
    void fallback;
    return { gx: 2, gy: 1.5 };
  }

  private findBuilding(state: WorldEngineState, id: number | null): BuildingInstance | undefined {
    if (id === null) return undefined;
    return state.buildings.find((b) => b.id === id);
  }
}
