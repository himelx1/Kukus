import { BUILDINGS } from '../data/buildings.data';
import { POLICY_MAP } from '../data/policies.data';
import { RESOURCE_LIST, RESOURCES, ResourceId } from '../data/resources.data';
import type { WorldEngineState } from '../core/GameState';
import { ResourceSystem } from './ResourceSystem';

export interface MissingMaterialPurchaseItem {
  resourceId: ResourceId;
  amount: number;
}

export class EconomySystem {
  public static createInitialMarketPrices(): Record<ResourceId, number> {
    const prices = {} as Record<ResourceId, number>;
    for (const r of RESOURCE_LIST) {
      prices[r.id] = r.basePrice;
    }
    return prices;
  }

  public static getBuyPrice(state: WorldEngineState, id: ResourceId): number {
    return Math.max(1, Math.round((state.marketPrices[id] ?? RESOURCES[id].basePrice) * 1.15));
  }

  public static getEmergencyCourierBuyPrice(state: WorldEngineState, id: ResourceId): number {
    return Math.max(2, Math.round(this.getBuyPrice(state, id) * 1.45));
  }

  public static getSellPrice(state: WorldEngineState, id: ResourceId): number {
    let mult = 0.85;
    if (state.activePolicies?.includes('free_trade_act')) mult *= 1.12;
    if (state.activeEvent?.id === 'merchant_caravan') mult *= 1.25;
    return Math.max(1, Math.floor((state.marketPrices[id] ?? RESOURCES[id].basePrice) * mult));
  }

  public static getMarketTrend(state: WorldEngineState, id: ResourceId): 'up' | 'down' | 'flat' {
    const cur = state.marketPrices[id] ?? RESOURCES[id].basePrice;
    const prev = state.marketPrevPrices?.[id] ?? RESOURCES[id].basePrice;
    if (cur - prev > 0.25) return 'up';
    if (prev - cur > 0.25) return 'down';
    return 'flat';
  }

  public static getTradeCapacity(state: WorldEngineState): number {
    let cap = 0;
    for (const b of state.buildings) {
      if (b.status !== 'active') continue;
      const def = BUILDINGS[b.defId];
      if (def?.tradeCapacity) {
        cap += Math.round(def.tradeCapacity * (1 + (b.level - 1) * 0.4));
      }
    }
    if (cap > 0 && state.activePolicies?.includes('free_trade_act')) {
      cap = Math.round(cap * 1.3);
    }
    return cap;
  }

  public static quoteMissingMaterialsCost(
    state: WorldEngineState,
    items: MissingMaterialPurchaseItem[],
    useCourierIfNoTradePost = true
  ): {
    totalCost: number;
    usesCourierFee: boolean;
    hasTradePost: boolean;
    canPurchase: boolean;
    reason?: string;
  } {
    const hasTradePost = this.getTradeCapacity(state) > 0;
    if (!hasTradePost && !useCourierIfNoTradePost) {
      return {
        totalCost: 0,
        usesCourierFee: false,
        hasTradePost: false,
        canPurchase: false,
        reason: 'Build a Trading Post first',
      };
    }

    let totalCost = 0;
    for (const item of items) {
      if (item.amount <= 0) continue;
      const unit = hasTradePost
        ? this.getBuyPrice(state, item.resourceId)
        : this.getEmergencyCourierBuyPrice(state, item.resourceId);
      totalCost += unit * item.amount;
      const freeSpace = Math.floor((state.capacities[item.resourceId] ?? 100) - (state.resources[item.resourceId] ?? 0));
      if (freeSpace < item.amount) {
        return {
          totalCost,
          usesCourierFee: !hasTradePost,
          hasTradePost,
          canPurchase: false,
          reason: `Not enough storage space for ${RESOURCES[item.resourceId]?.name ?? item.resourceId} (build Granary/Warehouse)`,
        };
      }
    }

    return {
      totalCost,
      usesCourierFee: !hasTradePost,
      hasTradePost,
      canPurchase: state.coins >= totalCost && items.some((i) => i.amount > 0),
      reason: state.coins < totalCost ? `Need ${totalCost} Coins (have ${Math.floor(state.coins)})` : undefined,
    };
  }

  public static buyMissingMaterials(
    state: WorldEngineState,
    items: MissingMaterialPurchaseItem[],
    allowEmergencyCourier = true
  ): { ok: boolean; reason?: string; cost: number } {
    const quote = this.quoteMissingMaterialsCost(state, items, allowEmergencyCourier);
    if (!quote.canPurchase) {
      return { ok: false, reason: quote.reason ?? 'Cannot purchase missing materials', cost: 0 };
    }
    if (state.coins < quote.totalCost) {
      return { ok: false, reason: `Needs ${quote.totalCost} Coins`, cost: 0 };
    }

    state.coins -= quote.totalCost;
    for (const item of items) {
      if (item.amount <= 0) continue;
      ResourceSystem.addClamped(state, item.resourceId, item.amount);
    }
    state.stats.tradesCompleted += 1;
    return { ok: true, cost: quote.totalCost };
  }

  public static buyResource(
    state: WorldEngineState,
    id: ResourceId,
    amount: number
  ): { ok: boolean; reason?: string; cost: number } {
    const qty = Math.max(1, Math.floor(amount));
    if (this.getTradeCapacity(state) <= 0) {
      return { ok: false, reason: 'Build a Trading Post or Harbor first', cost: 0 };
    }
    const freeSpace = Math.floor(state.capacities[id] - state.resources[id]);
    if (freeSpace <= 0) return { ok: false, reason: 'Storage full', cost: 0 };
    const actualQty = Math.min(qty, freeSpace);
    const unitPrice = this.getBuyPrice(state, id);
    const cost = actualQty * unitPrice;
    if (state.coins < cost) return { ok: false, reason: `Insufficient Coins (needs ${cost}C)`, cost: 0 };

    state.marketPrevPrices ??= {};
    state.marketPrevPrices[id] = state.marketPrices[id];

    state.coins -= cost;
    ResourceSystem.addClamped(state, id, actualQty);
    const base = RESOURCES[id].basePrice;
    state.marketPrices[id] = Math.min(base * 1.65, state.marketPrices[id] * (1 + Math.min(0.08, actualQty * 0.002)));
    state.stats.tradesCompleted += 1;
    return { ok: true, cost };
  }

  public static sellResource(
    state: WorldEngineState,
    id: ResourceId,
    amount: number
  ): { ok: boolean; reason?: string; earned: number } {
    const qty = Math.max(1, Math.floor(amount));
    if (this.getTradeCapacity(state) <= 0) {
      return { ok: false, reason: 'Build a Trading Post or Harbor first', earned: 0 };
    }
    const avail = Math.floor(state.resources[id]);
    if (avail <= 0) return { ok: false, reason: 'Nothing to sell', earned: 0 };
    const actualQty = Math.min(qty, avail);
    const unitPrice = this.getSellPrice(state, id);
    const earned = actualQty * unitPrice;

    state.marketPrevPrices ??= {};
    state.marketPrevPrices[id] = state.marketPrices[id];

    state.resources[id] -= actualQty;
    state.coins += earned;
    state.stats.totalCoinsEarned += earned;
    const base = RESOURCES[id].basePrice;
    state.marketPrices[id] = Math.max(base * 0.55, state.marketPrices[id] * (1 - Math.min(0.1, actualQty * 0.0025)));
    state.stats.tradesCompleted += 1;
    return { ok: true, earned };
  }

  public static sellAllExcess(
    state: WorldEngineState,
    keepAmount = 30
  ): { ok: boolean; reason?: string; totalEarned: number; itemsSold: number } {
    if (this.getTradeCapacity(state) <= 0) {
      return { ok: false, reason: 'Build a Trading Post or Harbor first', totalEarned: 0, itemsSold: 0 };
    }
    let totalEarned = 0;
    let itemsSold = 0;
    const keep = Math.max(0, Math.floor(keepAmount));
    for (const r of RESOURCE_LIST) {
      const avail = Math.floor(state.resources[r.id] ?? 0);
      if (avail > keep) {
        const res = this.sellResource(state, r.id, avail - keep);
        if (res.ok) {
          totalEarned += res.earned;
          itemsSold += avail - keep;
        }
      }
    }
    if (itemsSold === 0) {
      return { ok: false, reason: `No goods exceed ${keep} units`, totalEarned: 0, itemsSold: 0 };
    }
    return { ok: true, totalEarned, itemsSold };
  }

  public static getFireUpkeepDiscount(state: WorldEngineState): number {
    const fireStations = state.buildings.filter(
      (b) => b.defId === 'fire_station' && b.status === 'active'
    ).length;
    return Math.min(0.2, fireStations * 0.05);
  }

  public static tickEconomy(state: WorldEngineState): void {
    let taxPerMin = 0;
    let upkeepPerMin = 0;
    let wagesPerMin = 0;
    let hasShoppingBoost = false;

    const homes = state.buildings.filter(
      (b) => b.status !== 'constructing' && BUILDINGS[b.defId]?.category === 'residential'
    );

    for (const b of state.buildings) {
      if (b.status === 'constructing') continue;
      const def = BUILDINGS[b.defId];
      if (!def) continue;
      if (b.defId === 'shopping_district' && b.status === 'active') hasShoppingBoost = true;
    }

    const fireDiscount = 1 - this.getFireUpkeepDiscount(state);
    const festivalTaxMult = (state.festivalTicksRemaining ?? 0) > 0 ? 1.5 : 1.0;
    const isNightHours = state.timeOfDayHours >= 17.5 || state.timeOfDayHours < 5.5;
    const nightBazaarMult = state.activePolicies?.includes('night_bazaar_act') ? 1.3 : 1.0;

    const scenicNodes = state.buildings.filter(
      (b) =>
        b.status !== 'constructing' &&
        (b.defId === 'village_park' ||
          b.defId === 'botanical_garden' ||
          b.defId === 'fountain_plaza' ||
          b.defId === 'festival_plaza')
    );

    for (const b of state.buildings) {
      if (b.status === 'constructing') continue;
      const def = BUILDINGS[b.defId];
      if (!def) continue;

      const levelScale = 1 + (b.level - 1) * 0.35;
      if (def.taxPerMin && (def.category === 'residential' || b.status === 'active')) {
        let t = def.taxPerMin * levelScale;
        if (def.category === 'residential') {
          const fillRatio = state.population.capacity > 0 ? Math.min(1, state.population.total / state.population.capacity) : 0;
          const nearScenic = scenicNodes.some((s) => Math.abs(s.gx - b.gx) <= 3 && Math.abs(s.gy - b.gy) <= 3);
          t *= fillRatio * state.taxRate * (hasShoppingBoost ? 1.2 : 1.0) * (nearScenic ? 1.2 : 1.0);
        } else if (def.category === 'commercial' || b.defId === 'festival_plaza') {
          const nearHome = homes.some((h) => Math.abs(h.gx - b.gx) <= 3 && Math.abs(h.gy - b.gy) <= 3);
          if (nearHome) t *= 1.2;
          if (def.category === 'commercial') t *= nightBazaarMult;
          if (b.defId === 'night_market' && isNightHours) t *= 2.0;
        }
        taxPerMin += t * festivalTaxMult;
      }

      if (b.enabled && def.upkeepPerMin > 0) {
        const relaxedFactor = state.settings.difficulty === 'relaxed' ? 0.75 : 1.0;
        upkeepPerMin += def.upkeepPerMin * (1 + (b.level - 1) * 0.25) * relaxedFactor * fireDiscount;
      }

      if (b.assignedWorkers > 0) {
        const wageRate = def.workerClass === 'engineer' ? 1.2 : def.workerClass === 'artisan' ? 0.7 : 0.35;
        wagesPerMin += b.assignedWorkers * wageRate;
      }
    }

    // Active civic policies upkeep
    for (const pid of state.activePolicies ?? []) {
      const pDef = POLICY_MAP[pid];
      if (pDef) upkeepPerMin += pDef.upkeepPerMin;
    }

    // Execute net budget per tick (1/60 of per-minute flow)
    const taxTick = taxPerMin / 60;
    const expenseTick = (upkeepPerMin + wagesPerMin) / 60;
    const netTick = taxTick - expenseTick;

    if (netTick >= 0) {
      state.coins += netTick;
      state.stats.totalCoinsEarned += netTick;
    } else {
      state.coins = Math.max(0, state.coins + netTick);
    }

    // Auto-trade every 30 ticks
    let tradeEarned = 0;
    if (state.tick % 30 === 0) {
      const cap = this.getTradeCapacity(state);
      if (cap > 0) {
        for (const rule of Object.values(state.autoTradeRules)) {
          if (!rule || rule.mode === 'none') continue;
          const avail = state.resources[rule.resourceId];
          if (rule.mode === 'sell_excess' && avail > rule.threshold + 2) {
            const batch = Math.min(cap, Math.floor(avail - rule.threshold));
            const res = this.sellResource(state, rule.resourceId, batch);
            if (res.ok) tradeEarned += res.earned;
          } else if (rule.mode === 'buy_below' && avail < rule.threshold) {
            const batch = Math.min(cap, Math.ceil(rule.threshold - avail));
            this.buyResource(state, rule.resourceId, batch);
          }
        }
      }
    }

    // Mean-reversion of market prices every 15 ticks
    if (state.tick % 15 === 0) {
      state.marketPrevPrices ??= {};
      for (const r of RESOURCE_LIST) {
        const cur = state.marketPrices[r.id];
        state.marketPrevPrices[r.id] = cur;
        state.marketPrices[r.id] = Number((cur + (r.basePrice - cur) * 0.08).toFixed(2));
      }
    }

    // Record financial snapshot every 10 ticks (rolling 24 entries)
    if (state.tick % 10 === 0) {
      state.ledger.push({
        tick: state.tick,
        taxIncome: Math.round(taxPerMin),
        tradeIncome: Math.round(tradeEarned * 2),
        upkeepExpense: Math.round(upkeepPerMin),
        wageExpense: Math.round(wagesPerMin),
        net: Math.round(taxPerMin - upkeepPerMin - wagesPerMin),
      });
      if (state.ledger.length > 24) state.ledger.shift();
    }
  }
}
