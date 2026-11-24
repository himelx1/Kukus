import type { CoreEngine } from '../core/CoreEngine';
import type { ChunkData, WorldEngineState } from '../core/GameState';
import { CHUNK_SIZE, chunkKey } from '../core/IsoMath';
import {
  IndexedDBStore,
  StoredBackupRecord,
  StoredChunkRecord,
  StoredSlotRecord,
} from './IndexedDBStore';
import { SaveMigrator } from './SaveMigrator';

export type SaveSlotId = 'autosave' | 'manual_1' | 'manual_2' | 'manual_3';

export interface SaveSlotSummary {
  slotId: SaveSlotId;
  savedAt: number;
  cityName: string;
  level: number;
  population: number;
  coins: number;
  unlockedTiles: number;
  playTimeSeconds: number;
}

const CHUNK_STRIDE_BYTES =
  256 + // biomeId (u8)
  256 + // elevation (u8)
  256 + // moisture (u8)
  256 + // flags (u8)
  256 + // featureType (u8)
  512 + // featureHp (u16)
  256 + // depositType (u8)
  512 + // depositQty (u16)
  256 + // roadType (u8)
  1024 + // buildingRef (i32)
  256; // pollution (u8)

function computeCRC32(str: string): number {
  let c = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    c ^= str.charCodeAt(i);
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function serializeChunk(c: ChunkData): ArrayBuffer {
  const buf = new ArrayBuffer(CHUNK_STRIDE_BYTES);
  const u8 = new Uint8Array(buf);
  let off = 0;
  const copyU8 = (arr: Uint8Array) => {
    u8.set(arr, off);
    off += arr.byteLength;
  };
  const copyView = (arr: ArrayBufferView) => {
    u8.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), off);
    off += arr.byteLength;
  };

  copyU8(c.biomeId);
  copyU8(c.elevation);
  copyU8(c.moisture);
  copyU8(c.flags);
  copyU8(c.featureType);
  copyView(c.featureHp);
  copyU8(c.depositType);
  copyView(c.depositQty);
  copyU8(c.roadType);
  copyView(c.buildingRef);
  copyU8(c.pollution);
  return buf;
}

function deserializeChunk(cx: number, cy: number, bytes: ArrayBuffer): ChunkData {
  const len = CHUNK_SIZE * CHUNK_SIZE;
  let off = 0;
  const takeU8 = () => {
    const slice = new Uint8Array(bytes.slice(off, off + len));
    off += len;
    return slice;
  };
  const takeU16 = () => {
    const slice = new Uint16Array(bytes.slice(off, off + len * 2));
    off += len * 2;
    return slice;
  };
  const takeI32 = () => {
    const slice = new Int32Array(bytes.slice(off, off + len * 4));
    off += len * 4;
    return slice;
  };

  return {
    cx,
    cy,
    key: chunkKey(cx, cy),
    isModified: true,
    lastTouchedTick: 0,
    biomeId: takeU8(),
    elevation: takeU8(),
    moisture: takeU8(),
    flags: takeU8(),
    featureType: takeU8(),
    featureHp: takeU16(),
    depositType: takeU8(),
    depositQty: takeU16(),
    roadType: takeU8(),
    buildingRef: takeI32(),
    pollution: takeU8(),
  };
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export class SaveManager {
  private readonly store = new IndexedDBStore();
  private backupRingIndex = 0;
  private saveCount = 0;

  public async isStoragePersistent(): Promise<boolean> {
    await this.store.open();
    return this.store.isAvailable;
  }

  public async listSlots(): Promise<SaveSlotSummary[]> {
    const records = await this.store.listSlots();
    return records.map((r) => ({
      slotId: r.slotId as SaveSlotId,
      savedAt: r.savedAt,
      cityName: r.cityName,
      level: r.level,
      population: r.population,
      coins: Math.floor(r.coins),
      unlockedTiles: r.unlockedTiles,
      playTimeSeconds: r.playTimeSeconds,
    }));
  }

  public async saveGame(
    engine: CoreEngine,
    slotId: SaveSlotId,
    forceAllChunks = false
  ): Promise<{ ok: boolean; recoveredNote?: string }> {
    const state = engine.state;
    const payloadJson = JSON.stringify(state);
    const checksum = computeCRC32(payloadJson);

    const slotRecord: StoredSlotRecord = {
      slotId,
      schemaVersion: state.schemaVersion,
      savedAt: Date.now(),
      cityName: state.settings.cityName,
      level: state.level,
      population: state.population.total,
      coins: Math.floor(state.coins),
      unlockedTiles: state.stats.unlockedTiles,
      playTimeSeconds: state.stats.playTimeSeconds,
      checksumCRC32: checksum,
      payloadJson,
    };

    const dirtyKeys = engine.chunks.consumeDirtySaveKeys();
    const modifiedChunks = engine.chunks.getModifiedChunks();
    const chunksToWrite: StoredChunkRecord[] = [];

    for (const c of modifiedChunks) {
      if (forceAllChunks || slotId !== 'autosave' || dirtyKeys.includes(c.key)) {
        chunksToWrite.push({
          id: `${slotId}:${c.cx}:${c.cy}`,
          slotId,
          cx: c.cx,
          cy: c.cy,
          bytes: serializeChunk(c),
        });
      }
    }

    const ok = await this.store.writeSlotAndChunks(
      slotRecord,
      chunksToWrite,
      forceAllChunks || slotId !== 'autosave'
    );

    // Every 3rd autosave or on any manual save, write full recovery backup into 3-deep ring buffer
    this.saveCount += 1;
    if (ok && (slotId !== 'autosave' || this.saveCount % 3 === 1)) {
      const backupChunks = modifiedChunks.map((c) => ({
        cx: c.cx,
        cy: c.cy,
        bytes: serializeChunk(c),
      }));
      const backup: StoredBackupRecord = {
        id: `${slotId}:${this.backupRingIndex}`,
        slotId,
        savedAt: slotRecord.savedAt,
        checksumCRC32: checksum,
        payloadJson,
        chunks: backupChunks,
      };
      this.backupRingIndex = (this.backupRingIndex + 1) % 3;
      await this.store.writeBackup(backup);
    }

    return { ok };
  }

  public async loadGame(
    engine: CoreEngine,
    slotId: SaveSlotId
  ): Promise<{ ok: boolean; recoveredFromBackup?: boolean; error?: string }> {
    const slot = await this.store.getSlot(slotId);
    if (slot) {
      const expectedCrc = computeCRC32(slot.payloadJson);
      if (expectedCrc === slot.checksumCRC32) {
        try {
          const parsed = JSON.parse(slot.payloadJson) as unknown;
          const mig = SaveMigrator.migrate(parsed);
          if (mig.ok && mig.state) {
            const rawChunks = await this.store.getChunksForSlot(slotId);
            const chunks = rawChunks.map((rc) => deserializeChunk(rc.cx, rc.cy, rc.bytes));
            engine.loadState(mig.state, chunks);
            return { ok: true };
          }
        } catch {
          // Fall through to backup recovery
        }
      }
    }

    // Attempt corruption recovery from rolling backup ring
    const backups = await this.store.getBackupsForSlot(slotId);
    for (const b of backups) {
      if (computeCRC32(b.payloadJson) !== b.checksumCRC32) continue;
      try {
        const parsed = JSON.parse(b.payloadJson) as unknown;
        const mig = SaveMigrator.migrate(parsed);
        if (mig.ok && mig.state) {
          const chunks = b.chunks.map((c) => deserializeChunk(c.cx, c.cy, c.bytes));
          engine.loadState(mig.state, chunks);
          // Repair corrupted primary slot automatically
          await this.saveGame(engine, slotId, true);
          return { ok: true, recoveredFromBackup: true };
        }
      } catch {
        continue;
      }
    }

    return { ok: false, error: 'No valid save or backup found for this slot' };
  }

  public async deleteSlot(slotId: SaveSlotId): Promise<boolean> {
    return this.store.deleteSlot(slotId);
  }

  public async exportBackupFile(engine: CoreEngine): Promise<Blob> {
    const modifiedChunks = engine.chunks.getModifiedChunks().map((c) => ({
      cx: c.cx,
      cy: c.cy,
      b64: bufferToBase64(serializeChunk(c)),
    }));
    const envelope = {
      magic: 'KUKUS_SAVE_V1',
      exportedAt: Date.now(),
      checksumCRC32: computeCRC32(JSON.stringify(engine.state)),
      state: engine.state,
      chunks: modifiedChunks,
    };
    const jsonText = JSON.stringify(envelope);

    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([jsonText]).stream().pipeThrough(new CompressionStream('gzip'));
      return await new Response(stream).blob();
    }
    return new Blob([jsonText], { type: 'application/json' });
  }

  public async importBackupFile(
    file: File,
    engine: CoreEngine,
    targetSlot: SaveSlotId = 'manual_1'
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      let jsonText = '';
      const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      const isGzip = header.length === 2 && header[0] === 0x1f && header[1] === 0x8b;

      if (isGzip && typeof DecompressionStream !== 'undefined') {
        const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
        jsonText = await new Response(stream).text();
      } else {
        jsonText = await file.text();
      }

      const envelope = JSON.parse(jsonText) as {
        magic?: string;
        checksumCRC32?: number;
        state?: WorldEngineState;
        chunks?: Array<{ cx: number; cy: number; b64: string }>;
      };

      if (envelope.magic !== 'KUKUS_SAVE_V1' || !envelope.state) {
        return { ok: false, error: 'Invalid .kukus save file format' };
      }

      const mig = SaveMigrator.migrate(envelope.state);
      if (!mig.ok || !mig.state) {
        return { ok: false, error: mig.error ?? 'Migration failed' };
      }

      const chunks = (envelope.chunks ?? []).map((c) =>
        deserializeChunk(c.cx, c.cy, base64ToBuffer(c.b64))
      );

      engine.loadState(mig.state, chunks);
      await this.saveGame(engine, targetSlot, true);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not parse backup file' };
    }
  }
}
