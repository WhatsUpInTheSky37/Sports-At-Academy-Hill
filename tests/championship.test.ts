import { describe, expect, it } from 'vitest';
import { CLINCH_POINTS, champion, createChampionship, currentEvent, isComplete, markClinchAnnounced, needsClinchAnnouncement, recordEventResult } from '../src/core/championship';
import { GAME_ORDER } from '../src/core/constants';

describe('championship', () => {
  it('plays the seven games in order ending with darts', () => {
    const s = createChampionship();
    expect(s.events).toEqual(['derby', 'horse', 'pool', 'wrestling', 'hockey', 'football', 'darts']);
    expect(s.events).toEqual(GAME_ORDER);
    expect(currentEvent(s)).toBe('derby');
    expect(s.events[s.events.length - 1]).toBe('darts');
  });

  it('awards one point per event win and advances', () => {
    let s = createChampionship();
    s = recordEventResult(s, 0);
    expect(s.points).toEqual([1, 0]);
    expect(currentEvent(s)).toBe('horse');
    s = recordEventResult(s, 1);
    expect(s.points).toEqual([1, 1]);
    expect(s.results).toEqual([0, 1]);
  });

  it('announces a clinch at four wins but keeps playing all events', () => {
    let s = createChampionship();
    for (let i = 0; i < 4; i++) s = recordEventResult(s, 1);
    expect(s.clinchedBy).toBe(1);
    expect(needsClinchAnnouncement(s)).toBe(true);
    expect(isComplete(s)).toBe(false);
    expect(currentEvent(s)).toBe('hockey');
    s = markClinchAnnounced(s);
    expect(needsClinchAnnouncement(s)).toBe(false);
    s = recordEventResult(s, 0);
    s = recordEventResult(s, 0);
    s = recordEventResult(s, 0);
    expect(isComplete(s)).toBe(true);
    expect(s.points).toEqual([3, 4]);
    expect(champion(s)).toBe(1);
    expect(CLINCH_POINTS).toBe(4);
  });

  it('a 7-0 sweep still records all seven results', () => {
    let s = createChampionship();
    for (let i = 0; i < 7; i++) s = recordEventResult(s, 0);
    expect(s.results.length).toBe(7);
    expect(champion(s)).toBe(0);
    expect(() => recordEventResult(s, 0)).toThrow();
  });

  it('has no champion until complete', () => {
    let s = createChampionship();
    s = recordEventResult(s, 0);
    expect(champion(s)).toBeNull();
  });
});
