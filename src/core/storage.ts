import type { CharacterId } from './characters';
import type { TeamSize } from '../games/football/teams';
import type { Difficulty, GameId, Mode } from './constants';

export interface Settings {
  soundOn: boolean;
  musicOn: boolean;
  soundVolume: number; // 0..1
  musicVolume: number; // 0..1
  difficulty: Difficulty;
  mode: Mode;
  p1: CharacterId;
  p2: CharacterId;
  touch: 'auto' | 'on' | 'off';
  /** Derby batting: 'tap' = tap where the ball is when it arrives; 'classic' = aim reticle + SWING button. */
  derbyHitMode: 'tap' | 'classic';
  /** Turn-based games: 'skip' fast-forwards the CPU's turns (a button lets you watch), 'watch' plays them out. */
  cpuTurns: 'skip' | 'watch';
  /** Football: team size, the all-time-QB option, the two rosters (captain first) and who plays all-time QB. */
  footballSize: TeamSize;
  footballAllTime: boolean;
  footballTeams: [CharacterId[], CharacterId[]];
  footballQb: CharacterId;
  seenHowTo: Partial<Record<GameId, boolean>>;
}

export interface WinLoss { wins: number; losses: number; }

export interface Records {
  /** records[gameId][characterId] = wins/losses in that game for that character. */
  games: Partial<Record<GameId, Partial<Record<CharacterId, WinLoss>>>>;
  /** Human vs AI tally per difficulty. */
  vsAI: Record<Difficulty, WinLoss>;
  championships: Partial<Record<CharacterId, number>>;
  matchesPlayed: number;
}

interface SaveData { settings: Settings; records: Records; }

const KEY = 'sports-at-academy-hill-v1';

export const DEFAULT_SETTINGS: Settings = {
  soundOn: true,
  musicOn: true,
  soundVolume: 0.8,
  musicVolume: 0.5,
  difficulty: 'normal',
  mode: 'single',
  p1: 'will',
  p2: 'vinnie',
  touch: 'auto',
  derbyHitMode: 'tap',
  cpuTurns: 'skip',
  footballSize: 2,
  footballAllTime: false,
  footballTeams: [['will', 'bryan'], ['vinnie', 'ben']],
  footballQb: 'dan',
  seenHowTo: {},
};

export const DEFAULT_RECORDS: Records = {
  games: {},
  vsAI: { easy: { wins: 0, losses: 0 }, normal: { wins: 0, losses: 0 }, hard: { wins: 0, losses: 0 } },
  championships: {},
  matchesPlayed: 0,
};

function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }

let cache: SaveData | null = null;

function load(): SaveData {
  if (cache) return cache;
  let data: SaveData = { settings: clone(DEFAULT_SETTINGS), records: clone(DEFAULT_RECORDS) };
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      data = {
        settings: { ...clone(DEFAULT_SETTINGS), ...(parsed.settings ?? {}) },
        records: { ...clone(DEFAULT_RECORDS), ...(parsed.records ?? {}) },
      };
      data.records.vsAI = { ...clone(DEFAULT_RECORDS.vsAI), ...(data.records.vsAI ?? {}) };
    }
  } catch {
    /* corrupted or unavailable storage: fall back to defaults */
  }
  cache = data;
  return data;
}

function save(): void {
  if (!cache) return;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full or disabled: play on without persistence */
  }
}

export const Storage = {
  get settings(): Settings { return load().settings; },
  get records(): Records { return load().records; },
  updateSettings(patch: Partial<Settings>): Settings {
    const d = load();
    d.settings = { ...d.settings, ...patch };
    save();
    return d.settings;
  },
  markHowToSeen(gameId: GameId): void {
    const d = load();
    d.settings.seenHowTo = { ...d.settings.seenHowTo, [gameId]: true };
    save();
  },
  recordMatch(gameId: GameId, winner: CharacterId, loser: CharacterId, humanWonVsAI?: { difficulty: Difficulty; humanWon: boolean }): void {
    const d = load();
    const g = (d.records.games[gameId] ??= {});
    const w = (g[winner] ??= { wins: 0, losses: 0 });
    const l = (g[loser] ??= { wins: 0, losses: 0 });
    w.wins += 1;
    l.losses += 1;
    d.records.matchesPlayed += 1;
    if (humanWonVsAI) {
      const t = d.records.vsAI[humanWonVsAI.difficulty];
      if (humanWonVsAI.humanWon) t.wins += 1; else t.losses += 1;
    }
    save();
  },
  recordChampionship(champion: CharacterId): void {
    const d = load();
    d.records.championships[champion] = (d.records.championships[champion] ?? 0) + 1;
    save();
  },
  resetRecords(): void {
    const d = load();
    d.records = clone(DEFAULT_RECORDS);
    save();
  },
  /** Test helper: drop the in-memory cache. */
  _reset(): void { cache = null; },
};
