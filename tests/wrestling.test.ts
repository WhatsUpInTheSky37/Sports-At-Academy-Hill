import { describe, expect, it } from 'vitest';
import { NO_INPUT, START_POSITIONS, WRESTLING_TUNING as T, applyStagger, createWrestling, distance, escapeFillRate, insideRing, step, type Inputs, type WrestlingState } from '../src/games/wrestling/sim';
import { aiInputs, createAiMemory } from '../src/games/wrestling/ai';

const DT = 1 / 60;
const idle = (): Inputs => ({ ...NO_INPUT });

function fighting(): WrestlingState {
  const s = createWrestling();
  s.phase = 'fight';
  return s;
}

function run(s: WrestlingState, inputs: [Inputs, Inputs], seconds: number, rand = () => 0.99): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) step(s, inputs, DT, { rand });
}

/** Put wrestler 1 down next to wrestler 0 so a pin can start. */
function downedNextToPinner(): WrestlingState {
  const s = fighting();
  s.w[0].x = 0; s.w[0].z = 0;
  s.w[1].x = 0.5; s.w[1].z = 0;
  s.w[1].state = 'down';
  s.w[1].stateTime = 0;
  return s;
}

describe('wrestling three-count', () => {
  it('declares the pinning wrestler the winner after holding the pin for three counts', () => {
    const s = downedNextToPinner();
    const hold: [Inputs, Inputs] = [{ ...idle(), grapple: true }, idle()];
    step(s, hold, DT);
    expect(s.pin.active).toBe(true);
    expect(s.pin.attacker).toBe(0);
    expect(s.w[1].state).toBe('pinned');
    run(s, hold, T.pinCountSeconds * 3 + 0.2);
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(0);
    expect(s.events.some((e) => e.type === 'win' && e.winner === 0) || s.pin.count >= 3).toBe(true);
  });

  it('cancels the pin when the attacker releases before three', () => {
    const s = downedNextToPinner();
    const hold: [Inputs, Inputs] = [{ ...idle(), grapple: true }, idle()];
    step(s, hold, DT);
    run(s, hold, T.pinCountSeconds * 2 + 0.1);
    expect(s.pin.count).toBe(2);
    expect(s.phase).toBe('fight');
    step(s, [idle(), idle()], DT);
    expect(s.pin.active).toBe(false);
    expect(s.events.some((e) => e.type === 'pinReleased')).toBe(true);
    expect(s.w[1].state).toBe('down');
    expect(s.winner).toBeNull();
  });
});

describe('wrestling hold-to-escape', () => {
  it('breaks the pin before the three-count when the pinned wrestler holds escape from the start', () => {
    const s = downedNextToPinner();
    const hold: [Inputs, Inputs] = [{ ...idle(), grapple: true }, { ...idle(), escape: true }];
    step(s, hold, DT);
    expect(s.pin.active).toBe(true);
    run(s, hold, T.escapeHoldSeconds + 0.1);
    expect(s.pin.active).toBe(false);
    expect(s.events.some((e) => e.type === 'escape' && e.by === 1) || s.w[1].state === 'idle').toBe(true);
    expect(s.w[1].state).toBe('idle');
    expect(s.w[0].state).toBe('stagger');
    expect(s.winner).toBeNull();
    expect(s.w[1].stamina).toBeLessThan(T.staminaMax - T.escapeCost + 2); // paid the escape cost (a little regen since)
  });

  it('counts out a pinned wrestler who never holds escape, and progress drains when the button is released', () => {
    const s = downedNextToPinner();
    const hold: [Inputs, Inputs] = [{ ...idle(), grapple: true }, { ...idle(), escape: true }];
    step(s, hold, DT);
    run(s, hold, 0.5);
    const partial = s.pin.escape;
    expect(partial).toBeGreaterThan(0.2);
    expect(partial).toBeLessThan(1);
    run(s, [{ ...idle(), grapple: true }, idle()], 0.5);
    expect(s.pin.escape).toBeLessThan(partial);
    expect(s.pin.escape).toBeGreaterThan(0); // drains, doesn't snap to zero
    run(s, [{ ...idle(), grapple: true }, idle()], T.pinCountSeconds * 3);
    expect(s.phase).toBe('done');
    expect(s.winner).toBe(0);
  });

  it('an exhausted wrestler fills the escape bar too slowly to beat the count', () => {
    const fresh = downedNextToPinner();
    const tired = downedNextToPinner();
    tired.w[1].stamina = 0;
    expect(escapeFillRate(tired.w[1])).toBeLessThan(escapeFillRate(fresh.w[1]));
    expect(1 / escapeFillRate(tired.w[1])).toBeGreaterThan(T.pinCountSeconds * T.pinCounts);
    expect(1 / escapeFillRate(fresh.w[1])).toBeLessThan(T.pinCountSeconds * T.pinCounts);
    const hold: [Inputs, Inputs] = [{ ...idle(), grapple: true }, { ...idle(), escape: true }];
    step(tired, hold, DT);
    run(tired, hold, T.pinCountSeconds * 3 + 0.1);
    expect(tired.phase).toBe('done');
    expect(tired.winner).toBe(0);
  });
});

describe('wrestling strikes', () => {
  it('a punch costs stamina, drains and staggers the opponent, and puts the attacker in a short strike animation', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.6;
    const before = s.w[1].stamina;
    step(s, [{ ...idle(), punchJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'punch' && e.by === 0 && e.hit)).toBe(true);
    expect(s.w[0].stamina).toBeCloseTo(T.staminaMax - T.punchCost, 1);
    expect(s.w[1].stamina).toBeCloseTo(before - T.punchDrain, 0);
    expect(s.w[1].state).toBe('stagger');
    expect(s.w[0].state).toBe('strike');
    expect(s.w[0].strike).toBe('punch');
    run(s, [idle(), idle()], T.punchDuration + 0.05);
    expect(s.w[0].state).toBe('idle');
    expect(s.w[0].strike).toBeNull();
  });

  it('a punch out of range whiffs and still goes on cooldown', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + T.punchRange + 0.5;
    step(s, [{ ...idle(), punchJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'punch' && !e.hit)).toBe(true);
    expect(s.w[1].state).toBe('idle');
    expect(s.w[0].cooldown).toBeGreaterThan(0);
    // a second punch during the cooldown does nothing
    run(s, [idle(), idle()], T.punchDuration + 0.02);
    s.w[1].x = s.w[0].x + 0.6;
    step(s, [{ ...idle(), punchJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'punch')).toBe(false);
  });

  it('a leg kick reaches further than a punch and sweeps a staggered opponent down', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + (T.punchRange + T.kickRange) / 2;
    step(s, [{ ...idle(), kickJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'kick' && e.hit && !e.down)).toBe(true);
    expect(s.w[1].state).toBe('stagger');
    expect(s.w[0].stamina).toBeCloseTo(T.staminaMax - T.kickCost, 1);
    // follow-up kick on the staggered opponent sweeps them
    s.w[0].cooldown = 0; s.w[0].state = 'idle'; s.w[0].strike = null;
    s.w[1].vx = 0; s.w[1].vz = 0; s.w[1].x = s.w[0].x + 0.8;
    step(s, [{ ...idle(), kickJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'kick' && e.down)).toBe(true);
    expect(s.w[1].state).toBe('down');
  });

  it('a kick also sweeps a tired opponent who is not staggered', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.8;
    s.w[1].stamina = T.shoveDownStamina + T.kickDrain - 1; // drops below the threshold on the hit
    step(s, [{ ...idle(), kickJust: true }, idle()], DT);
    expect(s.w[1].state).toBe('down');
  });

  it('strikes are refused without the stamina to pay for them', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.6;
    s.w[0].stamina = T.kickCost - 1;
    step(s, [{ ...idle(), kickJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'kick')).toBe(false);
    expect(s.w[0].state).toBe('idle');
  });
});

describe('wrestling CPU escapes', () => {
  function pinWithAi(level: number): WrestlingState {
    const s = downedNextToPinner();
    const mem = createAiMemory();
    const rand = () => 0.5;
    step(s, [{ ...idle(), grapple: true }, idle()], DT, { rand });
    expect(s.pin.active).toBe(true);
    const n = Math.round((T.pinCountSeconds * 3 + 0.2) / DT);
    for (let i = 0; i < n && s.phase !== 'done'; i++) {
      const ai = aiInputs(s, 1, level, DT, mem, rand);
      step(s, [{ ...idle(), grapple: true }, ai], DT, { rand });
      if (!s.pin.active) break;
    }
    return s;
  }

  it('the hard CPU breaks a pin when it is fresh, the easy CPU gets counted out', () => {
    const hard = pinWithAi(1);
    expect(hard.pin.active).toBe(false);
    expect(hard.phase).toBe('fight');
    expect(hard.w[1].state).toBe('idle');
    const easy = pinWithAi(0);
    expect(easy.phase).toBe('done');
    expect(easy.winner).toBe(0);
  });
});

describe('wrestling stamina', () => {
  it('drops on a shove and regenerates while resting', () => {
    const s = fighting();
    const before = s.w[0].stamina;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT);
    expect(s.w[0].stamina).toBeCloseTo(before - T.shoveCost, 1);
    const after = s.w[0].stamina;
    run(s, [idle(), idle()], 1);
    expect(s.w[0].stamina).toBeGreaterThan(after);
    expect(s.w[0].stamina).toBeLessThanOrEqual(T.staminaMax);
  });

  it('refuses a shove without enough stamina', () => {
    const s = fighting();
    s.w[0].stamina = T.shoveCost - 1;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'shove')).toBe(false);
  });
});

describe('wrestling ring-out', () => {
  it('pauses and resets both wrestlers to their starting spots', () => {
    const s = fighting();
    s.w[0].x = 0.5; s.w[0].z = 0.4;
    s.w[1].x = T.ringSize / 2 - 0.05; s.w[1].z = 0;
    s.w[1].stamina = 20;
    // walk wrestler 1 out to the right
    run(s, [idle(), { ...idle(), x: 1, y: 0 }], 0.3);
    expect(insideRing(s.w[1])).toBe(false);
    expect(s.phase).toBe('ringout');
    run(s, [idle(), idle()], T.ringOutPause + 0.1);
    expect(s.phase).toBe('fight');
    expect(s.w[0].x).toBeCloseTo(START_POSITIONS[0].x, 5);
    expect(s.w[0].z).toBeCloseTo(START_POSITIONS[0].z, 5);
    expect(s.w[1].x).toBeCloseTo(START_POSITIONS[1].x, 5);
    expect(s.w[1].stamina).toBeGreaterThan(20);
    expect(s.w[0].state).toBe('idle');
    expect(s.w[1].state).toBe('idle');
  });
});

describe('wrestling grapple and takedown', () => {
  it('starts a grapple only when close enough', () => {
    const far = fighting();
    far.w[1].x = START_POSITIONS[0].x + T.grappleRange + 1;
    step(far, [{ ...idle(), grappleJust: true }, idle()], DT);
    expect(far.grapple.active).toBe(false);
    const near = fighting();
    near.w[1].x = near.w[0].x + T.grappleRange * 0.8;
    step(near, [{ ...idle(), grappleJust: true }, idle()], DT);
    expect(near.grapple.active).toBe(true);
    expect(near.w[0].state).toBe('grapple');
    expect(near.w[1].state).toBe('grapple');
  });

  it('a shove on a standing opponent staggers them and has a cooldown; it only knocks a staggered opponent down when they are tired or hit from behind', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.6;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT);
    expect(s.w[1].state).toBe('stagger');
    expect(s.events.some((e) => e.type === 'takedown')).toBe(false);
    // immediate second shove is blocked by the cooldown
    s.w[1].vx = 0; s.w[1].vz = 0; s.w[1].x = s.w[0].x + 0.6;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT);
    expect(s.events.some((e) => e.type === 'shove')).toBe(false);
    expect(s.w[1].state).toBe('stagger');
    // after the cooldown, a fresh opponent just gets staggered again...
    s.w[0].cooldown = 0; s.w[0].stamina = T.staminaMax;
    s.w[1].vx = 0; s.w[1].vz = 0; s.w[1].x = s.w[0].x + 0.6; s.w[1].facing = -1;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT);
    expect(s.w[1].state).toBe('stagger');
    // ...but a tired staggered opponent goes down
    s.w[0].cooldown = 0; s.w[0].stamina = T.staminaMax;
    s.w[1].stamina = T.shoveDownStamina - 1;
    s.w[1].vx = 0; s.w[1].vz = 0; s.w[1].x = s.w[0].x + 0.6;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT);
    expect(s.w[1].state).toBe('down');
  });

  it('grappling a staggered opponent starts with an advantage', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.6;
    applyStagger(s.w[1], 1);
    step(s, [{ ...idle(), grappleJust: true }, idle()], DT);
    expect(s.grapple.active).toBe(true);
    expect(s.grapple.advantage).toBeGreaterThan(0);
  });

  it('a grappled takedown succeeds with a winning roll and puts the opponent down', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.6;
    step(s, [{ ...idle(), grappleJust: true }, idle()], DT);
    expect(s.grapple.active).toBe(true);
    s.grapple.advantage = 0.8;
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT, { rand: () => 0.01 });
    expect(s.grapple.active).toBe(false);
    expect(s.w[1].state).toBe('down');
    expect(s.events.some((e) => e.type === 'takedown' && e.by === 0)).toBe(true);
  });

  it('a failed takedown staggers the attacker and breaks the grapple', () => {
    const s = fighting();
    s.w[1].x = s.w[0].x + 0.6;
    step(s, [{ ...idle(), grappleJust: true }, idle()], DT);
    step(s, [{ ...idle(), shoveJust: true }, idle()], DT, { rand: () => 0.999 });
    expect(s.grapple.active).toBe(false);
    expect(s.w[0].state).toBe('stagger');
    expect(s.w[1].state).toBe('idle');
  });

  it('a downed wrestler gets back up after the vulnerability window', () => {
    const s = downedNextToPinner();
    run(s, [idle(), idle()], T.downDuration + 0.1);
    expect(s.w[1].state).not.toBe('down');
    expect(s.events.some((e) => e.type === 'getUp') || s.w[1].state === 'stagger' || s.w[1].state === 'idle').toBe(true);
  });

  it('a staggered wrestler recovers', () => {
    const s = fighting();
    applyStagger(s.w[0], 0.5);
    run(s, [idle(), idle()], 0.6);
    expect(s.w[0].state).toBe('idle');
    expect(distance(s.w[0], s.w[1])).toBeGreaterThan(0);
  });
});
