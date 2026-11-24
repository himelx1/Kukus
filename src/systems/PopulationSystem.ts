import { BUILDINGS } from '../data/buildings.data';
import type { WorldEngineState } from '../core/GameState';
import { ResourceSystem } from './ResourceSystem';
import { CitizenAccounting } from './CitizenAccounting';
import { DistrictServiceSystem } from './DistrictServiceSystem';

export class PopulationSystem {
  public tickPopulation(state: WorldEngineState, weatherWaterMult: number): void {
    let housingCap = 0;
    let waterOut = 0;
    let waterDemand = 0;
    let healthCap = 0;
    let eduCap = 0;
    let safetyCap = 0;
    let recCap = 0;
    let flatHappiness = 0;

    for (const b of state.buildings) {
      if (b.status === 'constructing') continue;
      const def = BUILDINGS[b.defId];
      if (!def) continue;
      const levelScale = 1 + (b.level - 1) * 0.35;

      if (def.housingCapacity) {
        housingCap += Math.round(def.housingCapacity * levelScale);
      }
      if (def.waterOutput && b.enabled) {
        waterOut += Math.round(def.waterOutput * levelScale);
      }
      if (def.waterDemand) {
        waterDemand += Math.round(def.waterDemand * weatherWaterMult);
      }
      if (b.status === 'active' || def.minWorkers === 0) {
        if (def.healthcareBonus) healthCap += Math.round(def.healthcareBonus * levelScale);
        if (def.educationBonus) {
          const cov = DistrictServiceSystem.getBuildingCoverage(b, state);
          eduCap += Math.round(def.educationBonus * levelScale * cov.educationBonusMult);
        }
        if (def.safetyBonus) safetyCap += Math.round(def.safetyBonus * levelScale);
        if (def.recreationBonus) recCap += Math.round(def.recreationBonus * levelScale);
        if (def.happinessBonus) flatHappiness += def.happinessBonus;
      }
    }

    const waterPolicyCut = state.activePolicies?.includes('eco_water_pact') ? 0.75 : 1.0;
    state.waterGenerated = waterOut;
    state.waterDemand = Math.round(Math.max(state.population.total, waterDemand) * waterPolicyCut);
    state.population.capacity = housingCap;

    const pop = state.population.total;
    // Food consumption evaluated every 10 ticks for smooth stability
    let foodSatisfaction = 1;
    let foodVariety = 1;
    if (pop > 0 && state.tick % 10 === 0) {
      const nutritionNeeded = pop * 0.032; // ~0.19 units / citizen / min
      const res = ResourceSystem.consumeFoodUnits(state, nutritionNeeded);
      foodSatisfaction = res.satisfiedRatio;
      foodVariety = res.varietyCount;
      state.population.needs.food = foodSatisfaction;
    } else if (pop === 0) {
      state.population.needs.food = 1;
    } else {
      foodSatisfaction = state.population.needs.food;
    }

    const medStockBoost = (state.resources.medicine ?? 0) >= 1 ? 0.15 : 0;
    if (pop > 0 && state.tick % 20 === 0) {
      if ((state.resources.medicine ?? 0) >= 0.25) {
        state.resources.medicine = Math.max(0, state.resources.medicine - 0.25);
      }
      if ((state.resources.coffee ?? 0) >= 0.2) {
        state.resources.coffee = Math.max(0, state.resources.coffee - 0.2);
      }
      if ((state.resources.spices ?? 0) >= 0.2) {
        state.resources.spices = Math.max(0, state.resources.spices - 0.2);
      }
      if ((state.resources.tea ?? 0) >= 0.2) {
        state.resources.tea = Math.max(0, state.resources.tea - 0.2);
      }
    }

    const waterRatio = pop === 0 ? 1 : Math.min(1, waterOut / Math.max(1, state.waterDemand));
    const healthRatio = pop === 0 ? 1 : Math.min(1, healthCap / Math.max(10, pop) + medStockBoost);
    const eduRatio = pop === 0 ? 0 : Math.min(1, eduCap / Math.max(15, pop));
    const safetyRatio = pop === 0 ? 1 : Math.min(1, safetyCap / Math.max(15, pop));
    const recRatio = pop === 0 ? 0.5 : Math.min(1, recCap / Math.max(20, pop));

    state.population.needs.water = waterRatio;
    state.population.needs.healthcare = healthRatio;
    state.population.needs.education = eduRatio;
    state.population.needs.safety = safetyRatio;
    state.population.needs.recreation = recRatio;

    // Tax impact on happiness
    const taxPenalty =
      state.taxRate <= 0.6
        ? 8
        : state.taxRate <= 1.05
          ? 0
          : state.taxRate <= 1.55
            ? -12
            : -26;

    const pollutionPenalty = Math.min(20, state.environment.avgPollution * 0.45);
    const foodDelta = foodSatisfaction >= 0.9 ? 8 + Math.min(6, foodVariety * 1.5) : -24 * (1 - foodSatisfaction);
    const waterDelta = pop > 8 && waterRatio < 0.8 ? -16 * (1 - waterRatio) : waterRatio * 6;
    const servicesDelta = (healthRatio + safetyRatio + recRatio) * 5;
    const sustainabilityDelta = (state.environment.sustainability - 50) * 0.14;

    const hasFestival = (state.festivalTicksRemaining ?? 0) > 0;
    const hasPlazaOrTech =
      state.unlockedTechIds.includes('civic_festivals') ||
      state.buildings.some((b) => b.defId === 'festival_plaza' && b.status !== 'constructing');
    const festivalBoost = hasFestival ? (hasPlazaOrTech ? 22 : 15) : 0;

    let policyHappy = 0;
    if (state.activePolicies?.includes('free_bread')) policyHappy += 10;
    if (state.activePolicies?.includes('double_shift')) policyHappy -= 6;
    const isEveningOrNight = state.timeOfDayHours >= 17.5 || state.timeOfDayHours < 5.5;
    if (state.activePolicies?.includes('night_bazaar_act') && isEveningOrNight) policyHappy += 4;
    const luxuryComfort =
      ((state.resources.coffee ?? 0) >= 1 ? 2 : 0) +
      ((state.resources.tea ?? 0) >= 1 ? 2 : 0) +
      ((state.resources.spices ?? 0) >= 1 ? 2 : 0) +
      ((state.resources.luxury_goods ?? 0) >= 1 ? 3 : 0);

    const homelessPenalty = Math.min(18, (state.population.homeless ?? 0) * 1.5);
    const rawHappiness =
      52 +
      foodDelta +
      waterDelta +
      taxPenalty +
      servicesDelta +
      Math.min(18, flatHappiness) +
      sustainabilityDelta +
      festivalBoost +
      policyHappy +
      luxuryComfort -
      pollutionPenalty -
      homelessPenalty;

    state.population.happiness = Math.round(Math.max(0, Math.min(100, rawHappiness)));

    // Population growth or emigration
    if (housingCap > pop && state.population.happiness >= 48 && foodSatisfaction > 0.4) {
      // First settlers arrive quickly once Leaf Huts are built
      const baseRate = pop < 8 ? 0.45 : (0.12 + (state.population.happiness - 45) * 0.012);
      const festGrowth = hasFestival ? 1.35 : 1.0;
      state.population.growthAccumulator += baseRate * festGrowth;
      if (state.population.growthAccumulator >= 1) {
        const gained = Math.min(housingCap - pop, Math.floor(state.population.growthAccumulator));
        state.population.total += gained;
        state.population.growthAccumulator -= gained;
      }
    } else if (pop > 4 && (state.population.happiness < 25 || foodSatisfaction < 0.15)) {
      state.population.growthAccumulator -= 0.18;
      if (state.population.growthAccumulator <= -1) {
        const lost = Math.min(pop - 4, Math.floor(Math.abs(state.population.growthAccumulator)));
        state.population.total = Math.max(4, pop - lost);
        state.population.growthAccumulator += lost;
      }
    }

    if (state.population.total > housingCap) {
      state.population.total = housingCap;
    }

    if (state.population.total > state.stats.maxPopulation) {
      state.stats.maxPopulation = state.population.total;
    }

    // Class distribution derived cleanly from Education coverage
    const total = state.population.total;
    const engineerShare = eduRatio >= 0.4 ? Math.min(0.28, (eduRatio - 0.3) * 0.4) : 0;
    const artisanShare = eduRatio >= 0.15 ? Math.min(0.4, eduRatio * 0.5) : Math.min(0.15, total > 12 ? 0.1 : 0);
    const engineers = Math.floor(total * engineerShare);
    const artisans = Math.floor(total * artisanShare);
    const laborers = Math.max(0, total - engineers - artisans);

    state.population.classes = {
      laborer: laborers,
      artisan: artisans,
      engineer: engineers,
    };

    CitizenAccounting.reconcileCohorts(state);
  }
}
