import { describe, expect, it } from 'vitest';
import { FOOTBALL_CONFIG, canForwardPass, clampX, createFootball, endPlay, interception, outOfBoundsX, ownYardLine, yardsToGoal } from '../src/games/football/rules';
import { canCatch, isTouch, leadPoint, makePass, moveToward, passPosition } from '../src/games/football/sim';

const cfg = FOOTBALL_CONFIG;

describe('football rules', () => {
  it('starts at the offence\'s own 5 with first down', () => {
    const s = createFootball(cfg, 0);
    expect(s.offense).toBe(0);
    expect(s.down).toBe(1);
    expect(s.lineOfScrimmage).toBe(5);
    expect(ownYardLine(1, 5)).toBe(35);
  });

  it('advances the down on an incomplete pass and on a short tackle', () => {
    let s = createFootball(cfg, 0);
    s = endPlay(s, { type: 'incomplete' });
    expect(s.down).toBe(2);
    expect(s.lineOfScrimmage).toBe(5);
    s = endPlay(s, { type: 'tackled', spot: 9 });
    expect(s.down).toBe(3);
    expect(s.lineOfScrimmage).toBe(9);
    expect(s.offense).toBe(0);
  });

  it('turns the ball over on downs at the spot after the 4th down', () => {
    let s = createFootball(cfg, 0);
    s = { ...s, down: 4, lineOfScrimmage: 20 };
    s = endPlay(s, { type: 'tackled', spot: 24 });
    expect(s.offense).toBe(1);
    expect(s.down).toBe(1);
    expect(s.lineOfScrimmage).toBe(24);
    // and on an incomplete 4th-down pass, at the old line
    let t = { ...createFootball(cfg, 1), down: 4, lineOfScrimmage: 30 };
    t = endPlay(t, { type: 'incomplete' });
    expect(t.offense).toBe(0);
    expect(t.lineOfScrimmage).toBe(30);
  });

  it('scores 6 for a touchdown and gives the other team the ball at its own 5', () => {
    let s = createFootball(cfg, 0);
    s = endPlay(s, { type: 'touchdown' });
    expect(s.scores).toEqual([6, 0]);
    expect(s.offense).toBe(1);
    expect(s.lineOfScrimmage).toBe(35);
    expect(s.down).toBe(1);
    // being touched beyond the goal line also counts
    let t = createFootball(cfg, 1);
    t = endPlay(t, { type: 'tackled', spot: -0.5 });
    expect(t.scores).toEqual([0, 6]);
    expect(t.offense).toBe(0);
    expect(t.lineOfScrimmage).toBe(5);
  });

  it('flips possession immediately on an interception and spots the ball where the return ends', () => {
    let s = createFootball(cfg, 0);
    s = { ...s, down: 3, lineOfScrimmage: 15 };
    s = interception(s);
    expect(s.offense).toBe(1);
    expect(s.returning).toBe(true);
    s = endPlay(s, { type: 'tackled', spot: 22 });
    expect(s.offense).toBe(1);
    expect(s.down).toBe(1);
    expect(s.lineOfScrimmage).toBe(22);
    expect(s.returning).toBe(false);
    // a returned interception can score
    let t = interception({ ...createFootball(cfg, 0), lineOfScrimmage: 10 });
    t = endPlay(t, { type: 'touchdown' });
    expect(t.scores).toEqual([0, 6]);
    expect(t.offense).toBe(0);
  });

  it('awards a safety (2 points) to the defence and gives it the ball at its own 5', () => {
    let s = createFootball(cfg, 0);
    s = { ...s, lineOfScrimmage: 2 };
    s = endPlay(s, { type: 'tackled', spot: -1 });
    expect(s.scores).toEqual([0, 2]);
    expect(s.offense).toBe(1);
    expect(s.lineOfScrimmage).toBe(35);
    // team 1 touched in its own end zone (y >= 40)
    let t = { ...createFootball(cfg, 1), lineOfScrimmage: 38 };
    t = endPlay(t, { type: 'outOfBounds', spot: 41 });
    expect(t.scores).toEqual([2, 0]);
    expect(t.offense).toBe(0);
    expect(t.lineOfScrimmage).toBe(5);
    expect(endPlay(createFootball(cfg, 0), { type: 'safety' }).scores).toEqual([0, 2]);
  });

  it('spots out-of-bounds plays at the boundary and clamps x to the field', () => {
    let s = createFootball(cfg, 0);
    s = endPlay(s, { type: 'outOfBounds', spot: 17 });
    expect(s.lineOfScrimmage).toBe(17);
    expect(s.down).toBe(2);
    expect(clampX(40)).toBe(cfg.width / 2);
    expect(clampX(-40)).toBe(-cfg.width / 2);
    expect(outOfBoundsX(cfg.width / 2 + 0.1)).toBe(true);
    expect(outOfBoundsX(0)).toBe(false);
  });

  it('ends the game at 30 or more points', () => {
    let s = createFootball(cfg, 0);
    s = { ...s, scores: [24, 12] };
    s = endPlay(s, { type: 'touchdown' });
    expect(s.scores[0]).toBe(30);
    expect(s.winner).toBe(0);
    // no further changes after the winner is set
    const after = endPlay(s, { type: 'touchdown' });
    expect(after).toBe(s);
    let t = { ...createFootball(cfg, 0), scores: [10, 28] as [number, number] };
    t = endPlay(t, { type: 'safety' });
    expect(t.winner).toBe(1);
  });

  it('only allows a forward pass from behind the line of scrimmage', () => {
    expect(canForwardPass(0, 10, 12)).toBe(true);
    expect(canForwardPass(0, 12, 12)).toBe(true);
    expect(canForwardPass(0, 13, 12)).toBe(false);
    expect(canForwardPass(1, 30, 28)).toBe(true);
    expect(canForwardPass(1, 27, 28)).toBe(false);
  });

  it('reports yards to the goal line for both attack directions', () => {
    expect(yardsToGoal(0, 15)).toBe(25);
    expect(yardsToGoal(1, 15)).toBe(15);
  });
});

describe('football sim helpers', () => {
  it('moves toward a target and stops on arrival', () => {
    const m = { x: 0, y: 0, vx: 0, vy: 0 };
    moveToward(m, 3, 4, 10, 0.1);
    expect(m.x).toBeCloseTo(0.6);
    expect(m.y).toBeCloseTo(0.8);
    moveToward(m, 3, 4, 10, 10);
    expect(m.x).toBeCloseTo(3);
    expect(m.y).toBeCloseTo(4);
  });

  it('flies a pass from thrower to target and lands low', () => {
    const p = makePass({ x: 0, y: 0 }, { x: 0, y: 24 });
    expect(p.duration).toBeCloseTo(1);
    p.t = 0;
    const a = passPosition(p);
    p.t = p.duration / 2;
    const mid = passPosition(p);
    p.t = p.duration;
    const end = passPosition(p);
    expect(mid.z).toBeGreaterThan(a.z);
    expect(end.y).toBeCloseTo(24);
    expect(end.z).toBeLessThan(1);
  });

  it('leads a moving receiver and keeps the lead in bounds', () => {
    const r = { x: 11, y: 20, vx: 7, vy: 0 };
    const lp = leadPoint(r, 6);
    expect(lp.x).toBeLessThanOrEqual(cfg.width / 2);
    const r2 = { x: 0, y: 20, vx: 0, vy: 7 };
    expect(leadPoint(r2, 6).y).toBeCloseTo(26);
  });

  it('detects touches and catches by distance', () => {
    expect(isTouch({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(isTouch({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(canCatch({ x: 0, y: 0, z: 1 }, { x: 1, y: 0 }, cfg.catchRadius)).toBe(true);
    expect(canCatch({ x: 0, y: 0, z: 5 }, { x: 1, y: 0 }, cfg.catchRadius)).toBe(false);
  });
});
