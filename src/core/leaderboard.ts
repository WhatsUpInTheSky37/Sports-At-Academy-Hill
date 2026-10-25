/**
 * Online high scores. The game is a static site, so the browser talks straight to a small Supabase
 * table with the project's public key: anyone can read the board and post a bounded score, and nothing
 * can be edited or removed. Every call is best-effort: no network, no board, the game carries on.
 */
import type { CharacterId } from './characters';
import type { Difficulty, GameId } from './constants';
import type { MatchConfig, MatchResult } from './match';

export const LEADERBOARD = {
  url: 'https://zkefxhjslolsxjquynmx.supabase.co',
  key: 'sb_publishable_mNTCN1110et5STDT-VRnvg_jUonqoB7',
  table: 'academy_hill_scores',
  timeoutMs: 7000,
};

export type ScoreDifficulty = Difficulty | 'local';

export interface ScoreEntry {
  id?: number;
  game: GameId;
  character: CharacterId;
  score: number;
  difficulty: ScoreDifficulty;
  detail?: string | null;
  created_at?: string;
}

export interface ScoreMeta {
  /** What the number is, for the board header ("Home runs"). */
  label: string;
  /** Smaller numbers rank higher (darts thrown, seconds to a pin). */
  lowerIsBetter: boolean;
  /** Only the winner's number means anything (a loser in HORSE always has five letters). */
  winnersOnly: boolean;
  format: (n: number) => string;
}

const plain = (n: number) => String(n);
const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

export const SCORE_META: Record<GameId, ScoreMeta> = {
  derby: { label: 'Home runs', lowerIsBetter: false, winnersOnly: false, format: plain },
  horse: { label: 'Letters taken (win)', lowerIsBetter: true, winnersOnly: true, format: plain },
  pool: { label: "Opponent's balls left (win)", lowerIsBetter: false, winnersOnly: true, format: plain },
  wrestling: { label: 'Time to the pin', lowerIsBetter: true, winnersOnly: true, format: mmss },
  hockey: { label: 'Goals', lowerIsBetter: false, winnersOnly: false, format: plain },
  football: { label: 'Points', lowerIsBetter: false, winnersOnly: false, format: plain },
  darts: { label: 'Darts to check out', lowerIsBetter: true, winnersOnly: true, format: plain },
};

/** The entries a finished match should post: one per person who played (never the CPU). */
export function entriesFor(match: MatchConfig, result: MatchResult): ScoreEntry[] {
  if (!result.points) return [];
  const meta = SCORE_META[match.gameId];
  const out: ScoreEntry[] = [];
  for (const slot of [0, 1] as const) {
    const p = match.players[slot];
    if (p.isAI) continue;
    if (meta.winnersOnly && result.winnerSlot !== slot) continue;
    const score = Math.round(result.points[slot]);
    if (!Number.isFinite(score) || score < 0) continue;
    out.push({ game: match.gameId, character: p.character.id, score, difficulty: match.mode === 'single' ? match.difficulty : 'local', detail: result.summary.slice(0, 80) });
  }
  return out;
}

/** Rank from how many posted scores beat this one. */
export function rankFromCount(better: number): number { return better + 1; }

/** Sort entries the way the board shows them. */
export function sortEntries(game: GameId, entries: ScoreEntry[]): ScoreEntry[] {
  const lower = SCORE_META[game].lowerIsBetter;
  return [...entries].sort((a, b) => (lower ? a.score - b.score : b.score - a.score) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: LEADERBOARD.key, Authorization: `Bearer ${LEADERBOARD.key}`, 'Content-Type': 'application/json', ...extra };
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LEADERBOARD.timeoutMs);
  try {
    return await fetch(`${LEADERBOARD.url}/rest/v1/${LEADERBOARD.table}${path}`, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Top entries for a game (best first). Throws when the board cannot be reached. */
export async function fetchTop(game: GameId, limit = 10): Promise<ScoreEntry[]> {
  const order = SCORE_META[game].lowerIsBetter ? 'score.asc,created_at.asc' : 'score.desc,created_at.asc';
  const res = await call(`?game=eq.${game}&select=id,game,character,score,difficulty,detail,created_at&order=${order}&limit=${limit}`, { method: 'GET', headers: headers() });
  if (!res.ok) throw new Error(`board ${res.status}`);
  return (await res.json()) as ScoreEntry[];
}

/** Post a score and return its rank on the board (1 = best), or null if the board could not be reached. */
export async function submitScore(entry: ScoreEntry): Promise<number | null> {
  const body = { game: entry.game, character: entry.character, score: entry.score, difficulty: entry.difficulty, detail: entry.detail ?? null };
  const res = await call('', { method: 'POST', headers: headers({ Prefer: 'return=minimal' }), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`post ${res.status}`);
  const lower = SCORE_META[entry.game].lowerIsBetter;
  const cmp = lower ? `score=lt.${entry.score}` : `score=gt.${entry.score}`;
  const count = await call(`?game=eq.${entry.game}&${cmp}&select=id&limit=1`, { method: 'GET', headers: headers({ Prefer: 'count=exact' }) });
  if (!count.ok) return null;
  const range = count.headers.get('content-range') ?? '';
  const total = parseInt(range.split('/')[1] ?? '', 10);
  return Number.isFinite(total) ? rankFromCount(total) : null;
}
