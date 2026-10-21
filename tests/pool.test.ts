import { describe, expect, it } from 'vitest';
import { DEFAULT_POOL, PoolSim, emptyEvents, rackBalls, simulateShot, pockets, type Ball } from '../src/games/pool/physics';
import { applyShotResult, callPocket, chooseGroup, createGame, isLegalBreak, onTheEight, resolveIllegalBreak, type PoolGameState } from '../src/games/pool/rules';
import { chooseShot } from '../src/games/pool/ai';

const cfg = DEFAULT_POOL;

function ball(id: number, x: number, z: number, active = true): Ball { return { id, x, z, vx: 0, vz: 0, active }; }

/** A post-break state with assigned groups: P0 solids, P1 stripes. */
function midGame(balls: Ball[], turn: 0 | 1 = 0): PoolGameState {
  const s = createGame(0, cfg, 1);
  return { ...s, balls, turn, breakPending: false, open: false, groups: ['solid', 'stripe'] };
}

function events(partial: Partial<ReturnType<typeof emptyEvents>>) { return { ...emptyEvents(), ...partial }; }

describe('rack', () => {
  it('has 15 object balls, non-overlapping, with the 8 in the centre and mixed back corners', () => {
    const balls = rackBalls(cfg, 3);
    expect(balls).toHaveLength(16);
    const objs = balls.filter((b) => b.id !== 0);
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
      expect(Math.hypot(objs[i].x - objs[j].x, objs[i].z - objs[j].z)).toBeGreaterThanOrEqual(cfg.ballR * 2 - 1e-6);
    }
    const eight = objs.find((b) => b.id === 8)!;
    const zs = objs.map((b) => b.z);
    const rows = [...new Set(zs.map((z) => Math.round(z * 1000)))].sort((a, b) => a - b);
    expect(Math.round(eight.z * 1000)).toBe(rows[2]);
    expect(Math.abs(eight.x - cfg.tableW / 2)).toBeLessThan(1e-6);
    const back = objs.filter((b) => Math.round(b.z * 1000) === rows[4]).sort((a, b) => a.x - b.x);
    const corners = [back[0].id, back[back.length - 1].id];
    expect(corners.some((id) => id >= 1 && id <= 7)).toBe(true);
    expect(corners.some((id) => id >= 9 && id <= 15)).toBe(true);
  });
});

describe('physics', () => {
  it('transfers velocity in a head-on collision', () => {
    const balls = [ball(0, 0.5, 0.5), ball(1, 0.5, 0.8)];
    const sim = new PoolSim(balls, cfg);
    sim.strike(2, Math.PI / 2);
    sim.step(0.2);
    const cue = sim.balls[0];
    const one = sim.balls[1];
    expect(one.vz).toBeGreaterThan(1);
    expect(Math.abs(cue.vz)).toBeLessThan(0.5);
    expect(sim.events.firstContact).toBe(1);
  });
  it('rebounds off a cushion, flipping the velocity component', () => {
    const balls = [ball(0, 0.5, 1.0)];
    const sim = new PoolSim(balls, cfg);
    sim.strike(2, 0); // toward +x rail
    sim.step(0.6);
    expect(sim.balls[0].vx).toBeLessThan(0);
    expect(sim.balls[0].x).toBeLessThan(cfg.tableW - cfg.ballR + 1e-6);
  });
  it('pockets a ball aimed straight into a corner pocket and records it', () => {
    const balls = [ball(0, 0.4, 0.4), ball(3, 0.2, 2.34)];
    const p = pockets(cfg)[4]; // far-left
    // aim cue at the ghost ball position behind the 3 relative to the pocket
    const px = balls[1].x - p.x, pz = balls[1].z - p.z;
    const n = Math.hypot(px, pz);
    const gx = balls[1].x + (px / n) * cfg.ballR * 2, gz = balls[1].z + (pz / n) * cfg.ballR * 2;
    const angle = Math.atan2(gz - balls[0].z, gx - balls[0].x);
    const { events: ev } = simulateShot(balls, 3.2, angle, cfg);
    expect(ev.pocketed).toContain(3);
    expect(ev.pocketIndex[3]).toBe(4);
    expect(ev.scratched).toBe(false);
  });
  it('comes to rest', () => {
    const { balls } = simulateShot([ball(0, 0.6, 0.6), ball(1, 0.7, 1.4)], 3, Math.PI / 2, cfg);
    expect(balls.every((b) => b.vx === 0 && b.vz === 0)).toBe(true);
  });
});

describe('break', () => {
  it('detects an illegal break and lets the opponent rerack or accept', () => {
    const s = createGame(0, cfg, 1);
    const ev = events({ firstContact: 1, objectBallsToRail: [1, 2] });
    expect(isLegalBreak(ev)).toBe(false);
    const n = applyShotResult(s, s.balls, ev, cfg);
    expect(n.pending).toEqual({ type: 'illegalBreak', by: 1 });
    const rer = resolveIllegalBreak(n, 'rerack', cfg);
    expect(rer.breakPending).toBe(true);
    expect(rer.turn).toBe(1);
    const acc = resolveIllegalBreak(n, 'accept', cfg);
    expect(acc.ballInHand).toBe(true);
    expect(acc.turn).toBe(1);
  });
  it('treats four balls to a rail as legal and keeps the table open', () => {
    const s = createGame(0, cfg, 1);
    const n = applyShotResult(s, s.balls, events({ firstContact: 1, objectBallsToRail: [1, 2, 3, 4] }), cfg);
    expect(n.open).toBe(true);
    expect(n.breakPending).toBe(false);
    expect(n.turn).toBe(1);
  });
  it('respots the eight when it drops on the break and does not end the game', () => {
    const s = createGame(0, cfg, 1);
    const after = s.balls.map((b) => (b.id === 8 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 1, pocketed: [8], pocketIndex: { 8: 5 } }), cfg);
    expect(n.winner).toBeNull();
    const eight = n.balls.find((b) => b.id === 8)!;
    expect(eight.active).toBe(true);
    expect(n.balls.filter((b) => b.active && b.id !== 8).every((b) => Math.hypot(b.x - eight.x, b.z - eight.z) >= cfg.ballR * 2 - 1e-6)).toBe(true);
  });
  it('a scratch on the break gives the opponent ball in hand', () => {
    const s = createGame(0, cfg, 1);
    const n = applyShotResult(s, s.balls, events({ firstContact: 1, scratched: true, objectBallsToRail: [1, 2, 3, 4, 5] }), cfg);
    expect(n.turn).toBe(1);
    expect(n.ballInHand).toBe(true);
  });
});

describe('groups and turns', () => {
  it('assigns groups on the first pocketed group ball after the break', () => {
    const s = { ...createGame(0, cfg, 1), breakPending: false };
    const after = s.balls.map((b) => (b.id === 12 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 12, pocketed: [12], pocketIndex: { 12: 1 } }), cfg);
    expect(n.open).toBe(false);
    expect(n.groups).toEqual(['stripe', 'solid']);
    expect(n.turn).toBe(0);
  });
  it('lets the shooter choose when both groups drop on an open table', () => {
    const s = { ...createGame(0, cfg, 1), breakPending: false };
    const after = s.balls.map((b) => (b.id === 2 || b.id === 11 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 2, pocketed: [2, 11], pocketIndex: { 2: 0, 11: 1 } }), cfg);
    expect(n.pending).toEqual({ type: 'chooseGroup', by: 0 });
    const c = chooseGroup(n, 'stripe');
    expect(c.groups).toEqual(['stripe', 'solid']);
    expect(c.open).toBe(false);
  });
  it('hitting the eight first on an open table is a foul', () => {
    const s = { ...createGame(0, cfg, 1), breakPending: false };
    const n = applyShotResult(s, s.balls, events({ firstContact: 8, railsAfterContact: [0] }), cfg);
    expect(n.ballInHand).toBe(true);
    expect(n.turn).toBe(1);
    expect(n.message).toMatch(/eight/i);
  });
  it('a scratch gives ball in hand and changes turn', () => {
    const s = midGame([ball(0, 0.5, 0.5), ball(1, 0.5, 1.5), ball(9, 0.9, 1.5), ball(8, 0.6, 2.0)]);
    const n = applyShotResult(s, s.balls.map((b) => (b.id === 0 ? { ...b, active: false } : b)), events({ firstContact: 1, scratched: true, railsAfterContact: [1] }), cfg);
    expect(n.turn).toBe(1);
    expect(n.ballInHand).toBe(true);
    expect(n.balls.find((b) => b.id === 0)!.active).toBe(true);
  });
  it('no ball to a rail after contact is a foul', () => {
    const s = midGame([ball(0, 0.5, 0.5), ball(1, 0.5, 1.5), ball(9, 0.9, 1.5), ball(8, 0.6, 2.0)]);
    const n = applyShotResult(s, s.balls, events({ firstContact: 1 }), cfg);
    expect(n.ballInHand).toBe(true);
    expect(n.turn).toBe(1);
  });
  it('wrong first contact is a foul', () => {
    const s = midGame([ball(0, 0.5, 0.5), ball(1, 0.5, 1.5), ball(9, 0.9, 1.5), ball(8, 0.6, 2.0)]);
    const n = applyShotResult(s, s.balls, events({ firstContact: 9, railsAfterContact: [9] }), cfg);
    expect(n.ballInHand).toBe(true);
    expect(n.message).toMatch(/solid/i);
  });
  it('continues the turn after pocketing an own-group ball', () => {
    const s = midGame([ball(0, 0.5, 0.5), ball(1, 0.5, 1.5), ball(2, 0.3, 1.9), ball(9, 0.9, 1.5), ball(8, 0.6, 2.0)]);
    const after = s.balls.map((b) => (b.id === 1 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 1, pocketed: [1], pocketIndex: { 1: 4 } }), cfg);
    expect(n.turn).toBe(0);
    expect(n.ballInHand).toBe(false);
  });
  it('passes the turn when nothing drops', () => {
    const s = midGame([ball(0, 0.5, 0.5), ball(1, 0.5, 1.5), ball(9, 0.9, 1.5), ball(8, 0.6, 2.0)]);
    const n = applyShotResult(s, s.balls, events({ firstContact: 1, railsAfterContact: [1] }), cfg);
    expect(n.turn).toBe(1);
    expect(n.ballInHand).toBe(false);
  });
});

describe('eight ball', () => {
  it('loses when the eight is pocketed early', () => {
    const s = midGame([ball(0, 0.5, 0.5), ball(1, 0.5, 1.5), ball(9, 0.9, 1.5), ball(8, 0.6, 2.0)]);
    const after = s.balls.map((b) => (b.id === 8 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 1, pocketed: [8], pocketIndex: { 8: 4 } }), cfg);
    expect(n.winner).toBe(1);
  });
  it('wins by pocketing the eight in the called pocket after clearing the group', () => {
    const s = callPocket(midGame([ball(0, 0.5, 0.5), ball(9, 0.9, 1.5), ball(8, 0.2, 2.3)]), 4);
    expect(onTheEight(s)).toBe(true);
    const after = s.balls.map((b) => (b.id === 8 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 8, pocketed: [8], pocketIndex: { 8: 4 } }), cfg);
    expect(n.winner).toBe(0);
  });
  it('loses when the eight drops in the wrong pocket', () => {
    const s = callPocket(midGame([ball(0, 0.5, 0.5), ball(9, 0.9, 1.5), ball(8, 0.2, 2.3)]), 5);
    const after = s.balls.map((b) => (b.id === 8 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 8, pocketed: [8], pocketIndex: { 8: 4 } }), cfg);
    expect(n.winner).toBe(1);
  });
  it('loses when the eight drops with a scratch', () => {
    const s = callPocket(midGame([ball(0, 0.5, 0.5), ball(9, 0.9, 1.5), ball(8, 0.2, 2.3)]), 4);
    const after = s.balls.map((b) => (b.id === 8 || b.id === 0 ? { ...b, active: false } : b));
    const n = applyShotResult(s, after, events({ firstContact: 8, pocketed: [8], pocketIndex: { 8: 4 }, scratched: true }), cfg);
    expect(n.winner).toBe(1);
  });
});

describe('ai', () => {
  it('finds a pocketing shot on an easy layout using the real physics', () => {
    const s = callPocket(midGame([ball(0, 0.635, 0.6), ball(3, 0.635, 1.6), ball(9, 1.1, 0.3), ball(8, 0.3, 0.3)]), null);
    const shot = chooseShot(s, 1, cfg, () => 0.5);
    const r = simulateShot(s.balls, shot.power * cfg.maxShotSpeed, shot.angle, cfg);
    expect(r.events.firstContact).toBe(3);
    expect(r.events.scratched).toBe(false);
  });
  it('calls a pocket when on the eight', () => {
    const s = midGame([ball(0, 0.635, 0.6), ball(9, 1.1, 0.3), ball(8, 0.635, 1.8)]);
    const shot = chooseShot(s, 1, cfg, () => 0.5);
    expect(shot.calledPocket).not.toBeNull();
  });
});
