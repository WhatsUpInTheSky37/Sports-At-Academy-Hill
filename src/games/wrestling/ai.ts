import { NO_INPUT, WRESTLING_TUNING, distance, other, type Inputs, type WrestlingState } from './sim';

/** Per-AI scratch memory between frames. */
export interface AiMemory {
  decideTimer: number;
  mode: 'approach' | 'circle' | 'retreat' | 'pin';
  circleDir: 1 | -1;
  circleTimer: number;
  /** Seconds of the current pin before the AI starts fighting it. */
  escapeDelay: number;
  grappleTapTimer: number;
}

export function createAiMemory(): AiMemory {
  return { decideTimer: 0, mode: 'approach', circleDir: 1, circleTimer: 0, escapeDelay: -1, grappleTapTimer: 0 };
}

/** How the CPU fights a pin at a given level: seconds before it reacts, and the share of time it keeps the button held. */
export function aiEscapeProfile(level: number): { delay: number; hold: number } {
  return { delay: 0.9 - 0.7 * level, hold: 0.5 + 0.5 * level };
}

/**
 * Produce inputs for the AI wrestler in `slot`. `level` is 0 (easy) .. 1 (hard).
 * Uses the same rules as a human: it can only act through the Inputs interface.
 */
export function aiInputs(state: WrestlingState, slot: 0 | 1, level: number, dt: number, mem: AiMemory, rand: () => number = Math.random): Inputs {
  const t = WRESTLING_TUNING;
  const me = state.w[slot];
  const op = state.w[other(slot)];
  const inp: Inputs = { ...NO_INPUT };
  if (state.phase !== 'fight') return inp;
  const reaction = 0.55 - 0.35 * level;
  mem.decideTimer -= dt;
  mem.circleTimer -= dt;
  mem.grappleTapTimer -= dt;
  const dx = op.x - me.x;
  const dz = op.z - me.z;
  const dist = distance(me, op);
  const nx = dist > 0 ? dx / dist : 1;
  const nz = dist > 0 ? dz / dist : 0;

  // ---- pinned: hold to escape, after a reaction delay and with a level-dependent grip ----
  if (me.state === 'pinned') {
    const prof = aiEscapeProfile(level);
    if (mem.escapeDelay < 0) mem.escapeDelay = prof.delay * (0.8 + 0.4 * rand());
    if (me.stateTime >= mem.escapeDelay) {
      const cycle = 0.6;
      inp.escape = (me.stateTime % cycle) < cycle * prof.hold;
    }
    return inp;
  }
  mem.escapeDelay = -1;
  if (me.state === 'down' || me.state === 'pinning' || me.state === 'strike') {
    if (me.state === 'pinning') inp.grapple = true;
    return inp;
  }

  // ---- grappling: push, tap, and attempt takedowns ----
  if (me.state === 'grapple' && state.grapple.active) {
    inp.x = nx; inp.y = nz;
    if (mem.grappleTapTimer <= 0) {
      inp.grappleJust = true;
      mem.grappleTapTimer = 0.6 - 0.35 * level + rand() * 0.2;
    }
    const adv = slot === 0 ? state.grapple.advantage : -state.grapple.advantage;
    const threshold = 0.45 - 0.3 * level;
    if (mem.decideTimer <= 0) {
      mem.decideTimer = reaction;
      if (me.stamina >= t.takedownCost + 5 && (adv >= threshold || (op.stamina < 25 && rand() < 0.5) || rand() < 0.04 + 0.05 * level)) {
        inp.shoveJust = true;
      }
    }
    return inp;
  }

  // ---- opponent is down: go pin ----
  if (op.state === 'down') {
    mem.mode = 'pin';
    if (dist <= t.pinRange * 0.8) {
      inp.grapple = true; // hold to pin
      return inp;
    }
    inp.x = nx; inp.y = nz;
    inp.grapple = dist <= t.pinRange;
    return inp;
  }

  // ---- free movement decisions ----
  if (mem.decideTimer <= 0) {
    mem.decideTimer = reaction;
    if (me.stamina < 28) mem.mode = 'retreat';
    else if (me.stamina > 55 || mem.mode !== 'retreat') mem.mode = dist < 1.4 && rand() < 0.35 - 0.2 * level ? 'circle' : 'approach';
    if (mem.mode === 'circle' && mem.circleTimer <= 0) { mem.circleDir = rand() < 0.5 ? 1 : -1; mem.circleTimer = 0.8; }
  }
  const half = t.ringSize / 2 - 0.3;
  const centerPull = { x: -me.x / half, z: -me.z / half };
  if (mem.mode === 'retreat') {
    // back away but stay inside the ring
    let rx = -nx, rz = -nz;
    if (Math.abs(me.x - nx * 0.1) > half * 0.9 || Math.abs(me.z) > half * 0.9) { rx = -nz * mem.circleDir; rz = nx * mem.circleDir; }
    inp.x = rx + centerPull.x * 0.8;
    inp.y = rz + centerPull.z * 0.8;
  } else if (mem.mode === 'circle') {
    inp.x = -nz * mem.circleDir + nx * 0.2 + centerPull.x * 0.3;
    inp.y = nx * mem.circleDir + nz * 0.2 + centerPull.z * 0.3;
  } else {
    const stop = dist < t.grappleRange * 0.75;
    if (!stop) { inp.x = nx; inp.y = nz; }
  }
  // attacks (only evaluated on reaction ticks to avoid frame-perfect play)
  if (me.state === 'idle' && mem.mode !== 'retreat' && mem.decideTimer >= reaction - dt * 1.01) {
    const behind = (op.facing === 1 && nx < -0.3) || (op.facing === -1 && nx > 0.3);
    const tired = op.stamina < t.shoveDownStamina;
    if (dist <= t.shoveRange && op.state === 'stagger' && (behind || tired) && me.stamina >= t.shoveCost && me.cooldown <= 0) inp.shoveJust = true;
    else if (dist <= t.grappleRange && op.state === 'stagger' && me.stamina >= t.grappleCost + 10) inp.grappleJust = true;
    else if (dist <= t.shoveRange && behind && me.stamina >= t.shoveCost && me.cooldown <= 0 && rand() < 0.5 + 0.4 * level) inp.shoveJust = true;
    else if (dist <= t.kickRange && op.state === 'stagger' && me.stamina >= t.kickCost + 5 && me.cooldown <= 0 && rand() < 0.3 + 0.5 * level) inp.kickJust = true;
    else if (dist <= t.punchRange && me.stamina >= t.punchCost + 10 && me.cooldown <= 0 && rand() < 0.3 + 0.3 * level) inp.punchJust = true;
    else if (dist <= t.kickRange && dist > t.grappleRange && me.stamina >= t.kickCost + 10 && me.cooldown <= 0 && rand() < 0.25 + 0.3 * level) inp.kickJust = true;
    else if (dist <= t.grappleRange && me.stamina >= t.grappleCost + 15 && rand() < 0.3 + 0.55 * level) inp.grappleJust = true;
    else if (dist <= t.kickRange && me.stamina >= t.kickCost + 10 && me.cooldown <= 0 && rand() < 0.1 + 0.3 * level) inp.kickJust = true;
    else if (dist <= t.shoveRange && me.stamina >= t.shoveCost + 10 && me.cooldown <= 0 && rand() < 0.1 + 0.2 * level) inp.shoveJust = true;
  }
  return inp;
}
