/**
 * Batting model and ball flight for the derby. All units are metres / seconds / degrees.
 * Pure functions so timing windows and the boundary can be tuned and tested.
 */

export interface BattingConfig {
  /** |offset| <= perfectMs counts as PERFECT. */
  perfectMs: number;
  /** |offset| <= goodMs still gives solid contact. */
  goodMs: number;
  /** |offset| > maxContactMs is a swing and miss. */
  maxContactMs: number;
  /** Lateral direction (deg) applied at the edge of the contact window (early = negative/left). */
  maxPullDeg: number;
  /** Fair territory is within +/- fairAngleDeg of straight away. */
  fairAngleDeg: number;
  /** Distance (m) from the plate to the home run boundary (the tree line). */
  boundaryZ: number;
  /** Height (m) the ball must have when crossing the boundary to clear the trees. */
  treeHeight: number;
  /** Half-width (m) of the yard at the boundary (balls further out are foul anyway). */
  minExitSpeed: number;
  maxExitSpeed: number;
  /** Launch angle when the aim reticle is centred, and how far aim can push it either way. */
  baseLaunchDeg: number;
  launchRangeDeg: number;
  /** Aim lateral tweak in degrees at full aim offset. */
  aimLateralDeg: number;
  gravity: number;
  /** Linear drag coefficient (per second). */
  drag: number;
  /** Pitch duration from release to plate, seconds. */
  pitchSeconds: number;
}

export const DEFAULT_BATTING: BattingConfig = {
  perfectMs: 55,
  goodMs: 130,
  maxContactMs: 230,
  maxPullDeg: 48,
  fairAngleDeg: 30,
  boundaryZ: 45,
  treeHeight: 2.6,
  minExitSpeed: 18,
  maxExitSpeed: 36,
  baseLaunchDeg: 27,
  launchRangeDeg: 24,
  aimLateralDeg: 12,
  gravity: 9.81,
  drag: 0.32,
  pitchSeconds: 1.15,
};

export type TimingLabel = 'early' | 'perfect' | 'late' | 'miss';

export interface Contact {
  timing: TimingLabel;
  /** 0..1 overall quality. */
  quality: number;
  exitSpeed: number;
  launchDeg: number;
  /** Lateral direction, negative = left (pull side for a right-handed batter). */
  directionDeg: number;
  fair: boolean;
  miss: boolean;
}

export interface FlightPoint { x: number; y: number; z: number; t: number; }

export interface Flight {
  points: FlightPoint[];
  landing: FlightPoint;
  /** Height when crossing the boundary, or null if it never got there. */
  heightAtBoundary: number | null;
  homeRun: boolean;
  fair: boolean;
  /** Short explanation for the HUD. */
  reason: 'homerun' | 'foul' | 'short' | 'trees' | 'popup' | 'grounder';
}

export function timingLabel(offsetMs: number, cfg: BattingConfig = DEFAULT_BATTING): TimingLabel {
  const a = Math.abs(offsetMs);
  if (a > cfg.maxContactMs) return 'miss';
  if (a <= cfg.perfectMs) return 'perfect';
  return offsetMs < 0 ? 'early' : 'late';
}

/**
 * @param offsetMs swing time minus ideal contact time (negative = early)
 * @param aimX reticle offset, -1..1 (negative = left of the ball)
 * @param aimY reticle offset, -1..1 (positive = below the ball => more loft)
 */
export function computeContact(offsetMs: number, aimX: number, aimY: number, cfg: BattingConfig = DEFAULT_BATTING): Contact {
  const timing = timingLabel(offsetMs, cfg);
  const ax = clamp(aimX, -1, 1);
  const ay = clamp(aimY, -1, 1);
  if (timing === 'miss' || Math.max(Math.abs(ax), Math.abs(ay)) > 0.95) {
    return { timing: 'miss', quality: 0, exitSpeed: 0, launchDeg: 0, directionDeg: 0, fair: false, miss: true };
  }
  const tNorm = Math.abs(offsetMs) / cfg.maxContactMs; // 0 perfect .. 1 edge
  const timingQ = timing === 'perfect' ? 1 : 1 - tNorm * tNorm;
  const aimOff = Math.hypot(ax, ay);
  const aimQ = 1 - 0.55 * aimOff * aimOff;
  const quality = clamp(timingQ * aimQ, 0, 1);
  const exitSpeed = cfg.minExitSpeed + (cfg.maxExitSpeed - cfg.minExitSpeed) * quality;
  const launchDeg = cfg.baseLaunchDeg + ay * cfg.launchRangeDeg;
  const directionDeg = (offsetMs / cfg.maxContactMs) * cfg.maxPullDeg * (timing === 'perfect' ? 0.35 : 1) + ax * cfg.aimLateralDeg;
  const fair = Math.abs(directionDeg) <= cfg.fairAngleDeg;
  return { timing, quality, exitSpeed, launchDeg, directionDeg, fair, miss: false };
}

/** Integrate the ball flight with gravity and linear drag. Starts at the contact point (0, 1, 0). */
export function simulateFlight(contact: Contact, cfg: BattingConfig = DEFAULT_BATTING, dt = 1 / 60): Flight {
  const points: FlightPoint[] = [];
  const launch = (contact.launchDeg * Math.PI) / 180;
  const dir = (contact.directionDeg * Math.PI) / 180;
  const v = contact.exitSpeed;
  let vx = Math.sin(dir) * Math.cos(launch) * v;
  let vz = Math.cos(dir) * Math.cos(launch) * v;
  let vy = Math.sin(launch) * v;
  let x = 0;
  let y = 1;
  let z = 0;
  let t = 0;
  let heightAtBoundary: number | null = null;
  points.push({ x, y, z, t });
  for (let i = 0; i < 2000; i++) {
    const prevZ = z;
    const prevY = y;
    vy -= cfg.gravity * dt;
    const d = Math.max(0, 1 - cfg.drag * dt);
    vx *= d; vz *= d; vy *= d;
    x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
    if (heightAtBoundary === null && prevZ < cfg.boundaryZ && z >= cfg.boundaryZ) {
      const f = (cfg.boundaryZ - prevZ) / (z - prevZ);
      heightAtBoundary = prevY + (y - prevY) * f;
    }
    if (y <= 0) {
      // interpolate landing
      const f = prevY / (prevY - y);
      const lx = points[points.length - 1].x + (x - points[points.length - 1].x) * f;
      const lz = prevZ + (z - prevZ) * f;
      const landing = { x: lx, y: 0, z: lz, t };
      points.push(landing);
      return finish(points, landing, heightAtBoundary, contact, cfg);
    }
    points.push({ x, y, z, t });
  }
  const landing = points[points.length - 1];
  return finish(points, landing, heightAtBoundary, contact, cfg);
}

function finish(points: FlightPoint[], landing: FlightPoint, heightAtBoundary: number | null, contact: Contact, cfg: BattingConfig): Flight {
  const fair = contact.fair;
  let reason: Flight['reason'];
  let homeRun = false;
  if (!fair) reason = 'foul';
  else if (heightAtBoundary !== null && heightAtBoundary >= cfg.treeHeight) { reason = 'homerun'; homeRun = true; }
  else if (heightAtBoundary !== null) reason = 'trees';
  else if (contact.launchDeg > 44) reason = 'popup';
  else if (contact.launchDeg < 10) reason = 'grounder';
  else reason = 'short';
  return { points, landing, heightAtBoundary, homeRun, fair, reason };
}

/** Gaussian sample for AI batting noise. */
export function gaussian(sd: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * sd;
}

/** AI swing parameters per difficulty level (0 easy .. 1 hard). */
export function aiSwing(level: number): { offsetMs: number; aimX: number; aimY: number } {
  const timingSd = 135 - level * 85;   // 135 / 92 / 50 ms
  const aimSd = 0.32 - level * 0.2;     // 0.32 / 0.22 / 0.12
  return { offsetMs: gaussian(timingSd), aimX: gaussian(aimSd), aimY: gaussian(aimSd) };
}

function clamp(v: number, a: number, b: number): number { return Math.max(a, Math.min(b, v)); }
