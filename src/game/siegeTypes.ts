export type PlayMode = 'local' | 'bot' | 'online';
export type PlayerSide = 'P1' | 'P2';
export type FortressPreset = 'classic' | 'twin' | 'bunker';
export type BombType = 'standard' | 'cluster' | 'heavy';
export type BlockMaterial = 'wood' | 'stone' | 'steel';
export type GamePhase = 'TITLE_MENU' | 'PLAYING' | 'GAME_OVER';
export type TurnPhase = 'AIMING' | 'FLYING' | 'SETTLING' | 'AI_THINKING';

export interface BombArsenal {
  standard: number; // -1 means unlimited
  cluster: number;
  heavy: number;
}

export interface BlockBlueprint {
  id: string;
  owner: PlayerSide;
  x: number;
  y: number;
  w: number;
  h: number;
  material: BlockMaterial;
}

export interface BlockSyncData {
  id: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  angularVelocity: number;
  hp: number;
  destroyed: boolean;
}

export interface SiegeHudState {
  phase: GamePhase;
  turnPhase: TurnPhase;
  activeTurn: PlayerSide;
  playMode: PlayMode;
  localRole: PlayerSide | null;
  wind: number; // -2.5 to +2.5
  turnCount: number;
  p1TowerHp: number;
  p2TowerHp: number;
  maxTowerHp: number;
  p1Arsenal: BombArsenal;
  p2Arsenal: BombArsenal;
  selectedBomb: BombType;
  canSplitMidAir: boolean;
  overviewMode: boolean;
  winner: PlayerSide | null;
  p1Shots: number;
  p2Shots: number;
  p1BlocksBroken: number;
  p2BlocksBroken: number;
  statusBanner: string;
}

export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 820;
export const GROUND_Y = 710;
export const MAX_TOWER_HP = 220;

export const SLINGSHOT_P1_X = 640;
export const SLINGSHOT_P2_X = 1760;
export const SLINGSHOT_ANCHOR_Y = GROUND_Y - 98;

export const TOWER_P1_X = 270;
export const TOWER_P2_X = 2130;
export const TOWER_WIDTH = 86;
export const TOWER_HEIGHT = 96;

export const FORTRESS_PRESETS: Array<{
  id: FortressPreset;
  name: string;
  summary: string;
}> = [
  {
    id: 'classic',
    name: 'Benteng Klasik',
    summary: 'Tembok kayu & batu bertingkat melindungi rumah utama.',
  },
  {
    id: 'twin',
    name: 'Menara Kembar',
    summary: 'Dua pilar batu tinggi di depan & atap kayu pelindung.',
  },
  {
    id: 'bunker',
    name: 'Kubah Baja',
    summary: 'Rangka baja kokoh di bagian atap, rentan dari sudut rendah.',
  },
];

export const BOMB_SPECS: Record<
  BombType,
  {
    name: string;
    shortLabel: string;
    description: string;
    radius: number;
    mass: number;
    blastRadius: number;
    damage: number;
    color: string;
  }
> = {
  standard: {
    name: 'Bom Besi',
    shortLabel: 'Bom Besi',
    description: 'Seimbang, amunisi tak terbatas.',
    radius: 17,
    mass: 3.4,
    blastRadius: 118,
    damage: 78,
    color: '#1e293b',
  },
  cluster: {
    name: 'Bom Pecah 3',
    shortLabel: 'Pecah 3',
    description: 'Klik layar saat terbang untuk memecah jadi 3 bom.',
    radius: 16,
    mass: 2.9,
    blastRadius: 84,
    damage: 50,
    color: '#0369a1',
  },
  heavy: {
    name: 'Bom Berat',
    shortLabel: 'Bom Berat',
    description: 'Ledakan besar & penghancur tembok batu.',
    radius: 22,
    mass: 5.2,
    blastRadius: 148,
    damage: 115,
    color: '#b45309',
  },
};
