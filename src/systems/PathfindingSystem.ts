import { BUILDINGS, getBuildingFootprint } from '../data/buildings.data';
import { ROADS, RoadType } from '../data/roads.data';
import type { ChunkManager } from '../core/ChunkManager';
import { BiomeId, BuildingInstance, TileFlag } from '../core/GameState';

export type TransportMode = 'citizen' | 'vehicle' | 'train';

export interface GridPoint {
  gx: number;
  gy: number;
}

const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Strict network-aware movement rules & bounded A* pathfinding:
 * - Citizens walk ONLY on roads, bridges, and unlocked non-mountain dry land.
 *   They NEVER walk on unbridged water, buildings, mountains, or locked tiles.
 * - Vehicles travel strictly on roads & bridges (never off-road, water, or rail).
 * - Trains travel strictly on RoadType.Rail tiles.
 */
export class PathfindingSystem {
  public static isTilePassable(
    gx: number,
    gy: number,
    chunks: ChunkManager,
    mode: TransportMode = 'citizen'
  ): boolean {
    const { chunk, index } = chunks.getTile(gx, gy);
    if ((chunk.flags[index] & TileFlag.Unlocked) === 0) return false;
    if (chunk.buildingRef[index] !== -1) return false;

    const road = chunk.roadType[index] as RoadType;
    const biome = chunk.biomeId[index] as BiomeId;
    const isWater = chunks.isWaterBiome(biome);

    if (mode === 'train') {
      return road === RoadType.Rail;
    }

    if (mode === 'vehicle') {
      return road !== RoadType.None && road !== RoadType.Rail;
    }

    // Citizen mode:
    if (isWater) {
      return road === RoadType.Bridge;
    }
    if (biome === BiomeId.Mountain) {
      // Permanent mountains block foot traffic unless bridged/tunneled via road
      return road !== RoadType.None;
    }
    return true;
  }

  public static getTileStepCost(gx: number, gy: number, chunks: ChunkManager, mode: TransportMode): number {
    const { chunk, index } = chunks.getTile(gx, gy);
    const road = chunk.roadType[index] as RoadType;
    if (road !== RoadType.None) {
      const spd = ROADS[road]?.speedMultiplier ?? 1.15;
      return Math.max(0.35, 1.0 / spd);
    }
    return mode === 'citizen' ? 1.75 : 999;
  }

  /**
   * Returns the best accessible entrance tile adjacent to a building footprint
   * (preferring connected roads/bridges first, then dry empty land).
   */
  public static findBuildingEntrance(
    b: BuildingInstance,
    chunks: ChunkManager,
    mode: TransportMode = 'citizen'
  ): GridPoint | null {
    const def = BUILDINGS[b.defId];
    if (!def) return null;
    const fp = getBuildingFootprint(def, b.rotation ?? 0);

    let fallbackLand: GridPoint | null = null;
    for (let dx = -1; dx <= fp.width; dx++) {
      for (let dy = -1; dy <= fp.height; dy++) {
        const isPerimeter =
          ((dx === -1 || dx === fp.width) && dy >= 0 && dy < fp.height) ||
          ((dy === -1 || dy === fp.height) && dx >= 0 && dx < fp.width);
        if (!isPerimeter) continue;

        const tx = b.gx + dx;
        const ty = b.gy + dy;
        if (!this.isTilePassable(tx, ty, chunks, mode)) continue;

        const { chunk, index } = chunks.getTile(tx, ty);
        if (chunk.roadType[index] !== RoadType.None) {
          return { gx: tx, gy: ty };
        }
        if (!fallbackLand) {
          fallbackLand = { gx: tx, gy: ty };
        }
      }
    }
    return fallbackLand;
  }

  /**
   * Bounded A* pathfinder returning tile waypoints (excluding start, including goal).
   * Returns null if target is unreachable or blocked.
   */
  public static findPath(
    startGx: number,
    startGy: number,
    goalGx: number,
    goalGy: number,
    chunks: ChunkManager,
    mode: TransportMode = 'citizen',
    maxNodes = 450
  ): GridPoint[] | null {
    const sx = Math.round(startGx);
    const sy = Math.round(startGy);
    const gx = Math.round(goalGx);
    const gy = Math.round(goalGy);

    if (sx === gx && sy === gy) return [{ gx, gy }];
    if (!this.isTilePassable(gx, gy, chunks, mode)) return null;

    const startKey = `${sx}:${sy}`;
    const goalKey = `${gx}:${gy}`;

    const open: Array<{ x: number; y: number; key: string; f: number }> = [
      { x: sx, y: sy, key: startKey, f: Math.abs(gx - sx) + Math.abs(gy - sy) },
    ];
    const gScore = new Map<string, number>([[startKey, 0]]);
    const cameFrom = new Map<string, GridPoint>();
    const closed = new Set<string>();

    let expanded = 0;
    while (open.length > 0 && expanded < maxNodes) {
      // Pop lowest f-score
      let bestIdx = 0;
      for (let i = 1; i < open.length; i++) {
        if (open[i].f < open[bestIdx].f) bestIdx = i;
      }
      const cur = open.splice(bestIdx, 1)[0];
      if (cur.key === goalKey) {
        const path: GridPoint[] = [];
        let trace: GridPoint | undefined = { gx, gy };
        while (trace && !(trace.gx === sx && trace.gy === sy)) {
          path.push(trace);
          trace = cameFrom.get(`${trace.gx}:${trace.gy}`);
        }
        path.reverse();
        return path;
      }

      closed.add(cur.key);
      expanded++;
      const curG = gScore.get(cur.key) ?? Infinity;

      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        const nKey = `${nx}:${ny}`;
        if (closed.has(nKey)) continue;
        if (!this.isTilePassable(nx, ny, chunks, mode)) continue;

        const stepCost = this.getTileStepCost(nx, ny, chunks, mode);
        const tentativeG = curG + stepCost;
        if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
          cameFrom.set(nKey, { gx: cur.x, gy: cur.y });
          gScore.set(nKey, tentativeG);
          const h = (Math.abs(gx - nx) + Math.abs(gy - ny)) * 0.55;
          const existing = open.find((o) => o.key === nKey);
          if (existing) {
            existing.f = tentativeG + h;
          } else {
            open.push({ x: nx, y: ny, key: nKey, f: tentativeG + h });
          }
        }
      }
    }

    return null;
  }
}
