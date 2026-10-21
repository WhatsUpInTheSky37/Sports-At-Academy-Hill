/**
 * Casual eight-ball rules, independent of rendering. State transitions are pure functions that take
 * the shot events produced by the physics simulation.
 */
import { DEFAULT_POOL, findFreeSpot, isSolid, isStripe, rackBalls, type Ball, type PoolConfig, type ShotEvents } from './physics';

export type Group = 'solid' | 'stripe';

export interface PoolGameState {
  balls: Ball[];
  turn: 0 | 1;
  groups: [Group | null, Group | null];
  /** Table is open (groups not yet assigned). */
  open: boolean;
  /** Next shot must be a break. */
  breakPending: boolean;
  /** Current shooter has ball in hand (may place the cue ball). */
  ballInHand: boolean;
  /** Pocket index (0..5) called for the eight, or null. */
  calledPocket: number | null;
  /** A decision is required before play continues. */
  pending: null | { type: 'chooseGroup'; by: 0 | 1 } | { type: 'illegalBreak'; by: 0 | 1 };
  winner: 0 | 1 | null;
  /** Human-readable explanation of what just happened. */
  message: string;
  shots: number;
}

function other(s: 0 | 1): 0 | 1 { return s === 0 ? 1 : 0; }

export function createGame(firstBreaker: 0 | 1 = 0, cfg: PoolConfig = DEFAULT_POOL, seed = Math.floor(Math.random() * 1e9)): PoolGameState {
  return {
    balls: rackBalls(cfg, seed),
    turn: firstBreaker,
    groups: [null, null],
    open: true,
    breakPending: true,
    ballInHand: false,
    calledPocket: null,
    pending: null,
    winner: null,
    message: `${firstBreaker === 0 ? 'Player 1' : 'Player 2'} breaks.`,
    shots: 0,
  };
}

export function groupOf(id: number): Group | null {
  return isSolid(id) ? 'solid' : isStripe(id) ? 'stripe' : null;
}

export function remaining(balls: Ball[], group: Group): number {
  return balls.filter((b) => b.active && groupOf(b.id) === group).length;
}

/** The shooter has cleared their group and is on the eight. */
export function onTheEight(state: PoolGameState, slot: 0 | 1 = state.turn): boolean {
  const g = state.groups[slot];
  return g !== null && remaining(state.balls, g) === 0;
}

/** Ids the shooter may legally contact first. */
export function legalFirstContacts(state: PoolGameState, slot: 0 | 1 = state.turn): number[] {
  const active = state.balls.filter((b) => b.active && b.id !== 0).map((b) => b.id);
  if (state.open) return active.filter((id) => id !== 8);
  if (onTheEight(state, slot)) return active.filter((id) => id === 8);
  return active.filter((id) => groupOf(id) === state.groups[slot]);
}

function respotEight(balls: Ball[], cfg: PoolConfig): Ball[] {
  const out = balls.map((b) => ({ ...b }));
  const eight = out.find((b) => b.id === 8)!;
  const spot = findFreeSpot(out.filter((b) => b.id !== 8), cfg);
  eight.active = true; eight.x = spot.x; eight.z = spot.z; eight.vx = 0; eight.vz = 0;
  return out;
}

function withCueBallBack(balls: Ball[]): Ball[] {
  // Scratched cue ball comes back as inactive-at-rest; the shooter with ball in hand will place it.
  return balls.map((b) => (b.id === 0 ? { ...b, active: true, vx: 0, vz: 0 } : b));
}

/** Is the layout legal for a break: pocketed something or four object balls to rails. */
export function isLegalBreak(events: ShotEvents): boolean {
  return events.pocketed.length > 0 || events.objectBallsToRail.length >= 4;
}

/**
 * Apply the result of a shot. `ballsAfter` is the resting layout from the simulation and `events`
 * the recorded shot events. Returns the next game state.
 */
export function applyShotResult(state: PoolGameState, ballsAfter: Ball[], events: ShotEvents, cfg: PoolConfig = DEFAULT_POOL): PoolGameState {
  if (state.winner !== null) return state;
  const me = state.turn;
  const opp = other(me);
  let balls = ballsAfter.map((b) => ({ ...b }));
  const next: PoolGameState = { ...state, balls, shots: state.shots + 1, ballInHand: false, calledPocket: null, pending: null, message: '' };
  const eightPocketed = events.pocketed.includes(8);

  if (state.breakPending) {
    next.breakPending = false;
    const legal = isLegalBreak(events);
    if (eightPocketed) {
      balls = respotEight(balls, cfg);
      next.balls = balls;
      next.message = 'Eight ball on the break: respotted. ';
    }
    if (events.scratched) {
      next.balls = withCueBallBack(next.balls);
      next.turn = opp;
      next.ballInHand = true;
      next.message += 'Scratch on the break. Ball in hand.';
      return next;
    }
    if (!legal) {
      next.pending = { type: 'illegalBreak', by: opp };
      next.message += 'Illegal break (no ball pocketed and fewer than 4 balls to a rail). Opponent chooses: accept the table or rerack.';
      return next;
    }
    const objectPocketed = events.pocketed.filter((id) => id !== 8);
    if (objectPocketed.length > 0) {
      next.message += 'Legal break. Table is open: keep shooting.';
      return next; // same shooter, table still open
    }
    next.turn = opp;
    next.message += 'Legal break. Table is open.';
    return next;
  }

  // ---- Normal shot ----
  const legalFirst = legalFirstContacts(state, me);
  let foul: string | null = null;
  if (events.scratched) foul = 'Scratch!';
  else if (events.firstContact === null) foul = 'No ball contacted.';
  else if (!legalFirst.includes(events.firstContact)) {
    foul = events.firstContact === 8 ? 'Hit the eight first.' : state.open ? 'Illegal first contact.' : `Hit ${groupOf(events.firstContact) === 'solid' ? 'a solid' : 'a stripe'} first; you are ${state.groups[me] === 'solid' ? 'solids' : 'stripes'}.`;
  } else if (events.pocketed.length === 0 && events.railsAfterContact.length === 0) {
    foul = 'No ball reached a rail after contact.';
  }

  if (eightPocketed) {
    const wasOnEight = onTheEight(state, me);
    const calledOk = state.calledPocket !== null && events.pocketIndex[8] === state.calledPocket;
    if (!foul && wasOnEight && calledOk) {
      next.winner = me;
      next.message = 'Eight ball in the called pocket. Game over!';
      return next;
    }
    next.winner = opp;
    next.message = foul ? `Eight ball down with a foul (${foul}) — loss.` : !wasOnEight ? 'Eight ball pocketed too early — loss.' : 'Eight ball in the wrong pocket — loss.';
    return next;
  }

  if (foul) {
    next.balls = withCueBallBack(next.balls);
    next.turn = opp;
    next.ballInHand = true;
    next.message = `Foul: ${foul} Ball in hand.`;
    return next;
  }

  const pocketedSolids = events.pocketed.filter(isSolid);
  const pocketedStripes = events.pocketed.filter(isStripe);
  if (state.open && (pocketedSolids.length || pocketedStripes.length)) {
    if (pocketedSolids.length && pocketedStripes.length) {
      next.pending = { type: 'chooseGroup', by: me };
      next.message = 'Both groups pocketed: choose solids or stripes.';
      return next;
    }
    const g: Group = pocketedSolids.length ? 'solid' : 'stripe';
    next.groups = [me === 0 ? g : g === 'solid' ? 'stripe' : 'solid', me === 1 ? g : g === 'solid' ? 'stripe' : 'solid'];
    next.open = false;
    next.message = `You are ${g === 'solid' ? 'SOLIDS' : 'STRIPES'}. Keep shooting.`;
    return next;
  }
  const myGroup = state.groups[me];
  const pocketedOwn = myGroup ? events.pocketed.filter((id) => groupOf(id) === myGroup).length > 0 : false;
  if (pocketedOwn) {
    next.message = onTheEight(next, me) ? 'Group cleared! Call a pocket for the eight.' : 'Nice. Keep shooting.';
    return next;
  }
  next.turn = opp;
  next.message = events.pocketed.length ? 'Pocketed the wrong group. Turn passes.' : 'Nothing dropped. Turn passes.';
  return next;
}

/** Shooter picks a group after pocketing both kinds on an open table. */
export function chooseGroup(state: PoolGameState, group: Group): PoolGameState {
  if (!state.pending || state.pending.type !== 'chooseGroup') return state;
  const me = state.pending.by;
  const otherG: Group = group === 'solid' ? 'stripe' : 'solid';
  const groups: [Group | null, Group | null] = me === 0 ? [group, otherG] : [otherG, group];
  return { ...state, groups, open: false, pending: null, message: `${group === 'solid' ? 'Solids' : 'Stripes'} chosen. Keep shooting.` };
}

/** Opponent's response to an illegal break. */
export function resolveIllegalBreak(state: PoolGameState, choice: 'accept' | 'rerack', cfg: PoolConfig = DEFAULT_POOL): PoolGameState {
  if (!state.pending || state.pending.type !== 'illegalBreak') return state;
  const chooser = state.pending.by;
  if (choice === 'accept') {
    return { ...state, pending: null, turn: chooser, ballInHand: true, message: 'Table accepted with ball in hand.' };
  }
  return { ...state, balls: rackBalls(cfg, state.shots + 17), pending: null, turn: chooser, breakPending: true, ballInHand: false, open: true, message: 'Reracked. New break.' };
}

export function callPocket(state: PoolGameState, pocketIndex: number | null): PoolGameState {
  return { ...state, calledPocket: pocketIndex };
}

/** Place the cue ball (ball in hand). Returns null if the spot is not allowed. */
export function placeCueBall(state: PoolGameState, x: number, z: number, cfg: PoolConfig = DEFAULT_POOL): PoolGameState | null {
  const r = cfg.ballR;
  if (x < r || x > cfg.tableW - r || z < r || z > cfg.tableL - r) return null;
  if (state.balls.some((b) => b.active && b.id !== 0 && Math.hypot(b.x - x, b.z - z) < r * 2.02)) return null;
  const balls = state.balls.map((b) => (b.id === 0 ? { ...b, x, z, vx: 0, vz: 0, active: true } : b));
  return { ...state, balls };
}

/** Whether the shooter must call a pocket before shooting. */
export function needsCall(state: PoolGameState): boolean {
  return !state.breakPending && onTheEight(state) && state.calledPocket === null;
}

export const POCKET_NAMES = ['near left', 'near right', 'side left', 'side right', 'far left', 'far right'];
