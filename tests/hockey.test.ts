import { describe, expect, it } from 'vitest';
import { DEFAULT_HOCKEY, NO_INPUT, aiInputs, checkGoal, createAiMemory, createHockey, step, type HockeyInputs } from '../src/games/hockey/sim';

const cfg = DEFAULT_HOCKEY;
const none: [HockeyInputs, HockeyInputs] = [NO_INPUT, NO_INPUT];

describe('hockey goal detection', () => {
  it('scores for slot 1 when the puck fully crosses the near goal line inside the mouth', () => {
    expect(checkGoal({ x: 0.2, z: 0.3 }, { x: 0.2, z: -0.2 }, cfg)).toBe(1);
  });
  it('scores for slot 0 when the puck fully crosses the far goal line inside the mouth', () => {
    expect(checkGoal({ x: -0.5, z: cfg.rinkL - 0.2 }, { x: -0.5, z: cfg.rinkL + 0.2 }, cfg)).toBe(0);
  });
  it('does not score when the puck is outside the posts', () => {
    expect(checkGoal({ x: cfg.goalW / 2 + 0.3, z: 0.3 }, { x: cfg.goalW / 2 + 0.3, z: -0.2 }, cfg)).toBeNull();
  });
  it('does not score until the puck has fully crossed the line', () => {
    expect(checkGoal({ x: 0, z: 0.3 }, { x: 0, z: 0.02 }, cfg)).toBeNull();
  });
  it('bounces a puck off the end board outside the goal mouth', () => {
    const st = createHockey(cfg);
    st.puck = { x: cfg.goalW / 2 + 0.6, z: 0.3, vx: 0, vz: -6, carrier: null };
    st.players[0].z = 10; st.players[1].z = 14; // keep sticks away
    for (let i = 0; i < 6; i++) step(st, none, 1 / 60, cfg);
    expect(st.puck.vz).toBeGreaterThan(0);
    expect(st.scores).toEqual([0, 0]);
  });
});

describe('hockey puck physics', () => {
  it('flips lateral velocity on the side boundary', () => {
    const st = createHockey(cfg);
    st.puck = { x: cfg.rinkW / 2 - 0.1, z: 12, vx: 8, vz: 0, carrier: null };
    st.players[0].z = 2; st.players[1].z = 22;
    const events = step(st, none, 1 / 30, cfg);
    expect(st.puck.vx).toBeLessThan(0);
    expect(events.some((e) => e.type === 'wall')).toBe(true);
  });
  it('slows a free puck with friction and eventually stops it', () => {
    const st = createHockey(cfg);
    st.puck = { x: 0, z: 12, vx: 0, vz: 3, carrier: null };
    st.players[0].z = 2; st.players[1].z = 22;
    for (let i = 0; i < 240; i++) step(st, none, 1 / 60, cfg);
    expect(Math.hypot(st.puck.vx, st.puck.vz)).toBe(0);
  });
});

describe('hockey stick handling', () => {
  it('a player picks up a nearby puck and carries it in front', () => {
    const st = createHockey(cfg);
    st.players[0].x = 0; st.players[0].z = 11.3; // puck at centre (12)
    st.players[1].z = 22;
    const events = step(st, none, 1 / 60, cfg);
    expect(st.puck.carrier).toBe(0);
    expect(events.some((e) => e.type === 'pickup' && e.slot === 0)).toBe(true);
    for (let i = 0; i < 30; i++) step(st, none, 1 / 60, cfg);
    expect(st.puck.z).toBeGreaterThan(st.players[0].z);
  });
  it('releasing SHOOT fires the puck forward with power from the charge', () => {
    const st = createHockey(cfg);
    st.players[0].z = 11.3; st.players[1].z = 22;
    step(st, none, 1 / 60, cfg);
    const hold: [HockeyInputs, HockeyInputs] = [{ ax: 0, az: 0, shoot: true, poke: false }, NO_INPUT];
    for (let i = 0; i < 60; i++) step(st, hold, 1 / 60, cfg); // full charge
    const events = step(st, none, 1 / 60, cfg);
    const shot = events.find((e) => e.type === 'shot');
    expect(shot && shot.type === 'shot' && shot.power).toBeCloseTo(1, 1);
    expect(st.puck.carrier).toBeNull();
    expect(st.puck.vz).toBeGreaterThan(cfg.maxShot * 0.9);
  });
  it('a poke check strips the puck from the carrier', () => {
    const st = createHockey(cfg);
    st.players[0].z = 11.3; st.players[1].z = 22;
    step(st, none, 1 / 60, cfg);
    expect(st.puck.carrier).toBe(0);
    // opponent faces the carrier from just ahead of the puck
    st.players[1].x = 0; st.players[1].z = 13.6; st.players[1].fx = 0; st.players[1].fz = -1;
    const poke: [HockeyInputs, HockeyInputs] = [NO_INPUT, { ax: 0, az: 0, shoot: false, poke: true }];
    const events = step(st, poke, 1 / 60, cfg);
    expect(events.some((e) => e.type === 'poke' && e.stripped)).toBe(true);
    expect(st.puck.carrier).toBeNull();
    expect(st.players[0].noCarryTimer).toBeGreaterThan(0);
  });
});

describe('hockey match flow', () => {
  it('resets to centre after a goal and ends the match at the winning score', () => {
    const st = createHockey(cfg);
    st.players[0].z = 2; st.players[1].z = 22;
    for (let g = 0; g < cfg.winScore; g++) {
      st.puck = { x: 0, z: cfg.rinkL - 0.2, vx: 0, vz: 9, carrier: null };
      st.players[0].z = 2; st.players[1].z = 22; st.players[1].noCarryTimer = 1; st.players[0].noCarryTimer = 1;
      const events = step(st, none, 1 / 30, cfg);
      expect(events.some((e) => e.type === 'goal' && e.scorer === 0)).toBe(true);
      if (g < cfg.winScore - 1) {
        expect(st.phase).toBe('goal');
        for (let i = 0; i < 200; i++) step(st, none, 1 / 60, cfg);
        expect(st.phase).toBe('play');
        expect(st.puck.z).toBeCloseTo(cfg.rinkL / 2, 5);
        expect(st.puck.carrier).toBeNull();
      }
    }
    expect(st.scores[0]).toBe(cfg.winScore);
    expect(st.phase).toBe('done');
    expect(st.winner).toBe(0);
  });
  it('the AI chases a loose puck and shoots when carrying it near the net', () => {
    const st = createHockey(cfg);
    const mem = createAiMemory();
    const inp = aiInputs(st, 1, 1, mem, 1 / 60, cfg, () => 0.5);
    expect(Math.hypot(inp.ax, inp.az)).toBeGreaterThan(0);
    expect(inp.az).toBeLessThan(0); // heading toward the puck at centre from the far end
    st.puck = { x: 0, z: 5, vx: 0, vz: 0, carrier: 1 };
    st.players[1].x = 0; st.players[1].z = 6; st.players[1].fz = -1; st.players[1].fx = 0;
    st.players[0].x = 3; st.players[0].z = 2; // defender out of the shooting lane
    const shootInp = aiInputs(st, 1, 1, mem, 1 / 60, cfg, () => 0.5);
    expect(shootInp.shoot).toBe(true);
  });
});
