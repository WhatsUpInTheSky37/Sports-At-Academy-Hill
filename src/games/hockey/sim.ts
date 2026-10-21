/**
 * Driveway hockey simulation: pure 2D top-down logic in metres. The scene renders it in perspective.
 * x = lateral (-rinkW/2 .. rinkW/2), z = along the driveway (0 = near net, rinkL = far net).
 * Slot 0 defends z = 0 and attacks z = rinkL; slot 1 the opposite.
 */

export interface HockeyConfig {
  rinkW: number;
  rinkL: number;
  goalW: number;
  goalDepth: number;
  playerSpeed: number;
  playerAccel: number;
  playerRadius: number;
  stickReach: number;
  carryOffset: number;
  carryLag: number;
  puckRadius: number;
  /** Linear deceleration of a free puck, m/s^2. */
  puckFriction: number;
  minShot: number;
  maxShot: number;
  chargeTime: number;
  pokeReach: number;
  pokeDuration: number;
  pokeCooldown: number;
  /** Seconds a player cannot re-carry after shooting / being stripped. */
  noCarryTime: number;
  wallRestitution: number;
  winScore: number;
  /** Pause after a goal before the centre reset, seconds. */
  goalPause: number;
}

export const DEFAULT_HOCKEY: HockeyConfig = {
  rinkW: 7,
  rinkL: 24,
  goalW: 1.9,
  goalDepth: 0.9,
  playerSpeed: 5.4,
  playerAccel: 26,
  playerRadius: 0.42,
  stickReach: 1.15,
  carryOffset: 0.95,
  carryLag: 14,
  puckRadius: 0.08,
  puckFriction: 2.4,
  minShot: 7,
  maxShot: 17,
  chargeTime: 0.85,
  pokeReach: 1.7,
  pokeDuration: 0.3,
  pokeCooldown: 0.9,
  noCarryTime: 0.4,
  wallRestitution: 0.62,
  winScore: 5,
  goalPause: 2.2,
};

export interface HockeyPlayer {
  slot: 0 | 1;
  x: number; z: number;
  vx: number; vz: number;
  fx: number; fz: number;      // facing (unit)
  charge: number;              // 0..1 while holding shoot
  charging: boolean;
  pokeTimer: number;
  pokeCooldown: number;
  noCarryTimer: number;
}

export interface Puck { x: number; z: number; vx: number; vz: number; carrier: 0 | 1 | null; }

export interface HockeyInputs { ax: number; az: number; shoot: boolean; poke: boolean; }

export type HockeyEvent =
  | { type: 'goal'; scorer: 0 | 1 }
  | { type: 'shot'; slot: 0 | 1; power: number }
  | { type: 'poke'; slot: 0 | 1; stripped: boolean }
  | { type: 'pickup'; slot: 0 | 1 }
  | { type: 'wall' }
  | { type: 'reset' }
  | { type: 'win'; winner: 0 | 1 };

export interface HockeyState {
  players: [HockeyPlayer, HockeyPlayer];
  puck: Puck;
  scores: [number, number];
  phase: 'play' | 'goal' | 'done';
  winner: 0 | 1 | null;
  lastScorer: 0 | 1 | null;
  resetTimer: number;
  time: number;
}

export const NO_INPUT: HockeyInputs = { ax: 0, az: 0, shoot: false, poke: false };

function makePlayer(slot: 0 | 1, cfg: HockeyConfig): HockeyPlayer {
  return {
    slot,
    x: 0,
    z: slot === 0 ? 4 : cfg.rinkL - 4,
    vx: 0, vz: 0,
    fx: 0, fz: slot === 0 ? 1 : -1,
    charge: 0, charging: false,
    pokeTimer: 0, pokeCooldown: 0, noCarryTimer: 0,
  };
}

export function createHockey(cfg: HockeyConfig = DEFAULT_HOCKEY): HockeyState {
  return {
    players: [makePlayer(0, cfg), makePlayer(1, cfg)],
    puck: { x: 0, z: cfg.rinkL / 2, vx: 0, vz: 0, carrier: null },
    scores: [0, 0],
    phase: 'play',
    winner: null,
    lastScorer: null,
    resetTimer: 0,
    time: 0,
  };
}

/** Put everyone back at their own end with the puck at centre. */
export function resetPositions(state: HockeyState, cfg: HockeyConfig = DEFAULT_HOCKEY): void {
  state.players = [makePlayer(0, cfg), makePlayer(1, cfg)];
  state.puck = { x: 0, z: cfg.rinkL / 2, vx: 0, vz: 0, carrier: null };
}

/**
 * Goal detection: a goal counts only when the puck has fully crossed the goal line (z <= -r or z >= L + r)
 * between the posts. Returns the scoring slot or null.
 */
export function checkGoal(prev: { x: number; z: number }, puck: { x: number; z: number }, cfg: HockeyConfig = DEFAULT_HOCKEY): 0 | 1 | null {
  const r = cfg.puckRadius;
  const half = cfg.goalW / 2;
  if (prev.z > -r && puck.z <= -r && Math.abs(puck.x) < half) return 1; // into the near net: slot 1 scores
  if (prev.z < cfg.rinkL + r && puck.z >= cfg.rinkL + r && Math.abs(puck.x) < half) return 0;
  return null;
}

function len(x: number, z: number): number { return Math.hypot(x, z); }

/** Advance the simulation by dt seconds. Returns events for the presentation layer. */
export function step(state: HockeyState, inputs: [HockeyInputs, HockeyInputs], dt: number, cfg: HockeyConfig = DEFAULT_HOCKEY): HockeyEvent[] {
  const events: HockeyEvent[] = [];
  state.time += dt;
  if (state.phase === 'done') return events;
  if (state.phase === 'goal') {
    state.resetTimer -= dt;
    if (state.resetTimer <= 0) {
      resetPositions(state, cfg);
      state.phase = 'play';
      events.push({ type: 'reset' });
    }
    return events;
  }
  const puck = state.puck;
  const prevPuck = { x: puck.x, z: puck.z };

  // ---- players ----
  for (const p of state.players) {
    const inp = inputs[p.slot];
    const other = state.players[p.slot === 0 ? 1 : 0];
    // timers
    p.pokeTimer = Math.max(0, p.pokeTimer - dt);
    p.pokeCooldown = Math.max(0, p.pokeCooldown - dt);
    p.noCarryTimer = Math.max(0, p.noCarryTimer - dt);
    // movement (charging a shot slows you down)
    const spd = cfg.playerSpeed * (p.charging ? 0.45 : 1);
    const tx = inp.ax * spd;
    const tz = inp.az * spd;
    p.vx += (tx - p.vx) * Math.min(1, cfg.playerAccel * dt / cfg.playerSpeed);
    p.vz += (tz - p.vz) * Math.min(1, cfg.playerAccel * dt / cfg.playerSpeed);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    const half = cfg.rinkW / 2 - cfg.playerRadius;
    if (p.x < -half) { p.x = -half; p.vx = 0; }
    if (p.x > half) { p.x = half; p.vx = 0; }
    if (p.z < 0.4) { p.z = 0.4; p.vz = 0; }
    if (p.z > cfg.rinkL - 0.4) { p.z = cfg.rinkL - 0.4; p.vz = 0; }
    if (inp.ax !== 0 || inp.az !== 0) {
      const l = len(inp.ax, inp.az);
      p.fx = inp.ax / l;
      p.fz = inp.az / l;
    }
    // body collision
    const dx = p.x - other.x, dz = p.z - other.z;
    const d = len(dx, dz);
    const minD = cfg.playerRadius * 2;
    if (d > 0.0001 && d < minD) {
      const push = (minD - d) / 2;
      p.x += (dx / d) * push; p.z += (dz / d) * push;
      other.x -= (dx / d) * push; other.z -= (dz / d) * push;
    }
    // poke check
    if (inp.poke && p.pokeCooldown <= 0 && p.pokeTimer <= 0) {
      p.pokeTimer = cfg.pokeDuration;
      p.pokeCooldown = cfg.pokeCooldown;
      p.charging = false; p.charge = 0;
    }
    if (p.pokeTimer > 0) {
      const tipX = p.x + p.fx * cfg.pokeReach;
      const tipZ = p.z + p.fz * cfg.pokeReach;
      const pd = len(puck.x - tipX, puck.z - tipZ);
      if (pd < 0.75 && puck.carrier !== p.slot) {
        const stripped = puck.carrier === other.slot;
        if (stripped) {
          other.noCarryTimer = cfg.noCarryTime + 0.25;
          other.charging = false; other.charge = 0;
        }
        puck.carrier = null;
        puck.vx = p.fx * 5.5 + p.vx;
        puck.vz = p.fz * 5.5 + p.vz;
        p.pokeTimer = 0;
        p.noCarryTimer = 0.15;
        events.push({ type: 'poke', slot: p.slot, stripped });
      }
    }
  }

  // ---- pickup ----
  if (puck.carrier === null) {
    let best: HockeyPlayer | null = null;
    let bestD = Infinity;
    for (const p of state.players) {
      if (p.noCarryTimer > 0) continue;
      const dx = puck.x - p.x, dz = puck.z - p.z;
      const d = len(dx, dz);
      const ahead = d < 0.001 ? 1 : (dx * p.fx + dz * p.fz) / d;
      const reach = ahead > 0 ? cfg.stickReach : cfg.stickReach * 0.55;
      if (d < reach && d < bestD) { best = p; bestD = d; }
    }
    if (best) {
      puck.carrier = best.slot;
      puck.vx = 0; puck.vz = 0;
      events.push({ type: 'pickup', slot: best.slot });
    }
  }

  // ---- carried puck & shooting ----
  if (puck.carrier !== null) {
    const p = state.players[puck.carrier];
    const inp = inputs[p.slot];
    if (inp.shoot) {
      p.charging = true;
      p.charge = Math.min(1, p.charge + dt / cfg.chargeTime);
    } else if (p.charging) {
      // release: fire
      const power = p.charge;
      let dx = p.fx + inp.ax * 0.45;
      let dz = p.fz + inp.az * 0.45;
      const l = len(dx, dz) || 1;
      dx /= l; dz /= l;
      const speed = cfg.minShot + (cfg.maxShot - cfg.minShot) * power;
      puck.x = p.x + p.fx * cfg.carryOffset;
      puck.z = p.z + p.fz * cfg.carryOffset;
      puck.vx = dx * speed + p.vx * 0.3;
      puck.vz = dz * speed + p.vz * 0.3;
      puck.carrier = null;
      p.charging = false;
      p.charge = 0;
      p.noCarryTimer = cfg.noCarryTime;
      events.push({ type: 'shot', slot: p.slot, power });
    }
    if (puck.carrier !== null) {
      const tx = p.x + p.fx * cfg.carryOffset;
      const tz = p.z + p.fz * cfg.carryOffset;
      const k = Math.min(1, cfg.carryLag * dt);
      puck.x += (tx - puck.x) * k;
      puck.z += (tz - puck.z) * k;
      puck.vx = p.vx; puck.vz = p.vz;
    }
  }

  // ---- free puck physics ----
  if (puck.carrier === null) {
    const sp = len(puck.vx, puck.vz);
    if (sp > 0) {
      const ns = Math.max(0, sp - cfg.puckFriction * dt);
      puck.vx *= ns / sp; puck.vz *= ns / sp;
    }
    puck.x += puck.vx * dt;
    puck.z += puck.vz * dt;
    const half = cfg.rinkW / 2 - cfg.puckRadius;
    if (puck.x < -half) { puck.x = -half; puck.vx = Math.abs(puck.vx) * cfg.wallRestitution; events.push({ type: 'wall' }); }
    if (puck.x > half) { puck.x = half; puck.vx = -Math.abs(puck.vx) * cfg.wallRestitution; events.push({ type: 'wall' }); }
    const inMouth = Math.abs(puck.x) < cfg.goalW / 2;
    if (!inMouth) {
      if (puck.z < cfg.puckRadius) { puck.z = cfg.puckRadius; puck.vz = Math.abs(puck.vz) * cfg.wallRestitution; events.push({ type: 'wall' }); }
      if (puck.z > cfg.rinkL - cfg.puckRadius) { puck.z = cfg.rinkL - cfg.puckRadius; puck.vz = -Math.abs(puck.vz) * cfg.wallRestitution; events.push({ type: 'wall' }); }
    } else {
      // back of the net stops the puck
      if (puck.z < -cfg.goalDepth) { puck.z = -cfg.goalDepth; puck.vx = 0; puck.vz = 0; }
      if (puck.z > cfg.rinkL + cfg.goalDepth) { puck.z = cfg.rinkL + cfg.goalDepth; puck.vx = 0; puck.vz = 0; }
    }
    const scorer = checkGoal(prevPuck, puck, cfg);
    if (scorer !== null) {
      state.scores[scorer] += 1;
      state.lastScorer = scorer;
      events.push({ type: 'goal', scorer });
      if (state.scores[scorer] >= cfg.winScore) {
        state.phase = 'done';
        state.winner = scorer;
        events.push({ type: 'win', winner: scorer });
      } else {
        state.phase = 'goal';
        state.resetTimer = cfg.goalPause;
      }
    }
  }
  return events;
}

/** Per-AI scratch memory kept between frames. */
export interface AiMemory { jitterX: number; jitterT: number; wantShot: boolean; shotTarget: number; }

export function createAiMemory(): AiMemory { return { jitterX: 0, jitterT: 0, wantShot: false, shotTarget: 0.7 }; }

/**
 * CPU inputs for `slot`. level: 0 easy .. 1 hard. Uses only the public state, same rules as humans.
 */
export function aiInputs(state: HockeyState, slot: 0 | 1, level: number, mem: AiMemory, dt: number, cfg: HockeyConfig = DEFAULT_HOCKEY, rand: () => number = Math.random): HockeyInputs {
  const me = state.players[slot];
  const opp = state.players[slot === 0 ? 1 : 0];
  const puck = state.puck;
  const myGoalZ = slot === 0 ? 0 : cfg.rinkL;
  const oppGoalZ = slot === 0 ? cfg.rinkL : 0;
  const dir = slot === 0 ? 1 : -1; // attacking direction along z
  mem.jitterT -= dt;
  if (mem.jitterT <= 0) {
    mem.jitterT = 0.5 + rand() * 0.6;
    mem.jitterX = (rand() - 0.5) * (1.6 - 1.3 * level);
  }
  const speedMul = 0.78 + 0.27 * level;
  const moveTo = (tx: number, tz: number, deadzone = 0.15): { ax: number; az: number } => {
    const dx = tx - me.x, dz = tz - me.z;
    const d = len(dx, dz);
    if (d < deadzone) return { ax: 0, az: 0 };
    return { ax: (dx / d) * speedMul, az: (dz / d) * speedMul };
  };
  let out: HockeyInputs = { ax: 0, az: 0, shoot: false, poke: false };

  if (puck.carrier === slot) {
    const distGoal = Math.abs(oppGoalZ - me.z);
    // lane check: is the opponent between me and the net?
    const laneBlocked = Math.sign(opp.z - me.z) === dir && Math.abs(opp.z - me.z) < distGoal && Math.abs(opp.x - me.x) < 1.1;
    const shootRange = 6.5 + level * 5;
    const oppClose = len(opp.x - me.x, opp.z - me.z) < 1.6;
    if (!mem.wantShot && ((distGoal < shootRange && (!laneBlocked || rand() < 0.1)) || (oppClose && rand() < 0.05 + level * 0.1))) {
      mem.wantShot = true;
      mem.shotTarget = Math.min(1, 0.45 + distGoal / cfg.rinkL * 1.2 + (rand() - 0.5) * 0.2);
    }
    if (mem.wantShot) {
      // face the net (with slight aim error), hold shoot until charged, then release
      const aimX = (rand() - 0.5) * (0.5 - 0.42 * level) * cfg.goalW + mem.jitterX * 0.2;
      const dx = aimX - me.x, dz = oppGoalZ - me.z;
      const l = len(dx, dz) || 1;
      const charged = me.charge >= mem.shotTarget;
      if (charged) { mem.wantShot = false; out = { ax: dx / l * 0.3, az: dz / l * 0.3, shoot: false, poke: false }; }
      else out = { ax: dx / l * 0.6, az: dz / l * 0.6, shoot: true, poke: false };
      return out;
    }
    // skate toward the net, drifting around the defender
    let tx = laneBlocked ? (opp.x > 0 ? -1.6 : 1.6) : mem.jitterX * 0.5;
    tx = Math.max(-cfg.rinkW / 2 + 0.8, Math.min(cfg.rinkW / 2 - 0.8, tx));
    const m = moveTo(tx, oppGoalZ - dir * 2.5);
    return { ...m, shoot: false, poke: false };
  }
  mem.wantShot = false;

  if (puck.carrier === null) {
    // predict where the puck will be shortly
    const lead = 0.25 + level * 0.2;
    const px = puck.x + puck.vx * lead;
    const pz = puck.z + puck.vz * lead;
    const myD = len(px - me.x, pz - me.z);
    const oppD = len(px - opp.x, pz - opp.z);
    const inMyHalf = Math.abs(pz - myGoalZ) < cfg.rinkL / 2;
    if (myD <= oppD * (1.1 + level * 0.3) || inMyHalf || level > 0.6) {
      const m = moveTo(px + mem.jitterX * 0.3, pz);
      // knock a loose puck away if it is dangerously close to my net
      const poke = myD < cfg.pokeReach && me.pokeCooldown <= 0 && Math.abs(pz - myGoalZ) < 3 && rand() < 0.3;
      return { ...m, shoot: false, poke };
    }
    const m = moveTo(px * 0.5, myGoalZ + dir * 3);
    return { ...m, shoot: false, poke: false };
  }

  // opponent carries: defend between carrier and my net, poke when in reach
  const toGoalX = 0 - opp.x, toGoalZ = myGoalZ - opp.z;
  const l = len(toGoalX, toGoalZ) || 1;
  const standoff = 1.3;
  const tx = opp.x + (toGoalX / l) * standoff;
  const tz = opp.z + (toGoalZ / l) * standoff;
  const m = moveTo(tx + mem.jitterX * 0.4, tz);
  const d = len(opp.x - me.x, opp.z - me.z);
  const facingOpp = ((opp.x - me.x) * me.fx + (opp.z - me.z) * me.fz) / (d || 1) > 0.5;
  const poke = d < cfg.pokeReach + 0.6 && facingOpp && me.pokeCooldown <= 0 && rand() < (0.35 + level * 0.5);
  return { ...m, shoot: false, poke };
}
