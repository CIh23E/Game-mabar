import Matter from 'matter-js';
import { buildFortressBlueprints, MATERIAL_STATS } from './fortressLayouts';
import { siegeSound } from './siegeSound';
import {
  BlockMaterial,
  BlockSyncData,
  BombArsenal,
  BOMB_SPECS,
  BombType,
  FortressPreset,
  GamePhase,
  GROUND_Y,
  MAX_TOWER_HP,
  PlayerSide,
  PlayMode,
  SiegeHudState,
  SLINGSHOT_ANCHOR_Y,
  SLINGSHOT_P1_X,
  SLINGSHOT_P2_X,
  TOWER_HEIGHT,
  TOWER_P1_X,
  TOWER_P2_X,
  TOWER_WIDTH,
  TurnPhase,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from './siegeTypes';

interface FortressBlockEntity {
  id: string;
  owner: PlayerSide;
  material: BlockMaterial;
  w: number;
  h: number;
  maxHp: number;
  hp: number;
  destroyed: boolean;
  body: Matter.Body;
}

interface ActiveBombEntity {
  id: string;
  owner: PlayerSide;
  type: BombType;
  isSplitChild: boolean;
  body: Matter.Body;
  trail: Array<{ x: number; y: number }>;
  exploded: boolean;
  fuseTimerMs: number | null;
  ageMs: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
  shape: 'circle' | 'rect';
  angle: number;
  spin: number;
}

interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
}

interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export interface SiegeEngineCallbacks {
  onHudChange: (hud: SiegeHudState) => void;
  onOnlineAimEmit?: (pullX: number, pullY: number, bombType: BombType) => void;
  onOnlineFireEmit?: (vx: number, vy: number, bombType: BombType) => void;
  onOnlineAbilityEmit?: (x: number, y: number, vx: number, vy: number) => void;
  onOnlineTurnSettled?: (payload: {
    p1TowerHp: number;
    p2TowerHp: number;
    blocks: BlockSyncData[];
    winner: PlayerSide | null;
    p1BlocksBroken: number;
    p2BlocksBroken: number;
  }) => void;
}

const FIXED_DT = 1000 / 60;
const GRAVITY_SCALE = 0.0011;
const WIND_FORCE_COEFF = 0.000055;
const MAX_PULL_DIST = 142;
const MIN_PULL_DIST = 20;
const LAUNCH_SPEED_SCALE = 0.174;

export class SiegeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: SiegeEngineCallbacks;

  private engine: Matter.Engine;
  private groundBody: Matter.Body;
  private p1TowerBody: Matter.Body;
  private p2TowerBody: Matter.Body;

  private blocks: FortressBlockEntity[] = [];
  private bombs: ActiveBombEntity[] = [];
  private particles: Particle[] = [];
  private shockwaves: Shockwave[] = [];
  private floatingTexts: FloatingText[] = [];
  private clouds: Array<{ x: number; y: number; w: number; speed: number }> = [];

  private rafId: number | null = null;
  private resizeObserver: ResizeObserver;
  private lastFrameTime = 0;
  private accumulator = 0;

  private viewW = 1280;
  private viewH = 720;
  private dpr = 1;

  // Game state
  private phase: GamePhase = 'TITLE_MENU';
  private turnPhase: TurnPhase = 'AIMING';
  private playMode: PlayMode = 'local';
  private localRole: PlayerSide | null = null;
  private preset: FortressPreset = 'classic';
  private activeTurn: PlayerSide = 'P1';
  private wind = 0;
  private turnCount = 1;

  private p1TowerHp = MAX_TOWER_HP;
  private p2TowerHp = MAX_TOWER_HP;
  private p1TowerFlash = 0;
  private p2TowerFlash = 0;

  private p1Arsenal: BombArsenal = { standard: -1, cluster: 2, heavy: 2 };
  private p2Arsenal: BombArsenal = { standard: -1, cluster: 2, heavy: 2 };
  private selectedBomb: BombType = 'standard';

  private p1Shots = 0;
  private p2Shots = 0;
  private p1BlocksBroken = 0;
  private p2BlocksBroken = 0;
  private winner: PlayerSide | null = null;
  private statusBanner = '';

  // Slingshot & pointer interaction
  private isDraggingSling = false;
  private isPanningCamera = false;
  private panLastClientX = 0;
  private activePointerId: number | null = null;
  private pullX = 0;
  private pullY = 0;
  private lastAimEmitAt = 0;
  private remoteAimPull: { x: number; y: number; bombType: BombType } | null = null;

  // Camera
  private camX = WORLD_WIDTH / 2;
  private camY = WORLD_HEIGHT / 2;
  private camZoom = 0.85;
  private manualPanOffset = 0;
  private overviewMode = false;
  private shakeIntensity = 0;
  private lastImpactPoint: { x: number; y: number } | null = null;

  // Turn settle & AI timers
  private settleTimerMs = 0;
  private settleTotalMs = 0;
  private pendingSettleReport = false;
  private aiTimeoutId: number | null = null;
  private aiPullAnim: {
    startAt: number;
    duration: number;
    targetPullX: number;
    targetPullY: number;
    bombType: BombType;
  } | null = null;

  constructor(canvas: HTMLCanvasElement, callbacks: SiegeEngineCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context unavailable');
    }
    this.ctx = context;
    this.callbacks = callbacks;

    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 1, scale: GRAVITY_SCALE },
      positionIterations: 8,
      velocityIterations: 6,
    });

    this.groundBody = Matter.Bodies.rectangle(
      WORLD_WIDTH / 2,
      GROUND_Y + 80,
      WORLD_WIDTH + 800,
      160,
      { isStatic: true, friction: 0.9, restitution: 0.1, label: 'ground' }
    );

    this.p1TowerBody = Matter.Bodies.rectangle(
      TOWER_P1_X,
      GROUND_Y - TOWER_HEIGHT / 2,
      TOWER_WIDTH,
      TOWER_HEIGHT,
      { isStatic: true, friction: 0.85, label: 'tower_P1' }
    );

    this.p2TowerBody = Matter.Bodies.rectangle(
      TOWER_P2_X,
      GROUND_Y - TOWER_HEIGHT / 2,
      TOWER_WIDTH,
      TOWER_HEIGHT,
      { isStatic: true, friction: 0.85, label: 'tower_P2' }
    );

    Matter.World.add(this.engine.world, [
      this.groundBody,
      this.p1TowerBody,
      this.p2TowerBody,
    ]);

    this.initClouds();
    this.setupPhysicsCollisions();
    this.buildArena('classic');

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    if (canvas.parentElement) {
      this.resizeObserver.observe(canvas.parentElement);
    }
    this.handleResize();

    this.bindInputEvents();
    this.emitHud();

    this.lastFrameTime = performance.now();
    this.loop(this.lastFrameTime);
  }

  private initClouds(): void {
    this.clouds = [
      { x: 240, y: 120, w: 150, speed: 6 },
      { x: 680, y: 85, w: 190, speed: 4.5 },
      { x: 1180, y: 145, w: 140, speed: 7 },
      { x: 1680, y: 95, w: 205, speed: 5 },
      { x: 2150, y: 135, w: 165, speed: 6.2 },
    ];
  }

  private handleResize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.viewW = Math.max(320, Math.floor(rect.width));
    this.viewH = Math.max(320, Math.floor(rect.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
  }

  private clearAllDynamicBodies(): void {
    for (const blk of this.blocks) {
      Matter.World.remove(this.engine.world, blk.body);
    }
    for (const bmb of this.bombs) {
      Matter.World.remove(this.engine.world, bmb.body);
    }
    this.blocks = [];
    this.bombs = [];
  }

  private buildArena(preset: FortressPreset): void {
    this.clearAllDynamicBodies();
    this.preset = preset;
    const blueprints = buildFortressBlueprints(preset);

    for (const bp of blueprints) {
      const stats = MATERIAL_STATS[bp.material];
      const body = Matter.Bodies.rectangle(bp.x, bp.y, bp.w, bp.h, {
        density: stats.density,
        friction: stats.friction,
        restitution: stats.restitution,
        frictionAir: 0.008,
        label: `block_${bp.id}`,
      });
      Matter.World.add(this.engine.world, body);
      this.blocks.push({
        id: bp.id,
        owner: bp.owner,
        material: bp.material,
        w: bp.w,
        h: bp.h,
        maxHp: stats.maxHp,
        hp: stats.maxHp,
        destroyed: false,
        body,
      });
    }
  }

  public startNewMatch(options: {
    mode: PlayMode;
    preset: FortressPreset;
    localRole?: PlayerSide | null;
    initialTurn?: PlayerSide;
    initialWind?: number;
  }): void {
    this.cancelAiTimers();
    this.particles = [];
    this.shockwaves = [];
    this.floatingTexts = [];
    this.isDraggingSling = false;
    this.isPanningCamera = false;
    this.pullX = 0;
    this.pullY = 0;
    this.remoteAimPull = null;
    this.manualPanOffset = 0;
    this.overviewMode = false;
    this.lastImpactPoint = null;
    this.pendingSettleReport = false;

    this.playMode = options.mode;
    this.localRole = options.localRole ?? null;
    this.activeTurn = options.initialTurn ?? 'P1';
    this.wind =
      typeof options.initialWind === 'number'
        ? options.initialWind
        : Math.round((Math.random() * 4 - 2) * 10) / 10;
    this.turnCount = 1;

    this.p1TowerHp = MAX_TOWER_HP;
    this.p2TowerHp = MAX_TOWER_HP;
    this.p1TowerFlash = 0;
    this.p2TowerFlash = 0;

    this.p1Arsenal = { standard: -1, cluster: 2, heavy: 2 };
    this.p2Arsenal = { standard: -1, cluster: 2, heavy: 2 };
    this.selectedBomb = 'standard';

    this.p1Shots = 0;
    this.p2Shots = 0;
    this.p1BlocksBroken = 0;
    this.p2BlocksBroken = 0;
    this.winner = null;

    this.buildArena(options.preset);
    this.phase = 'PLAYING';
    this.turnPhase = 'AIMING';
    this.statusBanner = this.describeTurnBanner();
    this.snapCameraToActiveSlingshot();

    siegeSound.playTurnChime();
    this.emitHud();
    this.maybeTriggerAiTurn();
  }

  public returnToMenu(): void {
    this.cancelAiTimers();
    this.phase = 'TITLE_MENU';
    this.isDraggingSling = false;
    this.isPanningCamera = false;
    this.pullX = 0;
    this.pullY = 0;
    this.overviewMode = true;
    this.buildArena(this.preset);
    this.emitHud();
  }

  public selectBomb(type: BombType): void {
    if (this.phase !== 'PLAYING' || this.turnPhase !== 'AIMING') return;
    if (!this.canLocalHumanControl()) return;
    const arsenal = this.activeTurn === 'P1' ? this.p1Arsenal : this.p2Arsenal;
    if (arsenal[type] === 0) return;
    this.selectedBomb = type;
    this.emitHud();
  }

  public toggleOverview(): void {
    this.overviewMode = !this.overviewMode;
    this.manualPanOffset = 0;
    this.emitHud();
  }

  private canLocalHumanControl(): boolean {
    if (this.phase !== 'PLAYING' || this.turnPhase !== 'AIMING') return false;
    if (this.playMode === 'local') return true;
    if (this.playMode === 'bot') return this.activeTurn === 'P1';
    if (this.playMode === 'online') return this.activeTurn === this.localRole;
    return false;
  }

  private canLocalTriggerAbility(): boolean {
    if (this.phase !== 'PLAYING' || this.turnPhase !== 'FLYING') return false;
    if (this.playMode === 'local') return true;
    if (this.playMode === 'bot') return this.activeTurn === 'P1';
    if (this.playMode === 'online') return this.activeTurn === this.localRole;
    return false;
  }

  private describeTurnBanner(): string {
    if (this.playMode === 'bot') {
      return this.activeTurn === 'P1' ? 'Giliran Anda Menyerang' : 'Giliran Bot Menyerang';
    }
    if (this.playMode === 'online') {
      return this.activeTurn === this.localRole ? 'Giliran Anda' : 'Menunggu Lemparan Lawan';
    }
    return this.activeTurn === 'P1' ? 'Giliran Pemain 1' : 'Giliran Pemain 2';
  }

  private getActiveSlingshotAnchor(): { x: number; y: number } {
    return {
      x: this.activeTurn === 'P1' ? SLINGSHOT_P1_X : SLINGSHOT_P2_X,
      y: SLINGSHOT_ANCHOR_Y,
    };
  }

  private snapCameraToActiveSlingshot(): void {
    this.camX = this.activeTurn === 'P1' ? 840 : WORLD_WIDTH - 840;
    this.camY = WORLD_HEIGHT / 2;
  }

  private setupPhysicsCollisions(): void {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      if (this.phase !== 'PLAYING') return;

      for (const pair of event.pairs) {
        const { bodyA, bodyB } = pair;
        const bombA = this.bombs.find((b) => b.body === bodyA && !b.exploded);
        const bombB = this.bombs.find((b) => b.body === bodyB && !b.exploded);

        if (bombA || bombB) {
          const activeBomb = bombA || bombB!;
          const other = bombA ? bodyB : bodyA;
          if (other.label === 'ground') {
            if (activeBomb.fuseTimerMs === null) {
              activeBomb.fuseTimerMs = 260;
              siegeSound.playImpact('stone', 0.45);
            }
          } else {
            // Direct hit on fortress block or tower -> immediate detonation!
            this.detonateBomb(activeBomb);
          }
          continue;
        }

        // Block-to-block or block-to-tower/ground structural damage
        const blkA = this.blocks.find((b) => !b.destroyed && b.body === bodyA);
        const blkB = this.blocks.find((b) => !b.destroyed && b.body === bodyB);

        const relVx = bodyA.velocity.x - bodyB.velocity.x;
        const relVy = bodyA.velocity.y - bodyB.velocity.y;
        const relSpeed = Math.hypot(relVx, relVy);

        if (relSpeed > 3.1) {
          const impactDmg = (relSpeed - 2.8) * 6.5;
          if (blkA) this.damageBlock(blkA, impactDmg, true);
          if (blkB) this.damageBlock(blkB, impactDmg, true);

          // Falling debris hitting a tower causes crush damage!
          if ((bodyA === this.p1TowerBody || bodyB === this.p1TowerBody) && relSpeed > 3.6) {
            this.damageTower('P1', Math.round((relSpeed - 3.2) * 4.5));
          }
          if ((bodyA === this.p2TowerBody || bodyB === this.p2TowerBody) && relSpeed > 3.6) {
            this.damageTower('P2', Math.round((relSpeed - 3.2) * 4.5));
          }
        }
      }
    });
  }

  private damageBlock(blk: FortressBlockEntity, amount: number, playAudio: boolean): void {
    if (blk.destroyed || amount <= 0.5) return;
    blk.hp -= amount;
    if (playAudio && amount > 4) {
      siegeSound.playImpact(blk.material, Math.min(1.5, amount / 24));
    }
    if (blk.hp <= 0) {
      blk.destroyed = true;
      Matter.World.remove(this.engine.world, blk.body);
      if (blk.owner === 'P1') {
        this.p1BlocksBroken += 1;
      } else {
        this.p2BlocksBroken += 1;
      }
      const stats = MATERIAL_STATS[blk.material];
      this.spawnDebris(blk.body.position.x, blk.body.position.y, stats.fill, stats.stroke, 12);
    }
  }

  private damageTower(side: PlayerSide, rawDamage: number): void {
    if (rawDamage <= 0 || this.winner) return;
    if (side === 'P1') {
      const prev = this.p1TowerHp;
      this.p1TowerHp = Math.max(0, this.p1TowerHp - rawDamage);
      if (this.p1TowerHp < prev) {
        this.p1TowerFlash = 1;
        siegeSound.playTowerHit();
        this.floatingTexts.push({
          x: TOWER_P1_X,
          y: GROUND_Y - TOWER_HEIGHT - 24,
          vy: -0.9,
          text: `-${prev - this.p1TowerHp}`,
          color: '#ef4444',
          life: 1,
          maxLife: 1,
        });
      }
    } else {
      const prev = this.p2TowerHp;
      this.p2TowerHp = Math.max(0, this.p2TowerHp - rawDamage);
      if (this.p2TowerHp < prev) {
        this.p2TowerFlash = 1;
        siegeSound.playTowerHit();
        this.floatingTexts.push({
          x: TOWER_P2_X,
          y: GROUND_Y - TOWER_HEIGHT - 24,
          vy: -0.9,
          text: `-${prev - this.p2TowerHp}`,
          color: '#ef4444',
          life: 1,
          maxLife: 1,
        });
      }
    }

    if (this.p1TowerHp <= 0 && !this.winner) {
      this.winner = 'P2';
      this.spawnDebris(TOWER_P1_X, GROUND_Y - 50, '#dc2626', '#94a3b8', 28);
    } else if (this.p2TowerHp <= 0 && !this.winner) {
      this.winner = 'P1';
      this.spawnDebris(TOWER_P2_X, GROUND_Y - 50, '#2563eb', '#94a3b8', 28);
    }

    this.emitHud();
  }

  private detonateBomb(bomb: ActiveBombEntity): void {
    if (bomb.exploded) return;
    bomb.exploded = true;
    Matter.World.remove(this.engine.world, bomb.body);

    const ex = bomb.body.position.x;
    const ey = bomb.body.position.y;
    this.lastImpactPoint = { x: ex, y: ey };

    const spec = BOMB_SPECS[bomb.type];
    const scale = bomb.isSplitChild ? 0.68 : bomb.type === 'heavy' ? 1.25 : 1.0;
    const blastRadius = spec.blastRadius * (bomb.isSplitChild ? 0.72 : 1);
    const baseDmg = spec.damage * (bomb.isSplitChild ? 0.56 : 1);

    siegeSound.playExplosion(scale);
    this.shakeIntensity = Math.min(20, this.shakeIntensity + 11 * scale);

    this.shockwaves.push({
      x: ex,
      y: ey,
      radius: 10,
      maxRadius: blastRadius,
      alpha: 0.9,
      color: bomb.type === 'heavy' ? '#f59e0b' : '#fb923c',
    });

    // Fireball & smoke particles
    for (let i = 0; i < Math.round(28 * scale); i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 6.5 * scale;
      const isSmoke = i % 3 === 0;
      this.particles.push({
        x: ex + (Math.random() - 0.5) * 10,
        y: ey + (Math.random() - 0.5) * 10,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - (isSmoke ? 1.4 : 0.6),
        radius: isSmoke ? 10 + Math.random() * 14 : 4 + Math.random() * 9,
        color: isSmoke
          ? '#475569'
          : i % 2 === 0
          ? '#f97316'
          : '#facc15',
        alpha: 1,
        life: 1,
        maxLife: isSmoke ? 0.85 : 0.55,
        gravity: isSmoke ? -0.02 : 0.14,
        shape: 'circle',
        angle: 0,
        spin: 0,
      });
    }

    // Damage & impulse on fortress blocks
    for (const blk of this.blocks) {
      if (blk.destroyed) continue;
      const bx = blk.body.position.x;
      const by = blk.body.position.y;
      const dx = bx - ex;
      const dy = by - ey;
      const dist = Math.max(1, Math.hypot(dx, dy) - Math.min(blk.w, blk.h) * 0.35);

      if (dist < blastRadius) {
        const falloff = Math.max(0.2, 1 - dist / blastRadius);
        const armorMult =
          bomb.type === 'heavy' && (blk.material === 'stone' || blk.material === 'steel')
            ? 1.4
            : blk.material === 'steel'
            ? 0.72
            : 1.0;
        this.damageBlock(blk, baseDmg * falloff * armorMult, false);

        if (!blk.destroyed) {
          const push = (0.045 * scale * falloff) / Math.max(0.4, blk.body.mass * 0.15);
          const nx = dx / Math.max(1, Math.hypot(dx, dy));
          const ny = dy / Math.max(1, Math.hypot(dx, dy)) - 0.35;
          Matter.Body.applyForce(blk.body, blk.body.position, {
            x: nx * push,
            y: ny * push,
          });
        }
      }
    }

    // Damage on both towers
    const checkTowerSplash = (tx: number, side: PlayerSide) => {
      const halfW = TOWER_WIDTH / 2;
      const topY = GROUND_Y - TOWER_HEIGHT;
      const closestX = Math.max(tx - halfW, Math.min(ex, tx + halfW));
      const closestY = Math.max(topY, Math.min(ey, GROUND_Y));
      const dist = Math.hypot(ex - closestX, ey - closestY);

      if (dist < blastRadius * 0.94) {
        const directHit = dist <= 16;
        const falloff = directHit ? 1 : Math.max(0.24, 1 - dist / (blastRadius * 0.94));
        const dmg = Math.round(baseDmg * (directHit ? 0.78 : 0.62) * falloff);
        this.damageTower(side, dmg);
      }
    };

    checkTowerSplash(TOWER_P1_X, 'P1');
    checkTowerSplash(TOWER_P2_X, 'P2');
  }

  private spawnDebris(x: number, y: number, colorA: string, colorB: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * Math.random();
      const spd = 2 + Math.random() * 5.5;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 3,
        vy: Math.sin(ang) * spd - 1.5,
        radius: 4 + Math.random() * 6,
        color: i % 2 === 0 ? colorA : colorB,
        alpha: 1,
        life: 1,
        maxLife: 0.75 + Math.random() * 0.35,
        gravity: 0.24,
        shape: 'rect',
        angle: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.25,
      });
    }
  }

  private launchBomb(
    owner: PlayerSide,
    vx: number,
    vy: number,
    bombType: BombType,
    consumeAmmo: boolean
  ): void {
    const anchor = owner === 'P1' ? SLINGSHOT_P1_X : SLINGSHOT_P2_X;
    const spec = BOMB_SPECS[bombType];

    if (consumeAmmo) {
      const arsenal = owner === 'P1' ? this.p1Arsenal : this.p2Arsenal;
      if (arsenal[bombType] > 0) {
        arsenal[bombType] -= 1;
      }
      if (arsenal[this.selectedBomb] === 0) {
        this.selectedBomb = 'standard';
      }
    }

    if (owner === 'P1') this.p1Shots += 1;
    else this.p2Shots += 1;

    const body = Matter.Bodies.circle(anchor, SLINGSHOT_ANCHOR_Y, spec.radius, {
      mass: spec.mass,
      restitution: 0.28,
      friction: 0.65,
      frictionAir: 0,
      label: `bomb_${owner}`,
    });
    Matter.Body.setVelocity(body, { x: vx, y: vy });
    Matter.World.add(this.engine.world, body);

    this.bombs = [
      {
        id: `bomb_${Date.now()}_${Math.random()}`,
        owner,
        type: bombType,
        isSplitChild: false,
        body,
        trail: [{ x: anchor, y: SLINGSHOT_ANCHOR_Y }],
        exploded: false,
        fuseTimerMs: null,
        ageMs: 0,
      },
    ];

    this.turnPhase = 'FLYING';
    this.remoteAimPull = null;
    this.manualPanOffset = 0;
    this.overviewMode = false;
    this.settleTimerMs = 0;
    this.settleTotalMs = 0;
    this.lastImpactPoint = null;
    this.pendingSettleReport =
      this.playMode !== 'online' || owner === this.localRole;

    siegeSound.playLaunch();
    this.emitHud();
  }

  private triggerClusterSplit(fromRemote?: { x: number; y: number; vx: number; vy: number }): void {
    const parent = this.bombs.find(
      (b) => !b.exploded && b.type === 'cluster' && !b.isSplitChild
    );
    if (!parent) return;

    const px = fromRemote ? fromRemote.x : parent.body.position.x;
    const py = fromRemote ? fromRemote.y : parent.body.position.y;
    const pvx = fromRemote ? fromRemote.vx : parent.body.velocity.x;
    const pvy = fromRemote ? fromRemote.vy : parent.body.velocity.y;

    if (!fromRemote && this.playMode === 'online' && this.activeTurn === this.localRole) {
      this.callbacks.onOnlineAbilityEmit?.(px, py, pvx, pvy);
    }

    parent.exploded = true;
    Matter.World.remove(this.engine.world, parent.body);
    siegeSound.playSplit();

    const baseAngle = Math.atan2(pvy, pvx);
    const speed = Math.hypot(pvx, pvy) * 1.04;
    const offsets = [-0.18, 0, 0.18];

    offsets.forEach((off, idx) => {
      const ang = baseAngle + off;
      const childBody = Matter.Bodies.circle(px, py + (idx - 1) * 14, 12, {
        mass: 2.1,
        restitution: 0.25,
        friction: 0.6,
        frictionAir: 0,
        label: `bomb_child_${idx}`,
      });
      Matter.Body.setVelocity(childBody, {
        x: Math.cos(ang) * speed,
        y: Math.sin(ang) * speed,
      });
      Matter.World.add(this.engine.world, childBody);
      this.bombs.push({
        id: `cluster_${idx}_${Date.now()}`,
        owner: parent.owner,
        type: 'cluster',
        isSplitChild: true,
        body: childBody,
        trail: [{ x: px, y: py }],
        exploded: false,
        fuseTimerMs: null,
        ageMs: 0,
      });
    });

    this.spawnDebris(px, py, '#38bdf8', '#0284c7', 10);
    this.emitHud();
  }

  public applyRemoteAim(by: PlayerSide, pullX: number, pullY: number, bombType: BombType): void {
    if (this.phase !== 'PLAYING' || by !== this.activeTurn) return;
    this.remoteAimPull = { x: pullX, y: pullY, bombType };
    this.selectedBomb = bombType;
  }

  public applyRemoteFired(by: PlayerSide, vx: number, vy: number, bombType: BombType): void {
    if (this.phase !== 'PLAYING' || by !== this.activeTurn) return;
    this.launchBomb(by, vx, vy, bombType, true);
  }

  public applyRemoteAbility(by: PlayerSide, x: number, y: number, vx: number, vy: number): void {
    if (this.phase !== 'PLAYING' || by !== this.activeTurn) return;
    this.triggerClusterSplit({ x, y, vx, vy });
  }

  public applyOnlineTurnSync(payload: {
    nextTurn: PlayerSide;
    nextWind: number;
    p1TowerHp: number;
    p2TowerHp: number;
    blocks: BlockSyncData[];
    winner: PlayerSide | null;
    p1BlocksBroken: number;
    p2BlocksBroken: number;
  }): void {
    if (this.phase !== 'PLAYING') return;

    this.p1TowerHp = payload.p1TowerHp;
    this.p2TowerHp = payload.p2TowerHp;
    this.p1BlocksBroken = payload.p1BlocksBroken;
    this.p2BlocksBroken = payload.p2BlocksBroken;

    const map = new Map<string, BlockSyncData>();
    for (const s of payload.blocks) {
      map.set(s.id, s);
    }

    for (const blk of this.blocks) {
      const snap = map.get(blk.id);
      if (!snap) continue;
      blk.hp = snap.hp;
      if (snap.destroyed && !blk.destroyed) {
        blk.destroyed = true;
        Matter.World.remove(this.engine.world, blk.body);
      } else if (!snap.destroyed && !blk.destroyed) {
        Matter.Body.setPosition(blk.body, { x: snap.x, y: snap.y });
        Matter.Body.setAngle(blk.body, snap.angle);
        Matter.Body.setVelocity(blk.body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(blk.body, 0);
      }
    }

    if (payload.winner) {
      this.finishMatch(payload.winner);
      return;
    }

    this.advanceTurn(payload.nextTurn, payload.nextWind);
  }

  private finishMatch(winner: PlayerSide): void {
    this.winner = winner;
    this.phase = 'GAME_OVER';
    this.turnPhase = 'SETTLING';
    this.statusBanner = winner === 'P1' ? 'Pemain 1 Menang!' : 'Pemain 2 Menang!';
    siegeSound.playVictory();
    this.emitHud();
  }

  private advanceTurn(nextTurn: PlayerSide, nextWind: number): void {
    this.activeTurn = nextTurn;
    this.wind = nextWind;
    this.turnCount += 1;
    this.turnPhase = 'AIMING';
    this.pullX = 0;
    this.pullY = 0;
    this.remoteAimPull = null;
    this.manualPanOffset = 0;

    // Ensure selected bomb has remaining ammo
    const arsenal = this.activeTurn === 'P1' ? this.p1Arsenal : this.p2Arsenal;
    if (arsenal[this.selectedBomb] === 0) {
      this.selectedBomb = 'standard';
    }

    this.statusBanner = this.describeTurnBanner();
    siegeSound.playTurnChime();
    this.emitHud();
    this.maybeTriggerAiTurn();
  }

  private cancelAiTimers(): void {
    if (this.aiTimeoutId !== null) {
      window.clearTimeout(this.aiTimeoutId);
      this.aiTimeoutId = null;
    }
    this.aiPullAnim = null;
  }

  private maybeTriggerAiTurn(): void {
    if (this.phase !== 'PLAYING' || this.playMode !== 'bot' || this.activeTurn !== 'P2') {
      return;
    }

    this.turnPhase = 'AI_THINKING';
    this.statusBanner = 'Bot sedang membidik...';
    this.emitHud();

    this.aiTimeoutId = window.setTimeout(() => {
      if (this.phase !== 'PLAYING' || this.activeTurn !== 'P2') return;

      // Pick bomb strategically
      let bombChoice: BombType = 'standard';
      const p1StoneIntact = this.blocks.filter(
        (b) => !b.destroyed && b.owner === 'P1' && (b.material === 'stone' || b.material === 'steel')
      ).length;

      if (this.p2Arsenal.heavy > 0 && p1StoneIntact >= 2 && Math.random() < 0.58) {
        bombChoice = 'heavy';
      } else if (this.p2Arsenal.cluster > 0 && Math.random() < 0.36) {
        bombChoice = 'cluster';
      }
      this.selectedBomb = bombChoice;

      // Ballistic search toward P1 fortress & tower
      const targetX = TOWER_P1_X + (Math.random() < 0.4 ? 115 : (Math.random() - 0.5) * 40);
      const targetY = GROUND_Y - 58;
      let bestVx = -16;
      let bestVy = -14;
      let bestErr = Infinity;

      const stepGravityY = GRAVITY_SCALE * FIXED_DT * FIXED_DT;
      const stepWindX = this.wind * WIND_FORCE_COEFF * FIXED_DT * FIXED_DT;

      for (let deg = 28; deg <= 68; deg += 4) {
        const rad = (deg * Math.PI) / 180;
        for (let power = 0.62; power <= 0.99; power += 0.03) {
          const spd = power * MAX_PULL_DIST * LAUNCH_SPEED_SCALE;
          const vx0 = -Math.cos(rad) * spd;
          const vy0 = -Math.sin(rad) * spd;

          let sx = SLINGSHOT_P2_X;
          let sy = SLINGSHOT_ANCHOR_Y;
          let svx = vx0;
          let svy = vy0;

          for (let step = 0; step < 190; step++) {
            svx += stepWindX;
            svy += stepGravityY;
            sx += svx;
            sy += svy;
            const err = Math.hypot(sx - targetX, sy - targetY);
            if (err < bestErr) {
              bestErr = err;
              bestVx = vx0;
              bestVy = vy0;
            }
            if (sy > GROUND_Y) break;
          }
        }
      }

      // Slight human-like variance so Bot is fair and exciting
      const jitter = 0.96 + Math.random() * 0.08;
      const finalVx = bestVx * jitter;
      const finalVy = bestVy * (0.97 + Math.random() * 0.06);

      const targetPullX = -finalVx / LAUNCH_SPEED_SCALE;
      const targetPullY = -finalVy / LAUNCH_SPEED_SCALE;

      this.aiPullAnim = {
        startAt: performance.now(),
        duration: 720,
        targetPullX,
        targetPullY,
        bombType: bombChoice,
      };
    }, 680);
  }

  // Input handling (slingshot drag + sky panning + mid-air split)
  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = (sx - this.viewW / 2) / this.camZoom + this.camX;
    const wy = (sy - this.viewH / 2) / this.camZoom + this.camY;
    return { x: wx, y: wy };
  }

  private clampSlingshotPull(rawDx: number, rawDy: number): { x: number; y: number } {
    let dx = rawDx;
    let dy = rawDy;
    // Constrain pull so shot always goes toward the opponent side (P1 shoots right -> pull left; P2 shoots left -> pull right)
    if (this.activeTurn === 'P1') {
      dx = Math.min(-6, dx);
    } else {
      dx = Math.max(6, dx);
    }
    // Allow aiming upward or slightly downward lob (pulling down = shooting up)
    dy = Math.max(-45, dy);

    const len = Math.hypot(dx, dy);
    if (len > MAX_PULL_DIST) {
      const k = MAX_PULL_DIST / len;
      dx *= k;
      dy *= k;
    }
    return { x: dx, y: dy };
  }

  private bindInputEvents(): void {
    const onPointerDown = (e: PointerEvent) => {
      if (this.phase !== 'PLAYING') return;

      // Mid-air ability for Cluster Bomb
      if (this.canLocalTriggerAbility()) {
        const hasUnsplitCluster = this.bombs.some(
          (b) => !b.exploded && b.type === 'cluster' && !b.isSplitChild
        );
        if (hasUnsplitCluster) {
          this.triggerClusterSplit();
          return;
        }
      }

      const worldPt = this.screenToWorld(e.clientX, e.clientY);
      const anchor = this.getActiveSlingshotAnchor();
      const distToAnchor = Math.hypot(worldPt.x - anchor.x, worldPt.y - anchor.y);

      if (this.canLocalHumanControl() && distToAnchor <= 108) {
        this.isDraggingSling = true;
        this.activePointerId = e.pointerId;
        this.canvas.setPointerCapture(e.pointerId);
        this.overviewMode = false;
        this.manualPanOffset = 0;

        const clamped = this.clampSlingshotPull(worldPt.x - anchor.x, worldPt.y - anchor.y);
        this.pullX = clamped.x;
        this.pullY = clamped.y;
        siegeSound.playStretch();
        return;
      }

      // Otherwise allow panning across the battlefield to inspect walls/tower
      this.isPanningCamera = true;
      this.activePointerId = e.pointerId;
      this.panLastClientX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (this.activePointerId !== e.pointerId) return;

      if (this.isDraggingSling) {
        const worldPt = this.screenToWorld(e.clientX, e.clientY);
        const anchor = this.getActiveSlingshotAnchor();
        const clamped = this.clampSlingshotPull(worldPt.x - anchor.x, worldPt.y - anchor.y);
        this.pullX = clamped.x;
        this.pullY = clamped.y;
        siegeSound.playStretch();

        const now = performance.now();
        if (
          this.playMode === 'online' &&
          this.activeTurn === this.localRole &&
          now - this.lastAimEmitAt > 60
        ) {
          this.lastAimEmitAt = now;
          this.callbacks.onOnlineAimEmit?.(this.pullX, this.pullY, this.selectedBomb);
        }
      } else if (this.isPanningCamera && !this.overviewMode) {
        const dx = e.clientX - this.panLastClientX;
        this.panLastClientX = e.clientX;
        this.manualPanOffset = Math.max(
          -1200,
          Math.min(1200, this.manualPanOffset - dx / this.camZoom)
        );
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (this.activePointerId !== e.pointerId) return;
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
      this.activePointerId = null;

      if (this.isDraggingSling) {
        this.isDraggingSling = false;
        const pullDist = Math.hypot(this.pullX, this.pullY);
        if (pullDist >= MIN_PULL_DIST && this.canLocalHumanControl()) {
          const vx = -this.pullX * LAUNCH_SPEED_SCALE;
          const vy = -this.pullY * LAUNCH_SPEED_SCALE;
          const bombType = this.selectedBomb;
          const shooter = this.activeTurn;

          if (this.playMode === 'online') {
            this.callbacks.onOnlineFireEmit?.(vx, vy, bombType);
          }
          this.launchBomb(shooter, vx, vy, bombType, true);
        }
        this.pullX = 0;
        this.pullY = 0;
      }

      this.isPanningCamera = false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && this.canLocalTriggerAbility()) {
        const hasUnsplitCluster = this.bombs.some(
          (b) => !b.exploded && b.type === 'cluster' && !b.isSplitChild
        );
        if (hasUnsplitCluster) {
          e.preventDefault();
          this.triggerClusterSplit();
        }
      }
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    this.canvas.addEventListener('pointermove', onPointerMove);
    this.canvas.addEventListener('pointerup', onPointerUp);
    this.canvas.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    this.cleanupListeners = () => {
      this.canvas.removeEventListener('pointerdown', onPointerDown);
      this.canvas.removeEventListener('pointermove', onPointerMove);
      this.canvas.removeEventListener('pointerup', onPointerUp);
      this.canvas.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }

  private cleanupListeners: () => void = () => {};

  private stepPhysics(): void {
    // Apply wind force to active airborne bombs
    for (const bomb of this.bombs) {
      if (bomb.exploded) continue;
      Matter.Body.applyForce(bomb.body, bomb.body.position, {
        x: this.wind * WIND_FORCE_COEFF * bomb.body.mass,
        y: 0,
      });
    }

    Matter.Engine.update(this.engine, FIXED_DT);

    // Update bomb trails, bounds, and ground fuses
    for (const bomb of this.bombs) {
      if (bomb.exploded) continue;
      bomb.ageMs += FIXED_DT;
      const pos = bomb.body.position;
      const last = bomb.trail[bomb.trail.length - 1];
      if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) > 12) {
        bomb.trail.push({ x: pos.x, y: pos.y });
        if (bomb.trail.length > 48) bomb.trail.shift();
      }

      if (bomb.fuseTimerMs !== null) {
        bomb.fuseTimerMs -= FIXED_DT;
        if (bomb.fuseTimerMs <= 0) {
          this.detonateBomb(bomb);
          continue;
        }
      }

      if (pos.x < -250 || pos.x > WORLD_WIDTH + 250 || pos.y > WORLD_HEIGHT + 200) {
        bomb.exploded = true;
        Matter.World.remove(this.engine.world, bomb.body);
      }
    }

    // Check if blocks fell out of bounds
    for (const blk of this.blocks) {
      if (blk.destroyed) continue;
      if (blk.body.position.y > WORLD_HEIGHT + 150) {
        this.damageBlock(blk, 9999, false);
      }
    }
  }

  private updateTurnLifecycle(dtMs: number): void {
    if (this.phase !== 'PLAYING') return;

    // Handle AI pull animation
    if (this.aiPullAnim) {
      const elapsed = performance.now() - this.aiPullAnim.startAt;
      const t = Math.min(1, elapsed / this.aiPullAnim.duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.pullX = this.aiPullAnim.targetPullX * eased;
      this.pullY = this.aiPullAnim.targetPullY * eased;

      if (t >= 1) {
        const anim = this.aiPullAnim;
        this.aiPullAnim = null;
        const vx = -anim.targetPullX * LAUNCH_SPEED_SCALE;
        const vy = -anim.targetPullY * LAUNCH_SPEED_SCALE;
        this.pullX = 0;
        this.pullY = 0;
        this.launchBomb('P2', vx, vy, anim.bombType, true);
      }
    }

    if (this.turnPhase === 'FLYING') {
      const anyActiveBomb = this.bombs.some((b) => !b.exploded);
      if (!anyActiveBomb) {
        this.turnPhase = 'SETTLING';
        this.settleTimerMs = 0;
        this.settleTotalMs = 0;
        this.emitHud();
      }
    } else if (this.turnPhase === 'SETTLING') {
      this.settleTimerMs += dtMs;
      this.settleTotalMs += dtMs;

      const movingBlocks = this.blocks.some(
        (b) =>
          !b.destroyed &&
          (Math.hypot(b.body.velocity.x, b.body.velocity.y) > 0.35 ||
            Math.abs(b.body.angularVelocity) > 0.025)
      );

      if (!movingBlocks || this.settleTotalMs > 2600) {
        if (this.settleTimerMs >= 950 || this.settleTotalMs > 2600) {
          this.completeTurnSettle();
        }
      } else {
        this.settleTimerMs = Math.min(this.settleTimerMs, 450);
      }
    }
  }

  private completeTurnSettle(): void {
    if (this.phase !== 'PLAYING') return;

    if (this.playMode === 'online') {
      if (this.pendingSettleReport && this.activeTurn === this.localRole) {
        this.pendingSettleReport = false;
        const blockSnapshots: BlockSyncData[] = this.blocks.map((b) => ({
          id: b.id,
          x: b.body.position.x,
          y: b.body.position.y,
          angle: b.body.angle,
          vx: 0,
          vy: 0,
          angularVelocity: 0,
          hp: b.hp,
          destroyed: b.destroyed,
        }));
        this.callbacks.onOnlineTurnSettled?.({
          p1TowerHp: this.p1TowerHp,
          p2TowerHp: this.p2TowerHp,
          blocks: blockSnapshots,
          winner: this.winner,
          p1BlocksBroken: this.p1BlocksBroken,
          p2BlocksBroken: this.p2BlocksBroken,
        });
      }
      return;
    }

    if (this.winner) {
      this.finishMatch(this.winner);
      return;
    }

    const nextTurn: PlayerSide = this.activeTurn === 'P1' ? 'P2' : 'P1';
    const nextWind = Math.round((Math.random() * 5 - 2.5) * 10) / 10;
    this.advanceTurn(nextTurn, nextWind);
  }

  private updateCamera(dtSec: number): void {
    const overviewZoom = Math.min(this.viewW / WORLD_WIDTH, this.viewH / WORLD_HEIGHT) * 0.96;
    const playZoom = Math.max(0.55, Math.min(1.08, (this.viewH / WORLD_HEIGHT) * 1.02));

    let targetZoom = this.overviewMode || this.phase === 'TITLE_MENU' ? overviewZoom : playZoom;
    let targetX = WORLD_WIDTH / 2;
    let targetY = WORLD_HEIGHT / 2;

    if (this.phase === 'PLAYING' && !this.overviewMode) {
      const halfVisibleW = this.viewW / (2 * targetZoom);
      if (this.turnPhase === 'FLYING') {
        const leadBomb = this.bombs.find((b) => !b.exploded);
        if (leadBomb) {
          targetX = leadBomb.body.position.x;
          targetY = Math.min(WORLD_HEIGHT / 2, Math.max(280, leadBomb.body.position.y + 40));
        }
      } else if (this.turnPhase === 'SETTLING' && this.lastImpactPoint) {
        targetX = this.lastImpactPoint.x;
      } else {
        const baseFocus =
          this.activeTurn === 'P1' ? SLINGSHOT_P1_X + 240 : SLINGSHOT_P2_X - 240;
        targetX = baseFocus + this.manualPanOffset;
      }

      const minCamX = Math.min(WORLD_WIDTH / 2, halfVisibleW - 40);
      const maxCamX = Math.max(WORLD_WIDTH / 2, WORLD_WIDTH - halfVisibleW + 40);
      targetX = Math.max(minCamX, Math.min(maxCamX, targetX));
    }

    const lerp = Math.min(1, dtSec * 6.5);
    this.camX += (targetX - this.camX) * lerp;
    this.camY += (targetY - this.camY) * lerp;
    this.camZoom += (targetZoom - this.camZoom) * lerp;

    if (this.shakeIntensity > 0.1) {
      this.shakeIntensity *= Math.pow(0.05, dtSec);
    } else {
      this.shakeIntensity = 0;
    }
  }

  private updateVisualFx(dtSec: number): void {
    this.p1TowerFlash = Math.max(0, this.p1TowerFlash - dtSec * 3.5);
    this.p2TowerFlash = Math.max(0, this.p2TowerFlash - dtSec * 3.5);

    for (const c of this.clouds) {
      c.x += c.speed * dtSec;
      if (c.x - c.w > WORLD_WIDTH + 120) c.x = -c.w;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtSec / p.maxLife;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.angle += p.spin;
      p.alpha = Math.max(0, p.life);
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += (s.maxRadius - s.radius) * Math.min(1, dtSec * 12);
      s.alpha -= dtSec * 2.8;
      if (s.alpha <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.life -= dtSec / ft.maxLife;
      if (ft.life <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }
  }

  private loop = (now: number): void => {
    const rawDt = Math.min(50, Math.max(0, now - this.lastFrameTime));
    this.lastFrameTime = now;
    const dtSec = rawDt / 1000;

    if (this.phase === 'PLAYING') {
      this.accumulator += rawDt;
      while (this.accumulator >= FIXED_DT) {
        this.stepPhysics();
        this.accumulator -= FIXED_DT;
      }
      this.updateTurnLifecycle(rawDt);
    }

    this.updateCamera(dtSec);
    this.updateVisualFx(dtSec);
    this.render();

    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, this.viewH);
    sky.addColorStop(0, '#bae6fd');
    sky.addColorStop(0.62, '#e0f2fe');
    sky.addColorStop(1, '#fef3c7');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    // Apply camera transform + shake
    const shakeX = this.shakeIntensity ? (Math.random() - 0.5) * this.shakeIntensity : 0;
    const shakeY = this.shakeIntensity ? (Math.random() - 0.5) * this.shakeIntensity : 0;

    ctx.translate(this.viewW / 2 + shakeX, this.viewH / 2 + shakeY);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);

    this.renderBackdrop(ctx);
    this.renderGround(ctx);
    this.renderFortressZoneHighlight(ctx);
    this.renderTowerHouse(ctx, 'P1', TOWER_P1_X, this.p1TowerHp, this.p1TowerFlash);
    this.renderTowerHouse(ctx, 'P2', TOWER_P2_X, this.p2TowerHp, this.p2TowerFlash);
    this.renderBlocks(ctx);
    this.renderSlingshot(ctx, 'P1', SLINGSHOT_P1_X);
    this.renderSlingshot(ctx, 'P2', SLINGSHOT_P2_X);
    this.renderTrajectoryPreview(ctx);
    this.renderBombs(ctx);
    this.renderFx(ctx);

    ctx.restore();
  }

  private renderBackdrop(ctx: CanvasRenderingContext2D): void {
    // Distant sun glow
    ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
    ctx.beginPath();
    ctx.arc(WORLD_WIDTH * 0.5, 190, 95, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(254, 240, 138, 0.85)';
    ctx.beginPath();
    ctx.arc(WORLD_WIDTH * 0.5, 190, 52, 0, Math.PI * 2);
    ctx.fill();

    // Rolling hills
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(-400, GROUND_Y);
    ctx.quadraticCurveTo(220, 480, 740, GROUND_Y);
    ctx.quadraticCurveTo(1200, 430, 1680, GROUND_Y);
    ctx.quadraticCurveTo(2120, 490, WORLD_WIDTH + 400, GROUND_Y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#a7f3d0';
    ctx.beginPath();
    ctx.moveTo(-400, GROUND_Y);
    ctx.quadraticCurveTo(350, 560, 920, GROUND_Y);
    ctx.quadraticCurveTo(1540, 540, WORLD_WIDTH + 400, GROUND_Y);
    ctx.closePath();
    ctx.fill();

    // Soft clouds
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    for (const c of this.clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.w * 0.5, 22, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.w * 0.22, c.y + 5, c.w * 0.3, 18, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.w * 0.24, c.y + 6, c.w * 0.28, 17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderGround(ctx: CanvasRenderingContext2D): void {
    // Deep earth
    ctx.fillStyle = '#451a03';
    ctx.fillRect(-500, GROUND_Y, WORLD_WIDTH + 1000, 380);

    // Soil stratum
    ctx.fillStyle = '#78350f';
    ctx.fillRect(-500, GROUND_Y + 14, WORLD_WIDTH + 1000, 26);

    // Grass strip
    ctx.fillStyle = '#65a30d';
    ctx.fillRect(-500, GROUND_Y, WORLD_WIDTH + 1000, 16);

    // Ground stone platforms under bases
    ctx.fillStyle = '#475569';
    ctx.fillRect(150, GROUND_Y - 4, 330, 10);
    ctx.fillRect(WORLD_WIDTH - 480, GROUND_Y - 4, 330, 10);
  }

  private renderFortressZoneHighlight(ctx: CanvasRenderingContext2D): void {
    // Subtle territory markers
    ctx.fillStyle = 'rgba(37, 99, 235, 0.14)';
    ctx.fillRect(150, GROUND_Y + 4, 330, 8);
    ctx.fillStyle = 'rgba(220, 38, 38, 0.14)';
    ctx.fillRect(WORLD_WIDTH - 480, GROUND_Y + 4, 330, 8);
  }

  private renderTowerHouse(
    ctx: CanvasRenderingContext2D,
    side: PlayerSide,
    cx: number,
    hp: number,
    flash: number
  ): void {
    const w = TOWER_WIDTH;
    const h = TOWER_HEIGHT;
    const left = cx - w / 2;
    const top = GROUND_Y - h;
    const hpRatio = Math.max(0, hp / MAX_TOWER_HP);
    const accent = side === 'P1' ? '#2563eb' : '#dc2626';
    const roofColor = side === 'P1' ? '#1d4ed8' : '#b91c1c';

    ctx.save();

    if (hp <= 0) {
      // Ruined house rubble
      ctx.fillStyle = '#475569';
      ctx.fillRect(left + 4, GROUND_Y - 22, w - 8, 22);
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(left, GROUND_Y);
      ctx.lineTo(cx - 10, GROUND_Y - 34);
      ctx.lineTo(cx + 22, GROUND_Y - 18);
      ctx.lineTo(left + w, GROUND_Y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    // House body
    ctx.fillStyle = flash > 0.1 ? '#fecaca' : '#f8fafc';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2.5;
    ctx.fillRect(left + 6, top + 30, w - 12, h - 30);
    ctx.strokeRect(left + 6, top + 30, w - 12, h - 30);

    // Timber framing
    ctx.fillStyle = '#78350f';
    ctx.fillRect(left + 6, top + 30, 8, h - 30);
    ctx.fillRect(left + w - 14, top + 30, 8, h - 30);

    // Arched Wooden Door
    ctx.fillStyle = '#92400e';
    ctx.beginPath();
    ctx.roundRect(cx - 12, GROUND_Y - 34, 24, 34, [10, 10, 0, 0]);
    ctx.fill();
    ctx.stroke();

    // Glowing Window
    ctx.fillStyle = hpRatio > 0.4 ? '#fde047' : '#fb923c';
    ctx.fillRect(cx - 11, top + 40, 22, 16);
    ctx.strokeRect(cx - 11, top + 40, 22, 16);

    // Pitched Roof
    ctx.fillStyle = flash > 0.1 ? '#ef4444' : roofColor;
    ctx.beginPath();
    ctx.moveTo(left - 6, top + 34);
    ctx.lineTo(cx, top);
    ctx.lineTo(left + w + 6, top + 34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Flagpole on roof peak
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, top - 24);
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(cx, top - 24);
    ctx.lineTo(cx + (side === 'P1' ? 20 : -20), top - 17);
    ctx.lineTo(cx, top - 10);
    ctx.closePath();
    ctx.fill();

    // Structural cracks if damaged
    if (hpRatio < 0.72) {
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(left + 16, top + 45);
      ctx.lineTo(left + 26, top + 58);
      ctx.lineTo(left + 20, top + 72);
      ctx.stroke();
    }
    if (hpRatio < 0.4) {
      ctx.beginPath();
      ctx.moveTo(left + w - 18, top + 36);
      ctx.lineTo(left + w - 30, top + 54);
      ctx.lineTo(left + w - 22, top + 78);
      ctx.stroke();
    }

    // Floating in-world Tower Health Bar above house
    const barW = 92;
    const barH = 10;
    const barX = cx - barW / 2;
    const barY = top - 44;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 4);
    ctx.fill();

    ctx.fillStyle = hpRatio > 0.5 ? '#22c55e' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(barX, barY, barW * hpRatio, barH);

    ctx.fillStyle = '#0f172a';
    ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Rumah ${side} (${Math.max(0, Math.round(hp))})`,
      cx,
      barY - 6
    );

    ctx.restore();
  }

  private renderBlocks(ctx: CanvasRenderingContext2D): void {
    for (const blk of this.blocks) {
      if (blk.destroyed) continue;
      const { x, y } = blk.body.position;
      const stats = MATERIAL_STATS[blk.material];
      const dmgRatio = 1 - Math.max(0, blk.hp) / blk.maxHp;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(blk.body.angle);

      ctx.fillStyle = stats.fill;
      ctx.strokeStyle = stats.stroke;
      ctx.lineWidth = 2;
      ctx.fillRect(-blk.w / 2, -blk.h / 2, blk.w, blk.h);
      ctx.strokeRect(-blk.w / 2, -blk.h / 2, blk.w, blk.h);

      // Material texture lines
      ctx.strokeStyle = stats.grain;
      ctx.lineWidth = 1.2;
      if (blk.material === 'wood') {
        ctx.beginPath();
        if (blk.w > blk.h) {
          ctx.moveTo(-blk.w * 0.35, -blk.h * 0.15);
          ctx.lineTo(blk.w * 0.35, -blk.h * 0.15);
          ctx.moveTo(-blk.w * 0.25, blk.h * 0.2);
          ctx.lineTo(blk.w * 0.3, blk.h * 0.2);
        } else {
          ctx.moveTo(-blk.w * 0.18, -blk.h * 0.35);
          ctx.lineTo(-blk.w * 0.18, blk.h * 0.35);
          ctx.moveTo(blk.w * 0.18, -blk.h * 0.25);
          ctx.lineTo(blk.w * 0.18, blk.h * 0.3);
        }
        ctx.stroke();
      } else if (blk.material === 'steel') {
        ctx.fillStyle = '#cbd5e1';
        const rx = Math.max(2, blk.w / 2 - 5);
        const ry = Math.max(2, blk.h / 2 - 5);
        [
          [-rx, -ry],
          [rx, -ry],
          [-rx, ry],
          [rx, ry],
        ].forEach(([cx, cy]) => {
          ctx.beginPath();
          ctx.arc(cx, cy, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Cracks as block loses HP
      if (dmgRatio > 0.3) {
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-blk.w * 0.25, -blk.h * 0.25);
        ctx.lineTo(0, 0);
        ctx.lineTo(blk.w * 0.2, -blk.h * 0.1);
        if (dmgRatio > 0.62) {
          ctx.moveTo(0, 0);
          ctx.lineTo(-blk.w * 0.1, blk.h * 0.3);
        }
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private renderSlingshot(ctx: CanvasRenderingContext2D, side: PlayerSide, x: number): void {
    const isActive =
      this.phase === 'PLAYING' &&
      this.activeTurn === side &&
      (this.turnPhase === 'AIMING' || this.turnPhase === 'AI_THINKING');

    const anchorY = SLINGSHOT_ANCHOR_Y;
    const baseColor = side === 'P1' ? '#2563eb' : '#dc2626';

    // Mound base
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.roundRect(x - 28, GROUND_Y - 14, 56, 14, [6, 6, 0, 0]);
    ctx.fill();

    // Back fork arm
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y - 12);
    ctx.lineTo(x, anchorY + 26);
    ctx.lineTo(x + (side === 'P1' ? 12 : -12), anchorY - 4);
    ctx.stroke();

    // Active pull coordinates
    let pullDx = 0;
    let pullDy = 0;
    let activeBombType = this.selectedBomb;
    if (isActive) {
      if (this.remoteAimPull) {
        pullDx = this.remoteAimPull.x;
        pullDy = this.remoteAimPull.y;
        activeBombType = this.remoteAimPull.bombType;
      } else {
        pullDx = this.pullX;
        pullDy = this.pullY;
      }
    }

    const pouchX = x + pullDx;
    const pouchY = anchorY + pullDy;

    if (isActive) {
      // Back rubber band
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + (side === 'P1' ? 12 : -12), anchorY - 2);
      ctx.lineTo(pouchX, pouchY);
      ctx.stroke();

      // Bomb sitting in pouch
      this.drawBombSprite(ctx, pouchX, pouchY, activeBombType, false, 0);
    }

    // Front fork arm
    ctx.strokeStyle = '#92400e';
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(x, anchorY + 26);
    ctx.lineTo(x + (side === 'P1' ? -12 : 12), anchorY - 2);
    ctx.stroke();

    if (isActive) {
      // Front rubber band
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + (side === 'P1' ? -12 : 12), anchorY);
      ctx.lineTo(pouchX, pouchY);
      ctx.stroke();

      // Subtle turn beacon ring when idle so player knows which slingshot is active
      if (Math.hypot(pullDx, pullDy) < 5 && this.canLocalHumanControl()) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.006);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.35 + pulse * 0.4;
        ctx.beginPath();
        ctx.arc(x, anchorY, 34 + pulse * 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  private renderTrajectoryPreview(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'PLAYING') return;
    if (this.turnPhase !== 'AIMING' && this.turnPhase !== 'AI_THINKING') return;

    const pullDx = this.remoteAimPull ? this.remoteAimPull.x : this.pullX;
    const pullDy = this.remoteAimPull ? this.remoteAimPull.y : this.pullY;
    const pullDist = Math.hypot(pullDx, pullDy);
    if (pullDist < MIN_PULL_DIST) return;

    const anchor = this.getActiveSlingshotAnchor();
    let sx = anchor.x;
    let sy = anchor.y;
    let vx = -pullDx * LAUNCH_SPEED_SCALE;
    let vy = -pullDy * LAUNCH_SPEED_SCALE;

    const stepGravityY = GRAVITY_SCALE * FIXED_DT * FIXED_DT;
    const stepWindX = this.wind * WIND_FORCE_COEFF * FIXED_DT * FIXED_DT;

    ctx.save();
    for (let step = 1; step <= 48; step++) {
      vx += stepWindX;
      vy += stepGravityY;
      sx += vx;
      sy += vy;

      if (step % 3 === 0) {
        const alpha = Math.max(0.12, 1 - step / 52);
        ctx.fillStyle = `rgba(15, 23, 42, ${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 4.2 - step * 0.04, 0, Math.PI * 2);
        ctx.fill();
      }
      if (sy > GROUND_Y) break;
    }

    // Power & angle badge near slingshot
    const pct = Math.round((pullDist / MAX_PULL_DIST) * 100);
    const angleDeg = Math.round(
      Math.abs((Math.atan2(-pullDy, Math.abs(pullDx)) * 180) / Math.PI)
    );
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(anchor.x - 52, anchor.y - 74, 104, 26, 6);
    ctx.fill();
    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${pct}% · ${angleDeg}°`, anchor.x, anchor.y - 57);
    ctx.restore();
  }

  private renderBombs(ctx: CanvasRenderingContext2D): void {
    for (const bomb of this.bombs) {
      if (bomb.exploded) continue;

      // Dotted flight trail
      for (let i = 0; i < bomb.trail.length; i++) {
        const pt = bomb.trail[i];
        const alpha = ((i + 1) / bomb.trail.length) * 0.55;
        ctx.fillStyle = `rgba(51, 65, 85, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      this.drawBombSprite(
        ctx,
        bomb.body.position.x,
        bomb.body.position.y,
        bomb.type,
        bomb.isSplitChild,
        bomb.body.angle
      );
    }
  }

  private drawBombSprite(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    type: BombType,
    isChild: boolean,
    angle: number
  ): void {
    const spec = BOMB_SPECS[type];
    const r = isChild ? 12 : spec.radius;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Bomb sphere
    ctx.fillStyle = spec.color;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Specular highlight
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fill();

    // Type emblem
    if (type === 'cluster') {
      ctx.fillStyle = '#bae6fd';
      ctx.beginPath();
      ctx.arc(-4, 2, 2.6, 0, Math.PI * 2);
      ctx.arc(4, 2, 2.6, 0, Math.PI * 2);
      ctx.arc(0, -4, 2.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'heavy') {
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Lit fuse spark
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(6, -r - 7, 10, -r - 4);
    ctx.stroke();

    ctx.fillStyle = Math.random() > 0.4 ? '#facc15' : '#f97316';
    ctx.beginPath();
    ctx.arc(10, -r - 4, 3.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private renderFx(ctx: CanvasRenderingContext2D): void {
    for (const s of this.shockwaves) {
      ctx.save();
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = Math.max(0, s.alpha);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.fillRect(-p.radius / 2, -p.radius / 2, p.radius, p.radius * 0.7);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life);
      ctx.font = '800 22px "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  private emitHud(): void {
    const canSplitMidAir =
      this.canLocalTriggerAbility() &&
      this.bombs.some((b) => !b.exploded && b.type === 'cluster' && !b.isSplitChild);

    this.callbacks.onHudChange({
      phase: this.phase,
      turnPhase: this.turnPhase,
      activeTurn: this.activeTurn,
      playMode: this.playMode,
      localRole: this.localRole,
      wind: this.wind,
      turnCount: this.turnCount,
      p1TowerHp: Math.max(0, Math.round(this.p1TowerHp)),
      p2TowerHp: Math.max(0, Math.round(this.p2TowerHp)),
      maxTowerHp: MAX_TOWER_HP,
      p1Arsenal: { ...this.p1Arsenal },
      p2Arsenal: { ...this.p2Arsenal },
      selectedBomb: this.selectedBomb,
      canSplitMidAir,
      overviewMode: this.overviewMode,
      winner: this.winner,
      p1Shots: this.p1Shots,
      p2Shots: this.p2Shots,
      p1BlocksBroken: this.p1BlocksBroken,
      p2BlocksBroken: this.p2BlocksBroken,
      statusBanner: this.statusBanner,
    });
  }

  public dispose(): void {
    this.cancelAiTimers();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver.disconnect();
    this.cleanupListeners();
    Matter.World.clear(this.engine.world, false);
    Matter.Engine.clear(this.engine);
  }
}
