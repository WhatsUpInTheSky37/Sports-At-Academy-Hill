import { GAME_ORDER, type GameId } from './constants';

export interface ChampionshipState {
  events: GameId[];
  /** Index of the next event to play. */
  index: number;
  points: [number, number];
  /** winnerSlot per completed event. */
  results: (0 | 1)[];
  /** Slot that first reached CLINCH_POINTS, if any, and whether it has been announced. */
  clinchedBy: 0 | 1 | null;
  clinchAnnounced: boolean;
}

export const CLINCH_POINTS = 4;

export function createChampionship(events: GameId[] = GAME_ORDER): ChampionshipState {
  return { events: [...events], index: 0, points: [0, 0], results: [], clinchedBy: null, clinchAnnounced: false };
}

export function currentEvent(state: ChampionshipState): GameId | null {
  return state.index < state.events.length ? state.events[state.index] : null;
}

export function isComplete(state: ChampionshipState): boolean {
  return state.index >= state.events.length;
}

/** Record the winner of the current event and advance. Returns a new state. */
export function recordEventResult(state: ChampionshipState, winnerSlot: 0 | 1): ChampionshipState {
  if (isComplete(state)) throw new Error('Championship already complete');
  const points: [number, number] = [state.points[0], state.points[1]];
  points[winnerSlot] += 1;
  let clinchedBy = state.clinchedBy;
  if (clinchedBy === null && points[winnerSlot] >= CLINCH_POINTS) clinchedBy = winnerSlot;
  return {
    ...state,
    points,
    results: [...state.results, winnerSlot],
    index: state.index + 1,
    clinchedBy,
  };
}

export function markClinchAnnounced(state: ChampionshipState): ChampionshipState {
  return { ...state, clinchAnnounced: true };
}

/** True when a clinch happened and has not been announced yet. */
export function needsClinchAnnouncement(state: ChampionshipState): boolean {
  return state.clinchedBy !== null && !state.clinchAnnounced;
}

/** Final champion once all events are complete. Seven events means no ties are possible. */
export function champion(state: ChampionshipState): 0 | 1 | null {
  if (!isComplete(state)) return null;
  if (state.points[0] === state.points[1]) return null;
  return state.points[0] > state.points[1] ? 0 : 1;
}
