/**
 * Dartboard geometry and scoring, in millimetres on a standard board.
 * Coordinates: x to the right, y DOWN (screen convention), origin at the bull.
 */

export const BOARD = {
  /** Standard segment order clockwise from the top. */
  segments: [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5],
  innerBullR: 6.35,
  outerBullR: 15.9,
  tripleInnerR: 99,
  tripleOuterR: 107,
  doubleInnerR: 162,
  doubleOuterR: 170,
  /** Outer edge of the number ring (total board radius). */
  boardR: 225.5,
};

export type Ring = 'S' | 'D' | 'T' | 'OB' | 'IB' | 'miss';

export interface Hit {
  points: number;
  multiplier: 1 | 2 | 3;
  /** 1..20, 25 for the bulls, 0 for a miss. */
  segment: number;
  ring: Ring;
  label: string;
  isDouble: boolean;
  isBull: boolean;
}

/** Index 0..19 of the segment containing a clockwise-from-top angle (degrees). */
export function segmentIndexAt(angleDeg: number): number {
  const a = (((angleDeg + 9) % 360) + 360) % 360;
  return Math.floor(a / 18);
}

export function segmentAt(angleDeg: number): number {
  return BOARD.segments[segmentIndexAt(angleDeg)];
}

/** Clockwise-from-top angle in degrees of the centre of a segment number. */
export function segmentAngle(segment: number): number {
  const i = BOARD.segments.indexOf(segment);
  return i < 0 ? 0 : i * 18;
}

export function scoreAt(x: number, y: number): Hit {
  const r = Math.hypot(x, y);
  const miss: Hit = { points: 0, multiplier: 1, segment: 0, ring: 'miss', label: 'Miss', isDouble: false, isBull: false };
  if (r > BOARD.doubleOuterR) return miss;
  if (r <= BOARD.innerBullR) return { points: 50, multiplier: 2, segment: 25, ring: 'IB', label: 'BULLSEYE', isDouble: true, isBull: true };
  if (r <= BOARD.outerBullR) return { points: 25, multiplier: 1, segment: 25, ring: 'OB', label: 'Outer bull', isDouble: false, isBull: true };
  const angle = (Math.atan2(x, -y) * 180) / Math.PI; // clockwise from top
  const seg = segmentAt(angle);
  if (r >= BOARD.tripleInnerR && r <= BOARD.tripleOuterR) return { points: seg * 3, multiplier: 3, segment: seg, ring: 'T', label: `T${seg}`, isDouble: false, isBull: false };
  if (r >= BOARD.doubleInnerR) return { points: seg * 2, multiplier: 2, segment: seg, ring: 'D', label: `D${seg}`, isDouble: true, isBull: false };
  return { points: seg, multiplier: 1, segment: seg, ring: 'S', label: `${seg}`, isDouble: false, isBull: false };
}

export interface Target { ring: Ring; segment: number; }

/** Centre point (mm) of a target bed, used by the AI and for the aim helper. */
export function targetPoint(t: Target): { x: number; y: number } {
  if (t.ring === 'IB') return { x: 0, y: 0 };
  if (t.ring === 'OB') return { x: 0, y: -11 };
  const radius = t.ring === 'T' ? (BOARD.tripleInnerR + BOARD.tripleOuterR) / 2
    : t.ring === 'D' ? (BOARD.doubleInnerR + BOARD.doubleOuterR) / 2
    : (BOARD.tripleOuterR + BOARD.doubleInnerR) / 2;
  const a = (segmentAngle(t.segment) * Math.PI) / 180;
  return { x: Math.sin(a) * radius, y: -Math.cos(a) * radius };
}

export function targetLabel(t: Target): string {
  if (t.ring === 'IB') return 'Bull';
  if (t.ring === 'OB') return '25';
  return t.ring === 'S' ? `${t.segment}` : `${t.ring}${t.segment}`;
}

interface Option { label: string; value: number; target: Target; double: boolean; }

const SCORING: Option[] = [];
const FINISHERS: Option[] = [];
for (let s = 20; s >= 1; s--) {
  SCORING.push({ label: `T${s}`, value: s * 3, target: { ring: 'T', segment: s }, double: false });
}
SCORING.push({ label: 'Bull', value: 50, target: { ring: 'IB', segment: 25 }, double: true });
for (let s = 20; s >= 1; s--) SCORING.push({ label: `D${s}`, value: s * 2, target: { ring: 'D', segment: s }, double: true });
for (let s = 20; s >= 1; s--) SCORING.push({ label: `${s}`, value: s, target: { ring: 'S', segment: s }, double: false });
SCORING.push({ label: '25', value: 25, target: { ring: 'OB', segment: 25 }, double: false });
for (let s = 20; s >= 1; s--) FINISHERS.push({ label: `D${s}`, value: s * 2, target: { ring: 'D', segment: s }, double: true });
FINISHERS.push({ label: 'Bull', value: 50, target: { ring: 'IB', segment: 25 }, double: true });

/** Preference for the finishing double: lower is better. */
function finishRank(label: string): number {
  const pref = ['D16', 'D20', 'Bull', 'D8', 'D10', 'D12', 'D18', 'D4', 'D2', 'D1'];
  const i = pref.indexOf(label);
  return i < 0 ? 20 : i;
}

export interface Checkout { darts: Option[]; text: string; }

/**
 * All sensible checkouts for `remaining` with `dartsLeft` darts, best first, or null if no finish exists.
 * Fewest darts first; then nicest finishing double; then higher-scoring first darts.
 */
export function checkoutOptions(remaining: number, dartsLeft: number): Checkout[] | null {
  if (remaining < 2 || dartsLeft < 1 || remaining > 170) return null;
  const results: Checkout[] = [];
  for (let n = 1; n <= Math.min(3, dartsLeft); n++) {
    const found: Checkout[] = [];
    const seen = new Set<string>();
    const rec = (depth: number, left: number, acc: Option[], minIdx: number) => {
      if (depth === n - 1) {
        for (const f of FINISHERS) {
          if (f.value === left) {
            const darts = [...acc, f];
            const key = darts.map((d) => d.label).join(' ');
            if (!seen.has(key)) { seen.add(key); found.push({ darts, text: key }); }
          }
        }
        return;
      }
      for (let i = minIdx; i < SCORING.length; i++) {
        const o = SCORING[i];
        if (o.value >= left) continue;
        rec(depth + 1, left - o.value, [...acc, o], i);
      }
    };
    rec(0, remaining, [], 0);
    if (found.length) {
      found.sort((a, b) => {
        const fa = finishRank(a.darts[a.darts.length - 1].label);
        const fb = finishRank(b.darts[b.darts.length - 1].label);
        if (fa !== fb) return fa - fb;
        for (let i = 0; i < a.darts.length - 1; i++) {
          if (a.darts[i].value !== b.darts[i].value) return b.darts[i].value - a.darts[i].value;
        }
        return 0;
      });
      results.push(...found);
      break; // fewer darts always wins
    }
  }
  return results.length ? results : null;
}

/** Suggested checkout strings (best first, up to `max`), or null. */
export function checkouts(remaining: number, dartsLeft: number, max = 3): string[] | null {
  const opts = checkoutOptions(remaining, dartsLeft);
  return opts ? opts.slice(0, max).map((c) => c.text) : null;
}

/**
 * What the AI should aim at: the first dart of the best checkout when a finish is on, otherwise a
 * setup shot that leaves a nice two-dart finish, otherwise T20.
 */
export function aiTarget(remaining: number, dartsLeft: number): Target {
  const co = checkoutOptions(remaining, dartsLeft);
  if (co) return co[0].darts[0].target;
  // Setup: leave a finish for the remaining darts (or next turn), preferring 32 / 40 / 50 / 16.
  const nice = [32, 40, 50, 16, 24, 36, 20, 8, 4, 2];
  const dartsAfter = Math.max(1, dartsLeft - 1);
  let best: { target: Target; score: number } | null = null;
  for (const o of SCORING) {
    if (o.double && o.target.ring !== 'IB') continue;
    const left = remaining - o.value;
    if (left < 2) continue;
    let score = -Infinity;
    const niceIdx = nice.indexOf(left);
    if (niceIdx >= 0) score = 100 - niceIdx * 5 + o.value * 0.1;
    else if (left <= 170 && checkoutOptions(left, Math.min(3, dartsAfter))) score = 50 + o.value * 0.1;
    else if (left <= 170 && checkoutOptions(left, 3)) score = 20 + o.value * 0.2;
    else score = o.value * 0.3;
    if (!best || score > best.score) best = { target: o.target, score };
  }
  if (remaining > 230 || !best) return { ring: 'T', segment: 20 };
  return best.target;
}

/** Gaussian sample (Box-Muller). */
export function gaussian(sd: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * sd;
}
