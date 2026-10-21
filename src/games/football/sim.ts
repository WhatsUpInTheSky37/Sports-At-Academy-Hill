/** Movement, pass flight and contact helpers for the football scene. Pure functions on plain data. */
import { FOOTBALL_CONFIG, type FootballConfig } from './rules';

export interface Vec { x: number; y: number; }

export interface Mover extends Vec { vx: number; vy: number; }

/** Move `m` toward a target at `speed` yards/s. Returns the distance remaining after the move. */
export function moveToward(m: Mover, tx: number, ty: number, speed: number, dt: number, arriveRadius = 0.15): number {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx, dy);
  if (d <= arriveRadius) {
    m.vx = 0; m.vy = 0;
    return 0;
  }
  const step = Math.min(d, speed * dt);
  m.vx = (dx / d) * speed;
  m.vy = (dy / d) * speed;
  m.x += (dx / d) * step;
  m.y += (dy / d) * step;
  return d - step;
}

/** Apply a direction (unit-ish) input to a mover. */
export function moveByInput(m: Mover, ix: number, iy: number, speed: number, dt: number): void {
  const len = Math.hypot(ix, iy);
  if (len < 0.01) { m.vx = 0; m.vy = 0; return; }
  const k = len > 1 ? 1 / len : 1;
  m.vx = ix * k * speed;
  m.vy = iy * k * speed;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
}

export interface PassFlight {
  from: Vec;
  to: Vec;
  duration: number;
  /** Peak height in yards. */
  height: number;
  t: number;
}

export function makePass(from: Vec, to: Vec, cfg: FootballConfig = FOOTBALL_CONFIG): PassFlight {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const duration = Math.max(0.35, dist / cfg.passSpeed);
  return { from: { ...from }, to: { ...to }, duration, height: 1.2 + dist * 0.16, t: 0 };
}

/** Position of a pass in flight at its current t (0..duration). */
export function passPosition(p: PassFlight): { x: number; y: number; z: number } {
  const u = Math.min(1, p.t / p.duration);
  return {
    x: p.from.x + (p.to.x - p.from.x) * u,
    y: p.from.y + (p.to.y - p.from.y) * u,
    z: 1.6 + Math.sin(u * Math.PI) * p.height - u * 0.8,
  };
}

/** Lead point for a pass: receiver position plus its velocity direction times the lead distance. */
export function leadPoint(receiver: Mover, lead: number, cfg: FootballConfig = FOOTBALL_CONFIG): Vec {
  const sp = Math.hypot(receiver.vx, receiver.vy);
  const half = cfg.width / 2 - 0.5;
  let x = receiver.x;
  let y = receiver.y;
  if (sp > 0.2) {
    x += (receiver.vx / sp) * lead;
    y += (receiver.vy / sp) * lead;
  }
  x = Math.max(-half, Math.min(half, x));
  y = Math.max(-cfg.endZone + 1, Math.min(cfg.fieldLength + cfg.endZone - 1, y));
  return { x, y };
}

export function dist(a: Vec, b: Vec): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** True when a defender is close enough to the carrier to end the play by touch. */
export function isTouch(carrier: Vec, defender: Vec, cfg: FootballConfig = FOOTBALL_CONFIG): boolean {
  return dist(carrier, defender) <= cfg.touchDistance;
}

/** Catchable: ball low enough and within radius. */
export function canCatch(ball: { x: number; y: number; z: number }, player: Vec, radius: number, maxHeight = 2.4): boolean {
  return ball.z <= maxHeight && Math.hypot(ball.x - player.x, ball.y - player.y) <= radius;
}

/** Route waypoints (field coords) relative to a start point, for the attacking direction. */
export type RouteName = 'go' | 'slant' | 'out' | 'curl' | 'post' | 'drag';

export function routeWaypoints(name: RouteName, start: Vec, dir: 1 | -1, cfg: FootballConfig = FOOTBALL_CONFIG): Vec[] {
  const side = start.x >= 0 ? 1 : -1;
  const half = cfg.width / 2 - 1.5;
  const cl = (x: number) => Math.max(-half, Math.min(half, x));
  const y = (d: number) => start.y + d * dir;
  switch (name) {
    case 'go': return [{ x: start.x, y: y(8) }, { x: cl(start.x + side * 1), y: y(22) }];
    case 'slant': return [{ x: start.x, y: y(3) }, { x: cl(start.x - side * 7), y: y(10) }, { x: cl(start.x - side * 9), y: y(20) }];
    case 'out': return [{ x: start.x, y: y(6) }, { x: cl(start.x + side * 6), y: y(6.5) }, { x: cl(start.x + side * 7), y: y(14) }];
    case 'curl': return [{ x: start.x, y: y(8) }, { x: cl(start.x - side * 1.5), y: y(6.5) }, { x: cl(start.x - side * 3), y: y(13) }];
    case 'post': return [{ x: start.x, y: y(7) }, { x: cl(start.x - side * 5), y: y(16) }, { x: cl(start.x - side * 6), y: y(24) }];
    case 'drag': return [{ x: start.x, y: y(2) }, { x: cl(start.x - side * 10), y: y(3) }, { x: cl(start.x - side * 10), y: y(12) }];
  }
}
