import { describe, expect, it } from 'vitest';
import { DEFAULT_DERBY_RULES, acknowledgeSwitch, applyOutcome, createDerby, outsRemaining } from '../src/games/derby/rules';
import { DEFAULT_BATTING, computeContact, simulateFlight, timingLabel } from '../src/games/derby/batting';

const rules = { outsPerRound: 10, tiebreakOuts: 3 };

function runOuts(state: ReturnType<typeof createDerby>, n: number) {
  let s = state;
  for (let i = 0; i < n; i++) s = applyOutcome(s, 'out', rules);
  return s;
}

describe('derby rules', () => {
  it('starts with player 0 batting, zero outs and scores', () => {
    const s = createDerby(rules);
    expect(s.batter).toBe(0);
    expect(s.outs).toEqual([0, 0]);
    expect(s.scores).toEqual([0, 0]);
    expect(outsRemaining(s, 0)).toBe(10);
  });

  it('home runs score without consuming an out, takes do nothing', () => {
    let s = createDerby(rules);
    s = applyOutcome(s, 'homerun', rules);
    s = applyOutcome(s, 'take', rules);
    expect(s.scores[0]).toBe(1);
    expect(s.outs[0]).toBe(0);
    expect(s.batter).toBe(0);
  });

  it('switches batter after 10 outs', () => {
    let s = createDerby(rules);
    s = runOuts(s, 9);
    expect(s.phase).toBe('batting');
    s = applyOutcome(s, 'out', rules);
    expect(s.phase).toBe('switch');
    expect(s.batter).toBe(1);
    s = acknowledgeSwitch(s);
    expect(s.phase).toBe('batting');
  });

  it('declares a winner once both have batted with different scores', () => {
    let s = createDerby(rules);
    s = applyOutcome(s, 'homerun', rules);
    s = applyOutcome(s, 'homerun', rules);
    s = runOuts(s, 10);
    s = acknowledgeSwitch(s);
    s = applyOutcome(s, 'homerun', rules);
    s = runOuts(s, 10);
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(0);
    expect(s.scores).toEqual([2, 1]);
  });

  it('ties trigger 3-out tiebreak rounds until resolved', () => {
    let s = createDerby(rules);
    s = applyOutcome(s, 'homerun', rules);
    s = runOuts(s, 10);
    s = acknowledgeSwitch(s);
    s = applyOutcome(s, 'homerun', rules);
    s = runOuts(s, 10);
    expect(s.phase).toBe('switch');
    expect(s.newRound).toBe(true);
    expect(s.round).toBe(2);
    expect(s.outsLimit).toBe(3);
    expect(s.outs).toEqual([0, 0]);
    expect(s.batter).toBe(0);
    s = acknowledgeSwitch(s);
    // round 2: still tied
    s = runOuts(s, 3);
    s = acknowledgeSwitch(s);
    s = runOuts(s, 3);
    expect(s.round).toBe(3);
    expect(s.winner).toBeNull();
    s = acknowledgeSwitch(s);
    // round 3: player 1 wins
    s = runOuts(s, 3);
    s = acknowledgeSwitch(s);
    s = applyOutcome(s, 'homerun', rules);
    s = runOuts(s, 3);
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(1);
    expect(s.scores).toEqual([1, 2]);
  });

  it('ignores outcomes after the match is done', () => {
    let s = createDerby({ outsPerRound: 1, tiebreakOuts: 1 });
    s = applyOutcome(s, 'homerun');
    s = applyOutcome(s, 'out', { outsPerRound: 1, tiebreakOuts: 1 });
    s = acknowledgeSwitch(s);
    s = applyOutcome(s, 'out', { outsPerRound: 1, tiebreakOuts: 1 });
    expect(s.phase).toBe('done');
    const after = applyOutcome(s, 'homerun', { outsPerRound: 1, tiebreakOuts: 1 });
    expect(after).toBe(s);
  });

  it('uses the default rules of 10 outs and 3-out tiebreaks', () => {
    expect(DEFAULT_DERBY_RULES).toEqual({ outsPerRound: 10, tiebreakOuts: 3 });
  });
});

describe('derby batting', () => {
  it('labels timing windows', () => {
    expect(timingLabel(0)).toBe('perfect');
    expect(timingLabel(-DEFAULT_BATTING.perfectMs)).toBe('perfect');
    expect(timingLabel(-100)).toBe('early');
    expect(timingLabel(100)).toBe('late');
    expect(timingLabel(DEFAULT_BATTING.maxContactMs + 1)).toBe('miss');
  });

  it('a perfect, centred swing clears the trees for a home run', () => {
    const c = computeContact(0, 0, 0);
    expect(c.miss).toBe(false);
    expect(c.fair).toBe(true);
    const f = simulateFlight(c);
    expect(f.homeRun).toBe(true);
    expect(f.heightAtBoundary).not.toBeNull();
    expect(f.heightAtBoundary!).toBeGreaterThanOrEqual(DEFAULT_BATTING.treeHeight);
  });

  it('very late swings go foul and far-off aim misses', () => {
    const late = computeContact(DEFAULT_BATTING.maxContactMs * 0.95, 0, 0);
    expect(late.fair).toBe(false);
    expect(simulateFlight(late).reason).toBe('foul');
    const whiff = computeContact(0, 1, 1);
    expect(whiff.miss).toBe(true);
  });

  it('weak contact lands short of the boundary', () => {
    const c = computeContact(DEFAULT_BATTING.goodMs + 60, 0.4, 0.5);
    expect(c.miss).toBe(false);
    const f = simulateFlight(c);
    expect(f.homeRun).toBe(false);
    expect(['short', 'trees', 'popup', 'foul']).toContain(f.reason);
  });

  it('early swings pull left and late swings push right of the fair centre', () => {
    expect(computeContact(-120, 0, 0).directionDeg).toBeLessThan(DEFAULT_BATTING.fairCenterDeg);
    expect(computeContact(120, 0, 0).directionDeg).toBeGreaterThan(DEFAULT_BATTING.fairCenterDeg);
    expect(computeContact(0, 0, 0).directionDeg).toBeCloseTo(DEFAULT_BATTING.fairCenterDeg, 5);
  });
});
