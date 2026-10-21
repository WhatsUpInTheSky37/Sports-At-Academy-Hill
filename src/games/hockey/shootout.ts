/**
 * Driveway hockey shootout: pure rules and shot model in metres.
 * x = lateral (0 = centre of the driveway, +right), z = along the driveway toward the net at z = netZ,
 * y = height. The shooter skates in from the top of the driveway; the goalie guards the net.
 */

export interface GoalieConfig {
  /** How far in front of the goal line the goalie stands. */
  depth: number;
  /** Half-widths of what the goalie covers at different heights (m). */
  padsHalf: number;   // low: butterfly pads
  padsH: number;
  armsHalf: number;   // middle: arms, blocker, glove
  armsH: number;
  bodyHalf: number;   // high: shoulders and head
  height: number;
  /** Reaction delay (s) before the goalie starts moving toward the shot, and lateral speed (m/s). */
  reactBase: number;
  reactPerLevel: number;
  speedBase: number;
  speedPerLevel: number;
  /** The goalie never leaves the mouth by more than this. */
  maxX: number;
  /** Poke-check zone (m from the goal line) and chance per second (base + perLevel * level). */
  pokeZone: number;
  pokeBase: number;
  pokePerLevel: number;
}

export interface ShootoutConfig {
  rinkW: number;
  /** Goal line position along the driveway. */
  netZ: number;
  goalW: number;
  goalH: number;
  goalDepth: number;
  /** Where the shooter starts each attempt. */
  startZ: number;
  /** Closest the shooter may get to the goal line. */
  minDist: number;
  playerSpeed: number;
  playerAccel: number;
  playerRadius: number;
  /** The puck rides this far ahead of the shooter and this far to the forehand side. */
  carryAhead: number;
  carrySide: number;
  shotClock: number;
  attempts: number;
  shotSpeed: number;
  /** Aim error (standard deviation, m): base + perMetre * distance + moving * shooter speed. */
  aimErrorBase: number;
  aimErrorPerMetre: number;
  aimErrorMoving: number;
  goalie: GoalieConfig;
}

export const DEFAULT_SHOOTOUT: ShootoutConfig = {
  rinkW: 7,
  netZ: 14,
  goalW: 1.9,
  goalH: 1.2,
  goalDepth: 0.9,
  startZ: 4.6,
  minDist: 2.4,
  playerSpeed: 4.6,
  playerAccel: 22,
  playerRadius: 0.42,
  carryAhead: 0.7,
  carrySide: 0.78,
  shotClock: 8,
  attempts: 5,
  shotSpeed: 16,
  aimErrorBase: 0.06,
  aimErrorPerMetre: 0.026,
  aimErrorMoving: 0.025,
  goalie: {
    depth: 0.7,
    padsHalf: 0.68,
    padsH: 0.48,
    armsHalf: 0.5,
    armsH: 1.0,
    bodyHalf: 0.4,
    height: 1.32,
    reactBase: 0.42,
    reactPerLevel: 0.18,
    speedBase: 1.6,
    speedPerLevel: 1.3,
    maxX: 1.15,
    pokeZone: 3.3,
    pokeBase: 0.25,
    pokePerLevel: 0.55,
  },
};

export type ShotOutcome = 'goal' | 'save' | 'post' | 'wide' | 'poked' | 'clock';

export interface ShootoutState {
  attempts: number;
  shooter: 0 | 1;
  taken: [number, number];
  goals: [number, number];
  results: { slot: 0 | 1; outcome: ShotOutcome }[];
  phase: 'shoot' | 'done';
  winner: 0 | 1 | null;
  suddenDeath: boolean;
}

export function createShootout(attempts = DEFAULT_SHOOTOUT.attempts, first: 0 | 1 = 0): ShootoutState {
  return { attempts, shooter: first, taken: [0, 0], goals: [0, 0], results: [], phase: 'shoot', winner: null, suddenDeath: false };
}

/**
 * Record the current shooter's attempt and hand the puck to the other player. Regulation ends early
 * once the trailing player cannot catch up; a tie after both have shot `attempts` goes to sudden
 * death, decided pair by pair.
 */
export function recordAttempt(state: ShootoutState, outcome: ShotOutcome): ShootoutState {
  if (state.phase === 'done') return state;
  const s: ShootoutState = {
    ...state,
    taken: [...state.taken] as [number, number],
    goals: [...state.goals] as [number, number],
    results: [...state.results, { slot: state.shooter, outcome }],
  };
  const me = state.shooter;
  s.taken[me] += 1;
  if (outcome === 'goal') s.goals[me] += 1;
  const [a, b] = s.goals;
  const r0 = Math.max(0, s.attempts - s.taken[0]);
  const r1 = Math.max(0, s.attempts - s.taken[1]);
  let winner: 0 | 1 | null = null;
  if (!s.suddenDeath) {
    if (a > b + r1) winner = 0;
    else if (b > a + r0) winner = 1;
    else if (r0 === 0 && r1 === 0) {
      if (a !== b) winner = a > b ? 0 : 1;
      else s.suddenDeath = true;
    }
  } else if (s.taken[0] === s.taken[1] && a !== b) {
    winner = a > b ? 0 : 1;
  }
  if (winner !== null) {
    s.winner = winner;
    s.phase = 'done';
  }
  s.shooter = me === 0 ? 1 : 0;
  return s;
}

/** Attempts left for a slot in regulation (0 once sudden death starts). */
export function attemptsLeft(state: ShootoutState, slot: 0 | 1): number {
  return Math.max(0, state.attempts - state.taken[slot]);
}

// ---------------------------------------------------------------------------------------------
// Skating
// ---------------------------------------------------------------------------------------------

export interface Shooter { x: number; z: number; vx: number; vz: number; fx: number; fz: number; }

export function createShooter(cfg: ShootoutConfig = DEFAULT_SHOOTOUT): Shooter {
  return { x: 0, z: cfg.startZ, vx: 0, vz: 0, fx: 0, fz: 1 };
}

/** Advance the shooter by dt with a joystick-style input (ax right, az toward the net), clamped to the driveway. */
export function stepShooter(s: Shooter, ax: number, az: number, dt: number, cfg: ShootoutConfig = DEFAULT_SHOOTOUT): void {
  const l = Math.hypot(ax, az);
  if (l > 1) { ax /= l; az /= l; }
  const k = Math.min(1, cfg.playerAccel * dt / cfg.playerSpeed);
  s.vx += (ax * cfg.playerSpeed - s.vx) * k;
  s.vz += (az * cfg.playerSpeed - s.vz) * k;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  const half = cfg.rinkW / 2 - cfg.playerRadius;
  if (s.x < -half) { s.x = -half; s.vx = 0; }
  if (s.x > half) { s.x = half; s.vx = 0; }
  if (s.z < 1.2) { s.z = 1.2; s.vz = 0; }
  const maxZ = cfg.netZ - cfg.minDist;
  if (s.z > maxZ) { s.z = maxZ; s.vz = 0; }
  if (l > 0.05) {
    // face mostly toward the net; lateral input turns the shoulders
    const fl = Math.hypot(ax * 0.7, Math.max(0.35, az + 0.5)) || 1;
    s.fx = (ax * 0.7) / fl;
    s.fz = Math.max(0.35, az + 0.5) / fl;
  }
}

/** Where the carried puck sits: ahead of the shooter on the forehand (right) side. */
export function puckPosition(s: Shooter, cfg: ShootoutConfig = DEFAULT_SHOOTOUT): { x: number; z: number } {
  // right-perpendicular of the facing direction
  const px = s.fz, pz = -s.fx;
  return { x: s.x + s.fx * cfg.carryAhead + px * cfg.carrySide, z: s.z + s.fz * cfg.carryAhead + pz * cfg.carrySide };
}

// ---------------------------------------------------------------------------------------------
// Goalie and shots
// ---------------------------------------------------------------------------------------------

/** The goalie's ideal spot: on the line from the puck to the centre of the goal, `depth` out from the line. */
export function goalieHome(puck: { x: number; z: number }, cfg: ShootoutConfig = DEFAULT_SHOOTOUT): number {
  const g = cfg.goalie;
  const dz = cfg.netZ - puck.z;
  if (dz <= 0.01) return clamp(puck.x, -g.maxX, g.maxX);
  const x = puck.x * (g.depth / dz);
  return clamp(x, -g.maxX, g.maxX);
}

export interface ShotResult {
  outcome: 'goal' | 'save' | 'post' | 'wide';
  /** Where the puck actually arrives on the goal plane (after aim error). */
  x: number;
  y: number;
  /** Flight time (s) and where the goalie is when the puck arrives. */
  travel: number;
  goalieX: number;
}

/**
 * Resolve a shot from `from` aimed at goal-plane point `aim` against a goalie standing at `goalieX`.
 * level: 0 easy .. 1 hard (how fast the goalie reacts). rand: uniform [0,1) source (injectable).
 */
export function resolveShot(from: { x: number; z: number }, aim: { x: number; y: number }, shooterSpeed: number, goalieX: number, level: number, cfg: ShootoutConfig = DEFAULT_SHOOTOUT, rand: () => number = Math.random): ShotResult {
  const g = cfg.goalie;
  const dist = Math.hypot(aim.x - from.x, cfg.netZ - from.z);
  const sd = cfg.aimErrorBase + cfg.aimErrorPerMetre * dist + cfg.aimErrorMoving * Math.abs(shooterSpeed);
  const x = aim.x + gaussian(sd, rand);
  const y = Math.max(0.03, aim.y + gaussian(sd * 0.8, rand));
  const travel = dist / cfg.shotSpeed;
  const react = Math.max(0.05, g.reactBase - g.reactPerLevel * level);
  const speed = g.speedBase + g.speedPerLevel * level;
  const moveT = Math.max(0, travel - react);
  const gx = goalieX + clamp(x - goalieX, -speed * moveT, speed * moveT);
  const half = cfg.goalW / 2;
  let outcome: ShotResult['outcome'];
  if (Math.abs(x) > half || y > cfg.goalH) {
    outcome = Math.abs(x) <= half + 0.09 && y <= cfg.goalH + 0.09 ? 'post' : 'wide';
  } else {
    const dx = Math.abs(x - gx);
    const blocked = (y < g.padsH && dx < g.padsHalf) || (y < g.armsH && dx < g.armsHalf) || (y < g.height && dx < g.bodyHalf);
    outcome = blocked ? 'save' : 'goal';
  }
  return { outcome, x, y, travel, goalieX: gx };
}

/** Chance per second that the goalie pokes the puck away when the shooter is inside the poke zone. */
export function pokeRate(puck: { x: number; z: number }, level: number, cfg: ShootoutConfig = DEFAULT_SHOOTOUT): number {
  const g = cfg.goalie;
  const inZone = cfg.netZ - puck.z < g.pokeZone && Math.abs(puck.x) < cfg.goalW / 2 + 1.0;
  return inZone ? g.pokeBase + g.pokePerLevel * level : 0;
}

/** Keyboard / CPU aim: the corner on the far side from the goalie, high unless told otherwise. */
export function openCorner(goalieX: number, cfg: ShootoutConfig = DEFAULT_SHOOTOUT, opts: { high?: boolean; inset?: number; rand?: () => number } = {}): { x: number; y: number } {
  const rand = opts.rand ?? Math.random;
  const side = Math.abs(goalieX) < 0.05 ? (rand() < 0.5 ? -1 : 1) : -Math.sign(goalieX);
  const inset = opts.inset ?? 0.3;
  const high = opts.high ?? true;
  return { x: side * (cfg.goalW / 2 - inset), y: high ? cfg.goalH - 0.22 : 0.16 };
}

/** CPU shooter plan for one attempt. level 0 easy .. 1 hard. */
export interface AiShotPlan { targetX: number; targetZ: number; dwell: number; high: boolean; inset: number; }

export function aiShotPlan(level: number, cfg: ShootoutConfig = DEFAULT_SHOOTOUT, rand: () => number = Math.random): AiShotPlan {
  return {
    targetX: (rand() - 0.5) * 3.4,
    targetZ: cfg.netZ - (3.6 + rand() * 3.2 + (1 - level) * 1.0),
    dwell: 0.25 + rand() * 0.6,
    high: rand() < 0.45 + 0.35 * level,
    inset: Math.max(0.16, 0.5 - 0.26 * level + (rand() - 0.5) * 0.12),
  };
}

export function gaussian(sd: number, rand: () => number = Math.random): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * sd;
}

function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }
