/**
 * Pool AI: evaluates candidate shots by running the real physics and picks the best one with
 * difficulty-scaled noise. It never moves balls directly.
 */
import { DEFAULT_POOL, canPlace, pockets, simulateShot, type PoolConfig } from './physics';
import { applyShotResult, groupOf, legalFirstContacts, onTheEight, type PoolGameState } from './rules';

export interface AiShot { angle: number; power: number; calledPocket: number | null; }

const POWERS = [0.32, 0.5, 0.72];

/**
 * Physics config for the AI's look-ahead simulations: coarser sub-steps (1/240 is the coarsest that still tracks
 * the real 1/480 physics in tests/pool.test.ts) and a short time cap keep the
 * synchronous search (up to ~36 shots, +18 for placement) cheap. The real shot still uses the game config.
 */
function aiSimConfig(cfg: PoolConfig): PoolConfig {
  return { ...cfg, subStep: Math.max(cfg.subStep, 1 / 240), maxShotTime: Math.min(cfg.maxShotTime, 8) };
}

function targetsFor(state: PoolGameState): number[] {
  return legalFirstContacts(state);
}

/** Score a resulting state for the shooter. Higher is better. */
function score(state: PoolGameState, result: PoolGameState, target: number): number {
  const me = state.turn;
  let s = 0;
  if (result.winner === me) return 1000;
  if (result.winner !== null) return -1000;
  if (result.ballInHand && result.turn !== me) s -= 250; // foul
  if (result.turn === me) s += 120; // keep the table
  const pocketedTarget = !result.balls.find((b) => b.id === target)?.active;
  if (pocketedTarget) s += 100;
  if (state.open && result.pending?.type === 'chooseGroup') s += 60;
  // leave: distance from cue to nearest remaining legal target
  const cue = result.balls.find((b) => b.id === 0);
  if (cue && cue.active) {
    const nextTargets = legalFirstContacts({ ...result, turn: me });
    let best = Infinity;
    for (const id of nextTargets) {
      const b = result.balls.find((bb) => bb.id === id);
      if (b && b.active) best = Math.min(best, Math.hypot(b.x - cue.x, b.z - cue.z));
    }
    if (best !== Infinity) s += Math.max(0, 25 - best * 15);
  }
  return s;
}

/** Candidate directions: ghost-ball aim at each pocket for each legal target, plus a few direct hits. */
export function candidateShots(state: PoolGameState, cfg: PoolConfig = DEFAULT_POOL, maxCandidates = 40): { angle: number; target: number; pocket: number | null }[] {
  const cue = state.balls.find((b) => b.id === 0 && b.active);
  if (!cue) return [];
  const out: { angle: number; target: number; pocket: number | null; cut: number }[] = [];
  const pk = pockets(cfg);
  for (const id of targetsFor(state)) {
    const t = state.balls.find((b) => b.id === id);
    if (!t || !t.active) continue;
    for (const p of pk) {
      const px = t.x - p.x;
      const pz = t.z - p.z;
      const n = Math.hypot(px, pz) || 1;
      const gx = t.x + (px / n) * cfg.ballR * 2;
      const gz = t.z + (pz / n) * cfg.ballR * 2;
      const dx = gx - cue.x;
      const dz = gz - cue.z;
      const dist = Math.hypot(dx, dz) || 1;
      // cut angle between cue->ghost and target->pocket directions
      const cos = (dx / dist) * (-px / n) + (dz / dist) * (-pz / n);
      const cut = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (cut > (80 * Math.PI) / 180) continue;
      out.push({ angle: Math.atan2(dz, dx), target: id, pocket: p.index, cut });
    }
    // straight hit as a fallback (safety)
    out.push({ angle: Math.atan2(t.z - cue.z, t.x - cue.x), target: id, pocket: null, cut: Math.PI });
  }
  out.sort((a, b) => a.cut - b.cut);
  return out.slice(0, maxCandidates);
}

/** Choose a shot for the current shooter. `level` is 0 (easy) .. 1 (hard). */
export function chooseShot(state: PoolGameState, level: number, cfg: PoolConfig = DEFAULT_POOL, rnd: () => number = Math.random): AiShot {
  const cands = candidateShots(state, cfg);
  const cue = state.balls.find((b) => b.id === 0)!;
  const mustCall = onTheEight(state);
  let best: { angle: number; power: number; s: number; pocket: number | null } | null = null;
  const powers = state.breakPending ? [0.95] : POWERS;
  const simCfg = aiSimConfig(cfg);
  let budget = state.breakPending ? 1 : 36;
  for (const c of cands) {
    for (const p of powers) {
      if (budget-- <= 0) break;
      const trial = state.calledPocket === null && mustCall ? { ...state, calledPocket: c.pocket } : state;
      const { balls, events } = simulateShot(state.balls, p * cfg.maxShotSpeed, c.angle, simCfg);
      const result = applyShotResult(trial, balls, events, cfg);
      let s = score(trial, result, c.target);
      s -= p * 5; // prefer softer shots when equal
      s += rnd() * 2;
      if (!best || s > best.s) best = { angle: c.angle, power: p, s, pocket: c.pocket };
    }
  }
  if (!best) {
    // Nothing legal found: nudge toward the nearest legal ball softly.
    const ids = targetsFor(state);
    const t = state.balls.find((b) => ids.includes(b.id) && b.active) ?? state.balls.find((b) => b.active && b.id !== 0)!;
    best = { angle: Math.atan2(t.z - cue.z, t.x - cue.x), power: 0.35, s: 0, pocket: null };
  }
  // difficulty noise
  const angleSd = ((1 - level) * 2.2 + 0.25) * (Math.PI / 180);
  const powerSd = (1 - level) * 0.08 + 0.02;
  const g = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const angle = best.angle + g() * angleSd;
  const power = Math.max(0.15, Math.min(1, best.power + g() * powerSd));
  const calledPocket = mustCall ? (best.pocket ?? nearestPocketToEight(state, cfg)) : null;
  return { angle, power, calledPocket };
}

export function nearestPocketToEight(state: PoolGameState, cfg: PoolConfig = DEFAULT_POOL): number {
  const e = state.balls.find((b) => b.id === 8)!;
  let best = 0;
  let bd = Infinity;
  for (const p of pockets(cfg)) {
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d < bd) { bd = d; best = p.index; }
  }
  return best;
}

/** Pick a ball-in-hand placement: line up a straight shot on an easy target. */
export function choosePlacement(state: PoolGameState, cfg: PoolConfig = DEFAULT_POOL): { x: number; z: number } {
  const ids = legalFirstContacts(state);
  const pk = pockets(cfg);
  let best: { x: number; z: number; s: number } | null = null;
  const simCfg = aiSimConfig(cfg);
  let budget = 18;
  for (const id of ids) {
    const t = state.balls.find((b) => b.id === id && b.active);
    if (!t) continue;
    for (const p of pk) {
      if (budget-- <= 0) break;
      const px = t.x - p.x;
      const pz = t.z - p.z;
      const n = Math.hypot(px, pz) || 1;
      for (const d of [0.35, 0.22]) {
        const x = t.x + (px / n) * d;
        const z = t.z + (pz / n) * d;
        if (!canPlace(state.balls, x, z, cfg)) continue;
        const balls = state.balls.map((b) => (b.id === 0 ? { ...b, x, z, active: true, vx: 0, vz: 0 } : b));
        const angle = Math.atan2(t.z - z, t.x - x);
        const trial = { ...state, balls, ballInHand: false, calledPocket: onTheEight(state) ? p.index : null };
        const r = simulateShot(balls, 0.45 * cfg.maxShotSpeed, angle, simCfg);
        const res = applyShotResult(trial, r.balls, r.events, cfg);
        const s = score(trial, res, id);
        if (!best || s > best.s) best = { x, z, s };
        break;
      }
    }
  }
  if (best) return best;
  // fallback: anywhere free near the head spot
  for (let tries = 0; tries < 200; tries++) {
    const x = cfg.ballR + Math.random() * (cfg.tableW - 2 * cfg.ballR);
    const z = cfg.ballR + Math.random() * (cfg.tableL * 0.5);
    if (canPlace(state.balls, x, z, cfg)) return { x, z };
  }
  return { x: cfg.tableW / 2, z: cfg.tableL / 4 };
}

export { groupOf };
