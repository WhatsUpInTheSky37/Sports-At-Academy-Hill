import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CHARACTERS, displayName } from '../src/core/characters';
import { defaultSetup, formatLabel, hasAllTimeQb, normalizeSetup, setupCharacters, teamSize } from '../src/games/football/teams';

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
    // every kid has a distinct jersey number and accent colour
    expect(new Set(CHARACTER_IDS.map((id) => CHARACTERS[id].number)).size).toBe(7);
    expect(new Set(CHARACTER_IDS.map((id) => CHARACTERS[id].accent)).size).toBe(7);
  });
});

describe('football team setup', () => {
  it('knows the team size and labels for each format', () => {
    expect(teamSize('2v2')).toBe(2);
    expect(teamSize('3v3')).toBe(3);
    expect(teamSize('3v3qb')).toBe(3);
    expect(hasAllTimeQb('3v3qb')).toBe(true);
    expect(hasAllTimeQb('3v3')).toBe(false);
    expect(formatLabel('3v3qb')).toBe('3 ON 3 ALL-TIME QB');
  });

  it('keeps the picks in order, drops duplicates and fills empty spots from the unpicked kids', () => {
    const s = normalizeSetup('3v3', [['jimmy', 'will'], ['will', 'ben', 'ben', 'dan']], null);
    expect(s.rosters[0]).toEqual(['jimmy', 'will', 'vinnie']); // vinnie is the first unpicked kid
    expect(s.rosters[1]).toEqual(['ben', 'dan', 'bryan']);
    expect(new Set([...s.rosters[0], ...s.rosters[1]]).size).toBe(6);
  });

  it('cuts oversized picks to the team size', () => {
    const s = normalizeSetup('2v2', [['will', 'vinnie', 'bryan'], ['ben', 'dan', 'jimmy']], null);
    expect(s.rosters[0]).toEqual(['will', 'vinnie']);
    expect(s.rosters[1]).toEqual(['ben', 'dan']);
  });

  it('reserves the all-time QB off both rosters and picks one when none was chosen', () => {
    const s = normalizeSetup('3v3qb', [['will', 'dan', 'bryan'], ['vinnie', 'ben', 'jimmy']], 'dan');
    expect(s.qb).toBe('dan');
    expect(s.rosters[0]).toEqual(['will', 'bryan', 'billy']); // dan is the QB, so he leaves the roster
    expect(s.rosters[1]).toEqual(['vinnie', 'ben', 'jimmy']);
    expect(setupCharacters(s)).toHaveLength(7);
    const auto = normalizeSetup('3v3qb', [['will', 'dan', 'bryan'], ['vinnie', 'ben', 'jimmy']], null);
    expect(auto.qb).toBe('billy');
    expect(setupCharacters(auto)).toHaveLength(7);
    expect(new Set(setupCharacters(auto)).size).toBe(7);
  });

  it('defaults to the classic two-on-two with each captain plus a spare kid', () => {
    const s = defaultSetup('will', 'vinnie');
    expect(s.format).toBe('2v2');
    expect(s.rosters[0][0]).toBe('will');
    expect(s.rosters[1][0]).toBe('vinnie');
    expect(s.rosters[0]).toHaveLength(2);
    expect(s.rosters[1]).toHaveLength(2);
    expect(new Set(setupCharacters(s)).size).toBe(4);
  });
});
