import { describe, expect, it } from 'vitest';
import { applyShot, chooseSpot, createHorse, lettersDisplay, MAX_LETTERS } from '../src/games/horse/rules';
import { DEFAULT_SHOT, SPOTS, simulateShot } from '../src/games/horse/shot';

describe('HORSE rules', () => {
  it('a made set shot puts the opponent on the clock from the same spot', () => {
    let s = createHorse(0);
    s = chooseSpot(s, 3);
    s = applyShot(s, true);
    expect(s.phase).toBe('match');
    expect(s.shooter).toBe(1);
    expect(s.setter).toBe(0);
    expect(s.spot).toBe(3);
  });

  it('missing the match earns a letter and the setter sets again', () => {
    let s = chooseSpot(createHorse(0), 0);
    s = applyShot(s, true);
    s = applyShot(s, false);
    expect(s.letters).toEqual([0, 1]);
    expect(s.phase).toBe('set');
    expect(s.shooter).toBe(0);
    expect(s.setter).toBe(0);
    expect(s.spot).toBeNull();
  });

  it('making the match earns nothing and the setter sets again', () => {
    let s = chooseSpot(createHorse(1), 2);
    s = applyShot(s, true);
    s = applyShot(s, true);
    expect(s.letters).toEqual([0, 0]);
    expect(s.setter).toBe(1);
    expect(s.shooter).toBe(1);
    expect(s.phase).toBe('set');
  });

  it('a setter miss flips the setter role', () => {
    let s = chooseSpot(createHorse(0), 5);
    s = applyShot(s, false);
    expect(s.setter).toBe(1);
    expect(s.shooter).toBe(1);
    expect(s.phase).toBe('set');
    expect(s.spot).toBeNull();
    expect(s.letters).toEqual([0, 0]);
  });

  it('choosing a spot is only allowed in the set phase', () => {
    let s = chooseSpot(createHorse(0), 1);
    s = applyShot(s, true);
    const same = chooseSpot(s, 7);
    expect(same.spot).toBe(1);
  });

  it('five letters ends the match with the setter as winner', () => {
    let s = createHorse(0);
    for (let i = 0; i < MAX_LETTERS; i++) {
      s = chooseSpot(s, 0);
      s = applyShot(s, true);
      s = applyShot(s, false);
    }
    expect(s.letters[1]).toBe(5);
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(0);
    // further shots are ignored
    expect(applyShot(s, true)).toBe(s);
  });

  it('formats letters', () => {
    expect(lettersDisplay(0, '_')).toBe('_ _ _ _ _');
    expect(lettersDisplay(3, '_')).toBe('H O R _ _');
  });
});

describe('HORSE shot physics', () => {
  it('a centred, perfectly timed free throw goes in', () => {
    const r = simulateShot(SPOTS[0], 0, 0, 0, DEFAULT_SHOT);
    expect(r.made).toBe(true);
    expect(r.timing).toBe('perfect');
    expect(r.events.some((e) => e.kind === 'swish')).toBe(true);
  });

  it('perfect releases score from every marked spot', () => {
    for (const spot of SPOTS) {
      const r = simulateShot(spot, 0, 0, 0, DEFAULT_SHOT);
      expect(r.made, spot.name).toBe(true);
    }
  });

  it('a very early release is short and misses', () => {
    const r = simulateShot(SPOTS[5], -450, 0, 0, DEFAULT_SHOT);
    expect(r.made).toBe(false);
    expect(r.timing).toBe('early');
    expect(r.events.some((e) => e.kind === 'ground')).toBe(true);
  });

  it('a hard sideways aim misses', () => {
    const r = simulateShot(SPOTS[0], 0, 1, 0, DEFAULT_SHOT);
    expect(r.made).toBe(false);
  });

  it('trajectory starts at the release point and obeys gravity', () => {
    const r = simulateShot(SPOTS[0], 0, 0, 0, DEFAULT_SHOT);
    expect(r.points[0].y).toBeCloseTo(DEFAULT_SHOT.releaseHeight, 5);
    const apex = Math.max(...r.points.map((p) => p.y));
    expect(apex).toBeGreaterThan(DEFAULT_SHOT.rimHeight);
  });
});
