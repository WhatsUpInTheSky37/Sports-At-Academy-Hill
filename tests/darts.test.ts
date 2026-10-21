import { describe, expect, it } from 'vitest';
import { BOARD, aiTarget, checkouts, scoreAt, segmentAt, segmentAngle, targetPoint } from '../src/games/darts/board';
import { applyDart, createGame, type DartsState } from '../src/games/darts/rules';

const mm = (ring: 'S' | 'D' | 'T' | 'IB' | 'OB', seg: number) => targetPoint({ ring, segment: seg });

describe('dartboard scoring', () => {
  it('scores the treble 20 bed as 60', () => {
    const p = mm('T', 20);
    const h = scoreAt(p.x, p.y);
    expect(h.points).toBe(60);
    expect(h.multiplier).toBe(3);
    expect(h.segment).toBe(20);
    expect(h.isDouble).toBe(false);
  });
  it('scores D16 as 32 and flags it as a double', () => {
    const p = mm('D', 16);
    const h = scoreAt(p.x, p.y);
    expect(h.points).toBe(32);
    expect(h.isDouble).toBe(true);
    expect(h.label).toBe('D16');
  });
  it('scores the bulls correctly', () => {
    expect(scoreAt(0, -11).points).toBe(25);
    expect(scoreAt(0, -11).isDouble).toBe(false);
    const ib = scoreAt(2, 2);
    expect(ib.points).toBe(50);
    expect(ib.isDouble).toBe(true);
    expect(ib.isBull).toBe(true);
  });
  it('scores 0 outside the double ring', () => {
    expect(scoreAt(0, -(BOARD.doubleOuterR + 1)).points).toBe(0);
    expect(scoreAt(300, 300).ring).toBe('miss');
  });
  it('puts 20 at the top and 1 clockwise of it', () => {
    expect(segmentAt(0)).toBe(20);
    expect(segmentAt(18)).toBe(1);
    expect(segmentAt(-18)).toBe(5);
    expect(segmentAngle(1)).toBe(18);
    // a single 20 straight up
    expect(scoreAt(0, -130).points).toBe(20);
    // single 3 straight down
    expect(scoreAt(0, 130).points).toBe(3);
    // single 6 to the right
    expect(scoreAt(130, 0).points).toBe(6);
    // single 11 to the left
    expect(scoreAt(-130, 0).points).toBe(11);
  });
});

describe('checkouts', () => {
  it('suggests D16 for 32 with one dart', () => {
    expect(checkouts(32, 1)).toContain('D16');
  });
  it('suggests T20 T20 Bull for 170', () => {
    expect(checkouts(170, 3)).toContain('T20 T20 Bull');
  });
  it('has no finish for 169 or for 1', () => {
    expect(checkouts(169, 3)).toBeNull();
    expect(checkouts(1, 3)).toBeNull();
  });
  it('needs enough darts', () => {
    expect(checkouts(100, 1)).toBeNull();
    expect(checkouts(100, 2)).toContain('T20 D20');
  });
  it('AI aims at T20 when far away and at the finishing double when a finish is on', () => {
    expect(aiTarget(301, 3)).toEqual({ ring: 'T', segment: 20 });
    expect(aiTarget(32, 1)).toEqual({ ring: 'D', segment: 16 });
    expect(aiTarget(50, 1)).toEqual({ ring: 'IB', segment: 25 });
  });
});

const hit = (points: number, isDouble = false) => ({ points, multiplier: (isDouble ? 2 : 1) as 1 | 2 | 3, segment: points, ring: isDouble ? 'D' as const : 'S' as const, label: `${points}`, isDouble, isBull: false });

function withScore(s: DartsState, score: number): DartsState {
  return { ...s, scores: [score, s.scores[1]], turnStart: score };
}

describe('301 rules', () => {
  it('subtracts hits and ends the turn after three darts, switching players', () => {
    let s = createGame();
    s = applyDart(s, hit(20));
    s = applyDart(s, hit(60));
    expect(s.scores[0]).toBe(221);
    expect(s.turn).toBe(0);
    expect(s.dartsThrown).toBe(2);
    s = applyDart(s, hit(5));
    expect(s.scores[0]).toBe(216);
    expect(s.turn).toBe(1);
    expect(s.dartsThrown).toBe(0);
    expect(s.lastEvent).toBe('turnEnd');
    expect(s.history[0]).toEqual([216]);
    expect(s.turnStart).toBe(301);
  });
  it('busts when going below zero, restoring the start-of-turn score and ending the turn', () => {
    let s = withScore(createGame(), 40);
    s = applyDart(s, hit(20));
    expect(s.scores[0]).toBe(20);
    s = applyDart(s, hit(25));
    expect(s.scores[0]).toBe(40);
    expect(s.turn).toBe(1);
    expect(s.busted).toBe(true);
    expect(s.lastEvent).toBe('bust');
  });
  it('busts when leaving exactly 1', () => {
    let s = withScore(createGame(), 21);
    s = applyDart(s, hit(20));
    expect(s.scores[0]).toBe(21);
    expect(s.turn).toBe(1);
    expect(s.busted).toBe(true);
  });
  it('busts when reaching zero without a double', () => {
    let s = withScore(createGame(), 20);
    s = applyDart(s, hit(20, false));
    expect(s.scores[0]).toBe(20);
    expect(s.turn).toBe(1);
    expect(s.winner).toBeNull();
  });
  it('wins when reaching zero with a double', () => {
    let s = withScore(createGame(), 32);
    s = applyDart(s, hit(32, true));
    expect(s.scores[0]).toBe(0);
    expect(s.winner).toBe(0);
    expect(s.lastEvent).toBe('win');
  });
  it('lets the inner bull finish 50', () => {
    let s = withScore(createGame(), 50);
    const bull = { points: 50, multiplier: 2 as const, segment: 25, ring: 'IB' as const, label: 'BULLSEYE', isDouble: true, isBull: true };
    s = applyDart(s, bull);
    expect(s.winner).toBe(0);
  });
  it('does not let the outer bull finish 25', () => {
    let s = withScore(createGame(), 25);
    const ob = { points: 25, multiplier: 1 as const, segment: 25, ring: 'OB' as const, label: 'Outer bull', isDouble: false, isBull: true };
    s = applyDart(s, ob);
    expect(s.winner).toBeNull();
    expect(s.scores[0]).toBe(25);
    expect(s.turn).toBe(1);
  });
  it('ignores darts after a win', () => {
    let s = withScore(createGame(), 32);
    s = applyDart(s, hit(32, true));
    const after = applyDart(s, hit(20));
    expect(after).toBe(s);
  });
});
