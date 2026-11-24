import { BiomeId, ChunkData, TileFlag } from './GameState';
import { CHUNK_SIZE, chunkKey, gridToChunk } from './IsoMath';
import { WorldGenerator } from './WorldGenerator';

export const MAX_CHUNKS_IN_RAM = 48;

export const BIOME_NAMES: Record<BiomeId, string> = {
  [BiomeId.DeepWater]: 'Deep Water',
  [BiomeId.River]: 'River',
  [BiomeId.Beach]: 'Coastal Beach',
  [BiomeId.Grassland]: 'Grassland',
  [BiomeId.Fertile]: 'Fertile Floodplain',
  [BiomeId.Jungle]: 'Dense Jungle',
  [BiomeId.Forest]: 'Lush Forest',
  [BiomeId.Swamp]: 'Wetland Swamp',
  [BiomeId.Desert]: 'Arid Desert',
  [BiomeId.Mountain]: 'Highland Mountain',
};

export const BIOME_UNLOCK_COST_MULT: Record<BiomeId, number> = {
  [BiomeId.DeepWater]: 1.25,
  [BiomeId.River]: 1.1,
  [BiomeId.Beach]: 1.05,
  [BiomeId.Grassland]: 1.0,
  [BiomeId.Fertile]: 1.35,
  [BiomeId.Jungle]: 1.0,
  [BiomeId.Forest]: 1.05,
  [BiomeId.Swamp]: 1.25,
  [BiomeId.Desert]: 1.15,
  [BiomeId.Mountain]: 1.75,
};

export class ChunkManager {
  private readonly generator: WorldGenerator;
  private readonly chunks = new Map<string, ChunkData>();
  private readonly dirtyRenderKeys = new Set<string>();
  private readonly dirtySaveKeys = new Set<string>();
  private currentTick = 0;

  constructor(worldSeed: number) {
    this.generator = new WorldGenerator(worldSeed);
    // Ensure origin chunk (0,0) exists immediately
    const origin = this.getOrCreateChunk(0, 0);
    origin.isModified = true;
    this.dirtyRenderKeys.add(origin.key);
  }

  public setTick(tick: number): void {
    this.currentTick = tick;
  }

  public getOrCreateChunk(cx: number, cy: number): ChunkData {
    const key = chunkKey(cx, cy);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generator.generateChunk(cx, cy, this.currentTick);
      this.chunks.set(key, chunk);
      this.evictUnmodifiedIfNeeded();
    }
    chunk.lastTouchedTick = this.currentTick;
    return chunk;
  }

  public getLoadedChunk(cx: number, cy: number): ChunkData | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  public loadPersistedChunks(persisted: ChunkData[]): void {
    this.chunks.clear();
    for (const c of persisted) {
      c.isModified = true;
      this.chunks.set(c.key, c);
      this.dirtyRenderKeys.add(c.key);
    }
    if (!this.chunks.has(chunkKey(0, 0))) {
      this.getOrCreateChunk(0, 0);
    }
  }

  public getModifiedChunks(): ChunkData[] {
    const out: ChunkData[] = [];
    for (const c of this.chunks.values()) {
      if (c.isModified) out.push(c);
    }
    return out;
  }

  public getAllLoadedChunks(): ChunkData[] {
    return Array.from(this.chunks.values());
  }

  public markChunkModified(cx: number, cy: number): void {
    const c = this.getOrCreateChunk(cx, cy);
    c.isModified = true;
    this.dirtyRenderKeys.add(c.key);
    this.dirtySaveKeys.add(c.key);
  }

  public markRenderDirty(cx: number, cy: number): void {
    this.dirtyRenderKeys.add(chunkKey(cx, cy));
  }

  public consumeDirtyRenderKeys(): string[] {
    const keys = Array.from(this.dirtyRenderKeys);
    this.dirtyRenderKeys.clear();
    return keys;
  }

  public consumeDirtySaveKeys(): string[] {
    const keys = Array.from(this.dirtySaveKeys);
    this.dirtySaveKeys.clear();
    return keys;
  }

  public getLoadedChunkCount(): number {
    return this.chunks.size;
  }

  public getTile(gx: number, gy: number): { chunk: ChunkData; index: number } {
    const { cx, cy, index } = gridToChunk(gx, gy);
    const chunk = this.getOrCreateChunk(cx, cy);
    return { chunk, index };
  }

  public isUnlocked(gx: number, gy: number): boolean {
    const { chunk, index } = this.getTile(gx, gy);
    return (chunk.flags[index] & TileFlag.Unlocked) !== 0;
  }

  public isExplored(gx: number, gy: number): boolean {
    const { chunk, index } = this.getTile(gx, gy);
    return (chunk.flags[index] & TileFlag.Explored) !== 0;
  }

  public isWaterBiome(biome: BiomeId): boolean {
    return biome === BiomeId.DeepWater || biome === BiomeId.River;
  }

  public isAdjacentToUnlocked(gx: number, gy: number): boolean {
    return (
      this.isUnlocked(gx + 1, gy) ||
      this.isUnlocked(gx - 1, gy) ||
      this.isUnlocked(gx, gy + 1) ||
      this.isUnlocked(gx, gy - 1)
    );
  }

  public canUnlockTile(gx: number, gy: number): boolean {
    return !this.isUnlocked(gx, gy) && this.isAdjacentToUnlocked(gx, gy);
  }

  public computeUnlockCost(gx: number, gy: number): number {
    const { chunk, index } = this.getTile(gx, gy);
    const biome = chunk.biomeId[index] as BiomeId;
    const d = Math.abs(gx - 2) + Math.abs(gy - 1.5);
    const mult = BIOME_UNLOCK_COST_MULT[biome] ?? 1.0;
    return Math.round((35 + 11 * Math.pow(Math.max(1, d), 1.15)) * mult);
  }

  public unlockTile(gx: number, gy: number): void {
    const { cx, cy, index } = gridToChunk(gx, gy);
    const chunk = this.getOrCreateChunk(cx, cy);
    chunk.flags[index] |= TileFlag.Unlocked | TileFlag.Explored;
    // Owned land becomes flat buildable terrain (water stays recessed at elev 0/1)
    const biome = chunk.biomeId[index] as BiomeId;
    if (!this.isWaterBiome(biome)) {
      chunk.elevation[index] = 2;
    }
    this.markChunkModified(cx, cy);

    // Reveal 2-tile exploration ring around newly unlocked tile & refresh adjacent chunk borders
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const n = gridToChunk(gx + dx, gy + dy);
        const nc = this.getOrCreateChunk(n.cx, n.cy);
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
          this.dirtyRenderKeys.add(nc.key);
        }
        if ((nc.flags[n.index] & TileFlag.Explored) === 0) {
          nc.flags[n.index] |= TileFlag.Explored;
          nc.isModified = true;
          this.dirtyRenderKeys.add(nc.key);
          this.dirtySaveKeys.add(nc.key);
        }
      }
    }
  }

  public getUnlockedGridBounds(): {
    minGx: number;
    maxGx: number;
    minGy: number;
    maxGy: number;
    count: number;
  } {
    let minGx = Infinity;
    let maxGx = -Infinity;
    let minGy = Infinity;
    let maxGy = -Infinity;
    let count = 0;

    for (const c of this.chunks.values()) {
      if (!c.isModified) continue;
      for (let ly = 0; ly < CHUNK_SIZE; ly++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const idx = ly * CHUNK_SIZE + lx;
          if ((c.flags[idx] & TileFlag.Unlocked) !== 0) {
            const gx = c.cx * CHUNK_SIZE + lx;
            const gy = c.cy * CHUNK_SIZE + ly;
            if (gx < minGx) minGx = gx;
            if (gx > maxGx) maxGx = gx;
            if (gy < minGy) minGy = gy;
            if (gy > maxGy) maxGy = gy;
            count++;
          }
        }
      }
    }

    if (count === 0) {
      return { minGx: 0, maxGx: 4, minGy: 0, maxGy: 3, count: 20 };
    }
    return { minGx, maxGx, minGy, maxGy, count };
  }

  public countUnlockedTiles(): number {
    let count = 0;
    for (const c of this.chunks.values()) {
      if (!c.isModified) continue;
      for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
        if ((c.flags[i] & TileFlag.Unlocked) !== 0) count++;
      }
    }
    return count;
  }

  private evictUnmodifiedIfNeeded(): void {
    if (this.chunks.size <= MAX_CHUNKS_IN_RAM) return;
    const candidates = Array.from(this.chunks.values())
      .filter((c) => !c.isModified)
      .sort((a, b) => a.lastTouchedTick - b.lastTouchedTick);

    for (const c of candidates) {
      if (this.chunks.size <= MAX_CHUNKS_IN_RAM) break;
      this.chunks.delete(c.key);
    }
  }

  /**
   * Scans explored/nearby chunks to locate the closest matching mineral deposit,
   * river/ocean coast tile, or unexplored Ancient Ruin for camera navigation.
   */
  public findNearestTarget(
    fromGx: number,
    fromGy: number,
    opts: { depositType?: number; coast?: boolean; ruin?: boolean }
  ): { gx: number; gy: number; unlocked: boolean } | null {
    let best: { gx: number; gy: number; unlocked: boolean; dist: number } | null = null;
    const searchRadius = 26;

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const gx = fromGx + dx;
        const gy = fromGy + dy;
        const { chunk, index } = this.getTile(gx, gy);
        const unlocked = (chunk.flags[index] & TileFlag.Unlocked) !== 0;
        let match = false;

        if (opts.depositType && chunk.depositType[index] === opts.depositType && chunk.buildingRef[index] === -1) {
          match = true;
        } else if (opts.ruin && chunk.featureType[index] === 8) {
          match = true;
        } else if (opts.coast) {
          const bio = chunk.biomeId[index] as BiomeId;
          if (!this.isWaterBiome(bio) && chunk.buildingRef[index] === -1) {
            for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nb = this.getTile(gx + nx, gy + ny);
              if (this.isWaterBiome(nb.chunk.biomeId[nb.index] as BiomeId)) {
                match = true;
                break;
              }
            }
          }
        }

        if (!match) continue;
        // Prefer unlocked matching tiles first, then closest Manhattan distance
        const dist = Math.abs(dx) + Math.abs(dy) + (unlocked ? 0 : 12);
        if (!best || dist < best.dist) {
          best = { gx, gy, unlocked, dist };
        }
      }
    }

    return best ? { gx: best.gx, gy: best.gy, unlocked: best.unlocked } : null;
  }

  public terraformTile(gx: number, gy: number, action: 'to_water' | 'to_land'): boolean {
    const { cx, cy, index } = gridToChunk(gx, gy);
    const chunk = this.getOrCreateChunk(cx, cy);
    const isUnlocked = (chunk.flags[index] & TileFlag.Unlocked) !== 0;
    if (!isUnlocked) return false;
    if (chunk.buildingRef[index] !== -1) return false;

    if (action === 'to_water') {
      chunk.biomeId[index] = BiomeId.River;
      chunk.elevation[index] = 1;
      chunk.featureType[index] = 0;
    } else {
      chunk.biomeId[index] = BiomeId.Grassland;
      chunk.elevation[index] = 2;
    }
    this.markChunkModified(cx, cy);
    this.dirtyRenderKeys.add(chunk.key);
    return true;
  }
}
