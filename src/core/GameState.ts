import type { ResourceId } from '../data/resources.data';
import type { BuildingCategory, WorkerClass } from '../data/buildings.data';
import type { PolicyId } from '../data/policies.data';
import type { RoadType } from '../data/roads.data';

export const SCHEMA_VERSION = 1;

export type WorldEventId =
  | 'merchant_caravan'
  | 'bountiful_harvest'
  | 'gold_rush'
  | 'scholar_symposium';

export interface ActiveWorldEvent {
  id: WorldEventId;
  title: string;
  description: string;
  ticksRemaining: number;
}

export const enum BiomeId {
  DeepWater = 0,
  River = 1,
  Beach = 2,
  Grassland = 3,
  Fertile = 4,
  Jungle = 5,
  Forest = 6,
  Swamp = 7,
  Desert = 8,
  Mountain = 9,
}

export const enum TileFlag {
  Unlocked = 1 << 0,
  Explored = 1 << 1,
  Irrigated = 1 << 2,
  ReforestZone = 1 << 3,
}

export interface ChunkData {
  cx: number;
  cy: number;
  key: string;
  isModified: boolean;
  lastTouchedTick: number;
  biomeId: Uint8Array;
  elevation: Uint8Array;
  moisture: Uint8Array;
  flags: Uint8Array;
  featureType: Uint8Array;
  featureHp: Uint16Array;
  depositType: Uint8Array;
  depositQty: Uint16Array;
  roadType: Uint8Array;
  buildingRef: Int32Array;
  pollution: Uint8Array;
}

export type BuildingStatus =
  | 'constructing'
  | 'active'
  | 'no_workers'
  | 'no_inputs'
  | 'storage_full'
  | 'no_road'
  | 'no_power'
  | 'disabled';

export interface BuildingInstance {
  id: number;
  defId: string;
  gx: number;
  gy: number;
  level: number;
  status: BuildingStatus;
  buildProgress: number; // 0..1
  prodProgress: number; // 0..1
  assignedWorkers: number;
  lockedWorkers: number | null; // null = auto
  enabled: boolean;
  connectedRoadCluster: number;
}

export type SeasonType = 'spring' | 'summer' | 'autumn' | 'winter';
export type WeatherType = 'clear' | 'rain' | 'storm' | 'drought' | 'snow';
export type GameSpeed = 0 | 1 | 2 | 3;

export interface AutoTradeRule {
  resourceId: ResourceId;
  mode: 'none' | 'sell_excess' | 'buy_below';
  threshold: number;
}

export interface EconomyLedgerEntry {
  tick: number;
  taxIncome: number;
  tradeIncome: number;
  upkeepExpense: number;
  wageExpense: number;
  net: number;
}

export interface NotificationItem {
  id: number;
  tick: number;
  severity: 'critical' | 'warning' | 'milestone' | 'info';
  title: string;
  message: string;
}

export interface GameSettings {
  cityName: string;
  difficulty: 'standard' | 'relaxed';
  masterVolume: number;
  sfxVolume: number;
  ambientVolume: number;
  graphicsMode: 'auto' | 'high' | 'low_power';
  reducedAnimations: boolean;
  mildDisasters: boolean;
  haptics: boolean;
  timeMode: 'normal' | 'always_day' | 'always_night';
  weatherMode: 'random' | 'always_clear';
}

export interface CumulativeStats {
  treesCut: number;
  unlockedTiles: number;
  buildingsBuilt: number;
  roadsBuilt: number;
  maxPopulation: number;
  totalCoinsEarned: number;
  tradesCompleted: number;
  playTimeSeconds: number;
  ruinsExplored: number;
  festivalsHeld: number;
  buildingsMoved: number;
}

export interface PopulationState {
  total: number;
  capacity: number;
  happiness: number;
  classes: Record<WorkerClass, number>;
  employed: number;
  unemployed: number;
  growthAccumulator: number;
  needs: {
    food: number; // 0..1
    water: number; // 0..1
    healthcare: number; // 0..1
    education: number; // 0..1
    safety: number; // 0..1
    recreation: number; // 0..1
  };
}

export interface EnvironmentState {
  forestCoveragePct: number;
  avgPollution: number;
  waterQuality: number;
  biodiversity: number;
  sustainability: number;
}

export interface WorldEngineState {
  schemaVersion: number;
  worldSeed: number;
  tick: number;
  speed: GameSpeed;
  coins: number;
  xp: number;
  level: number;
  researchPoints: number;
  activeTechId: string | null;
  activeTechProgress: number;
  unlockedTechIds: string[];
  completedQuestIds: string[];
  trackedQuestId?: string | null;
  unlockedAchievements: string[];
  resources: Record<ResourceId, number>;
  capacities: Record<ResourceId, number>;
  netRatesPerMin: Partial<Record<ResourceId, number>>;
  buildings: BuildingInstance[];
  nextBuildingId: number;
  workforcePriorities: Record<BuildingCategory, number>;
  taxRate: number; // 0.5, 1.0, 1.5, 2.0
  marketPrices: Record<ResourceId, number>;
  marketPrevPrices?: Partial<Record<ResourceId, number>>;
  autoTradeRules: Partial<Record<ResourceId, AutoTradeRule>>;
  ledger: EconomyLedgerEntry[];
  season: SeasonType;
  dayInSeason: number;
  year: number;
  timeOfDayHours: number; // 0..24 real-time 5 min = 24h cycle
  weather: WeatherType;
  nextWeather: WeatherType;
  weatherTicksRemaining: number;
  activePolicies: PolicyId[];
  festivalTicksRemaining: number;
  festivalCooldownTicks: number;
  activeEvent: ActiveWorldEvent | null;
  population: PopulationState;
  environment: EnvironmentState;
  powerGenerated: number;
  powerDemand: number;
  waterGenerated: number;
  waterDemand: number;
  roadConnectedCount: number;
  stats: CumulativeStats;
  camera: { x: number; y: number; zoom: number };
  settings: GameSettings;
}

export interface TileInspection {
  gx: number;
  gy: number;
  biomeId: BiomeId;
  biomeName: string;
  elevation: number;
  moisture: number;
  unlocked: boolean;
  canUnlock: boolean;
  unlockCost: number;
  featureType: number;
  featureHp: number;
  featureMaxHp: number;
  depositType: number;
  depositQty: number;
  roadType: RoadType;
  building: BuildingInstance | null;
  pollution: number;
}
