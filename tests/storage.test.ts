import { beforeEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/core/storage';

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe('storage', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
    Storage._reset();
  });

  it('provides defaults and persists settings', () => {
    expect(Storage.settings.difficulty).toBe('normal');
    Storage.updateSettings({ difficulty: 'hard', musicOn: false });
    Storage._reset();
    expect(Storage.settings.difficulty).toBe('hard');
    expect(Storage.settings.musicOn).toBe(false);
  });

  it('records wins and losses per game and character, and the vs-CPU tally', () => {
    Storage.recordMatch('derby', 'will', 'vinnie', { difficulty: 'normal', humanWon: true });
    Storage.recordMatch('derby', 'vinnie', 'will', { difficulty: 'normal', humanWon: false });
    Storage._reset();
    const r = Storage.records;
    expect(r.games.derby?.will).toEqual({ wins: 1, losses: 1 });
    expect(r.games.derby?.vinnie).toEqual({ wins: 1, losses: 1 });
    expect(r.vsAI.normal).toEqual({ wins: 1, losses: 1 });
    expect(r.matchesPlayed).toBe(2);
  });

  it('counts championships and can reset records', () => {
    Storage.recordChampionship('ben');
    expect(Storage.records.championships.ben).toBe(1);
    Storage.resetRecords();
    expect(Storage.records.championships.ben).toBeUndefined();
    expect(Storage.records.matchesPlayed).toBe(0);
  });

  it('survives corrupted saves', () => {
    localStorage.setItem('sports-at-academy-hill-v1', '{not json');
    Storage._reset();
    expect(Storage.settings.p1).toBe('will');
  });
});
