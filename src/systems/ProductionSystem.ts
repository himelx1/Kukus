import { BUILDINGS } from '../data/buildings.data';
import { RESOURCE_LIST, ResourceId } from '../data/resources.data';
import type { ChunkManager } from '../core/ChunkManager';
import { BiomeId, WorldEngineState } from '../core/GameState';
import type { ClimateModifiers } from './EnvironmentSystem';
import { ResourceSystem } from './ResourceSystem';
import type { RoadNetworkSystem } from './RoadNetworkSystem';
import type { TechModifiers } from './TechSystem';
import type { WorkforceSystem } from './WorkforceSystem';

import type { BuildingInstance } from '../core/GameState';

export interface AdjacencyBonusInfo {
  multiplier: number;
  labels: string[];
}

export class ProductionSystem {
  public static getBuildingAdjacencyBonus(
    b: BuildingInstance,
    state: WorldEngineState,
    chunks: ChunkManager
  ): AdjacencyBonusInfo {
    const def = BUILDINGS[b.defId];
    if (!def) return { multiplier: 1.0, labels: [] };

    let mult = 1.0;
    const labels: string[] = [];

    if (def.category === 'agricultural') {
      let hasFertileOrRiver = false;
      for (let dx = -1; dx <= def.width; dx++) {
        for (let dy = -1; dy <= def.height; dy++) {
          const { chunk, index } = chunks.getTile(b.gx + dx, b.gy + dy);
          const bio = chunk.biomeId[index] as BiomeId;
          if (bio === BiomeId.Fertile || bio === BiomeId.River) {
            hasFertileOrRiver = true;
            break;
          }
        }
        if (hasFertileOrRiver) break;
      }
      if (hasFertileOrRiver) {
        mult *= 1.25;
        labels.push('River / Fertile Irrigation +25%');
      }
    }

    if (def.category === 'production' || def.category === 'industrial') {
      const nearSupply = state.buildings.some((other) => {
        if (other.id === b.id || other.status === 'constructing') return false;
        if (other.defId !== 'warehouse' && other.defId !== 'cart_depot') return false;
        return Math.abs(other.gx - b.gx) <= 3 && Math.abs(other.gy - b.gy) <= 3;
      });
      if (nearSupply) {
        mult *= 1.15;
        labels.push('Logistics Hub Proximity +15%');
      }
    }

    if (def.category === 'commercial' || def.id === 'festival_plaza') {
      const nearHomes = state.buildings.some((other) => {
        if (other.status === 'constructing') return false;
        const oDef = BUILDINGS[other.defId];
        if (!oDef || oDef.category !== 'residential') return false;
        return Math.abs(other.gx - b.gx) <= 3 && Math.abs(other.gy - b.gy) <= 3;
      });
      if (nearHomes) {
        mult *= 1.2;
        labels.push('Neighborhood Foot Traffic +20%');
      }
    }

    if (def.category === 'residential') {
      const nearScenic = state.buildings.some((other) => {
        if (other.status === 'constructing') return false;
        return (
          (other.defId === 'village_park' ||
            other.defId === 'botanical_garden' ||
            other.defId === 'fountain_plaza' ||
            other.defId === 'festival_plaza') &&
          Math.abs(other.gx - b.gx) <= 3 &&
          Math.abs(other.gy - b.gy) <= 3
        );
      });
      if (nearScenic) {
        mult *= 1.2;
        labels.push('Scenic Plaza Aura +20%');
      }
    }

    return { multiplier: mult, labels };
  }

  public tickProduction(
    state: WorldEngineState,
    chunks: ChunkManager,
    roadNet: RoadNetworkSystem,
    workforce: WorkforceSystem,
    techMods: TechModifiers,
    climate: ClimateModifiers
  ): void {
    // 1. Power balance
    let powerGen = 0;
    let powerDem = 0;
    for (const b of state.buildings) {
      if (b.status === 'constructing' || !b.enabled) continue;
      const def = BUILDINGS[b.defId];
      if (!def) continue;
      const lvl = 1 + (b.level - 1) * 0.35;

      if (def.powerOutput) {
        let p = def.powerOutput * lvl;
        if (b.defId === 'wind_turbine') p *= climate.windPowerMult;
        if (b.defId === 'solar_array') p *= climate.solarPowerMult;
        if (b.defId === 'coal_power_plant') {
          if (b.assignedWorkers < def.minWorkers || state.resources.coal < 1) {
            p = 0;
          }
        }
        powerGen += Math.round(p);
      }
      if (def.powerDemand) {
        powerDem += Math.round(def.powerDemand);
      }
    }

    state.powerGenerated = powerGen;
    state.powerDemand = powerDem;
    const powerFactor = powerDem === 0 ? 1 : powerGen >= powerDem ? 1 : Math.max(0.25, powerGen / Math.max(1, powerDem));

    // Track per-minute net estimate
    const tickDeltas: Partial<Record<ResourceId, number>> = {};
    for (const r of RESOURCE_LIST) tickDeltas[r.id] = 0;

    // 2. Building production & status resolution
    for (const b of state.buildings) {
      if (b.status === 'constructing') continue;
      const def = BUILDINGS[b.defId];
      if (!def) continue;

      if (!b.enabled) {
        b.status = 'disabled';
        continue;
      }

      if (def.requiresRoad) {
        const { connectedCluster, bestRoadTier } = roadNet.evaluateBuildingRoadAccess(b, chunks);
        if (connectedCluster === 0 || (def.minRoadTier && bestRoadTier < def.minRoadTier)) {
          b.status = 'no_road';
          continue;
        }
      }

      if (def.maxWorkers > 0 && b.assignedWorkers < def.minWorkers) {
        b.status = 'no_workers';
        continue;
      }

      if (def.powerDemand && powerGen === 0) {
        b.status = 'no_power';
        continue;
      }

      if (!def.recipe) {
        b.status = 'active';
        continue;
      }

      const workerEff = workforce.getWorkerEfficiency(b, state, techMods.workerNeedReduction);
      if (workerEff <= 0) {
        b.status = 'no_workers';
        continue;
      }

      const levelMult = 1 + (b.level - 1) * 0.35;
      const roadMult = roadNet.getBuildingLogisticsMultiplier(b, state, chunks);
      const adjBonus = ProductionSystem.getBuildingAdjacencyBonus(b, state, chunks);

      let catMult = techMods.prodSpeedMult * adjBonus.multiplier;
      if (def.category === 'agricultural') {
        catMult *= techMods.farmYieldMult * climate.farmMult;
        if (state.activeEvent?.id === 'bountiful_harvest') catMult *= 1.35;
      } else if (def.requiredDeposit) {
        catMult *= techMods.mineYieldMult;
        if (state.activeEvent?.id === 'gold_rush') catMult *= 1.35;
      }

      if (state.activePolicies?.includes('double_shift') && (def.category === 'production' || def.category === 'industrial')) {
        catMult *= 1.25;
      }
      if (state.activePolicies?.includes('green_charter') && def.category === 'industrial') {
        catMult *= 0.9;
      }
      if (
        state.activePolicies?.includes('timber_stewards') &&
        (b.defId === 'woodcutter_camp' || b.defId === 'forester_hut' || b.defId === 'bamboo_grove')
      ) {
        catMult *= 1.35;
      }
      if (state.activePolicies?.includes('artisan_stipend') && def.category === 'production') {
        catMult *= 1.25;
      }

      // Tools bonus if any tools exist in inventory for production/industrial buildings
      let toolsMult = 1.0;
      if ((def.category === 'production' || def.category === 'industrial') && state.resources.tools >= 1) {
        toolsMult = 1.15;
        if (state.tick % 45 === 0 && b.id % 3 === 0) {
          state.resources.tools = Math.max(0, state.resources.tools - 0.5);
        }
      }

      const ratePerSec =
        (1 / def.recipe.cycleSeconds) *
        workerEff *
        levelMult *
        roadMult *
        catMult *
        toolsMult *
        (def.powerDemand ? powerFactor : 1);

      b.prodProgress += ratePerSec;

      if (b.prodProgress >= 1.0) {
        const hasInputs = ResourceSystem.canAfford(state, 0, def.recipe.inputs);
        if (!hasInputs) {
          b.status = 'no_inputs';
          b.prodProgress = 0.99;
          continue;
        }

        const hasSpace =
          Object.keys(def.recipe.outputs).length === 0 ||
          ResourceSystem.hasSpaceForAll(state, def.recipe.outputs);
        if (!hasSpace) {
          b.status = 'storage_full';
          b.prodProgress = 0.99;
          continue;
        }

        // Atomic execute cycle
        ResourceSystem.consume(state, 0, def.recipe.inputs);
        for (const [k, v] of Object.entries(def.recipe.outputs)) {
          if (v) {
            const rid = k as ResourceId;
            ResourceSystem.addClamped(state, rid, v);
            tickDeltas[rid] = (tickDeltas[rid] ?? 0) + v;
          }
        }
        for (const [k, v] of Object.entries(def.recipe.inputs)) {
          if (v) {
            const rid = k as ResourceId;
            tickDeltas[rid] = (tickDeltas[rid] ?? 0) - v;
          }
        }
        state.xp += def.recipe.xpPerCycle;
        b.prodProgress -= 1.0;
        b.status = 'active';
      } else {
        b.status = 'active';
      }
    }

    // Exponential moving average for UI per-minute rate estimates
    for (const r of RESOURCE_LIST) {
      const prev = state.netRatesPerMin[r.id] ?? 0;
      const instantPerMin = (tickDeltas[r.id] ?? 0) * 60;
      state.netRatesPerMin[r.id] = Number((prev * 0.92 + instantPerMin * 0.08).toFixed(1));
    }
  }
}
