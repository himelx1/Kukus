import { BUILDINGS, BuildingCategory } from '../data/buildings.data';
import type { BuildingInstance, WorldEngineState } from '../core/GameState';

const CATEGORY_ORDER: BuildingCategory[] = [
  'energy',
  'agricultural',
  'healthcare',
  'environmental',
  'production',
  'industrial',
  'commercial',
  'educational',
  'government',
  'transportation',
  'storage',
  'recreational',
  'residential',
];

export class WorkforceSystem {
  public assignWorkers(state: WorldEngineState, workerStrainReduction = 0): void {
    let availableTotal = state.population.total;
    let employed = 0;

    // Reset assignments first
    for (const b of state.buildings) {
      if (b.status === 'constructing' || !b.enabled) {
        b.assignedWorkers = 0;
      }
    }

    const activeBuildings = state.buildings.filter(
      (b) => b.status !== 'constructing' && b.enabled && (BUILDINGS[b.defId]?.maxWorkers ?? 0) > 0
    );

    // Sort by player priority desc, then category critical order
    activeBuildings.sort((a, b) => {
      const defA = BUILDINGS[a.defId]!;
      const defB = BUILDINGS[b.defId]!;
      const prioA = state.workforcePriorities[defA.category] ?? 3;
      const prioB = state.workforcePriorities[defB.category] ?? 3;
      if (prioA !== prioB) return prioB - prioA;
      return CATEGORY_ORDER.indexOf(defA.category) - CATEGORY_ORDER.indexOf(defB.category);
    });

    // Pass 1: Assign locked/pinned buildings first
    for (const b of activeBuildings) {
      const def = BUILDINGS[b.defId]!;
      const effectiveMax = Math.max(1, Math.round(def.maxWorkers * (1 - workerStrainReduction)));
      if (b.lockedWorkers !== null) {
        const want = Math.min(effectiveMax, Math.max(0, b.lockedWorkers));
        const give = Math.min(availableTotal, want);
        b.assignedWorkers = give;
        availableTotal -= give;
        employed += give;
      }
    }

    // Pass 2: Ensure minimum workers for unlocked buildings
    for (const b of activeBuildings) {
      if (b.lockedWorkers !== null) continue;
      const def = BUILDINGS[b.defId]!;
      const minNeed = Math.min(availableTotal, def.minWorkers);
      b.assignedWorkers = minNeed;
      availableTotal -= minNeed;
      employed += minNeed;
    }

    // Pass 3: Fill up to maxWorkers proportionally
    for (const b of activeBuildings) {
      if (availableTotal <= 0) break;
      if (b.lockedWorkers !== null) continue;
      const def = BUILDINGS[b.defId]!;
      const effectiveMax = Math.max(1, Math.round(def.maxWorkers * (1 - workerStrainReduction)));
      const room = Math.max(0, effectiveMax - b.assignedWorkers);
      const extra = Math.min(availableTotal, room);
      b.assignedWorkers += extra;
      availableTotal -= extra;
      employed += extra;
    }

    state.population.employed = employed;
    state.population.unemployed = Math.max(0, state.population.total - employed);
  }

  public getWorkerEfficiency(b: BuildingInstance, state: WorldEngineState, workerStrainReduction = 0): number {
    const def = BUILDINGS[b.defId];
    if (!def || def.maxWorkers === 0) return 1.0;
    if (b.assignedWorkers < def.minWorkers || b.assignedWorkers === 0) return 0;

    const effectiveMax = Math.max(1, Math.round(def.maxWorkers * (1 - workerStrainReduction)));
    const ratio = Math.min(1.15, b.assignedWorkers / effectiveMax);
    const happinessMod = 0.65 + (state.population.happiness / 100) * 0.5;
    return Math.pow(ratio, 0.85) * happinessMod;
  }
}
