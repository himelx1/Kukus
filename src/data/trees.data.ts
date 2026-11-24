import type { ResourceId } from './resources.data';

export const enum FeatureType {
  None = 0,
  JungleHardwood = 1,
  TropicalPalm = 2,
  FruitTree = 3,
  AncientMahogany = 4,
  StoneOutcrop = 5,
  Sapling = 6,
  BambooCluster = 7,
  AncientRuin = 8,
}

export const enum DepositType {
  None = 0,
  Stone = 1,
  Clay = 2,
  Sand = 3,
  IronOre = 4,
  CopperOre = 5,
  Coal = 6,
  Gold = 7,
}

export interface TreeSpeciesDef {
  featureType: FeatureType;
  name: string;
  maxHp: number;
  woodYield: number;
  bonusResource?: ResourceId;
  bonusAmount?: number;
  bonusChance?: number;
  coinYield: number;
  xpYield: number;
  minLevel: number;
}

export const TREE_SPECIES: Record<number, TreeSpeciesDef> = {
  [FeatureType.JungleHardwood]: {
    featureType: FeatureType.JungleHardwood,
    name: 'Jungle Hardwood',
    maxHp: 45,
    woodYield: 8,
    bonusResource: 'herbs',
    bonusAmount: 2,
    bonusChance: 0.2,
    coinYield: 12,
    xpYield: 8,
    minLevel: 1,
  },
  [FeatureType.TropicalPalm]: {
    featureType: FeatureType.TropicalPalm,
    name: 'Tropical Palm',
    maxHp: 30,
    woodYield: 5,
    bonusResource: 'berries',
    bonusAmount: 2,
    bonusChance: 0.25,
    coinYield: 8,
    xpYield: 6,
    minLevel: 1,
  },
  [FeatureType.FruitTree]: {
    featureType: FeatureType.FruitTree,
    name: 'Wild Fruit Tree',
    maxHp: 35,
    woodYield: 4,
    bonusResource: 'berries',
    bonusAmount: 4,
    bonusChance: 0.9,
    coinYield: 10,
    xpYield: 7,
    minLevel: 1,
  },
  [FeatureType.AncientMahogany]: {
    featureType: FeatureType.AncientMahogany,
    name: 'Ancient Mahogany',
    maxHp: 90,
    woodYield: 18,
    bonusResource: 'herbs',
    bonusAmount: 4,
    bonusChance: 0.5,
    coinYield: 28,
    xpYield: 20,
    minLevel: 1,
  },
  [FeatureType.StoneOutcrop]: {
    featureType: FeatureType.StoneOutcrop,
    name: 'Stone Boulder',
    maxHp: 60,
    woodYield: 0,
    bonusResource: 'stone',
    bonusAmount: 8,
    bonusChance: 1.0,
    coinYield: 14,
    xpYield: 10,
    minLevel: 1,
  },
  [FeatureType.Sapling]: {
    featureType: FeatureType.Sapling,
    name: 'Jungle Sapling',
    maxHp: 15,
    woodYield: 2,
    coinYield: 2,
    xpYield: 2,
    minLevel: 1,
  },
  [FeatureType.BambooCluster]: {
    featureType: FeatureType.BambooCluster,
    name: 'Wild Bamboo Grove',
    maxHp: 25,
    woodYield: 2,
    bonusResource: 'bamboo',
    bonusAmount: 6,
    bonusChance: 1.0,
    coinYield: 9,
    xpYield: 6,
    minLevel: 1,
  },
  [FeatureType.AncientRuin]: {
    featureType: FeatureType.AncientRuin,
    name: 'Ancient Jungle Ruin',
    maxHp: 50,
    woodYield: 0,
    bonusResource: 'stone',
    bonusAmount: 10,
    bonusChance: 1.0,
    coinYield: 95,
    xpYield: 35,
    minLevel: 1,
  },
};

export const DEPOSIT_NAMES: Record<DepositType, string> = {
  [DepositType.None]: 'None',
  [DepositType.Stone]: 'Stone Vein',
  [DepositType.Clay]: 'Clay Bed',
  [DepositType.Sand]: 'Silica Sand Bank',
  [DepositType.IronOre]: 'Iron Ore Seam',
  [DepositType.CopperOre]: 'Copper Vein',
  [DepositType.Coal]: 'Coal Deposit',
  [DepositType.Gold]: 'Gold Ore Vein',
};
