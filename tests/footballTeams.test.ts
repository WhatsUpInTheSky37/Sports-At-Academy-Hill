import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CHARACTERS, displayName } from '../src/core/characters';
import { defaultSetup, formatLabel, normalizeSetup, setupCharacters } from '../src/games/football/teams';
import { ROUTES, playMenu } from '../src/games/football/sim';

describe('the roster', () => {
  it('has the seven kids with roster names', () => {
    expect(CHARACTER_IDS).toEqual(['will', 'vinnie', 'bryan', 'ben', 'dan', 'jimmy', 'billy']);
    expect(displayName(CHARACTERS.will)).toBe('Will F');
    expect(displayName(CHARACTERS.vinnie)).toBe('Vinnie G');
    expect(displayName(CHARACTERS.ben)).toBe('Ben L');
    expect(displayName(CHARACTERS.bryan)).toBe('Bryan B');
    expect(displayName(CHARACTERS.dan)).toBe('Dan R');
    expect(displayName(CHARACTERS.jimmy)).toBe('Jimmy "Boner" K');
    expect(displayName(CHARACTERS.billy)).toBe('Billy D');
    expect(new Set(CHARACTER_IDS.map((id) => CHARACTERS[id].number)).size).toBe(7);
    expect(new Set(CHARACTER_IDS.map((id) => CHARACTERS[id].accent)).size).toBe(7);
  });
});

describe('football team setup', () => {
  it('labels the formats', () => {
    expect(formatLabel(1, false)).toBe('1 ON 1');
    expect(formatLabel(2, true)).toBe('2 ON 2 + ALL-TIME QB');
  });

  it('keeps the picks in order, drops duplicates and fills empty spots from the unpicked kids', () => {
    const s = normalizeSetup(2, false, [['jimmy'], ['will', 'jimmy', 'ben', 'dan']], null);
    expect(s.rosters[0]).toEqual(['jimmy', 'vinnie']); // vinnie is the first unpicked kid
    expect(s.rosters[1]).toEqual(['will', 'ben']);
    expect(new Set([...s.rosters[0], ...s.rosters[1]]).size).toBe(4);
  });

  it('cuts oversized picks to the team size', () => {
    const s = normalizeSetup(1, false, [['will', 'vinnie', 'bryan'], ['ben', 'dan', 'jimmy']], null);
    expect(s.rosters[0]).toEqual(['will']);
    expect(s.rosters[1]).toEqual(['ben']);
  });

  it('reserves the all-time QB off both rosters and picks one when none was chosen', () => {
    const s = normalizeSetup(2, true, [['will', 'dan'], ['vinnie', 'ben']], 'dan');
    expect(s.qb).toBe('dan');
    expect(s.rosters[0]).toEqual(['will', 'bryan']); // dan is the QB, so he leaves the roster
    expect(s.rosters[1]).toEqual(['vinnie', 'ben']);
    expect(setupCharacters(s)).toHaveLength(5);
    const auto = normalizeSetup(1, true, [['will'], ['vinnie']], null);
    expect(auto.qb).toBe('bryan');
    expect(new Set(setupCharacters(auto)).size).toBe(3);
    const off = normalizeSetup(2, false, [['will'], ['vinnie']], 'dan');
    expect(setupCharacters(off)).toHaveLength(4); // no QB on the field when the option is off
  });

  it('defaults to the classic two-on-two with each captain plus a spare kid', () => {
    const s = defaultSetup('will', 'vinnie');
    expect(s.size).toBe(2);
    expect(s.allTime).toBe(false);
    expect(s.rosters[0][0]).toBe('will');
    expect(s.rosters[1][0]).toBe('vinnie');
    expect(new Set(setupCharacters(s)).size).toBe(4);
  });
});

describe('play calling', () => {
  it('offers four distinct routes for one receiver and none for no receivers', () => {
    expect(playMenu(0)).toEqual([]);
    const m = playMenu(1, () => 0.5);
    expect(m).toHaveLength(4);
    expect(new Set(m.map((p) => p.routes[0])).size).toBe(4);
    for (const p of m) { expect(ROUTES).toContain(p.routes[0]); expect(p.name).toBe(p.routes[0].toUpperCase()); }
  });

  it('offers two-route combinations for two receivers with different routes inside each play', () => {
    const m = playMenu(2, () => 0.3);
    expect(m).toHaveLength(4);
    for (const p of m) {
      expect(p.routes).toHaveLength(2);
      expect(p.routes[0]).not.toBe(p.routes[1]);
      expect(p.name).toBe(`${p.routes[0].toUpperCase()} + ${p.routes[1].toUpperCase()}`);
    }
  });
});
