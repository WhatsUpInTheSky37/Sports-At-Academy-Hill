/**
 * Basement wrestling simulation. Pure and deterministic given inputs (randomness is injected via
 * `rand` in the step options so tests can control it). The scene renders this state and feeds inputs.
 * Units: metres, seconds. The ring is a square centred on the origin.
 */

export const WRESTLING_TUNING = {
  /** Side length of the cushion ring (10 ft). */
  ringSize: 3.05,
  moveSpeed: 2.4,
  staminaMax: 100,
  /** Stamina per second while idle / while grappling. */
  staminaRegen: 16,
  staminaRegenGrapple: 3,
  shoveCost: 22,
  grappleCost: 10,
  grappleTapCost: 3,
  takedownCost: 24,
  grappleRange: 0.95,
  shoveRange: 1.05,
  /** Knockback distance (m) of a normal shove, and the stagger it causes (s). */
  shoveKnockback: 1.2,
  shoveStagger: 0.9,
  /** Seconds before the same wrestler can shove again. */
  shoveCooldown: 0.75,
  /** A shove on a staggered opponent only knocks them down when it comes from behind or they are this tired. */
  shoveDownStamina: 35,
  /** Grappling a staggered opponent starts the tug with this much advantage. */
  grappleStaggerBonus: 0.35,
  /** Multiplier when shoving an opponent from behind. */
  shoveFromBehindMult: 1.5,
  /** Advantage gained per second while pushing toward the opponent in a grapple (scaled by stamina). */
  grappleAdvantagePush: 0.75,
  /** Advantage gained per grapple tap. */
  grappleAdvantageTap: 0.1,
  /** Advantage drifts back toward zero at this rate per second. */
  grappleDecay: 0.2,
  /** When advantage hits +/-1 the loser is shoved out of the grapple and staggered. */
  takedownBaseChance: 0.3,
  takedownAdvantageWeight: 0.55,
  takedownStaminaWeight: 0.25,
  /** How long a downed wrestler stays vulnerable. */
  downDuration: 3.4,
  /** Extra vulnerability added when a pin is cancelled by releasing the button. */
  pinReleaseExtension: 0.6,
  pinRange: 1.15,
  /** Seconds per count of the three-count. */
  pinCountSeconds: 1.0,
  pinCounts: 3,
  /** Escape marker sweep period (s) and the fraction of the bar that counts as the green zone. */
  escapeMarkerPeriod: 1.1,
  escapeWindow: 0.24,
  escapeLockout: 0.5,
  ringOutPause: 1.6,
  /** Fraction of missing stamina restored on a ring-out reset. */
  ringOutStaminaRestore: 0.5,
  /** Recovery stagger after getting up / after a failed takedown / after being escaped. */
  recoverStagger: 0.5,
  failedTakedownStagger: 0.7,
  escapedStagger: 0.6,
  /** Grapple partners stand this far apart. */
  grappleHold: 0.75,
  introSeconds: 1.2,
};

export type WrestlerState = 'idle' | 'stagger' | 'grapple' | 'down' | 'pinning' | 'pinned';

export interface Wrestler {
  x: number;
  z: number;
  /** +1 faces +x (screen right), -1 faces -x. */
  facing: 1 | -1;
  stamina: number;
  state: WrestlerState;
  /** Seconds in the current state. */
  stateTime: number;
  /** Knockback velocity. */
  vx: number;
  vz: number;
  /** True this frame while the wrestler is walking. */
  moving: boolean;
  /** Seconds until the next shove is allowed. */
  cooldown: number;
}

export interface Inputs {
  x: number;
  y: number;
  /** Grapple / pin button held and just pressed. */
  grapple: boolean;
  grappleJust: boolean;
  shoveJust: boolean;
  escapeJust: boolean;
}

export interface PinState {
  active: boolean;
  attacker: 0 | 1;
  /** Completed counts (0..3). */
  count: number;
  /** Seconds into the current count. */
  progress: number;
  /** Escape marker position 0..1 (ping-pong). */
  marker: number;
  markerDir: 1 | -1;
  /** Seconds the defender's escape button stays locked after a mistimed tap. */
  lockout: number;
}

export type WrestlingEvent =
  | { type: 'grapple' }
  | { type: 'shove'; by: 0 | 1; strong: boolean }
  | { type: 'takedown'; by: 0 | 1 }
  | { type: 'takedownFailed'; by: 0 | 1 }
  | { type: 'grappleBroken'; loser: 0 | 1 }
  | { type: 'pinStart'; by: 0 | 1 }
  | { type: 'count'; n: number }
  | { type: 'pinReleased' }
  | { type: 'escape'; by: 0 | 1 }
  | { type: 'escapeMissed'; by: 0 | 1 }
  | { type: 'ringOut'; who: 0 | 1 }
  | { type: 'reset' }
  | { type: 'getUp'; who: 0 | 1 }
  | { type: 'win'; winner: 0 | 1 };

export interface WrestlingState {
  w: [Wrestler, Wrestler];
  grapple: { active: boolean; advantage: number };
  pin: PinState;
  phase: 'intro' | 'fight' | 'ringout' | 'done';
  phaseTime: number;
  time: number;
  winner: 0 | 1 | null;
  /** Events emitted by the most recent step (cleared every step). */
  events: WrestlingEvent[];
  ringOutBy: 0 | 1 | null;
}

export const NO_INPUT: Inputs = { x: 0, y: 0, grapple: false, grappleJust: false, shoveJust: false, escapeJust: false };

export const START_POSITIONS: [{ x: number; z: number }, { x: number; z: number }] = [
  { x: -0.9, z: 0 },
  { x: 0.9, z: 0 },
];

function makeWrestler(slot: 0 | 1): Wrestler {
  return { ...START_POSITIONS[slot], facing: slot === 0 ? 1 : -1, stamina: WRESTLING_TUNING.staminaMax, state: 'idle', stateTime: 0, vx: 0, vz: 0, moving: false, cooldown: 0 };
}

export function createWrestling(): WrestlingState {
  return {
    w: [makeWrestler(0), makeWrestler(1)],
    grapple: { active: false, advantage: 0 },
    pin: { active: false, attacker: 0, count: 0, progress: 0, marker: 0, markerDir: 1, lockout: 0 },
    phase: 'intro',
    phaseTime: 0,
    time: 0,
    winner: null,
    events: [],
    ringOutBy: null,
  };
}

export function other(s: 0 | 1): 0 | 1 { return s === 0 ? 1 : 0; }

export function distance(a: Wrestler, b: Wrestler): number { return Math.hypot(a.x - b.x, a.z - b.z); }

export function insideRing(w: { x: number; z: number }, t = WRESTLING_TUNING): boolean {
  const h = t.ringSize / 2;
  return Math.abs(w.x) <= h && Math.abs(w.z) <= h;
}

/** True while this wrestler can be pinned (lying down, not yet recovered). */
export function isVulnerable(w: Wrestler): boolean { return w.state === 'down' || w.state === 'pinned'; }

export function vulnerabilityLeft(w: Wrestler, t = WRESTLING_TUNING): number {
  return w.state === 'down' ? Math.max(0, t.downDuration - w.stateTime) : w.state === 'pinned' ? t.downDuration : 0;
}

/** Escape succeeds when the marker is inside the centred green window. */
export function escapeWindowHit(marker: number, t = WRESTLING_TUNING): boolean {
  return Math.abs(marker - 0.5) <= t.escapeWindow / 2;
}

export interface StepOptions { rand?: () => number; tuning?: typeof WRESTLING_TUNING; }

function setState(w: Wrestler, s: WrestlerState): void {
  w.state = s;
  w.stateTime = 0;
}

function dirTo(from: Wrestler, to: Wrestler): { x: number; z: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: dx / d, z: dz / d };
}

/** Advance the simulation by dt seconds. Mutates and returns the same state object. */
export function step(state: WrestlingState, inputs: [Inputs, Inputs], dt: number, opts: StepOptions = {}): WrestlingState {
  const t = opts.tuning ?? WRESTLING_TUNING;
  const rand = opts.rand ?? Math.random;
  const ev: WrestlingEvent[] = [];
  state.events = ev;
  state.time += dt;
  state.phaseTime += dt;
  const [a, b] = state.w;

  if (state.phase === 'done') return state;
  if (state.phase === 'intro') {
    if (state.phaseTime >= t.introSeconds) { state.phase = 'fight'; state.phaseTime = 0; }
    return state;
  }
  if (state.phase === 'ringout') {
    if (state.phaseTime >= t.ringOutPause) {
      for (const slot of [0, 1] as const) {
        const w = state.w[slot];
        w.x = START_POSITIONS[slot].x; w.z = START_POSITIONS[slot].z;
        w.vx = 0; w.vz = 0;
        w.facing = slot === 0 ? 1 : -1;
        setState(w, 'idle');
        w.stamina = Math.min(t.staminaMax, w.stamina + (t.staminaMax - w.stamina) * t.ringOutStaminaRestore);
      }
      state.grapple = { active: false, advantage: 0 };
      state.pin.active = false;
      state.phase = 'fight';
      state.phaseTime = 0;
      state.ringOutBy = null;
      ev.push({ type: 'reset' });
    }
    return state;
  }

  // ---- state timers ----
  for (const slot of [0, 1] as const) {
    const w = state.w[slot];
    w.stateTime += dt;
    w.moving = false;
    w.cooldown = Math.max(0, w.cooldown - dt);
    if (w.state === 'stagger' && w.stateTime >= getStaggerDuration(w)) setState(w, 'idle');
    if (w.state === 'down' && w.stateTime >= t.downDuration) {
      setState(w, 'stagger');
      w.stateTime = getStaggerDuration(w) - t.recoverStagger; // short recovery stagger
      ev.push({ type: 'getUp', who: slot });
    }
    // knockback
    w.x += w.vx * dt;
    w.z += w.vz * dt;
    const damp = Math.max(0, 1 - 6 * dt);
    w.vx *= damp; w.vz *= damp;
  }

  // ---- pin in progress ----
  if (state.pin.active) {
    const p = state.pin;
    const att = state.w[p.attacker];
    const def = state.w[other(p.attacker)];
    const attIn = inputs[p.attacker];
    const defIn = inputs[other(p.attacker)];
    // marker sweep
    p.marker += (p.markerDir * dt) / (t.escapeMarkerPeriod / 2);
    if (p.marker >= 1) { p.marker = 1; p.markerDir = -1; }
    if (p.marker <= 0) { p.marker = 0; p.markerDir = 1; }
    p.lockout = Math.max(0, p.lockout - dt);
    if (!attIn.grapple) {
      // released: defender back to down with a little extra vulnerability
      p.active = false;
      setState(att, 'idle');
      setState(def, 'down');
      def.stateTime = Math.max(0, t.downDuration - t.pinReleaseExtension - 0.4);
      ev.push({ type: 'pinReleased' });
      return finishStep(state, t, ev);
    }
    if (defIn.escapeJust && p.lockout <= 0) {
      if (escapeWindowHit(p.marker, t)) {
        p.active = false;
        setState(def, 'idle');
        setState(att, 'stagger');
        att.stateTime = getStaggerDuration(att) - t.escapedStagger;
        const d = dirTo(att, def);
        def.vx = d.x * 2.2; def.vz = d.z * 2.2;
        ev.push({ type: 'escape', by: other(p.attacker) });
        return finishStep(state, t, ev);
      }
      p.lockout = t.escapeLockout;
      ev.push({ type: 'escapeMissed', by: other(p.attacker) });
    }
    p.progress += dt;
    if (p.progress >= t.pinCountSeconds) {
      p.progress -= t.pinCountSeconds;
      p.count += 1;
      ev.push({ type: 'count', n: p.count });
      if (p.count >= t.pinCounts) {
        state.phase = 'done';
        state.winner = p.attacker;
        ev.push({ type: 'win', winner: p.attacker });
        return state;
      }
    }
    return finishStep(state, t, ev);
  }

  // ---- grapple in progress ----
  if (state.grapple.active) {
    const g = state.grapple;
    let push = 0;
    for (const slot of [0, 1] as const) {
      const me = state.w[slot];
      const op = state.w[other(slot)];
      const inp = inputs[slot];
      const d = dirTo(me, op);
      const toward = Math.max(0, inp.x * d.x + inp.y * d.z); // y input maps to z
      const staminaF = 0.4 + 0.6 * (me.stamina / t.staminaMax);
      const sign = slot === 0 ? 1 : -1;
      push += sign * toward * t.grappleAdvantagePush * staminaF * dt;
      if (inp.grappleJust) {
        push += sign * t.grappleAdvantageTap * staminaF;
        me.stamina = Math.max(0, me.stamina - t.grappleTapCost);
      }
      me.stamina = Math.min(t.staminaMax, me.stamina + t.staminaRegenGrapple * dt);
      me.facing = d.x >= 0 ? 1 : -1;
    }
    g.advantage += push;
    // decay toward 0
    const dec = t.grappleDecay * dt;
    if (g.advantage > 0) g.advantage = Math.max(0, g.advantage - dec); else g.advantage = Math.min(0, g.advantage + dec);
    g.advantage = Math.max(-1, Math.min(1, g.advantage));
    // keep them at grapple distance
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const d = dirTo(a, b);
    a.x = mid.x - d.x * t.grappleHold / 2; a.z = mid.z - d.z * t.grappleHold / 2;
    b.x = mid.x + d.x * t.grappleHold / 2; b.z = mid.z + d.z * t.grappleHold / 2;
    // takedown attempts
    for (const slot of [0, 1] as const) {
      const me = state.w[slot];
      const op = state.w[other(slot)];
      if (!inputs[slot].shoveJust) continue;
      if (me.stamina < t.takedownCost) continue;
      me.stamina -= t.takedownCost;
      const adv = slot === 0 ? g.advantage : -g.advantage;
      const chance = t.takedownBaseChance + adv * t.takedownAdvantageWeight + ((me.stamina - op.stamina) / t.staminaMax) * t.takedownStaminaWeight + (op.stamina < 25 ? 0.15 : 0);
      if (rand() < chance) {
        g.active = false;
        setState(op, 'down');
        setState(me, 'idle');
        const dd = dirTo(me, op);
        op.x += dd.x * 0.35; op.z += dd.z * 0.35;
        ev.push({ type: 'takedown', by: slot });
      } else {
        g.active = false;
        setState(me, 'stagger');
        me.stateTime = getStaggerDuration(me) - t.failedTakedownStagger;
        setState(op, 'idle');
        ev.push({ type: 'takedownFailed', by: slot });
      }
      return finishStep(state, t, ev);
    }
    // resolution: advantage maxed or a wrestler out of gas
    let loser: 0 | 1 | null = null;
    if (g.advantage >= 1) loser = 1; else if (g.advantage <= -1) loser = 0;
    else if (a.stamina <= 0) loser = 0; else if (b.stamina <= 0) loser = 1;
    if (loser !== null) {
      const win = other(loser);
      const lw = state.w[loser];
      const dd = dirTo(state.w[win], lw);
      g.active = false;
      setState(lw, 'stagger');
      lw.vx = dd.x * 3.2; lw.vz = dd.z * 3.2;
      setState(state.w[win], 'idle');
      ev.push({ type: 'grappleBroken', loser });
    }
    return finishStep(state, t, ev);
  }

  // ---- free movement, shoves, grapple/pin initiation ----
  for (const slot of [0, 1] as const) {
    const me = state.w[slot];
    const op = state.w[other(slot)];
    const inp = inputs[slot];
    const canAct = me.state === 'idle';
    const canMove = me.state === 'idle' || me.state === 'stagger';
    if (canMove && (inp.x !== 0 || inp.y !== 0)) {
      const len = Math.hypot(inp.x, inp.y);
      const k = len > 1 ? 1 / len : 1;
      const speed = t.moveSpeed * (me.state === 'stagger' ? 0.35 : 1);
      me.x += inp.x * k * speed * dt;
      me.z += inp.y * k * speed * dt;
      me.moving = true;
    }
    // face the opponent
    if (me.state !== 'down') me.facing = op.x >= me.x ? 1 : -1;
    let acted = false;
    if (canAct) {
      const dist = distance(me, op);
      // pin attempt: hold grapple next to a downed opponent
      if (inp.grapple && op.state === 'down' && dist <= t.pinRange) {
        state.pin = { active: true, attacker: slot, count: 0, progress: 0, marker: 0, markerDir: 1, lockout: 0 };
        setState(me, 'pinning');
        setState(op, 'pinned');
        ev.push({ type: 'pinStart', by: slot });
        return finishStep(state, t, ev);
      }
      if (inp.grappleJust && op.state !== 'down' && op.state !== 'pinned' && dist <= t.grappleRange && me.stamina >= t.grappleCost) {
        me.stamina -= t.grappleCost;
        const bonus = op.state === 'stagger' ? t.grappleStaggerBonus * (slot === 0 ? 1 : -1) : 0;
        state.grapple = { active: true, advantage: bonus };
        setState(me, 'grapple');
        setState(op, 'grapple');
        ev.push({ type: 'grapple' });
        return finishStep(state, t, ev);
      }
      if (inp.shoveJust && me.stamina >= t.shoveCost && me.cooldown <= 0) {
        me.stamina -= t.shoveCost;
        me.cooldown = t.shoveCooldown;
        acted = true;
        if (dist <= t.shoveRange && op.state !== 'down' && op.state !== 'pinned') {
          const d = dirTo(me, op);
          const fromBehind = (op.facing === 1 && d.x > 0.3) || (op.facing === -1 && d.x < -0.3);
          const wasStaggered = op.state === 'stagger';
          const strong = fromBehind || wasStaggered;
          const mult = (fromBehind ? t.shoveFromBehindMult : 1) * (0.6 + 0.4 * (me.stamina + t.shoveCost) / t.staminaMax);
          op.vx = d.x * t.shoveKnockback * mult * 3;
          op.vz = d.z * t.shoveKnockback * mult * 3;
          if ((wasStaggered && (fromBehind || op.stamina < t.shoveDownStamina)) || (fromBehind && op.stamina < t.shoveDownStamina)) {
            setState(op, 'down');
            ev.push({ type: 'takedown', by: slot });
          } else {
            setState(op, 'stagger');
            op.stateTime = getStaggerDuration(op) - t.shoveStagger * (fromBehind ? 1.4 : 1);
            ev.push({ type: 'shove', by: slot, strong });
          }
        } else {
          ev.push({ type: 'shove', by: slot, strong: false });
        }
      }
    }
    if (!acted && !inp.grappleJust && !inp.shoveJust && me.state !== 'down' && me.state !== 'pinned') {
      me.stamina = Math.min(t.staminaMax, me.stamina + t.staminaRegen * dt * (me.moving ? 0.5 : 1));
    }
  }
  return finishStep(state, t, ev);
}

/** Staggers are stored as "time remaining" by setting stateTime relative to this fixed duration. */
export function getStaggerDuration(_w: Wrestler): number { return 2.0; }

function finishStep(state: WrestlingState, t: typeof WRESTLING_TUNING, ev: WrestlingEvent[]): WrestlingState {
  // ring-out check
  for (const slot of [0, 1] as const) {
    if (!insideRing(state.w[slot], t)) {
      state.phase = 'ringout';
      state.phaseTime = 0;
      state.ringOutBy = slot;
      state.grapple.active = false;
      state.pin.active = false;
      for (const w of state.w) { w.vx = 0; w.vz = 0; }
      ev.push({ type: 'ringOut', who: slot });
      break;
    }
  }
  return state;
}

/** Seconds of stagger remaining (0 when not staggered). */
export function staggerLeft(w: Wrestler): number {
  return w.state === 'stagger' ? Math.max(0, getStaggerDuration(w) - w.stateTime) : 0;
}

/** Convenience: start a stagger lasting `seconds`. */
export function applyStagger(w: Wrestler, seconds: number): void {
  setState(w, 'stagger');
  w.stateTime = getStaggerDuration(w) - seconds;
}
