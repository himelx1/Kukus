import React, { useState } from 'react';
import { RESOURCE_LIST } from '../../data/resources.data';
import { EconomySystem } from '../../systems/EconomySystem';
import { GameController, GameSnapshot } from '../bridge/GameController';
import { SheetContainer } from './SheetContainer';

export const EconomySheet: React.FC<{ snap: GameSnapshot }> = ({ snap }) => {
  const [query, setQuery] = useState('');
  const { state } = snap;
  const tradeCap = EconomySystem.getTradeCapacity(state);
  const fireDiscount = Math.round(EconomySystem.getFireUpkeepDiscount(state) * 100);
  const latestLedger = state.ledger[state.ledger.length - 1];
  const q = query.trim().toLowerCase();

  const visibleResources = RESOURCE_LIST.filter(
    (r) =>
      (state.level >= r.unlockLevel || state.resources[r.id] > 0) &&
      (!q || r.name.toLowerCase().includes(q) || r.shortCode.toLowerCase().includes(q))
  );

  return (
    <SheetContainer
      title="Economy & Market"
      subtitle={`Treasury: ${Math.floor(state.coins).toLocaleString()} Coins · Trade Cap: ${tradeCap}/batch`}
    >
      <div className="space-y-4">
        {/* Tax Policy Selector */}
        <div className="p-3 rounded-xl bg-emerald-950/50 border border-emerald-900/50">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="font-semibold text-stone-200">Tax Rate Policy</span>
            <span className="text-stone-400">
              {state.taxRate <= 0.6
                ? '+8 Happiness'
                : state.taxRate <= 1.05
                  ? 'Balanced'
                  : state.taxRate <= 1.55
                    ? '-12 Happiness'
                    : '-26 Happiness'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {[
              [0.5, 'Low 0.5×'],
              [1.0, 'Normal 1×'],
              [1.5, 'High 1.5×'],
              [2.0, 'Max 2×'],
            ].map(([rate, label]) => (
              <button
                key={String(rate)}
                type="button"
                onClick={() => GameController.dispatch({ type: 'SET_TAX_RATE', rate: Number(rate) })}
                className={`min-h-[44px] rounded-lg text-xs font-medium transition-colors ${
                  Math.abs(state.taxRate - Number(rate)) < 0.05
                    ? 'bg-amber-500 text-stone-950 font-semibold'
                    : 'bg-stone-900 text-stone-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Rolling Financial Ledger */}
        <div className="grid grid-cols-4 gap-2 text-center text-xs tabular-nums">
          <div className="p-2.5 rounded-xl bg-emerald-950/45 border border-emerald-900/45">
            <div className="text-[10px] text-stone-400">Tax/min</div>
            <div className="font-bold text-emerald-300">+{latestLedger?.taxIncome ?? 0}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-950/45 border border-emerald-900/45">
            <div className="text-[10px] text-stone-400">Upkeep/m</div>
            <div className="font-bold text-orange-300">-{latestLedger?.upkeepExpense ?? 0}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-950/45 border border-emerald-900/45">
            <div className="text-[10px] text-stone-400">Wages/m</div>
            <div className="font-bold text-orange-300">-{latestLedger?.wageExpense ?? 0}</div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-950/45 border border-emerald-900/45">
            <div className="text-[10px] text-stone-400">Net/min</div>
            <div
              className={`font-bold ${
                (latestLedger?.net ?? 0) >= 0 ? 'text-amber-300' : 'text-red-400'
              }`}
            >
              {(latestLedger?.net ?? 0) >= 0 ? `+${latestLedger?.net ?? 0}` : latestLedger?.net ?? 0}
            </div>
          </div>
        </div>

        {fireDiscount > 0 || state.activeEvent?.id === 'merchant_caravan' || state.activePolicies?.includes('free_trade_act') ? (
          <div className="px-3 py-2 rounded-xl bg-amber-950/45 border border-amber-700/45 text-[11px] text-amber-200 flex flex-wrap gap-3 tabular-nums">
            {fireDiscount > 0 ? <span>Fire Brigade Upkeep Savings: -{fireDiscount}%</span> : null}
            {state.activePolicies?.includes('free_trade_act') ? (
              <span>Open Harbor Charter: +30% Cap · +12% Sell</span>
            ) : null}
            {state.activeEvent?.id === 'merchant_caravan' ? (
              <span>Merchant Caravan: +25% Sell ({state.activeEvent.ticksRemaining}s)</span>
            ) : null}
          </div>
        ) : null}

        {/* Dynamic Market Exchange */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-stone-300">Global Market Exchange</h3>
            {tradeCap === 0 ? (
              <span className="text-[11px] text-amber-300">Build a Trading Post to unlock trading</span>
            ) : (
              <button
                type="button"
                onClick={() => GameController.dispatch({ type: 'SELL_ALL_EXCESS', keepAmount: 30 })}
                className="min-h-[38px] px-3 rounded-lg bg-amber-500 text-stone-950 font-bold text-xs"
              >
                Sell Surplus (&gt;30)
              </button>
            )}
          </div>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter goods..."
            className="w-full mb-2.5 px-3 py-2 rounded-xl bg-[#07150e] border border-emerald-800/60 text-xs text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-amber-400"
          />

          <div className="space-y-1.5">
            {visibleResources.map((r) => {
              const stock = Math.floor(state.resources[r.id]);
              const buyP = EconomySystem.getBuyPrice(state, r.id);
              const sellP = EconomySystem.getSellPrice(state, r.id);
              const rule = state.autoTradeRules[r.id];

              return (
                <div
                  key={r.id}
                  className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-900/45 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums"
                >
                  <div className="min-w-[110px]">
                    <div className="font-semibold text-stone-100">{r.name}</div>
                    <div className="text-[11px] text-stone-400">
                      Stock: {stock} · Buy {buyP}C · Sell {sellP}C
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={tradeCap === 0}
                      onClick={() =>
                        GameController.dispatch({ type: 'BUY_RESOURCE', resourceId: r.id, amount: 10 })
                      }
                      className="min-h-[38px] px-2.5 rounded-lg bg-sky-700 disabled:bg-stone-800 text-white font-medium"
                    >
                      Buy 10
                    </button>
                    <button
                      type="button"
                      disabled={tradeCap === 0}
                      onClick={() =>
                        GameController.dispatch({ type: 'BUY_RESOURCE', resourceId: r.id, amount: 50 })
                      }
                      className="min-h-[38px] px-2 rounded-lg bg-sky-800 disabled:bg-stone-800 text-sky-100 font-medium"
                    >
                      +50
                    </button>
                    <button
                      type="button"
                      disabled={tradeCap === 0 || stock === 0}
                      onClick={() =>
                        GameController.dispatch({ type: 'SELL_RESOURCE', resourceId: r.id, amount: 10 })
                      }
                      className="min-h-[38px] px-2.5 rounded-lg bg-amber-500 disabled:bg-stone-800 disabled:text-stone-500 text-stone-950 font-semibold"
                    >
                      Sell 10
                    </button>
                    <button
                      type="button"
                      disabled={tradeCap === 0 || stock === 0}
                      onClick={() =>
                        GameController.dispatch({ type: 'SELL_RESOURCE', resourceId: r.id, amount: 50 })
                      }
                      className="min-h-[38px] px-2 rounded-lg bg-amber-600 disabled:bg-stone-800 disabled:text-stone-500 text-stone-950 font-semibold"
                    >
                      -50
                    </button>
                    <button
                      type="button"
                      disabled={tradeCap === 0}
                      onClick={() => {
                        const nextMode = rule?.mode === 'sell_excess' ? 'none' : 'sell_excess';
                        GameController.dispatch({
                          type: 'SET_AUTO_TRADE',
                          rule: { resourceId: r.id, mode: nextMode, threshold: 40 },
                        });
                      }}
                      className={`min-h-[38px] px-2 rounded-lg text-[11px] font-medium ${
                        rule?.mode === 'sell_excess'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-stone-800 text-stone-300'
                      }`}
                    >
                      {rule?.mode === 'sell_excess' ? 'Auto >40' : 'Auto'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </SheetContainer>
  );
};
