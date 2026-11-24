import { useEffect, useState } from 'react';
import { CoreEngine } from '../../core/CoreEngine';
import type { CommandResult, GameCommand } from '../../core/CommandTypes';
import type { NotificationItem, TileInspection, WorldEngineState } from '../../core/GameState';
import { BUILDINGS } from '../../data/buildings.data';
import { getBuildQueueCap, QuestDef } from '../../data/levels.data';
import { DEPOSIT_NAMES, DepositType } from '../../data/trees.data';
import { AudioSystem } from '../../engine/AudioSystem';
import { PhaserHost } from '../../engine/PhaserHost';
import type { InteractionTool, OverlayMode } from '../../engine/WorldScene';
import { OfflineManager, OfflineStatus } from '../../persistence/OfflineManager';
import { PerfMetrics, PerfMonitor } from '../../persistence/PerfMonitor';
import { SaveManager, SaveSlotId, SaveSlotSummary } from '../../persistence/SaveManager';
import type { MaterialShortage, PlacementValidation } from '../../systems/BuildingSystem';
import type { QuestProgressEntry } from '../../systems/ProgressionSystem';

export type ActiveSheet =
  | 'none'
  | 'build'
  | 'land'
  | 'inventory'
  | 'population'
  | 'economy'
  | 'tech'
  | 'achievements'
  | 'quests';

export type ActiveModal = 'none' | 'pause' | 'settings' | 'saves';

export interface GhostInfoState {
  gx: number;
  gy: number;
  valid: boolean;
  reason?: string;
  blockingObstacleTiles?: Array<{ gx: number; gy: number }>;
  missingCoins?: number;
  missingMaterials?: MaterialShortage[];
  queueFull?: boolean;
}

export interface GameSnapshot {
  state: WorldEngineState;
  activeQuest: { quest: QuestDef; progress: number } | null;
  activeQuests: Array<{ quest: QuestDef; progress: number }>;
  allQuests: QuestProgressEntry[];
  buildQueueActive: number;
  buildQueueCap: number;
  notifications: NotificationItem[];
  perf: PerfMetrics;
  offline: OfflineStatus;
  tool: InteractionTool;
  overlayMode: OverlayMode;
  selectedTile: TileInspection | null;
  selectedBuildingId: number | null;
  ghostInfo: GhostInfoState | null;
  activeSheet: ActiveSheet;
  activeModal: ActiveModal;
  simInspectorOpen: boolean;
  toastError: string | null;
}

class GameControllerImpl {
  public readonly engine = new CoreEngine();
  public readonly audio = new AudioSystem();
  public readonly perf = new PerfMonitor();
  public readonly saveManager = new SaveManager();
  private phaserHost: PhaserHost | null = null;

  private tool: InteractionTool = { mode: 'inspect_chop' };
  private overlayMode: OverlayMode = 'none';
  private selectedTileCoords: { gx: number; gy: number } | null = null;
  private selectedBuildingId: number | null = null;
  private ghostInfo: GhostInfoState | null = null;
  private activeSheet: ActiveSheet = 'none';
  private activeModal: ActiveModal = 'none';
  private simInspectorOpen = false;
  private toastError: string | null = null;
  private toastTimer: number | null = null;

  private subscribers = new Set<() => void>();
  private snapshotDirty = false;
  private uiTimer: number | null = null;
  private autosaveTimer: number | null = null;
  private bootComplete = false;

  public async mount(container: HTMLElement): Promise<void> {
    if (this.phaserHost) {
      this.phaserHost.destroy();
      this.phaserHost = null;
    }

    OfflineManager.init();

    if (!this.bootComplete) {
      this.bootComplete = true;
      const slots = await this.saveManager.listSlots();
      if (slots.some((s) => s.slotId === 'autosave')) {
        await this.saveManager.loadGame(this.engine, 'autosave');
      }
      void OfflineManager.requestPersistence();
    }

    this.phaserHost = new PhaserHost(container, this.engine, this.audio, this.perf, {
      onSelectTile: (gx, gy) => {
        this.selectedBuildingId = null;
        this.selectedTileCoords = { gx, gy };
        this.activeSheet = 'none';
        this.notifyImmediate();
      },
      onSelectBuilding: (buildingId) => {
        this.selectedTileCoords = null;
        this.selectedBuildingId = buildingId;
        this.activeSheet = 'none';
        this.notifyImmediate();
      },
      onGhostUpdated: (gx, gy, val: PlacementValidation) => {
        this.ghostInfo = {
          gx,
          gy,
          valid: val.valid,
          reason: val.reason,
          blockingObstacleTiles: val.blockingObstacleTiles,
          missingCoins: val.missingCoins,
          missingMaterials: val.missingMaterials,
          queueFull: val.queueFull,
        };
        this.notifyImmediate();
      },
      onMoveCompleted: (buildingId) => {
        this.tool = { mode: 'inspect_chop' };
        this.ghostInfo = null;
        this.selectedTileCoords = null;
        this.selectedBuildingId = buildingId;
        this.notifyImmediate();
      },
      onToolError: (reason) => {
        this.showErrorToast(reason);
      },
    });

    this.phaserHost.worldScene.setOverlayMode(this.overlayMode);

    this.engine.subscribe(() => {
      this.snapshotDirty = true;
    });

    OfflineManager.subscribe(() => {
      this.notifyImmediate();
    });

    if (this.uiTimer === null) {
      this.uiTimer = window.setInterval(() => {
        if (this.snapshotDirty) {
          this.snapshotDirty = false;
          this.emit();
        }
      }, 200);
    }

    if (this.autosaveTimer === null) {
      this.autosaveTimer = window.setInterval(() => {
        void this.saveManager.saveGame(this.engine, 'autosave');
      }, 45000);
    }

    window.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);
  }

  public unmount(): void {
    if (this.phaserHost) {
      this.phaserHost.destroy();
      this.phaserHost = null;
    }
    window.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.saveManager.saveGame(this.engine, 'autosave');
    }
  };

  private handlePageHide = (): void => {
    void this.saveManager.saveGame(this.engine, 'autosave');
  };

  public dispatchResult(cmd: GameCommand): CommandResult {
    this.audio.unlock();
    const res = this.engine.dispatch(cmd);
    if (!res.ok && res.reason && !res.needsConfirm) {
      this.showErrorToast(res.reason);
      this.audio.play('error');
    } else if (
      res.ok &&
      (cmd.type === 'UNLOCK_TILE' || cmd.type === 'UNLOCK_BATCH_FRONTIER' || cmd.type === 'UNLOCK_CHUNK')
    ) {
      this.audio.play('unlock');
    } else if (res.ok && cmd.type === 'DEMOLISH_BUILDING' && this.selectedBuildingId === cmd.buildingId) {
      this.selectedBuildingId = null;
    } else if (res.ok && cmd.type === 'REMOVE_ROAD') {
      this.audio.play('demolish');
    } else if (res.ok && cmd.type === 'RUSH_CONSTRUCTION') {
      this.audio.play('build');
    } else if (res.ok && (cmd.type === 'BUY_MISSING_FOR_BUILDING' || cmd.type === 'RECRUIT_WORKERS')) {
      this.audio.play('coin');
    } else if (res.ok && cmd.type === 'CLEAR_AREA_OBSTACLES') {
      this.audio.play('tree_clear');
    } else if (res.ok && cmd.type === 'TERRAFORM_TILE') {
      this.phaserHost?.worldScene.invalidateAllChunkTextures();
      this.audio.play('build');
    }
    this.notifyImmediate();
    return res;
  }

  public dispatch(cmd: GameCommand): boolean {
    return this.dispatchResult(cmd).ok;
  }

  public setOverlayMode(mode: OverlayMode): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.overlayMode = mode;
    this.phaserHost?.worldScene.setOverlayMode(mode);
    this.notifyImmediate();
  }

  public setTool(tool: InteractionTool): void {
    this.audio.unlock();
    this.tool = tool;
    this.ghostInfo = null;
    if (tool.mode !== 'inspect_chop') {
      this.selectedTileCoords = null;
      this.selectedBuildingId = null;
    }
    this.phaserHost?.worldScene.setTool(tool);
    this.notifyImmediate();
  }

  public startMoveBuilding(buildingId: number): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.tool = { mode: 'move', buildingId };
    this.selectedTileCoords = null;
    this.selectedBuildingId = null;
    this.activeSheet = 'none';
    this.ghostInfo = null;
    this.phaserHost?.worldScene.setTool(this.tool);
    this.notifyImmediate();
  }

  public confirmGhostBuild(): void {
    this.phaserHost?.worldScene.confirmGhostPlacement();
    this.notifyImmediate();
  }

  public clearGhostObstacles(): boolean {
    if (!this.ghostInfo?.blockingObstacleTiles?.length) return false;
    return this.dispatch({
      type: 'CLEAR_AREA_OBSTACLES',
      tiles: this.ghostInfo.blockingObstacleTiles,
    });
  }

  public locateTarget(opts: { depositType?: number; coast?: boolean; ruin?: boolean; keepTool?: boolean }): boolean {
    this.audio.unlock();
    const hit = this.engine.chunks.findNearestTarget(2, 2, opts);
    if (!hit) {
      const targetName = opts.ruin
        ? 'Ancient Ruin'
        : opts.coast
          ? 'River or Ocean shoreline'
          : opts.depositType
            ? DEPOSIT_NAMES[opts.depositType as DepositType] ?? 'mineral deposit'
            : 'target';
      this.showErrorToast(`No ${targetName} discovered within 26 tiles — unlock more land!`);
      this.audio.play('error');
      return false;
    }
    this.audio.play('discovery');
    this.activeSheet = 'none';
    if (!opts.keepTool) {
      this.tool = { mode: 'inspect_chop' };
      this.phaserHost?.worldScene.setTool(this.tool);
      this.selectedBuildingId = null;
      this.selectedTileCoords = { gx: hit.gx, gy: hit.gy };
    }
    const label = opts.ruin
      ? hit.unlocked
        ? 'Ruin Ready'
        : 'Unlock & Explore'
      : opts.coast
        ? hit.unlocked
          ? 'Shoreline'
          : 'Unlock Shore'
        : hit.unlocked
          ? DEPOSIT_NAMES[(opts.depositType ?? 1) as DepositType] ?? 'Deposit'
          : 'Unlock Deposit';
    this.phaserHost?.worldScene.focusOnGrid(hit.gx, hit.gy, label);
    this.notifyImmediate();
    return true;
  }

  public focusBuilding(buildingId: number): void {
    const b = this.engine.state.buildings.find((item) => item.id === buildingId);
    if (!b) return;
    this.audio.unlock();
    this.audio.play('ui');
    this.activeSheet = 'none';
    this.tool = { mode: 'inspect_chop' };
    this.phaserHost?.worldScene.setTool(this.tool);
    this.selectedTileCoords = null;
    this.selectedBuildingId = buildingId;
    this.phaserHost?.worldScene.focusOnGrid(b.gx, b.gy, BUILDINGS[b.defId]?.name ?? 'Building');
    this.notifyImmediate();
  }

  public setTrackedQuest(questId: string | null): void {
    this.dispatch({ type: 'SET_TRACKED_QUEST', questId });
  }

  public centerCamera(): void {
    this.phaserHost?.worldScene.centerOnOrigin();
  }

  public zoomIn(): void {
    this.audio.unlock();
    this.phaserHost?.worldScene.zoomBy(1.18);
  }

  public zoomOut(): void {
    this.audio.unlock();
    this.phaserHost?.worldScene.zoomBy(0.84);
  }

  public setActiveSheet(sheet: ActiveSheet): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.activeSheet = this.activeSheet === sheet ? 'none' : sheet;
    if (this.activeSheet !== 'none') {
      this.selectedBuildingId = null;
      this.selectedTileCoords = null;
    }
    if (this.activeSheet === 'land') {
      this.setTool({ mode: 'land_unlock' });
    } else if (this.activeSheet === 'none' && this.tool.mode === 'land_unlock') {
      this.setTool({ mode: 'inspect_chop' });
    }
    this.notifyImmediate();
  }

  public setActiveModal(modal: ActiveModal): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.activeModal = modal;
    this.notifyImmediate();
  }

  public setSimInspectorOpen(open: boolean): void {
    this.audio.unlock();
    this.audio.play('ui');
    this.simInspectorOpen = open;
    this.notifyImmediate();
  }

  public clearSelection(): void {
    this.selectedBuildingId = null;
    this.selectedTileCoords = null;
    this.notifyImmediate();
  }

  public showErrorToast(msg: string): void {
    this.toastError = msg;
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastError = null;
      this.notifyImmediate();
    }, 3200);
    this.notifyImmediate();
  }

  public async saveToSlot(slotId: SaveSlotId): Promise<boolean> {
    const res = await this.saveManager.saveGame(this.engine, slotId, true);
    this.notifyImmediate();
    return res.ok;
  }

  public async loadFromSlot(slotId: SaveSlotId): Promise<{ ok: boolean; recoveredFromBackup?: boolean; migrated?: boolean; error?: string }> {
    const res = await this.saveManager.loadGame(this.engine, slotId);
    if (res.ok) {
      this.phaserHost?.worldScene.invalidateAllChunkTextures();
      this.centerCamera();
    }
    this.notifyImmediate();
    return res;
  }

  public async restorePreMigrationBackup(slotId: SaveSlotId): Promise<{ ok: boolean; error?: string }> {
    const res = await this.saveManager.restorePreMigrationBackup(this.engine, slotId);
    if (res.ok) {
      this.phaserHost?.worldScene.invalidateAllChunkTextures();
      this.centerCamera();
    }
    this.notifyImmediate();
    return res;
  }

  public async listSaveSlots(): Promise<SaveSlotSummary[]> {
    return this.saveManager.listSlots();
  }

  public startNewGame(cityName: string, difficulty: 'standard' | 'relaxed'): void {
    this.engine.resetNewWorld(cityName, difficulty);
    this.phaserHost?.worldScene.invalidateAllChunkTextures();
    this.centerCamera();
    this.selectedBuildingId = null;
    this.selectedTileCoords = null;
    this.activeSheet = 'none';
    this.activeModal = 'none';
    void this.saveManager.saveGame(this.engine, 'autosave', true);
    this.notifyImmediate();
  }

  public getSnapshot(): GameSnapshot {
    const activeQuest = this.engine.progression.getActiveQuest(this.engine.state);
    const activeQuests = this.engine.progression.getActiveQuests(this.engine.state, 3);
    const allQuests = this.engine.progression.getAllQuestProgress(this.engine.state);
    const buildQueueActive = this.engine.state.buildings.filter((b) => b.status === 'constructing').length;
    const buildQueueCap = getBuildQueueCap(this.engine.state.level);

    return {
      state: this.engine.state,
      activeQuest,
      activeQuests,
      allQuests,
      buildQueueActive,
      buildQueueCap,
      notifications: this.engine.progression.getNotifications(),
      perf: this.perf.getMetrics(),
      offline: { ...OfflineManager.status },
      tool: this.tool,
      overlayMode: this.overlayMode,
      selectedTile: this.selectedTileCoords
        ? this.engine.inspectTile(this.selectedTileCoords.gx, this.selectedTileCoords.gy)
        : null,
      selectedBuildingId: this.selectedBuildingId,
      ghostInfo: this.ghostInfo,
      activeSheet: this.activeSheet,
      activeModal: this.activeModal,
      simInspectorOpen: this.simInspectorOpen,
      toastError: this.toastError,
    };
  }

  public subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private notifyImmediate(): void {
    this.snapshotDirty = false;
    this.emit();
  }

  private emit(): void {
    for (const cb of this.subscribers) cb();
  }
}

export const GameController = new GameControllerImpl();

export function useGameSnapshot(): GameSnapshot {
  const [snap, setSnap] = useState<GameSnapshot>(() => GameController.getSnapshot());
  useEffect(() => {
    return GameController.subscribe(() => {
      setSnap(GameController.getSnapshot());
    });
  }, []);
  return snap;
}
