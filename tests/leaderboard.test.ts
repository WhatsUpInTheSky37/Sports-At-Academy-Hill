import { describe, expect, it } from 'vitest';
import { SCORE_META, entriesFor, rankFromCount, sortEntries, type ScoreEntry } from '../src/core/leaderboard';
import { buildMatch, type MatchResult } from '../src/core/match';
import { GAME_ORDER } from '../src/core/constants';

const res = (winnerSlot: 0 | 1, points: [number, number]): MatchResult => ({ winnerSlot, summary: 'x', scores: ['a', 'b'], points });

describe('high scores', () => {
  it('every game has a metric', () => {
    for (const g of GAME_ORDER) expect(SCORE_META[g].label.length).toBeGreaterThan(0);
    expect(SCORE_META.wrestling.format(125)).toBe('2:05');
    expect(SCORE_META.derby.format(7)).toBe('7');
  });

  it('posts only people, with the difficulty, and never the CPU', () => {
    const m = buildMatch('derby', { mode: 'single', difficulty: 'hard', p1: 'will', p2: 'vinnie' });
    const e = entriesFor(m, res(1, [4, 9]));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ game: 'derby', character: 'will', score: 4, difficulty: 'hard' });
    const local = buildMatch('hockey', { mode: 'local', difficulty: 'normal', p1: 'dan', p2: 'billy' });
    expect(entriesFor(local, res(0, [3, 2])).map((x) => `${x.character}:${x.score}:${x.difficulty}`)).toEqual(['dan:3:local', 'billy:2:local']);
  });

  it('winner-only games post the winner alone, and nothing posts without numbers', () => {
    const m = buildMatch('darts', { mode: 'local', difficulty: 'normal', p1: 'will', p2: 'ben' });
    expect(entriesFor(m, res(1, [30, 30])).map((x) => x.character)).toEqual(['ben']);
    expect(entriesFor(m, { winnerSlot: 0, summary: 'x', scores: ['a', 'b'] })).toEqual([]);
  });

  it('ranks from how many beat you and sorts each board the right way', () => {
    expect(rankFromCount(0)).toBe(1);
    expect(rankFromCount(4)).toBe(5);
    const rows: ScoreEntry[] = [
      { game: 'darts', character: 'will', score: 30, difficulty: 'easy', created_at: '2026-01-02' },
      { game: 'darts', character: 'ben', score: 24, difficulty: 'easy', created_at: '2026-01-03' },
      { game: 'darts', character: 'dan', score: 24, difficulty: 'easy', created_at: '2026-01-01' },
    ];
    expect(sortEntries('darts', rows).map((r) => r.character)).toEqual(['dan', 'ben', 'will']);
    expect(sortEntries('derby', rows).map((r) => r.character)).toEqual(['will', 'dan', 'ben']);
  });
});
