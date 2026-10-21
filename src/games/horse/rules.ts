/** HORSE rules, independent of rendering. */

export const LETTERS = ['H', 'O', 'R', 'S', 'E'] as const;
export const MAX_LETTERS = LETTERS.length;

export type HorsePhase = 'set' | 'match' | 'done';

export interface HorseState {
  /** Letters earned by each slot (0..5). */
  letters: [number, number];
  /** Who is currently setting shots. */
  setter: 0 | 1;
  /** Who shoots next. */
  shooter: 0 | 1;
  phase: HorsePhase;
  /** Spot index chosen by the setter (preserved for the matching attempt). */
  spot: number | null;
  winner: 0 | 1 | null;
  shotsTaken: number;
  /** Description of what just happened, for the presentation layer. */
  lastEvent: 'none' | 'set-made' | 'set-missed' | 'match-made' | 'match-missed';
}

function other(s: 0 | 1): 0 | 1 { return s === 0 ? 1 : 0; }

export function createHorse(firstSetter: 0 | 1 = 0): HorseState {
  return { letters: [0, 0], setter: firstSetter, shooter: firstSetter, phase: 'set', spot: null, winner: null, shotsTaken: 0, lastEvent: 'none' };
}

/** Setter chooses where to shoot from. Only legal in the set phase. */
export function chooseSpot(state: HorseState, spot: number): HorseState {
  if (state.phase !== 'set') return state;
  return { ...state, spot };
}

/** Apply the outcome of the current shooter's attempt. */
export function applyShot(state: HorseState, made: boolean): HorseState {
  if (state.phase === 'done') return state;
  const s: HorseState = { ...state, letters: [state.letters[0], state.letters[1]], shotsTaken: state.shotsTaken + 1 };
  if (state.phase === 'set') {
    if (made) {
      // Opponent must match from the same spot.
      s.phase = 'match';
      s.shooter = other(state.setter);
      s.lastEvent = 'set-made';
    } else {
      // Setter missed: roles flip, spot cleared.
      s.setter = other(state.setter);
      s.shooter = s.setter;
      s.phase = 'set';
      s.spot = null;
      s.lastEvent = 'set-missed';
    }
    return s;
  }
  // match phase
  const matcher = state.shooter;
  if (!made) {
    s.letters[matcher] += 1;
    s.lastEvent = 'match-missed';
    if (s.letters[matcher] >= MAX_LETTERS) {
      s.phase = 'done';
      s.winner = other(matcher);
      return s;
    }
  } else {
    s.lastEvent = 'match-made';
  }
  // Either way the original setter sets again.
  s.phase = 'set';
  s.shooter = state.setter;
  s.spot = null;
  return s;
}

/** "H O R _ _" style display string. */
export function lettersDisplay(n: number, blank = '–'): string {
  return LETTERS.map((l, i) => (i < n ? l : blank)).join(' ');
}
