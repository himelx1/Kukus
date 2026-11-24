import { BUILDINGS } from '../data/buildings.data';
import { ROADS, RoadType } from '../data/roads.data';
import type { ChunkManager } from '../core/ChunkManager';
import type { BuildingInstance, WorldEngineState } from '../core/GameState';
import { CHUNK_SIZE } from '../core/IsoMath';

export class RoadNetworkSystem {
  private roadClusterMap = new Map<string, number>();
  private roadDirty = true;

  public markDirty(): void {
    this.roadDirty = true;
  }

  public recomputeIfDirty(chunks: ChunkManager, state: WorldEngineState): void {
    if (!this.roadDirty) return;
    this.roadDirty = false;
    this.roadClusterMap.clear();

    const roadTiles: Array<{ gx: number; gy: number; type: RoadType }> = [];
    for (const chunk of chunks.getAllLoadedChunks()) {
      if (!chunk.isModified) continue;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const idx = ly * CHUNK_SIZE + lx;
          const rt = chunk.roadType[idx] as RoadType;
          if (rt !== RoadType.None) {
            roadTiles.push({
              gx: chunk.cx * CHUNK_SIZE + lx,
              gy: chunk.cy * CHUNK_SIZE + ly,
              type: rt,
            });
          }
        }
      }
    }

    state.roadConnectedCount = roadTiles.length;
    const tileSet = new Map<string, RoadType>();
    for (const t of roadTiles) {
      tileSet.set(`${t.gx}:${t.gy}`, t.type);
    }

    let nextCluster = 1;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

    for (const start of roadTiles) {
      const startKey = `${start.gx}:${start.gy}`;
      if (this.roadClusterMap.has(startKey)) continue;
      const clusterId = nextCluster++;
      const queue: Array<[number, number]> = [[start.gx, start.gy]];
      this.roadClusterMap.set(startKey, clusterId);

      while (queue.length > 0) {
        const [x, y] = queue.pop()!;
        for (const [dx, dy] of dirs) {
          const nk = `${x + dx}:${y + dy}`;
          if (tileSet.has(nk) && !this.roadClusterMap.has(nk)) {
            this.roadClusterMap.set(nk, clusterId);
            queue.push([x + dx, y + dy]);
          }
        }
      }
    }

    // Update each building's adjacent road connectivity and highest adjacent road tier
    for (const b of state.buildings) {
      this.evaluateBuildingRoadAccess(b, chunks);
    }
  }

  public evaluateBuildingRoadAccess(b: BuildingInstance, chunks: ChunkManager): {
    connectedCluster: number;
    bestRoadTier: number;
  } {
    const def = BUILDINGS[b.defId];
    if (!def) return { connectedCluster: 0, bestRoadTier: 0 };

    let bestCluster = 0;
    let bestTier = 0;

    for (let dx = -1; dx <= def.width; dx++) {
      for (let dy = -1; dy <= def.height; dy++) {
        const isEdge =
          (dx === -1 || dx === def.width) !== (dy === -1 || dy === def.height) ||
          (dx >= 0 && dx < def.width && (dy === -1 || dy === def.height)) ||
          (dy >= 0 && dy < def.height && (dx === -1 || dx === def.width));
        if (!isEdge) continue;

        const nx = b.gx + dx;
        const ny = b.gy + dy;
        const { chunk, index } = chunks.getTile(nx, ny);
        const rt = chunk.roadType[index] as RoadType;
        if (rt !== RoadType.None) {
          const cluster = this.roadClusterMap.get(`${nx}:${ny}`) ?? 1;
          if (cluster > 0) bestCluster = cluster;
          const tier = rt === RoadType.Bridge ? 2 : rt === RoadType.Rail ? 5 : rt;
          if (tier > bestTier) bestTier = tier;
        }
      }
    }

    b.connectedRoadCluster = bestCluster;
    return { connectedCluster: bestCluster, bestRoadTier: bestTier };
  }

  public getBuildingLogisticsMultiplier(b: BuildingInstance, state: WorldEngineState, chunks: ChunkManager): number {
    const { bestRoadTier } = this.evaluateBuildingRoadAccess(b, chunks);
    let base = 1.0;
    if (bestRoadTier > 0) {
      const roadDef = ROADS[bestRoadTier as RoadType];
      if (roadDef) {
        base = 0.95 + (roadDef.speedMultiplier - 1.0) * 0.25;
      }
    }

    // Add global logistics bonuses from Cart Depots, Harbors, Train Stations, Airports
    let hubBoost = 0;
    for (const other of state.buildings) {
      if (other.status !== 'active') continue;
      const odef = BUILDINGS[other.defId];
      if (odef?.logisticsBoost) {
        hubBoost += odef.logisticsBoost * (1 + (other.level - 1) * 0.2);
      }
    }

    return Math.min(1.85, base + Math.min(0.65, hubBoost));
  }
}
