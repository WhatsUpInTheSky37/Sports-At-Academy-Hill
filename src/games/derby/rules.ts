/** Home Run Derby rules, independent of rendering. */

export interface DerbyRulesConfig {
  outsPerRound: number;
  tiebreakOuts: number;
}

export const DEFAULT_DERBY_RULES: DerbyRulesConfig = { outsPerRound: 10, tiebreakOuts: 3 };

export type SwingOutcome = 'homerun' | 'out' | 'take';

export interface DerbyState {
  scores: [number, number];
  outs: [number, number];
  /** Who is batting now. */
  batter: 0 | 1;
  /** 1 = main round, 2+ = tiebreak rounds. */
  round: number;
  /** Outs available in the current round. */
  outsLimit: number;
  /** Which slots have completed their at-bat in the current round. */
  finishedThisRound: [boolean, boolean];
  phase: 'batting' | 'switch' | 'done';
  winner: 0 | 1 | null;
  /** Set when a new round (tiebreak) has just begun. */
  newRound: boolean;
}

export function createDerby(cfg: DerbyRulesConfig = DEFAULT_DERBY_RULES, firstBatter: 0 | 1 = 0): DerbyState {
  return {
    scores: [0, 0],
    outs: [0, 0],
    batter: firstBatter,
    round: 1,
    outsLimit: cfg.outsPerRound,
    finishedThisRound: [false, false],
    phase: 'batting',
    winner: null,
    newRound: false,
  };
}

function other(s: 0 | 1): 0 | 1 { return s === 0 ? 1 : 0; }

/** Apply one swing result for the current batter and return the next state. */
export function applyOutcome(state: DerbyState, outcome: SwingOutcome, cfg: DerbyRulesConfig = DEFAULT_DERBY_RULES): DerbyState {
  if (state.phase === 'done') return state;
  const s: DerbyState = {
    ...state,
    scores: [state.scores[0], state.scores[1]],
    outs: [state.outs[0], state.outs[1]],
    finishedThisRound: [state.finishedThisRound[0], state.finishedThisRound[1]],
    newRound: false,
    phase: 'batting',
  };
  const b = s.batter;
  if (outcome === 'homerun') s.scores[b] += 1;
  else if (outcome === 'out') s.outs[b] += 1;
  if (s.outs[b] >= s.outsLimit) {
    s.finishedThisRound[b] = true;
    if (s.finishedThisRound[0] && s.finishedThisRound[1]) {
      if (s.scores[0] !== s.scores[1]) {
        s.phase = 'done';
        s.winner = s.scores[0] > s.scores[1] ? 0 : 1;
      } else {
        // Tie: extra round with fewer outs, same batting order as the round that just ended.
        s.round += 1;
        s.outsLimit = cfg.tiebreakOuts;
        s.outs = [0, 0];
        s.finishedThisRound = [false, false];
        s.batter = other(b); // the player who batted first this round leads off again
        s.phase = 'switch';
        s.newRound = true;
      }
    } else {
      s.batter = other(b);
      s.phase = 'switch';
    }
  }
  return s;
}

/** Called by the presentation layer once the "switch batter" moment has been shown. */
export function acknowledgeSwitch(state: DerbyState): DerbyState {
  if (state.phase !== 'switch') return state;
  return { ...state, phase: 'batting', newRound: false };
}

export function outsRemaining(state: DerbyState, slot: 0 | 1): number {
  return Math.max(0, state.outsLimit - state.outs[slot]);
}
