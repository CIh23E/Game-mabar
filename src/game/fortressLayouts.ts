import {
  BlockBlueprint,
  BlockMaterial,
  FortressPreset,
  GROUND_Y,
  WORLD_WIDTH,
} from './siegeTypes';

export const MATERIAL_STATS: Record<
  BlockMaterial,
  {
    maxHp: number;
    density: number;
    friction: number;
    restitution: number;
    fill: string;
    stroke: string;
    grain: string;
  }
> = {
  wood: {
    maxHp: 58,
    density: 0.0014,
    friction: 0.72,
    restitution: 0.08,
    fill: '#d97706',
    stroke: '#78350f',
    grain: '#b45309',
  },
  stone: {
    maxHp: 112,
    density: 0.0026,
    friction: 0.85,
    restitution: 0.04,
    fill: '#94a3b8',
    stroke: '#334155',
    grain: '#64748b',
  },
  steel: {
    maxHp: 185,
    density: 0.0038,
    friction: 0.78,
    restitution: 0.05,
    fill: '#475569',
    stroke: '#0f172a',
    grain: '#64748b',
  },
};

interface RawBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  material: BlockMaterial;
}

function getLeftSideBlocks(preset: FortressPreset): RawBlock[] {
  if (preset === 'twin') {
    return [
      // Outer high stone tower
      { x: 425, y: GROUND_Y - 45, w: 30, h: 90, material: 'stone' },
      { x: 425, y: GROUND_Y - 90 - 40, w: 28, h: 80, material: 'stone' },
      { x: 425, y: GROUND_Y - 170 - 20, w: 34, h: 40, material: 'wood' },

      // Inner front & back columns flanking P1 tower (227..313)
      { x: 192, y: GROUND_Y - 68, w: 26, h: 136, material: 'stone' },
      { x: 350, y: GROUND_Y - 68, w: 26, h: 136, material: 'stone' },

      // Main roof beam over house
      { x: 271, y: GROUND_Y - 136 - 12, w: 194, h: 24, material: 'wood' },

      // Second tier over roof
      { x: 222, y: GROUND_Y - 160 - 28, w: 24, h: 56, material: 'wood' },
      { x: 320, y: GROUND_Y - 160 - 28, w: 24, h: 56, material: 'wood' },
      { x: 271, y: GROUND_Y - 216 - 10, w: 138, h: 20, material: 'stone' },
    ];
  }

  if (preset === 'bunker') {
    return [
      // Reinforced back & inner front steel/stone columns
      { x: 186, y: GROUND_Y - 64, w: 28, h: 128, material: 'stone' },
      { x: 354, y: GROUND_Y - 64, w: 28, h: 128, material: 'stone' },

      // Heavy steel roof beam
      { x: 270, y: GROUND_Y - 128 - 13, w: 206, h: 26, material: 'steel' },

      // Upper steel bunker cap
      { x: 226, y: GROUND_Y - 154 - 22, w: 26, h: 44, material: 'stone' },
      { x: 314, y: GROUND_Y - 154 - 22, w: 26, h: 44, material: 'stone' },
      { x: 270, y: GROUND_Y - 198 - 11, w: 136, h: 22, material: 'steel' },

      // Low front wooden & stone bunker shield
      { x: 408, y: GROUND_Y - 36, w: 28, h: 72, material: 'wood' },
      { x: 450, y: GROUND_Y - 28, w: 28, h: 56, material: 'stone' },
    ];
  }

  // 'classic'
  return [
    // Low front stone shield
    { x: 444, y: GROUND_Y - 28, w: 28, h: 56, material: 'stone' },
    { x: 444, y: GROUND_Y - 56 - 20, w: 24, h: 40, material: 'wood' },

    // Mid-front layered wall
    { x: 396, y: GROUND_Y - 40, w: 28, h: 80, material: 'stone' },
    { x: 396, y: GROUND_Y - 80 - 34, w: 24, h: 68, material: 'wood' },

    // Inner enclosure framing P1 house (227..313)
    { x: 194, y: GROUND_Y - 64, w: 24, h: 128, material: 'wood' },
    { x: 346, y: GROUND_Y - 64, w: 24, h: 128, material: 'wood' },

    // Main wooden roof
    { x: 270, y: GROUND_Y - 128 - 11, w: 186, h: 22, material: 'wood' },

    // Upper lookout on roof
    { x: 222, y: GROUND_Y - 150 - 24, w: 24, h: 48, material: 'stone' },
    { x: 318, y: GROUND_Y - 150 - 24, w: 24, h: 48, material: 'stone' },
    { x: 270, y: GROUND_Y - 198 - 10, w: 132, h: 20, material: 'wood' },
  ];
}

export function buildFortressBlueprints(preset: FortressPreset): BlockBlueprint[] {
  const leftRaw = getLeftSideBlocks(preset);
  const all: BlockBlueprint[] = [];

  leftRaw.forEach((b, idx) => {
    all.push({
      id: `p1_blk_${idx}`,
      owner: 'P1',
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      material: b.material,
    });
    all.push({
      id: `p2_blk_${idx}`,
      owner: 'P2',
      x: WORLD_WIDTH - b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      material: b.material,
    });
  });

  return all;
}
