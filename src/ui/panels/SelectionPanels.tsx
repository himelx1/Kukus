import React, { useState } from 'react';
import {
  X,
  ArrowUpCircle,
  Trash2,
  Pause,
  Play,
  Axe,
  Sprout,
  Unlock,
  Compass,
  Move,
  Copy,
} from 'lucide-react';
import { BUILDINGS } from '../../data/buildings.data';
import { RESOURCES, ResourceId } from '../../data/resources.data';
import { ROADS, RoadType } from '../../data/roads.data';
import { DEPOSIT_NAMES, DepositType, FeatureType, TREE_SPECIES } from '../../data/trees.data';
import { ProductionSystem } from '../../systems/ProductionSystem';
import { GameController, GameSnapshot } from '../bridge/GameController';

export const SelectionPanels: React.FC<{ snap: GameSnapshot }> = ({ snap }) => {
  const [confirmDemolish, setConfirmDemolish] = useState(false);

  if (snap.selectedBuildingId !== null) {
    const b = snap.state.buildings.find((item) => item.id === snap.selectedBuildingId);
    if (!b) return null;
    const def = BUILDINGS[b.defId];
    if (!def) return null;

    const canUpgrade = b.status !== 'constructing' && b.level < def.maxLevel;
    const upgMult = 0.75 * Math.pow(1.6, b.level - 1);
    const upgCoins = Math.round(def.coinCost * upgMult);
    const adj = ProductionSystem.getBuildingAdjacencyBonus(
      b,
      snap.state,
      GameController.engine.chunks
    );
    const copyUnlocked =
      snap.state.level >= def.unlockLevel &&
      (!def.requiredTech || snap.state.unlockedTechIds.includes(def.requiredTech));

    return (
      <div className="pointer-events-auto fixed bottom-24 inset-x-0 z-30 flex justify-center px-3">
        <div className="w-full max-w-md bg-gradient-to-b from-[#142c20]/98 to-[#091610]/98 backdrop-blur-md border border-emerald-700/60 rounded-2xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_40px_rgba(0,0,0,0.6)] space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-stone-100 tabular-nums">
                {def.name} · Lv.{b.level}/{def.maxLevel}
              </div>
              <div className="text-xs text-stone-300/85 mt-0.5 tabular-nums">
                Status:{' '}
                <span className="text-amber-300 font-semibold capitalize">
                  {b.status.replace('_', ' ')}
                </span>
                {b.status === 'constructing' ? ` (${Math.round(b.buildProgress * 100)}%)` : ''}
                {` · (${b.gx}, ${b.gy})`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setConfirmDemolish(false);
                GameController.clearSelection();
              }}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-[#0a1a12] border border-emerald-800/60 text-stone-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-xs text-stone-300 leading-relaxed">{def.description}</p>

          {adj.labels.length > 0 ? (
            <div className="text-[11px] font-medium text-emerald-300 bg-emerald-950/60 border border-emerald-700/50 rounded-xl px-3 py-2 tabular-nums">
              Adjacency Bonus: {adj.labels.join(' · ')}
            </div>
          ) : null}

          {def.recipe ? (
            <div className="text-[11px] text-stone-200 bg-[#08150f] border border-emerald-800/60 rounded-xl px-3 py-2 tabular-nums">
              Cycle ({def.recipe.cycleSeconds}s):{' '}
              {Object.keys(def.recipe.inputs).length > 0
                ? Object.entries(def.recipe.inputs)
                    .map(([k, v]) => `${v} ${RESOURCES[k as ResourceId]?.name ?? k}`)
                    .join(' + ')
                : 'Natural Harvest'}{' '}
              →{' '}
              {Object.keys(def.recipe.outputs).length > 0
                ? Object.entries(def.recipe.outputs)
                    .map(([k, v]) => `${v} ${RESOURCES[k as ResourceId]?.name ?? k}`)
                    .join(' + ')
                : 'Power Output'}
            </div>
          ) : null}

          {def.maxWorkers > 0 ? (
            <div className="flex items-center justify-between text-xs bg-[#08150f] border border-emerald-800/60 rounded-xl px-3 py-2 tabular-nums">
              <span className="text-stone-200 font-medium">
                Workers: {b.assignedWorkers}/{def.maxWorkers}
                {b.lockedWorkers !== null ? ' · Pinned' : ' · Auto'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    GameController.dispatch({
                      type: 'SET_BUILDING_WORKERS',
                      buildingId: b.id,
                      lockedWorkers: Math.max(0, (b.lockedWorkers ?? b.assignedWorkers) - 1),
                    })
                  }
                  className="w-9 h-9 rounded-lg bg-[#142c20] border border-emerald-800/60 text-stone-100 font-bold"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() =>
                    GameController.dispatch({
                      type: 'SET_BUILDING_WORKERS',
                      buildingId: b.id,
                      lockedWorkers: Math.min(def.maxWorkers, (b.lockedWorkers ?? b.assignedWorkers) + 1),
                    })
                  }
                  className="w-9 h-9 rounded-lg bg-[#142c20] border border-emerald-800/60 text-stone-100 font-bold"
                >
                  +
                </button>
                {b.lockedWorkers !== null ? (
                  <button
                    type="button"
                    onClick={() =>
                      GameController.dispatch({
                        type: 'SET_BUILDING_WORKERS',
                        buildingId: b.id,
                        lockedWorkers: null,
                      })
                    }
                    className="h-9 px-2.5 rounded-lg bg-emerald-700 text-white text-[11px] font-semibold"
                  >
                    Auto
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="space-y-2 pt-0.5">
            <div className="flex items-center gap-2">
              {canUpgrade ? (
                <button
                  type="button"
                  onClick={() => GameController.dispatch({ type: 'UPGRADE_BUILDING', buildingId: b.id })}
                  className="flex-1 min-h-[44px] px-3 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_#92400e] active:translate-y-[2px]"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  Upgrade ({upgCoins}C)
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => GameController.dispatch({ type: 'TOGGLE_BUILDING', buildingId: b.id })}
                className="flex-1 min-h-[44px] px-3.5 rounded-xl bg-[#142c20] border border-emerald-700/60 text-stone-100 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                {b.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {b.enabled ? 'Pause' : 'Resume'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmDemolish(false);
                  GameController.startMoveBuilding(b.id);
                }}
                className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#0d2433] border border-sky-700/60 text-sky-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Move className="w-4 h-4" />
                Move
              </button>
              {copyUnlocked ? (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDemolish(false);
                    GameController.setTool({ mode: 'build', defId: b.defId });
                  }}
                  className="flex-1 min-h-[44px] px-3 rounded-xl bg-[#10261b] border border-emerald-700/60 text-emerald-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-4 h-4" />
                  Build Copy
                </button>
              ) : null}
              {!confirmDemolish ? (
                <button
                  type="button"
                  onClick={() => setConfirmDemolish(true)}
                  className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-red-950/80 text-red-200 border border-red-800/60 flex items-center justify-center gap-1 text-xs font-semibold"
                  aria-label="Demolish"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    GameController.dispatch({ type: 'DEMOLISH_BUILDING', buildingId: b.id });
                    setConfirmDemolish(false);
                    GameController.clearSelection();
                  }}
                  className="min-h-[44px] px-3.5 rounded-xl bg-red-600 text-white text-xs font-bold"
                >
                  Confirm
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (snap.selectedTile) {
    const t = snap.selectedTile;
    const species = TREE_SPECIES[t.featureType];
    const depName = DEPOSIT_NAMES[t.depositType as DepositType];
    const isRuin = t.featureType === FeatureType.AncientRuin;
    const curRoad = t.roadType !== RoadType.None ? ROADS[t.roadType] : null;
    const roadRefund = curRoad ? Math.round(curRoad.coinCost * 0.5) : 0;
    const nextRoadType =
      t.roadType >= RoadType.Dirt && t.roadType < RoadType.Highway
        ? ((t.roadType + 1) as RoadType)
        : null;
    const nextRoadDef = nextRoadType ? ROADS[nextRoadType] : null;
    const canUpgradeRoad =
      nextRoadDef &&
      snap.state.level >= nextRoadDef.unlockLevel &&
      (!nextRoadDef.requiredTech || snap.state.unlockedTechIds.includes(nextRoadDef.requiredTech));

    return (
      <div className="pointer-events-auto fixed bottom-24 inset-x-0 z-30 flex justify-center px-3">
        <div className="w-full max-w-md bg-gradient-to-b from-[#142c20]/98 to-[#091610]/98 backdrop-blur-md border border-emerald-700/60 rounded-2xl p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_16px_40px_rgba(0,0,0,0.6)] space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-bold text-stone-100 tabular-nums">
                {t.biomeName} · ({t.gx}, {t.gy})
              </div>
              <div className="text-xs text-stone-300/85 tabular-nums mt-0.5">
                <span className={t.unlocked ? 'text-emerald-300 font-semibold' : 'text-sky-300 font-semibold'}>
                  {t.unlocked ? 'Owned Sunlit Land' : t.canUnlock ? 'Unlockable Frontier' : 'Locked Wilderness'}
                </span>
                {` · Elev ${t.elevation}`}
                {t.depositType !== DepositType.None ? ` · ${depName} (${t.depositQty})` : ''}
                {curRoad ? ` · ${curRoad.name} (${curRoad.speedMultiplier}×)` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => GameController.clearSelection()}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl bg-[#0a1a12] border border-emerald-800/60 text-stone-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {species ? (
            <div className="text-xs font-medium text-lime-300 bg-[#08150f] border border-emerald-800/60 rounded-xl px-3 py-2 tabular-nums">
              {isRuin
                ? 'Ancient overgrown ruins hiding relics, Coins & Research Points.'
                : `${species.name} · ${t.featureHp}/${t.featureMaxHp} HP`}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {!t.unlocked ? (
              <button
                type="button"
                disabled={!t.canUnlock}
                onClick={() => GameController.dispatch({ type: 'UNLOCK_TILE', gx: t.gx, gy: t.gy })}
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 disabled:from-stone-800 disabled:to-stone-800 disabled:text-stone-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 tabular-nums shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_#92400e] disabled:shadow-none active:translate-y-[2px]"
              >
                <Unlock className="w-4 h-4" />
                {t.canUnlock ? `Unlock & Flatten (${t.unlockCost}C)` : 'Border Locked — Unlock Adjacent First'}
              </button>
            ) : isRuin ? (
              <button
                type="button"
                onClick={() => GameController.dispatch({ type: 'EXPLORE_RUIN', gx: t.gx, gy: t.gy })}
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_#92400e] active:translate-y-[2px]"
              >
                <Compass className="w-4 h-4" />
                Explore Ancient Ruin
              </button>
            ) : t.featureType !== FeatureType.None ? (
              <button
                type="button"
                onClick={() =>
                  GameController.dispatch({ type: 'CHOP_TILE', gx: t.gx, gy: t.gy, isManualTap: true })
                }
                className="flex-1 min-h-[46px] px-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_#92400e] active:translate-y-[2px]"
              >
                <Axe className="w-4 h-4" />
                Chop / Harvest
              </button>
            ) : curRoad ? (
              <>
                {nextRoadDef ? (
                  <button
                    type="button"
                    disabled={!canUpgradeRoad}
                    onClick={() =>
                      GameController.dispatch({ type: 'PLACE_ROAD', roadType: nextRoadDef.id, gx: t.gx, gy: t.gy })
                    }
                    className="flex-1 min-h-[46px] px-4 rounded-xl bg-gradient-to-b from-amber-400 to-amber-500 disabled:from-stone-800 disabled:to-stone-800 disabled:text-stone-400 text-stone-950 font-bold text-xs flex items-center justify-center gap-1.5 tabular-nums"
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                    {canUpgradeRoad
                      ? `Upgrade (${nextRoadDef.name})`
                      : `${nextRoadDef.name} (Lv.${nextRoadDef.unlockLevel})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    GameController.dispatch({ type: 'REMOVE_ROAD', gx: t.gx, gy: t.gy });
                    GameController.clearSelection();
                  }}
                  className="min-h-[46px] px-3.5 rounded-xl bg-red-950/85 border border-red-700/70 text-red-100 font-bold text-xs flex items-center justify-center gap-1.5 tabular-nums"
                >
                  <Trash2 className="w-4 h-4" />
                  Remove Road{roadRefund > 0 ? ` (+${roadRefund}C)` : ''}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    GameController.clearSelection();
                    GameController.setActiveSheet('build');
                  }}
                  className="flex-1 min-h-[46px] px-3 rounded-xl bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_3px_0_#065f46] active:translate-y-[2px]"
                >
                  Build Here
                </button>
                <button
                  type="button"
                  onClick={() => GameController.dispatch({ type: 'REPLANT_TILE', gx: t.gx, gy: t.gy })}
                  className="min-h-[46px] px-3.5 rounded-xl bg-[#0a1d14] border border-emerald-700/70 text-lime-300 font-semibold text-xs flex items-center gap-1.5"
                >
                  <Sprout className="w-4 h-4" />
                  Plant Tree
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};
