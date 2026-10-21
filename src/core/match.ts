import { CHARACTERS, type Character, type CharacterId } from './characters';
import type { Difficulty, GameId, Mode } from './constants';
import type { ChampionshipState } from './championship';
import { Storage } from './storage';

export interface PlayerInfo {
  slot: 0 | 1;
  character: Character;
  isAI: boolean;
}

export interface MatchConfig {
  gameId: GameId;
  mode: Mode;
  difficulty: Difficulty;
  players: [PlayerInfo, PlayerInfo];
  championship?: ChampionshipState;
}

export interface MatchResult {
  winnerSlot: 0 | 1;
  /** Short result line, e.g. "7 - 5 home runs". */
  summary: string;
  /** Per-player score strings for the result card. */
  scores: [string, string];
}

export function buildMatch(gameId: GameId, opts: { mode: Mode; difficulty: Difficulty; p1: CharacterId; p2: CharacterId; championship?: ChampionshipState }): MatchConfig {
  return {
    gameId,
    mode: opts.mode,
    difficulty: opts.difficulty,
    players: [
      { slot: 0, character: CHARACTERS[opts.p1], isAI: false },
      { slot: 1, character: CHARACTERS[opts.p2], isAI: opts.mode === 'single' },
    ],
    championship: opts.championship,
  };
}

/** Persist a finished match to the records store. */
export function recordResult(match: MatchConfig, result: MatchResult): void {
  const winner = match.players[result.winnerSlot];
  const loser = match.players[result.winnerSlot === 0 ? 1 : 0];
  const vsAI = match.mode === 'single' ? { difficulty: match.difficulty, humanWon: !winner.isAI } : undefined;
  Storage.recordMatch(match.gameId, winner.character.id, loser.character.id, vsAI);
}

/** Numeric parameters per difficulty that AI code can scale from. */
export function aiLevel(d: Difficulty): number {
  return d === 'easy' ? 0 : d === 'normal' ? 0.5 : 1;
}
