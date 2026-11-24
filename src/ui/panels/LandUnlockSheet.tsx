import React from 'react';
import { GameController, GameSnapshot } from '../bridge/GameController';
import { SheetContainer } from './SheetContainer';

export const LandUnlockSheet: React.FC<{ snap: GameSnapshot }> = ({ snap }) => {
  const { state } = snap;

  return (
    <SheetContainer
      title="Expand Territory"
      subtitle={`Unlocked Tiles: ${state.stats.unlockedTiles} · Coins: ${Math.floor(state.coins).toLocaleString()}`}
    >
      <div className="space-y-3.5 text-sm text-stone-200">
        <p className="text-xs text-stone-300 leading-relaxed">
          Locked tiles are dense tropical forest. Gold-bordered frontier tiles flatten into buildable
          land as you unlock them—expanding both your settlement and camera range!
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
            className="flex-1 min-h-[48px] px-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_#92400e] active:translate-y-[2px]"
          >
            Tap Frontier Tiles on Map
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
            className="flex-1 min-h-[48px] px-4 rounded-xl bg-gradient-to-b from-emerald-600 to-emerald-700 text-white font-bold text-sm border border-emerald-500/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_3px_0_#064e3b] active:translate-y-[2px]"
          >
            Auto-Expand Nearby Ring
          </button>
        </div>
      </div>
    </SheetContainer>
  );
};
