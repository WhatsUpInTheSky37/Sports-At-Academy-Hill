/**
 * Basketball shot physics for HORSE. Pure functions; all units metres / seconds.
 * World frame: hoop rim centre at (0, RIM_HEIGHT, 0); the driveway runs along -z (shooters stand at z < 0).
 */

export interface ShotConfig {
  gravity: number;
  ballRadius: number;
  rimRadius: number;
  rimHeight: number;
  /** z of the backboard plane (behind the rim) and its half width / height extents. */
  backboardZ: number;
  backboardHalfWidth: number;
  backboardBottom: number;
  backboardTop: number;
  /** Launch angle for the ideal (perfect release) shot: launchBaseDeg - distance * launchPerMetre, clamped. */
  launchBaseDeg: number;
  launchPerMetre: number;
  launchMinDeg: number;
  launchMaxDeg: number;
  /** Release point height above the shooter's spot. */
  releaseHeight: number;
  /** Timing: |offset| <= perfectMs is perfect; beyond goodMs is poor. */
  perfectMs: number;
  goodMs: number;
  /** Sweep time of the release meter in ms; release later than this auto-releases. */
  meterMs: number;
  /** Where the perfect moment sits on the meter (0..1). */
  perfectAt: number;
  /** Power change per 100 ms of timing error (fraction of ideal speed). Early = short, late = long. */
  powerPer100Ms: number;
  /** Aim reticle at full deflection moves the target this far laterally (m) and in depth (m). */
  aimLateral: number;
  aimDepth: number;
  restitutionRim: number;
  restitutionBoard: number;
  restitutionGround: number;
}

export const DEFAULT_SHOT: ShotConfig = {
  gravity: 9.81,
  ballRadius: 0.12,
  rimRadius: 0.23,
  rimHeight: 2.74,
  backboardZ: 0.38,
  backboardHalfWidth: 0.9,
  backboardBottom: 2.45,
  backboardTop: 3.3,
  launchBaseDeg: 68,
  launchPerMetre: 3,
  launchMinDeg: 48,
  launchMaxDeg: 66,
  releaseHeight: 1.95,
  perfectMs: 70,
  goodMs: 170,
  meterMs: 1200,
  perfectAt: 0.62,
  powerPer100Ms: 0.055,
  aimLateral: 0.45,
  aimDepth: 0.35,
  restitutionRim: 0.38,
  restitutionBoard: 0.55,
  restitutionGround: 0.5,
};

export interface Spot { id: number; name: string; x: number; z: number; }

/** Legal shooting spots on the driveway (z is negative: distance from the hoop). */
export const SPOTS: Spot[] = [
  { id: 0, name: 'Free throw', x: 0, z: -4.2 },
  { id: 1, name: 'Left elbow', x: -1.9, z: -3.4 },
  { id: 2, name: 'Right elbow', x: 1.9, z: -3.4 },
  { id: 3, name: 'Left wing', x: -2.5, z: -5.6 },
  { id: 4, name: 'Right wing', x: 2.5, z: -5.6 },
  { id: 5, name: 'Top of the key', x: 0, z: -6.4 },
  { id: 6, name: 'Garage door', x: 0, z: -8.6 },
  { id: 7, name: 'Close left', x: -1.2, z: -2.1 },
  { id: 8, name: 'Close right', x: 1.2, z: -2.1 },
];

export type TimingLabel = 'early' | 'perfect' | 'late';

export interface ShotPoint { x: number; y: number; z: number; t: number; }
export type ShotEvent = { t: number; kind: 'rim' | 'backboard' | 'ground' | 'swish' };

export interface ShotResult {
  points: ShotPoint[];
  events: ShotEvent[];
  made: boolean;
  timing: TimingLabel;
  /** Deepest y the ball reached under the rim (for presentation). */
  powerFactor: number;
}

export function timingLabel(offsetMs: number, cfg: ShotConfig = DEFAULT_SHOT): TimingLabel {
  if (Math.abs(offsetMs) <= cfg.perfectMs) return 'perfect';
  return offsetMs < 0 ? 'early' : 'late';
}

/** Speed needed to reach (dx, dy) at the given launch angle. */
function idealSpeed(dist: number, dy: number, launch: number, g: number): number {
  const denom = 2 * Math.cos(launch) * Math.cos(launch) * (dist * Math.tan(launch) - dy);
  if (denom <= 0) return 12;
  return Math.sqrt((g * dist * dist) / denom);
}

/**
 * Simulate a shot.
 * @param spot shooter position
 * @param offsetMs release timing error (negative = early = short)
 * @param aimX reticle lateral -1..1
 * @param aimY reticle vertical -1..1 (negative = higher on the board = deeper target)
 */
export function simulateShot(spot: { x: number; z: number }, offsetMs: number, aimX: number, aimY: number, cfg: ShotConfig = DEFAULT_SHOT, dt = 1 / 120): ShotResult {
  return simulateShotPower(spot, powerFromOffset(offsetMs, cfg), aimX, aimY, cfg, dt);
}

/** Release-timing error (ms) -> power factor (1 = the ideal speed for the spot). */
export function powerFromOffset(offsetMs: number, cfg: ShotConfig = DEFAULT_SHOT): number {
  return 1 + (offsetMs / 100) * cfg.powerPer100Ms;
}

/** Power factor -> the equivalent timing error, so one label scale serves both control schemes. */
export function offsetFromPower(powerFactor: number, cfg: ShotConfig = DEFAULT_SHOT): number {
  return ((powerFactor - 1) / cfg.powerPer100Ms) * 100;
}

/** Flick control: how far to pull (fraction of screen height) for a perfect shot, and the lateral pull for full aim. */
export const FLICK = { sweetPull: 0.26, maxPull: 0.42, lateralPull: 0.14, minPull: 0.05 };

/**
 * Map a flick (drag vector in screen px, dy negative = upward) to shot parameters. Pulling exactly
 * `sweetPull` of the screen height is a perfect-power shot; shorter is short, longer is long.
 */
export function flickToShot(dx: number, dy: number, screenW: number, screenH: number): { powerFactor: number; aimX: number; pull: number } {
  const pull = Math.max(0, -dy) / screenH;
  const powerFactor = clamp(pull / FLICK.sweetPull, 0, FLICK.maxPull / FLICK.sweetPull);
  const aimX = clamp(dx / screenW / FLICK.lateralPull, -1, 1);
  return { powerFactor, aimX, pull };
}

/** Shot noise that grows with distance: close shots are nearly automatic, deep ones are a gamble. */
export function shotNoise(spot: { x: number; z: number }): { powerSd: number; aimSd: number } {
  const dist = Math.hypot(spot.x, spot.z);
  return { powerSd: 0.008 + 0.004 * dist, aimSd: 0.02 + 0.01 * dist };
}

/**
 * Shot assist for a person's flick: a release that is nearly right gets nudged toward perfect (the
 * remaining error is scaled by `keep`), so a decent pull goes in. Outside the window nothing changes.
 */
export const ASSIST = { powerWindow: 0.1, powerKeep: 0.45, aimWindow: 0.2, aimKeep: 0.5 };

export function assistShot(powerFactor: number, aimX: number): { powerFactor: number; aimX: number } {
  const dp = powerFactor - 1;
  const pf = Math.abs(dp) <= ASSIST.powerWindow ? 1 + dp * ASSIST.powerKeep : powerFactor;
  const ax = Math.abs(aimX) <= ASSIST.aimWindow ? aimX * ASSIST.aimKeep : aimX;
  return { powerFactor: pf, aimX: ax };
}

/**
 * Simulate a shot from a power factor (1 = ideal speed for the spot; < 1 short, > 1 long).
 * @param aimX reticle lateral -1..1
 * @param aimY reticle vertical -1..1 (negative = higher on the board = deeper target)
 */
export function simulateShotPower(spot: { x: number; z: number }, powerFactor: number, aimX: number, aimY: number, cfg: ShotConfig = DEFAULT_SHOT, dt = 1 / 120): ShotResult {
  const offsetMs = offsetFromPower(powerFactor, cfg);
  const ax = clamp(aimX, -1, 1);
  const ay = clamp(aimY, -1, 1);
  const target = { x: ax * cfg.aimLateral, y: cfg.rimHeight + 0.05, z: -ay * cfg.aimDepth };
  const start = { x: spot.x, y: cfg.releaseHeight, z: spot.z + 0.35 };
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const dist = Math.hypot(dx, dz);
  const launchDeg = clamp(cfg.launchBaseDeg - dist * cfg.launchPerMetre, cfg.launchMinDeg, cfg.launchMaxDeg);
  const launch = (launchDeg * Math.PI) / 180;
  const v0 = idealSpeed(dist, target.y - start.y, launch, cfg.gravity);
  const v = v0 * clamp(powerFactor, 0.6, 1.4);
  let vx = (dx / dist) * Math.cos(launch) * v;
  let vz = (dz / dist) * Math.cos(launch) * v;
  let vy = Math.sin(launch) * v;
  let { x, y, z } = start;
  let t = 0;
  const points: ShotPoint[] = [{ x, y, z, t }];
  const events: ShotEvent[] = [];
  let made = false;
  let groundHits = 0;
  let firstGroundT = -1;
  let lastRimT = -1;
  for (let i = 0; i < 1600; i++) {
    const px = x, py = y, pz = z;
    vy -= cfg.gravity * dt;
    x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
    // Backboard (plane at z = backboardZ, ball travelling toward +z)
    if (pz + cfg.ballRadius < cfg.backboardZ && z + cfg.ballRadius >= cfg.backboardZ && vz > 0 &&
        Math.abs(x) <= cfg.backboardHalfWidth && y >= cfg.backboardBottom && y <= cfg.backboardTop) {
      z = cfg.backboardZ - cfg.ballRadius;
      vz = -vz * cfg.restitutionBoard;
      vx *= 0.9;
      events.push({ t, kind: 'backboard' });
    }
    // Rim ring collision
    const rxz = Math.hypot(x, z);
    if (rxz > 1e-6 && t - lastRimT > 0.05) {
      const nx = x / rxz, nz = z / rxz;
      const ringX = nx * cfg.rimRadius, ringZ = nz * cfg.rimRadius, ringY = cfg.rimHeight;
      const ddx = x - ringX, ddy = y - ringY, ddz = z - ringZ;
      const d = Math.hypot(ddx, ddy, ddz);
      const thick = 0.012;
      if (d < cfg.ballRadius + thick && d > 1e-6) {
        const inx = ddx / d, iny = ddy / d, inz = ddz / d;
        const vn = vx * inx + vy * iny + vz * inz;
        if (vn < 0) {
          vx -= (1 + cfg.restitutionRim) * vn * inx;
          vy -= (1 + cfg.restitutionRim) * vn * iny;
          vz -= (1 + cfg.restitutionRim) * vn * inz;
          vx *= 0.92; vz *= 0.92;
          const push = cfg.ballRadius + thick - d;
          x += inx * push; y += iny * push; z += inz * push;
          events.push({ t, kind: 'rim' });
          lastRimT = t;
        }
      }
    }
    // Score check: downward through the rim plane inside the ring
    if (!made && py >= cfg.rimHeight && y < cfg.rimHeight && vy < 0) {
      const f = (py - cfg.rimHeight) / (py - y);
      const cx = px + (x - px) * f, cz = pz + (z - pz) * f;
      if (Math.hypot(cx, cz) < cfg.rimRadius - cfg.ballRadius * 0.2) {
        made = true;
        events.push({ t, kind: 'swish' });
        // net slows the ball
        vx *= 0.3; vz *= 0.3; vy *= 0.5;
      }
    }
    // Ground
    if (y - cfg.ballRadius <= 0 && vy < 0) {
      y = cfg.ballRadius;
      vy = -vy * cfg.restitutionGround;
      vx *= 0.8; vz *= 0.8;
      groundHits += 1;
      if (firstGroundT < 0) firstGroundT = t;
      events.push({ t, kind: 'ground' });
      if (Math.abs(vy) < 0.8) vy = 0;
    }
    points.push({ x, y, z, t });
    if (made && y < cfg.rimHeight - 0.9) break;
    // The outcome is settled once the ball is on the ground: keep a short bounce for presentation only.
    if (groundHits >= 3 || (firstGroundT >= 0 && t > firstGroundT + 0.9)) break;
    if (t > 6) break;
  }
  return { points, events, made, timing: timingLabel(offsetMs, cfg), powerFactor };
}

/** Gaussian noise helper. */
export function gaussian(sd: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * sd;
}

/** AI shot parameters per difficulty level (0 easy .. 1 hard). Same physics as the player. */
export function aiShot(level: number, spot: Spot): { offsetMs: number; aimX: number; aimY: number } {
  const distance = Math.hypot(spot.x, spot.z);
  const far = clamp((distance - 3) / 6, 0, 1);
  const timingSd = (120 - level * 85) * (1 + far * 0.6); // easy 120ms .. hard 35ms, worse from deep
  const aimSd = (0.30 - level * 0.22) * (1 + far * 0.5);
  return { offsetMs: gaussian(timingSd), aimX: gaussian(aimSd), aimY: gaussian(aimSd) };
}

/** AI spot choice: easy AI keeps it close, hard AI mixes in deep shots to pressure the opponent. */
export function aiChooseSpot(level: number): Spot {
  const near = SPOTS.filter((s) => Math.hypot(s.x, s.z) < 5);
  const deep = SPOTS.filter((s) => Math.hypot(s.x, s.z) >= 5);
  const useDeep = Math.random() < 0.15 + level * 0.4;
  const pool = useDeep ? deep : near;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }
