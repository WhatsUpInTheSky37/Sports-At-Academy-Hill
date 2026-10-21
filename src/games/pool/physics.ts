/**
 * 2D top-down pool physics (metres, seconds). Pure and deterministic so the AI and the tests can run
 * the exact same simulation the scene animates. x runs across the table, z runs away from the shooter
 * (z = 0 is the head rail where players break from).
 */

export interface PoolConfig {
  /** Playing surface size (m). */
  tableW: number;
  tableL: number;
  ballR: number;
  /** Capture radius for corner and side pockets (distance from pocket centre to ball centre). */
  cornerPocketR: number;
  sidePocketR: number;
  /** Constant deceleration from rolling resistance (m/s^2). */
  friction: number;
  /** Extra proportional damping per second. */
  damping: number;
  cushionRestitution: number;
  ballRestitution: number;
  /** Speed below which a ball is considered stopped. */
  stopSpeed: number;
  /** Max cue ball speed at 100% power (m/s). */
  maxShotSpeed: number;
  /** Physics sub-step (s). */
  subStep: number;
  /** Safety cap on simulated time for a single shot (s). */
  maxShotTime: number;
}

export const DEFAULT_POOL: PoolConfig = {
  tableW: 1.27,
  tableL: 2.54,
  ballR: 0.0286,
  cornerPocketR: 0.075,
  sidePocketR: 0.068,
  friction: 0.3,
  damping: 0.1,
  cushionRestitution: 0.72,
  ballRestitution: 0.96,
  stopSpeed: 0.03,
  maxShotSpeed: 6.5,
  subStep: 1 / 480,
  maxShotTime: 25,
};

export interface Ball {
  id: number; // 0 = cue
  x: number;
  z: number;
  vx: number;
  vz: number;
  active: boolean;
}

export interface Pocket { x: number; z: number; r: number; index: number; }

export function pockets(cfg: PoolConfig = DEFAULT_POOL): Pocket[] {
  const { tableW: w, tableL: l } = cfg;
  const c = cfg.cornerPocketR;
  const s = cfg.sidePocketR;
  // Index order: 0 near-left, 1 near-right, 2 mid-left, 3 mid-right, 4 far-left, 5 far-right.
  return [
    { x: 0, z: 0, r: c, index: 0 },
    { x: w, z: 0, r: c, index: 1 },
    { x: 0, z: l / 2, r: s, index: 2 },
    { x: w, z: l / 2, r: s, index: 3 },
    { x: 0, z: l, r: c, index: 4 },
    { x: w, z: l, r: c, index: 5 },
  ];
}

export function isSolid(id: number): boolean { return id >= 1 && id <= 7; }
export function isStripe(id: number): boolean { return id >= 9 && id <= 15; }

/** Foot spot (where the apex ball of the rack sits). */
export function footSpot(cfg: PoolConfig = DEFAULT_POOL): { x: number; z: number } {
  return { x: cfg.tableW / 2, z: cfg.tableL * 0.75 };
}

/** Head spot (cue ball break position). */
export function headSpot(cfg: PoolConfig = DEFAULT_POOL): { x: number; z: number } {
  return { x: cfg.tableW / 2, z: cfg.tableL * 0.25 };
}

/**
 * Standard eight-ball rack: apex on the foot spot pointing at the head, 8 in the centre of the third
 * row, one solid and one stripe in the back corners. Returns the 16 balls (cue on the head spot).
 */
export function rackBalls(cfg: PoolConfig = DEFAULT_POOL, seed = 1): Ball[] {
  const r = cfg.ballR;
  const fs = footSpot(cfg);
  const positions: { x: number; z: number }[] = [];
  const rowGap = r * 2 * Math.sqrt(3) / 2 + 0.0004;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      positions.push({ x: fs.x + (i - row / 2) * (r * 2 + 0.0004), z: fs.z + row * rowGap });
    }
  }
  // Fixed layout order (index into positions): rows are 0 / 1-2 / 3-5 / 6-9 / 10-14; centre of row 3 is index 4.
  const order = new Array<number>(15).fill(0);
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const shuffle = (a: number[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(solids); shuffle(stripes);
  order[4] = 8;
  order[10] = solids.pop()!;   // back-left corner: a solid
  order[14] = stripes.pop()!;  // back-right corner: a stripe
  const rest = shuffle([...solids, ...stripes]);
  for (let i = 0; i < 15; i++) if (order[i] === 0) order[i] = rest.pop()!;
  const balls: Ball[] = [{ id: 0, ...headSpot(cfg), vx: 0, vz: 0, active: true }];
  for (let i = 0; i < 15; i++) balls.push({ id: order[i], x: positions[i].x, z: positions[i].z, vx: 0, vz: 0, active: true });
  return balls;
}

export interface ShotEvents {
  /** Id of the first object ball the cue ball touched, or null. */
  firstContact: number | null;
  /** Object balls pocketed, in order. */
  pocketed: number[];
  /** Pocket index each ball dropped into. */
  pocketIndex: Record<number, number>;
  /** Balls (including the cue) that hit a cushion after the first contact. */
  railsAfterContact: number[];
  /** Object balls that touched a cushion at any time (break legality). */
  objectBallsToRail: number[];
  scratched: boolean;
  /** Collision/cushion/pocket happenings for sound effects (consumed by the scene). */
  sounds: ('clack' | 'cushion' | 'pocket')[];
}

export function emptyEvents(): ShotEvents {
  return { firstContact: null, pocketed: [], pocketIndex: {}, railsAfterContact: [], objectBallsToRail: [], scratched: false, sounds: [] };
}

export function cloneBalls(balls: Ball[]): Ball[] { return balls.map((b) => ({ ...b })); }

/** Running simulation of one shot. Call step() until settled. */
export class PoolSim {
  readonly balls: Ball[];
  readonly events: ShotEvents = emptyEvents();
  elapsed = 0;
  settled = false;
  private pk: Pocket[];
  /** Balls that just got pocketed this step (for animation). */
  justPocketed: number[] = [];

  constructor(balls: Ball[], readonly cfg: PoolConfig = DEFAULT_POOL) {
    this.balls = cloneBalls(balls);
    this.pk = pockets(cfg);
  }

  /** Strike the cue ball with a given speed (m/s) and direction (radians, 0 = +x, PI/2 = +z). */
  strike(speed: number, angle: number): void {
    const cue = this.balls.find((b) => b.id === 0);
    if (!cue || !cue.active) return;
    cue.vx = Math.cos(angle) * speed;
    cue.vz = Math.sin(angle) * speed;
    this.settled = false;
  }

  /** Advance by dt seconds using fixed sub-steps. */
  step(dt: number): void {
    if (this.settled) return;
    this.justPocketed = [];
    let remaining = dt;
    while (remaining > 1e-9) {
      const h = Math.min(this.cfg.subStep, remaining);
      this.subStep(h);
      remaining -= h;
      this.elapsed += h;
      if (this.elapsed > this.cfg.maxShotTime) { this.stopAll(); break; }
    }
    this.settled = this.balls.every((b) => !b.active || (b.vx === 0 && b.vz === 0));
  }

  /** Run until every ball is at rest. */
  runToRest(): void {
    let guard = 0;
    while (!this.settled && guard++ < 200000) this.step(1 / 60);
  }

  private stopAll(): void { for (const b of this.balls) { b.vx = 0; b.vz = 0; } }

  private subStep(h: number): void {
    const cfg = this.cfg;
    const r = cfg.ballR;
    const { tableW: w, tableL: l } = cfg;
    const balls = this.balls;
    // integrate + friction
    for (const b of balls) {
      if (!b.active) continue;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp === 0) continue;
      b.x += b.vx * h;
      b.z += b.vz * h;
      let ns = sp - cfg.friction * h;
      ns *= Math.max(0, 1 - cfg.damping * h);
      if (ns <= cfg.stopSpeed * 0.5) { b.vx = 0; b.vz = 0; }
      else { const k = ns / sp; b.vx *= k; b.vz *= k; }
    }
    // pockets
    for (const b of balls) {
      if (!b.active) continue;
      for (const p of this.pk) {
        const d = Math.hypot(b.x - p.x, b.z - p.z);
        if (d < p.r) {
          b.active = false;
          b.vx = 0; b.vz = 0;
          this.events.sounds.push('pocket');
          this.justPocketed.push(b.id);
          if (b.id === 0) this.events.scratched = true;
          else { this.events.pocketed.push(b.id); this.events.pocketIndex[b.id] = p.index; }
          break;
        }
      }
    }
    // cushions (skipped inside pocket jaws so balls can drop)
    for (const b of balls) {
      if (!b.active) continue;
      const inJaws = this.pk.some((p) => Math.hypot(b.x - p.x, b.z - p.z) < p.r + r * 1.1);
      if (inJaws) continue;
      let hit = false;
      if (b.x - r < 0 && b.vx < 0) { b.x = r; b.vx = -b.vx * cfg.cushionRestitution; hit = true; }
      if (b.x + r > w && b.vx > 0) { b.x = w - r; b.vx = -b.vx * cfg.cushionRestitution; hit = true; }
      if (b.z - r < 0 && b.vz < 0) { b.z = r; b.vz = -b.vz * cfg.cushionRestitution; hit = true; }
      if (b.z + r > l && b.vz > 0) { b.z = l - r; b.vz = -b.vz * cfg.cushionRestitution; hit = true; }
      if (hit) {
        if (Math.hypot(b.vx, b.vz) > 0.15) this.events.sounds.push('cushion');
        if (this.events.firstContact !== null && !this.events.railsAfterContact.includes(b.id)) this.events.railsAfterContact.push(b.id);
        if (b.id !== 0 && !this.events.objectBallsToRail.includes(b.id)) this.events.objectBallsToRail.push(b.id);
      }
    }
    // ball-ball collisions
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (!a.active) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (!b.active) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minD = r * 2;
        if (dist >= minD || dist === 0) continue;
        const nx = dx / dist;
        const nz = dz / dist;
        // separate
        const overlap = minD - dist;
        a.x -= nx * overlap / 2; a.z -= nz * overlap / 2;
        b.x += nx * overlap / 2; b.z += nz * overlap / 2;
        const rvx = a.vx - b.vx;
        const rvz = a.vz - b.vz;
        const vn = rvx * nx + rvz * nz;
        if (vn <= 0) continue; // moving apart
        const imp = vn * (1 + cfg.ballRestitution) / 2;
        a.vx -= imp * nx; a.vz -= imp * nz;
        b.vx += imp * nx; b.vz += imp * nz;
        if (vn > 0.1) this.events.sounds.push('clack');
        if (this.events.firstContact === null) {
          if (a.id === 0) this.events.firstContact = b.id;
          else if (b.id === 0) this.events.firstContact = a.id;
        }
      }
    }
  }
}

/** Convenience: simulate a full shot from a ball layout and return the resting layout plus events. */
export function simulateShot(balls: Ball[], speed: number, angle: number, cfg: PoolConfig = DEFAULT_POOL): { balls: Ball[]; events: ShotEvents } {
  const sim = new PoolSim(balls, cfg);
  sim.strike(speed, angle);
  sim.runToRest();
  return { balls: sim.balls, events: sim.events };
}

export function ballsMoving(balls: Ball[]): boolean {
  return balls.some((b) => b.active && (b.vx !== 0 || b.vz !== 0));
}

/** Find a free spot for respotting a ball: foot spot, else slide toward the foot rail, then toward the head. */
export function findFreeSpot(balls: Ball[], cfg: PoolConfig = DEFAULT_POOL): { x: number; z: number } {
  const fs = footSpot(cfg);
  const free = (x: number, z: number) => balls.every((b) => !b.active || Math.hypot(b.x - x, b.z - z) >= cfg.ballR * 2.05);
  if (free(fs.x, fs.z)) return fs;
  for (let z = fs.z; z <= cfg.tableL - cfg.ballR; z += cfg.ballR * 0.5) if (free(fs.x, z)) return { x: fs.x, z };
  for (let z = fs.z; z >= cfg.ballR; z -= cfg.ballR * 0.5) if (free(fs.x, z)) return { x: fs.x, z };
  return fs;
}

/** True if a ball of radius r could be placed at (x, z) without overlap and inside the cushions. */
export function canPlace(balls: Ball[], x: number, z: number, cfg: PoolConfig = DEFAULT_POOL, ignoreId = 0): boolean {
  const r = cfg.ballR;
  if (x < r || x > cfg.tableW - r || z < r || z > cfg.tableL - r) return false;
  return balls.every((b) => !b.active || b.id === ignoreId || Math.hypot(b.x - x, b.z - z) >= r * 2.02);
}

/**
 * Ray-cast from the cue ball along an angle: returns where the cue ball centre would first touch
 * another ball (ghost-ball position) or a cushion, for the aiming guide.
 */
export function aimGuide(balls: Ball[], angle: number, cfg: PoolConfig = DEFAULT_POOL): { end: { x: number; z: number }; hitBall: Ball | null; objectDir: { x: number; z: number } | null } {
  const cue = balls.find((b) => b.id === 0 && b.active);
  if (!cue) return { end: { x: 0, z: 0 }, hitBall: null, objectDir: null };
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  const r = cfg.ballR;
  let bestT = Infinity;
  let hit: Ball | null = null;
  for (const b of balls) {
    if (!b.active || b.id === 0) continue;
    // solve |cue + t*d - b| = 2r
    const ox = cue.x - b.x;
    const oz = cue.z - b.z;
    const bq = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - (2 * r) * (2 * r);
    const disc = bq * bq - 4 * c;
    if (disc < 0) continue;
    const t = (-bq - Math.sqrt(disc)) / 2;
    if (t > 0 && t < bestT) { bestT = t; hit = b; }
  }
  // cushion distance
  const tx = dx > 0 ? (cfg.tableW - r - cue.x) / dx : dx < 0 ? (r - cue.x) / dx : Infinity;
  const tz = dz > 0 ? (cfg.tableL - r - cue.z) / dz : dz < 0 ? (r - cue.z) / dz : Infinity;
  const tc = Math.min(tx, tz);
  if (tc < bestT) { bestT = tc; hit = null; }
  const end = { x: cue.x + dx * bestT, z: cue.z + dz * bestT };
  let objectDir: { x: number; z: number } | null = null;
  if (hit) {
    const nx = hit.x - end.x;
    const nz = hit.z - end.z;
    const n = Math.hypot(nx, nz) || 1;
    objectDir = { x: nx / n, z: nz / n };
  }
  return { end, hitBall: hit, objectDir };
}
