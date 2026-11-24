import React from 'react';
import { formatCompactNumber } from '../../core/Formatters';
import { GameController, GameSnapshot } from '../bridge/GameController';
import { SheetContainer } from './SheetContainer';

export const LandUnlockSheet: React.FC<{ snap: GameSnapshot }> = ({ snap }) => {
  const { state } = snap;
  const chunks = GameController.engine.chunks;

  let targetChunk: { cx: number; cy: number; cost: number; lockedCount: number } | null = null;
  for (let cy = -2; cy <= 2 && !targetChunk; cy++) {
    for (let cx = -2; cx <= 2 && !targetChunk; cx++) {
      if (chunks.canUnlockChunk(cx, cy)) {
        const quote = chunks.getChunkUnlockCost(cx, cy);
        if (quote.lockedCount > 0) {
          targetChunk = { cx, cy, cost: quote.cost, lockedCount: quote.lockedCount };
        }
      }
    }
  }

  return (
    <SheetContainer
      title="Expand Territory"
      subtitle={`Unlocked Tiles: ${state.stats.unlockedTiles} · Coins: ${formatCompactNumber(state.coins)}`}
    >
      <div className="space-y-3.5 text-sm text-stone-200">
        <p className="text-xs text-stone-300 leading-relaxed">
          Unlock individual border blocks for surgical expansion, or claim an entire 16×16 chunk at a
          20% territory discount.
        </p>

        <div className="grid grid-cols-2 gap-2.5 text-xs tabular-nums">
          <div className="p-3.5 rounded-2xl bg-gradient-to-b from-[#132b1f] to-[#0a1a12] border border-emerald-700/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
            <div className="text-stone-400">Total Territory</div>
            <div className="text-xl font-extrabold text-stone-100 mt-0.5">
              {state.stats.unlockedTiles} tiles
            </div>
          </div>
          <div className="p-3.5 rounded-2xl bg-gradient-to-b from-[#132b1f] to-[#0a1a12] border border-emerald-700/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
            <div className="text-stone-400">Trees Harvested</div>
            <div className="text-xl font-extrabold text-lime-300 mt-0.5">
              {state.stats.treesCut}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <button
            type="button"
            onClick={() => {
              GameController.setTool({ mode: 'land_unlock' });
              GameController.setActiveSheet('none');
            }}
            className="flex-1 min-h-[46px] px-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold text-xs sm:text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_#92400e] active:translate-y-[2px]"
          >
            Tap Border Blocks on Map
          </button>
          <button
            type="button"
            onClick={() =>
              GameController.dispatch({
                type: 'UNLOCK_BATCH_FRONTIER',
                centerGx: 2,
                centerGy: 2,
                radius: 6,
              })
            }
            className="flex-1 min-h-[46px] px-4 rounded-xl bg-gradient-to-b from-emerald-600 to-emerald-700 text-white font-bold text-xs sm:text-sm border border-emerald-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_3px_0_#064e3b] active:translate-y-[2px]"
          >
            Expand Nearby Ring
          </button>
        </div>

        {targetChunk ? (
          <button
            type="button"
            onClick={() =>
              GameController.dispatch({
                type: 'UNLOCK_CHUNK',
                cx: targetChunk!.cx,
                cy: targetChunk!.cy,
              })
            }
            className="w-full min-h-[46px] px-4 rounded-xl bg-[#0d2433] border border-sky-600/60 text-sky-100 font-bold text-xs tabular-nums flex items-center justify-between"
          >
            <span>
              Unlock Chunk ({targetChunk.cx}, {targetChunk.cy}) · {targetChunk.lockedCount} tiles
            </span>
            <span className="text-amber-300">{formatCompactNumber(targetChunk.cost)}C (-20%)</span>
          </button>
        ) : null}
      </div>
    </SheetContainer>
  );
};
