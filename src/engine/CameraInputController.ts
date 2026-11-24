import type Phaser from 'phaser';
import type { ChunkManager } from '../core/ChunkManager';
import {
  gridToIso,
  isPointInIsoDiamond,
  isoToGridApprox,
} from '../core/IsoMath';

export interface CameraGestureCallbacks {
  onTapTile: (gx: number, gy: number) => void;
  onLongPressTile: (gx: number, gy: number) => void;
  onDragPaintTile: (gx: number, gy: number) => void;
  isPaintMode: () => boolean;
  onUserGestureAudioUnlock: () => void;
  onCameraMoved: (x: number, y: number, zoom: number) => void;
}

export class CameraInputController {
  private readonly scene: Phaser.Scene;
  private readonly chunks: ChunkManager;
  private readonly callbacks: CameraGestureCallbacks;

  private isDragging = false;
  private dragMoved = false;
  private downScreenX = 0;
  private downScreenY = 0;
  private lastScreenX = 0;
  private lastScreenY = 0;
  private velX = 0;
  private velY = 0;
  private downTime = 0;
  private longPressFired = false;
  private lastPaintedKey = '';

  private isPinching = false;
  private lastPinchDist = 0;

  private readonly maxZoom = 2.35;

  constructor(
    scene: Phaser.Scene,
    chunks: ChunkManager,
    callbacks: CameraGestureCallbacks
  ) {
    this.scene = scene;
    this.chunks = chunks;
    this.callbacks = callbacks;

    scene.input.addPointer(2); // Support multi-touch pinch

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.event && pointer.event.target !== scene.game.canvas) return;
      callbacks.onUserGestureAudioUnlock();

      const p1 = scene.input.pointer1;
      const p2 = scene.input.pointer2;

      if (p1.isDown && p2.isDown) {
        this.isPinching = true;
        this.isDragging = false;
        this.lastPinchDist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        return;
      }

      this.isPinching = false;
      this.isDragging = true;
      this.dragMoved = false;
      this.longPressFired = false;
      this.downScreenX = pointer.x;
      this.downScreenY = pointer.y;
      this.lastScreenX = pointer.x;
      this.lastScreenY = pointer.y;
      this.downTime = performance.now();
      this.velX = 0;
      this.velY = 0;
      this.lastPaintedKey = '';
    });

    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const p1 = scene.input.pointer1;
      const p2 = scene.input.pointer2;

      if (p1.isDown && p2.isDown) {
        this.isPinching = true;
        this.isDragging = false;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (this.lastPinchDist > 0) {
          const factor = dist / this.lastPinchDist;
          const midX = (p1.x + p2.x) * 0.5;
          const midY = (p1.y + p2.y) * 0.5;
          this.zoomAroundScreenPoint(factor, midX, midY);
        }
        this.lastPinchDist = dist;
        return;
      }

      if (!this.isDragging || !pointer.isDown) return;

      const totalDist = Math.hypot(pointer.x - this.downScreenX, pointer.y - this.downScreenY);
      if (totalDist > 9) {
        this.dragMoved = true;
      }

      if (this.dragMoved) {
        if (this.callbacks.isPaintMode()) {
          const hit = this.pickTileAtScreen(pointer.x, pointer.y);
          if (hit) {
            const key = `${hit.gx}:${hit.gy}`;
            if (key !== this.lastPaintedKey) {
              this.lastPaintedKey = key;
              this.callbacks.onDragPaintTile(hit.gx, hit.gy);
            }
          }
        } else {
          const cam = scene.cameras.main;
          const dx = (pointer.x - this.lastScreenX) / cam.zoom;
          const dy = (pointer.y - this.lastScreenY) / cam.zoom;
          cam.scrollX -= dx;
          cam.scrollY -= dy;
          this.clampCameraToBounds();
          this.velX = dx * 0.65;
          this.velY = dy * 0.65;
          this.callbacks.onCameraMoved(cam.scrollX, cam.scrollY, cam.zoom);
        }
      }

      this.lastScreenX = pointer.x;
      this.lastScreenY = pointer.y;
    });

    scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const p1 = scene.input.pointer1;
      const p2 = scene.input.pointer2;
      if (this.isPinching && (!p1.isDown || !p2.isDown)) {
        this.isPinching = false;
        this.lastPinchDist = 0;
        return;
      }

      if (this.isDragging && !this.dragMoved && !this.longPressFired) {
        const hit = this.pickTileAtScreen(pointer.x, pointer.y);
        if (hit) {
          this.callbacks.onTapTile(hit.gx, hit.gy);
        }
      }
      this.isDragging = false;
    });

    scene.input.on(
      'wheel',
      (
        pointer: Phaser.Input.Pointer,
        _objs: unknown,
        _dx: number,
        dy: number
      ) => {
        if (pointer.event && pointer.event.target !== scene.game.canvas) return;
        const factor = dy < 0 ? 1.12 : 0.89;
        this.zoomAroundScreenPoint(factor, pointer.x, pointer.y);
      }
    );
  }

  /**
   * Computes camera pan & min-zoom limits strictly from currently unlocked territory.
   * Starting 20 tiles stay closely framed; unlocking more land progressively opens movement.
   */
  public getDynamicLimits(): {
    minCenterX: number;
    maxCenterX: number;
    minCenterY: number;
    maxCenterY: number;
    minZoom: number;
  } {
    const b = this.chunks.getUnlockedGridBounds();
    const corners = [
      gridToIso(b.minGx, b.minGy, 2),
      gridToIso(b.maxGx, b.minGy, 2),
      gridToIso(b.minGx, b.maxGy, 2),
      gridToIso(b.maxGx, b.maxGy, 2),
    ];

    let minSx = Infinity;
    let maxSx = -Infinity;
    let minSy = Infinity;
    let maxSy = -Infinity;
    for (const c of corners) {
      if (c.sx < minSx) minSx = c.sx;
      if (c.sx > maxSx) maxSx = c.sx;
      if (c.sy < minSy) minSy = c.sy;
      if (c.sy > maxSy) maxSy = c.sy;
    }

    const extraTiles = Math.max(0, b.count - 20);
    // At 20 tiles: tight ~115px horizontal / ~90px vertical frontier margin; expands with unlocked land
    const padX = 115 + Math.min(280, Math.sqrt(extraTiles) * 24);
    const padY = 90 + Math.min(220, Math.sqrt(extraTiles) * 20);
    const minZoom = Math.max(0.45, 0.98 - Math.sqrt(extraTiles) * 0.042);

    return {
      minCenterX: minSx - padX,
      maxCenterX: maxSx + padX,
      minCenterY: minSy - padY,
      maxCenterY: maxSy + padY + 16,
      minZoom,
    };
  }

  public clampCamera(): void {
    const cam = this.scene.cameras.main;
    this.clampCameraToBounds();
    this.callbacks.onCameraMoved(cam.scrollX, cam.scrollY, cam.zoom);
  }

  private clampCameraToBounds(): void {
    const cam = this.scene.cameras.main;
    const limits = this.getDynamicLimits();

    if (cam.zoom < limits.minZoom) {
      cam.setZoom(limits.minZoom);
    } else if (cam.zoom > this.maxZoom) {
      cam.setZoom(this.maxZoom);
    }

    const halfW = cam.width * 0.5;
    const halfH = cam.height * 0.5;
    const centerX = cam.scrollX + halfW;
    const centerY = cam.scrollY + halfH;

    const clampedX = Math.max(limits.minCenterX, Math.min(limits.maxCenterX, centerX));
    const clampedY = Math.max(limits.minCenterY, Math.min(limits.maxCenterY, centerY));

    cam.scrollX = clampedX - halfW;
    cam.scrollY = clampedY - halfH;
  }

  public update(dtSec: number): void {
    // Long press detection
    if (this.isDragging && !this.dragMoved && !this.longPressFired) {
      if (performance.now() - this.downTime >= 460) {
        this.longPressFired = true;
        const hit = this.pickTileAtScreen(this.downScreenX, this.downScreenY);
        if (hit) {
          this.callbacks.onLongPressTile(hit.gx, hit.gy);
        }
      }
    }

    // Inertial camera glide after drag release
    if (!this.isDragging && (Math.abs(this.velX) > 0.25 || Math.abs(this.velY) > 0.25)) {
      const cam = this.scene.cameras.main;
      const prevX = cam.scrollX;
      const prevY = cam.scrollY;
      cam.scrollX -= this.velX;
      cam.scrollY -= this.velY;
      this.clampCameraToBounds();
      if (cam.scrollX === prevX) this.velX = 0;
      if (cam.scrollY === prevY) this.velY = 0;

      const damping = Math.pow(0.08, dtSec);
      this.velX *= damping;
      this.velY *= damping;
      this.callbacks.onCameraMoved(cam.scrollX, cam.scrollY, cam.zoom);
    }
  }

  public zoomByStep(factor: number): void {
    const cam = this.scene.cameras.main;
    this.zoomAroundScreenPoint(factor, cam.width * 0.5, cam.height * 0.5);
  }

  public zoomAroundScreenPoint(factor: number, screenX: number, screenY: number): void {
    const cam = this.scene.cameras.main;
    const limits = this.getDynamicLimits();
    const before = cam.getWorldPoint(screenX, screenY);
    const nextZoom = Math.max(limits.minZoom, Math.min(this.maxZoom, cam.zoom * factor));
    cam.setZoom(nextZoom);
    const after = cam.getWorldPoint(screenX, screenY);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.clampCameraToBounds();
    this.callbacks.onCameraMoved(cam.scrollX, cam.scrollY, cam.zoom);
  }

  public centerOnGrid(gx: number, gy: number): void {
    const cam = this.scene.cameras.main;
    const { sx, sy } = gridToIso(gx, gy, 2);
    cam.centerOn(sx, sy);
    this.clampCameraToBounds();
    this.callbacks.onCameraMoved(cam.scrollX, cam.scrollY, cam.zoom);
  }

  public pickTileAtScreen(screenX: number, screenY: number): { gx: number; gy: number } | null {
    const cam = this.scene.cameras.main;
    const worldPt = cam.getWorldPoint(screenX, screenY);

    // Search a neighborhood around approximate elevation=2 projection, sorted front-to-back
    const approx = isoToGridApprox(worldPt.x, worldPt.y + 16);
    const candidates: Array<{ gx: number; gy: number; depth: number }> = [];

    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const gx = approx.gx + dx;
        const gy = approx.gy + dy;
        candidates.push({ gx, gy, depth: gx + gy });
      }
    }

    candidates.sort((a, b) => b.depth - a.depth);
    for (const c of candidates) {
      const { chunk, index } = this.chunks.getTile(c.gx, c.gy);
      const elev = chunk.elevation[index];
      const { sx, sy } = gridToIso(c.gx, c.gy, elev);
      if (isPointInIsoDiamond(worldPt.x, worldPt.y, sx, sy + 16)) {
        return { gx: c.gx, gy: c.gy };
      }
    }
    return approx;
  }
}
