import type { Hit } from './board';

/** 301, straight in, double out. Pure state machine independent of rendering. */

export interface DartsRulesConfig { startScore: number; dartsPerTurn: number; }
export const DEFAULT_DARTS_RULES: DartsRulesConfig = { startScore: 301, dartsPerTurn: 3 };

export type DartsEvent = 'none' | 'hit' | 'bust' | 'win' | 'turnEnd';

export interface DartsState {
  scores: [number, number];
  turn: 0 | 1;
  dartsThrown: number;
  /** Score at the start of the current turn (restored on a bust). */
  turnStart: number;
  turnHits: Hit[];
  /** Remaining score after each completed turn, per player (chalkboard history). */
  history: [number[], number[]];
  winner: 0 | 1 | null;
  /** What the last applyDart did. 'turnEnd' means the third dart ended the turn normally. */
  lastEvent: DartsEvent;
  /** True when the turn that just ended was a bust. */
  busted: boolean;
}

export function createGame(cfg: DartsRulesConfig = DEFAULT_DARTS_RULES, first: 0 | 1 = 0): DartsState {
  return {
    scores: [cfg.startScore, cfg.startScore],
    turn: first,
    dartsThrown: 0,
    turnStart: cfg.startScore,
    turnHits: [],
    history: [[], []],
    winner: null,
    lastEvent: 'none',
    busted: false,
  };
}

function endTurn(s: DartsState, busted: boolean): DartsState {
  const history: [number[], number[]] = [[...s.history[0]], [...s.history[1]]];
  history[s.turn].push(s.scores[s.turn]);
  const next: 0 | 1 = s.turn === 0 ? 1 : 0;
  return {
    ...s,
    history,
    turn: next,
    dartsThrown: 0,
    turnStart: s.scores[next],
    turnHits: [],
    lastEvent: busted ? 'bust' : 'turnEnd',
    busted,
  };
}

/** True if subtracting `points` from `remaining` with this hit would bust. */
export function isBust(remaining: number, hit: Hit): boolean {
  const left = remaining - hit.points;
  return left < 0 || left === 1 || (left === 0 && !hit.isDouble);
}

export function applyDart(state: DartsState, hit: Hit, cfg: DartsRulesConfig = DEFAULT_DARTS_RULES): DartsState {
  if (state.winner !== null) return state;
  const t = state.turn;
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  const turnHits = [...state.turnHits, hit];
  if (isBust(scores[t], hit)) {
    scores[t] = state.turnStart;
    return endTurn({ ...state, scores, turnHits }, true);
  }
  scores[t] -= hit.points;
  if (scores[t] === 0) {
    const history: [number[], number[]] = [[...state.history[0]], [...state.history[1]]];
    history[t].push(0);
    return { ...state, scores, turnHits, history, dartsThrown: state.dartsThrown + 1, winner: t, lastEvent: 'win', busted: false };
  }
  const s: DartsState = { ...state, scores, turnHits, dartsThrown: state.dartsThrown + 1, lastEvent: 'hit', busted: false };
  if (s.dartsThrown >= cfg.dartsPerTurn) return endTurn(s, false);
  return s;
}

export function turnTotal(state: DartsState): number {
  return state.turnHits.reduce((a, h) => a + h.points, 0);
}

export function dartsLeft(state: DartsState, cfg: DartsRulesConfig = DEFAULT_DARTS_RULES): number {
  return cfg.dartsPerTurn - state.dartsThrown;
}
