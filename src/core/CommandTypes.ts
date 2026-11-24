import type { BuildingCategory } from '../data/buildings.data';
import type { PolicyId } from '../data/policies.data';
import type { ResourceId } from '../data/resources.data';
import type { RoadType } from '../data/roads.data';
import type { AutoTradeRule, GameSettings, GameSpeed } from './GameState';

export type GameCommand =
  | { type: 'CHOP_TILE'; gx: number; gy: number; isManualTap: boolean }
  | { type: 'REPLANT_TILE'; gx: number; gy: number }
  | { type: 'EXPLORE_RUIN'; gx: number; gy: number }
  | { type: 'UNLOCK_TILE'; gx: number; gy: number }
  | { type: 'UNLOCK_BATCH_FRONTIER'; centerGx: number; centerGy: number; radius: number }
  | { type: 'PLACE_BUILDING'; defId: string; gx: number; gy: number }
  | { type: 'MOVE_BUILDING'; buildingId: number; gx: number; gy: number }
  | { type: 'PLACE_ROAD'; roadType: RoadType; gx: number; gy: number }
  | { type: 'REMOVE_ROAD'; gx: number; gy: number }
  | { type: 'UPGRADE_BUILDING'; buildingId: number }
  | { type: 'DEMOLISH_BUILDING'; buildingId: number }
  | { type: 'TOGGLE_BUILDING'; buildingId: number }
  | { type: 'RESUME_ALL_BUILDINGS' }
  | { type: 'SET_BUILDING_WORKERS'; buildingId: number; lockedWorkers: number | null }
  | { type: 'SET_WORKFORCE_PRIORITY'; category: BuildingCategory; priority: number }
  | { type: 'SET_TAX_RATE'; rate: number }
  | { type: 'TOGGLE_POLICY'; policyId: PolicyId }
  | { type: 'START_FESTIVAL' }
  | { type: 'BUY_MISSING_FOR_BUILDING'; defId: string; allowEmergency?: boolean }
  | { type: 'RUSH_CONSTRUCTION'; buildingId: number }
  | { type: 'CLEAR_AREA_OBSTACLES'; tiles: Array<{ gx: number; gy: number }> }
  | { type: 'BUY_RESOURCE'; resourceId: ResourceId; amount: number }
  | { type: 'SELL_RESOURCE'; resourceId: ResourceId; amount: number }
  | { type: 'SELL_ALL_EXCESS'; keepAmount: number }
  | { type: 'SET_AUTO_TRADE'; rule: AutoTradeRule }
  | { type: 'START_TECH'; techId: string }
  | { type: 'SET_SPEED'; speed: GameSpeed }
  | { type: 'SET_TIME_OF_DAY'; hours: number }
  | { type: 'UPDATE_SETTINGS'; partial: Partial<GameSettings> }
  | { type: 'SET_CAMERA'; x: number; y: number; zoom: number }
  | { type: 'SET_TRACKED_QUEST'; questId: string | null }
  | { type: 'TERRAFORM_TILE'; gx: number; gy: number; action: 'to_water' | 'to_land' };

export interface CommandResult {
  ok: boolean;
  reason?: string;
}
