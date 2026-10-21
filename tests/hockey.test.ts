import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHOOTOUT, aiShotPlan, attemptsLeft, createShooter, createShootout, goalieHome, openCorner, pokeRate, puckPosition, recordAttempt, resolveShot, stepShooter,
} from '../src/games/hockey/shootout';

const cfg = DEFAULT_SHOOTOUT;
/** Deterministic "no error" random source: gaussian(…) returns 0 when u = 1 (log 1 = 0). */
const exact = () => 0.999999999;

describe('shootout rules', () => {
  it('starts with player 0 shooting and five attempts each', () => {
    const s = createShootout();
    expect(s.shooter).toBe(0);
    expect(s.attempts).toBe(5);
    expect(attemptsLeft(s, 0)).toBe(5);
    expect(attemptsLeft(s, 1)).toBe(5);
  });

  it('alternates shooters and counts goals', () => {
    let s = createShootout();
    s = recordAttempt(s, 'goal');
    expect(s.shooter).toBe(1);
    expect(s.goals).toEqual([1, 0]);
    expect(s.taken).toEqual([1, 0]);
    s = recordAttempt(s, 'save');
    expect(s.shooter).toBe(0);
    expect(s.goals).toEqual([1, 0]);
    expect(s.taken).toEqual([1, 1]);
  });

  it('ends early once the trailing player cannot catch up', () => {
    let s = createShootout();
    // P0 scores three, P1 misses three: P1 has two left and trails by three
    for (let i = 0; i < 3; i++) { s = recordAttempt(s, 'goal'); s = recordAttempt(s, 'wide'); }
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(0);
  });

  it('decides a tie in sudden death pair by pair', () => {
    let s = createShootout();
    for (let i = 0; i < 5; i++) { s = recordAttempt(s, 'goal'); s = recordAttempt(s, 'goal'); }
    expect(s.phase).toBe('shoot');
    expect(s.suddenDeath).toBe(true);
    s = recordAttempt(s, 'save');
    expect(s.phase).toBe('shoot');          // the pair is not complete yet
    s = recordAttempt(s, 'goal');
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(1);
  });

  it('ignores attempts after the shootout is over', () => {
    let s = createShootout(1);
    s = recordAttempt(s, 'goal');
    s = recordAttempt(s, 'wide');
    expect(s.phase).toBe('done');
    expect(recordAttempt(s, 'goal')).toBe(s);
  });
});

describe('shootout skating', () => {
  it('skates toward the net and stops short of the crease', () => {
    const s = createShooter(cfg);
    for (let i = 0; i < 600; i++) stepShooter(s, 0, 1, 1 / 60, cfg);
    expect(s.z).toBeCloseTo(cfg.netZ - cfg.minDist, 5);
    expect(Math.abs(s.x)).toBeLessThan(0.01);
  });

  it('stays on the driveway', () => {
    const s = createShooter(cfg);
    for (let i = 0; i < 300; i++) stepShooter(s, 1, 0, 1 / 60, cfg);
    expect(s.x).toBeCloseTo(cfg.rinkW / 2 - cfg.playerRadius, 5);
  });

  it('carries the puck ahead on the forehand side', () => {
    const s = createShooter(cfg);
    const p = puckPosition(s, cfg);
    expect(p.z).toBeGreaterThan(s.z);
    expect(p.x).toBeGreaterThan(s.x);
  });
});

describe('shootout goalie and shots', () => {
  it('the goalie stands on the line from the puck to the centre of the net', () => {
    expect(goalieHome({ x: 0, z: 8 }, cfg)).toBeCloseTo(0, 5);
    const right = goalieHome({ x: 2, z: cfg.netZ - 4 }, cfg);
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThan(cfg.goalie.maxX + 0.001);
  });

  it('a clean shot into the top corner beats a centred goalie', () => {
    const r = resolveShot({ x: 0, z: cfg.netZ - 6 }, { x: cfg.goalW / 2 - 0.2, y: cfg.goalH - 0.2 }, 0, 0, 0.5, cfg, exact);
    expect(r.outcome).toBe('goal');
  });

  it('a shot straight at the goalie is saved', () => {
    const r = resolveShot({ x: 0, z: cfg.netZ - 6 }, { x: 0, y: 0.3 }, 0, 0, 0.5, cfg, exact);
    expect(r.outcome).toBe('save');
  });

  it('a shot outside the frame is wide, just outside is the post', () => {
    expect(resolveShot({ x: 0, z: 8 }, { x: cfg.goalW / 2 + 0.5, y: 0.5 }, 0, 0, 0.5, cfg, exact).outcome).toBe('wide');
    expect(resolveShot({ x: 0, z: 8 }, { x: cfg.goalW / 2 + 0.05, y: 0.5 }, 0, 0, 0.5, cfg, exact).outcome).toBe('post');
    expect(resolveShot({ x: 0, z: 8 }, { x: 0.3, y: cfg.goalH + 0.5 }, 0, 0, 0.5, cfg, exact).outcome).toBe('wide');
  });

  it('a hard goalie reaches a corner from far out that an easy goalie cannot', () => {
    const far = { x: 0, z: cfg.netZ - 9 };
    const corner = { x: cfg.goalW / 2 - 0.2, y: 0.9 };
    const easy = resolveShot(far, corner, 0, 0, 0, cfg, exact);
    const hard = resolveShot(far, corner, 0, 0, 1, cfg, exact);
    expect(easy.outcome).toBe('goal');
    expect(hard.outcome).toBe('save');
    expect(hard.goalieX).toBeGreaterThan(easy.goalieX);
  });

  it('only pokes inside the crease zone', () => {
    expect(pokeRate({ x: 0, z: 5 }, 0.5, cfg)).toBe(0);
    expect(pokeRate({ x: 0, z: cfg.netZ - 2.5 }, 0.5, cfg)).toBeGreaterThan(0);
  });

  it('picks the corner on the far side from the goalie', () => {
    expect(openCorner(0.6, cfg).x).toBeLessThan(0);
    expect(openCorner(-0.6, cfg).x).toBeGreaterThan(0);
    const c = openCorner(0.6, cfg, { high: false });
    expect(c.y).toBeLessThan(0.3);
  });

  it('CPU plans stay inside the driveway and in front of the crease', () => {
    for (let i = 0; i < 50; i++) {
      const p = aiShotPlan(Math.random(), cfg);
      expect(Math.abs(p.targetX)).toBeLessThan(cfg.rinkW / 2);
      expect(p.targetZ).toBeLessThan(cfg.netZ - cfg.minDist);
      expect(p.targetZ).toBeGreaterThan(cfg.startZ);
      expect(p.inset).toBeGreaterThan(0.1);
    }
  });
});
