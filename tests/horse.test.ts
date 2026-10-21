import { describe, expect, it } from 'vitest';
import { applyShot, chooseSpot, createHorse, lettersDisplay, MAX_LETTERS } from '../src/games/horse/rules';
import { DEFAULT_SHOT, FLICK, SPOTS, flickToShot, powerFromOffset, shotNoise, simulateShot, simulateShotPower } from '../src/games/horse/shot';

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

  it('power-factor and timing-offset shots agree', () => {
    const a = simulateShot(SPOTS[5], 150, 0.2, 0, DEFAULT_SHOT);
    const b = simulateShotPower(SPOTS[5], powerFromOffset(150, DEFAULT_SHOT), 0.2, 0, DEFAULT_SHOT);
    expect(b.points.length).toBe(a.points.length);
    expect(b.made).toBe(a.made);
    expect(b.timing).toBe('late');
  });

  it('a flick of the sweet length is a perfect-power shot; shorter is short, longer is long', () => {
    const W = 1080, H = 1920;
    const sweet = flickToShot(0, -FLICK.sweetPull * H, W, H);
    expect(sweet.powerFactor).toBeCloseTo(1, 5);
    expect(sweet.aimX).toBe(0);
    expect(flickToShot(0, -FLICK.sweetPull * H * 0.5, W, H).powerFactor).toBeCloseTo(0.5, 5);
    expect(flickToShot(0, -H, W, H).powerFactor).toBeCloseTo(FLICK.maxPull / FLICK.sweetPull, 5);
    expect(flickToShot(0, 200, W, H).powerFactor).toBe(0);
    expect(flickToShot(W * FLICK.lateralPull, -H * 0.3, W, H).aimX).toBeCloseTo(1, 5);
    expect(flickToShot(-W, -H * 0.3, W, H).aimX).toBe(-1);
    expect(simulateShotPower(SPOTS[0], sweet.powerFactor, sweet.aimX, 0, DEFAULT_SHOT).made).toBe(true);
  });

  it('shot noise grows with distance from the hoop', () => {
    const close = shotNoise(SPOTS[7]), deep = shotNoise(SPOTS[6]);
    expect(deep.powerSd).toBeGreaterThan(close.powerSd);
    expect(deep.aimSd).toBeGreaterThan(close.aimSd);
  });
});
