import Phaser from 'phaser';
import { CHARACTERS, type Character, type CharacterId } from '../core/characters';
import { createCanvas, roundRect, shade } from './canvas';
import { QUALITY } from '../core/quality';

/** Every character sheet frame is FRAME x FRAME; feet sit near y = 205, centre x = 110. */
export const FRAME = 220;
/** Sheets are rasterised at this multiple of FRAME so sprites stay crisp when scaled up on big screens (1 on phones). */
export const SHEET_RES = QUALITY.sheetRes;

export type BasePoseName =
  | 'idle0' | 'idle1' | 'run0' | 'run1' | 'run2' | 'run3' | 'swing0' | 'swing1' | 'swing2'
  | 'shoot0' | 'shoot1' | 'throw0' | 'throw1' | 'cheer0' | 'cheer1' | 'sad' | 'grapple' | 'down' | 'crouch' | 'push' | 'dizzy'
  | 'bat0' | 'bat1' | 'bat2' | 'bat3'
  | 'skate0' | 'skate1' | 'goalie' | 'wrist';
/** Every pose also exists as a back view (`back-<pose>`) for behind-the-player camera angles. */
export type PoseName = BasePoseName | `back-${BasePoseName}`;

interface Pose {
  lArm: number; rArm: number;       // degrees, 0 = hanging down, positive = raised outward (screen left arm rotates counter-clockwise)
  lBend?: number; rBend?: number;   // forearm bend degrees
  lLeg: number; rLeg: number;
  crouch?: number;                  // 0..1
  lean?: number;                    // torso lean degrees (positive leans right)
  jump?: number;                    // px lifted
  face: 'smile' | 'grin' | 'focus' | 'ouch' | 'shout' | 'dizzy';
  rotate?: number;                  // whole-body rotation degrees (down pose)
  armsFront?: boolean;              // draw both arms in front of torso
  back?: boolean;                   // seen from behind: no face, hair covers the head, number on the back
}

const BASE_POSES: Record<BasePoseName, Pose> = {
  idle0: { lArm: 8, rArm: 8, lLeg: 0, rLeg: 0, face: 'smile' },
  idle1: { lArm: 12, rArm: 12, lLeg: 0, rLeg: 0, face: 'smile', jump: -3 },
  run0: { lArm: 60, rArm: -50, lLeg: 35, rLeg: -30, face: 'focus', lean: 6, lBend: 60, rBend: 60 },
  run1: { lArm: 15, rArm: 15, lLeg: 5, rLeg: 5, face: 'focus', lean: 6, jump: 4, lBend: 50, rBend: 50 },
  run2: { lArm: -50, rArm: 60, lLeg: -30, rLeg: 35, face: 'focus', lean: 6, lBend: 60, rBend: 60 },
  run3: { lArm: 15, rArm: 15, lLeg: 5, rLeg: 5, face: 'focus', lean: 6, jump: 4, lBend: 50, rBend: 50 },
  swing0: { lArm: 150, rArm: 120, lBend: 70, rBend: 50, lLeg: 10, rLeg: -5, face: 'focus', lean: -8, crouch: 0.2, armsFront: true },
  swing1: { lArm: 95, rArm: -95, lBend: 0, rBend: 0, lLeg: 15, rLeg: -20, face: 'shout', lean: 4, crouch: 0.15, armsFront: true },
  swing2: { lArm: -140, rArm: -120, lBend: 30, rBend: 40, lLeg: 20, rLeg: -25, face: 'grin', lean: 14, crouch: 0.1, armsFront: true },
  shoot0: { lArm: 70, rArm: 70, lBend: 110, rBend: 110, lLeg: 15, rLeg: -15, face: 'focus', crouch: 0.45, armsFront: true },
  shoot1: { lArm: 170, rArm: 160, lBend: 10, rBend: 25, lLeg: 0, rLeg: 0, face: 'focus', jump: 10, armsFront: true },
  throw0: { lArm: 40, rArm: 150, rBend: 90, lLeg: 10, rLeg: -10, face: 'focus', lean: -6 },
  throw1: { lArm: 20, rArm: -100, rBend: 0, lLeg: 25, rLeg: -15, face: 'shout', lean: 10, armsFront: true },
  cheer0: { lArm: 165, rArm: 165, lLeg: 0, rLeg: 0, face: 'grin', jump: 0 },
  cheer1: { lArm: 150, rArm: 175, lBend: 20, lLeg: 25, rLeg: -25, face: 'shout', jump: 22 },
  sad: { lArm: 2, rArm: 2, lLeg: 0, rLeg: 0, face: 'ouch', lean: 3, crouch: 0.1 },
  grapple: { lArm: 80, rArm: 80, lBend: 60, rBend: 60, lLeg: 25, rLeg: -25, face: 'focus', crouch: 0.35, armsFront: true },
  down: { lArm: 60, rArm: 70, lBend: 20, lLeg: 10, rLeg: -5, face: 'dizzy', rotate: 90 },
  crouch: { lArm: 30, rArm: 30, lBend: 70, rBend: 70, lLeg: 25, rLeg: -25, face: 'focus', crouch: 0.4 },
  push: { lArm: 100, rArm: 100, lBend: 10, rBend: 10, lLeg: 30, rLeg: -30, face: 'shout', lean: 12, crouch: 0.25, armsFront: true },
  dizzy: { lArm: 20, rArm: 25, lLeg: 10, rLeg: -10, face: 'dizzy', lean: -5 },
  // Right-handed batter (seen from behind in the derby): stance with the bat over the right
  // shoulder, a short stride/load, contact with arms extended, and the wrap-around follow-through.
  bat0: { lArm: 95, rArm: -40, lBend: 0, rBend: -130, lLeg: 22, rLeg: -18, face: 'focus', lean: -3, crouch: 0.28, armsFront: true },
  bat1: { lArm: 100, rArm: -45, lBend: 0, rBend: -125, lLeg: 30, rLeg: -14, face: 'focus', lean: -7, crouch: 0.34, armsFront: true },
  bat2: { lArm: 92, rArm: -92, lBend: 0, rBend: 0, lLeg: 24, rLeg: -24, face: 'shout', lean: 5, crouch: 0.22, armsFront: true },
  bat3: { lArm: 30, rArm: 90, lBend: 150, rBend: 0, lLeg: 26, rLeg: -28, face: 'grin', lean: 12, crouch: 0.14, armsFront: true },
  // hockey: low skating stance with both hands on the stick, legs alternating
  skate0: { lArm: 38, rArm: 34, lBend: 78, rBend: 70, lLeg: 32, rLeg: -26, face: 'focus', lean: 5, crouch: 0.3, armsFront: true },
  skate1: { lArm: 34, rArm: 38, lBend: 70, rBend: 78, lLeg: -26, rLeg: 32, face: 'focus', lean: 5, crouch: 0.3, armsFront: true },
  // goalie: wide butterfly-ready stance, hands low and out
  goalie: { lArm: 52, rArm: 52, lBend: 48, rBend: 48, lLeg: 40, rLeg: -40, face: 'focus', crouch: 0.48, armsFront: true },
  // wrist shot follow-through: hands pushed forward and across
  wrist: { lArm: 88, rArm: 60, lBend: 20, rBend: 35, lLeg: 28, rLeg: -24, face: 'shout', lean: 10, crouch: 0.24, armsFront: true },
};

/**
 * Frame-local hand positions (pixels inside the FRAME x FRAME cell) for a pose, using the same limb
 * geometry as drawCharacterFrame. Lets scenes attach held items (a bat) to the hands exactly.
 */
export function handPositions(poseName: PoseName, facing: 1 | -1 = 1): { left: { x: number; y: number }; right: { x: number; y: number } } {
  const pose = POSES[poseName];
  const cx = 110;
  const crouch = pose.crouch ?? 0;
  const lift = -(pose.jump ?? 0);
  const baseFeet = 206 + lift;
  const hipY = baseFeet - 50 + crouch * 22;
  const torsoTop = hipY - 66 + crouch * 6;
  const shoulderY = torsoTop + 12;
  const hand = (sx: number, angleDeg: number, bendDeg: number, side: number) => {
    const a = deg(angleDeg) * side;
    const b = deg(bendDeg) * side;
    const ux = sx + Math.sin(a) * 30, uy = shoulderY + Math.cos(a) * 30;
    return { x: ux + Math.sin(a + b) * 28, y: uy + Math.cos(a + b) * 28 };
  };
  let left = hand(cx - 32, pose.lArm, pose.lBend ?? 0, 1);
  let right = hand(cx + 32, pose.rArm, pose.rBend ?? 0, -1);
  if (pose.rotate) {
    const rot = deg(pose.rotate);
    const r = (p: { x: number; y: number }) => { const dx = p.x - 110, dy = p.y - 110; return { x: 110 + dx * Math.cos(rot) - dy * Math.sin(rot), y: 110 + dx * Math.sin(rot) + dy * Math.cos(rot) }; };
    left = r(left); right = r(right);
  }
  if (facing === -1) { left = { x: 220 - left.x, y: left.y }; right = { x: 220 - right.x, y: right.y }; }
  return { left, right };
}

export const POSES: Record<PoseName, Pose> = Object.fromEntries([
  ...Object.entries(BASE_POSES),
  ...Object.entries(BASE_POSES).map(([k, v]) => [`back-${k}`, { ...v, back: true, lean: v.lean ? -v.lean : v.lean }]),
]) as Record<PoseName, Pose>;

const POSE_NAMES = Object.keys(POSES) as PoseName[];

function deg(d: number): number { return (d * Math.PI) / 180; }

const OUTLINE = 'rgba(58,34,22,0.6)';
const OUTLINE_W = 2;

/** Iris colour per character, derived from their palette (kept here so core/characters.ts is untouched). */
function irisColor(ch: Character): string {
  switch (ch.id) {
    case 'will': return '#3f7fcf';
    case 'vinnie': return '#5a3a22';
    case 'bryan': return '#3f9a5a';
    case 'ben': return '#8a6a3a';
    default: return '#4a4a4a';
  }
}

/** Stroke a segment with a cylindrical (across-the-limb) gradient. */
function cylinderStroke(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number, color: string): void {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const g = ctx.createLinearGradient(mx - px * width / 2, my - py * width / 2, mx + px * width / 2, my + py * width / 2);
  g.addColorStop(0, shade(color, 0.2));
  g.addColorStop(0.4, color);
  g.addColorStop(1, shade(color, -0.35));
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

interface LimbResult { x: number; y: number; joint: { x: number; y: number }; angleEnd: number; }

/**
 * Two-segment limb (upper + lower). Angle measured from straight down; caller flips sign per side.
 * Draws the outline first, then the shaded segments and a joint shadow.
 */
function drawLimb(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number, color: string, bend = 0, bendLen = 0, bendColor?: string): LimbResult {
  const ex = x + Math.sin(angle) * len;
  const ey = y + Math.cos(angle) * len;
  const a2 = angle + bend;
  const fx = bendLen > 0 ? ex + Math.sin(a2) * bendLen : ex;
  const fy = bendLen > 0 ? ey + Math.cos(a2) * bendLen : ey;
  // outline
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width + OUTLINE_W * 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  if (bendLen > 0) ctx.lineTo(fx, fy);
  ctx.stroke();
  cylinderStroke(ctx, x, y, ex, ey, width, color);
  if (bendLen > 0) {
    cylinderStroke(ctx, ex, ey, fx, fy, width * 0.92, bendColor ?? color);
    // joint (elbow / knee) crease
    ctx.fillStyle = 'rgba(60,30,20,0.16)';
    ctx.beginPath();
    ctx.ellipse(ex, ey, width * 0.42, width * 0.26, angle + bend / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return { x: fx, y: fy, joint: { x: ex, y: ey }, angleEnd: bendLen > 0 ? a2 : angle };
}

function drawHand(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, skin: string, angle: number): void {
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r * 1.1);
  g.addColorStop(0, shade(skin, 0.18));
  g.addColorStop(0.7, skin);
  g.addColorStop(1, shade(skin, -0.3));
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  // thumb hint
  const tx = x + Math.cos(angle + Math.PI / 2) * r * 0.75;
  const ty = y + Math.sin(angle + Math.PI / 2) * r * 0.75;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(tx, ty, r * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.arc(x + r * 0.15, y + r * 0.1, r * 0.35, 0, Math.PI * 2); ctx.fill();
}

function drawShoe(ctx: CanvasRenderingContext2D, x: number, y: number, side: number, color: string): void {
  // side: -1 left foot (toe points left), +1 right foot
  ctx.save();
  ctx.translate(x, y);
  // sole
  ctx.fillStyle = '#2b2b2b';
  ctx.beginPath(); ctx.ellipse(side * 3, 9, 21, 7, 0, 0, Math.PI * 2); ctx.fill();
  // upper
  const g = ctx.createLinearGradient(0, -8, 0, 10);
  g.addColorStop(0, shade(color, 0.25));
  g.addColorStop(0.6, color);
  g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.beginPath();
  ctx.ellipse(side * 3, 4, 20, 11, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // toe cap
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.ellipse(side * 12, 4, 7, 6, 0, 0, Math.PI * 2); ctx.fill();
  // laces
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 3; i++) {
    const lx = -side * 2 + side * i * 4;
    ctx.beginPath(); ctx.moveTo(lx - 3, -1 + i * 1.5); ctx.lineTo(lx + 3, 1 + i * 1.5); ctx.stroke();
  }
  // highlight
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(-side * 4, -2, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Draw one character frame at the canvas origin (frame is FRAME x FRAME). */
export function drawCharacterFrame(ctx: CanvasRenderingContext2D, ch: Character, pose: Pose, facing: 1 | -1 = 1): void {
  ctx.save();
  ctx.translate(FRAME / 2, FRAME / 2);
  if (pose.rotate) ctx.rotate(deg(pose.rotate));
  if (facing === -1) ctx.scale(-1, 1);
  ctx.translate(-FRAME / 2, -FRAME / 2);
  const cx = 110;
  const crouch = pose.crouch ?? 0;
  const lift = -(pose.jump ?? 0);
  const baseFeet = 206 + lift;
  const hipY = baseFeet - 50 + crouch * 22;
  const legLen = 46 - crouch * 18;
  const torsoTop = hipY - 66 + crouch * 6;
  const torsoH = 68 - crouch * 4;
  const shoulderY = torsoTop + 12;
  const headY = torsoTop - 30;
  const headR = 42;
  const lean = deg(pose.lean ?? 0);
  const skin = ch.skin;

  // ---- legs (always behind torso) ----
  const legs: [number, number][] = [[cx - 17, pose.lLeg], [cx + 17, pose.rLeg]];
  for (const [lx, la] of legs) {
    const a = deg(la) * (lx < cx ? 1 : -1);
    const foot = drawLimb(ctx, lx, hipY, -a, legLen, 24, skin);
    drawShoe(ctx, foot.x, foot.y + 2, lx < cx ? -1 : 1, ch.shoes);
  }
  // shorts with waistband and seam
  ctx.save();
  ctx.translate(cx, hipY - 10);
  ctx.rotate(lean);
  const sg = ctx.createLinearGradient(-36, 0, 36, 0);
  sg.addColorStop(0, shade(ch.shorts, 0.18));
  sg.addColorStop(0.5, ch.shorts);
  sg.addColorStop(1, shade(ch.shorts, -0.3));
  ctx.fillStyle = sg;
  roundRect(ctx, -37, -4, 74, 36, 12);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  ctx.fillStyle = shade(ch.shorts, -0.35);
  roundRect(ctx, -37, -4, 74, 9, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, 30); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.moveTo(-30, 10); ctx.quadraticCurveTo(-28, 20, -32, 28); ctx.stroke();
  ctx.restore();

  // ---- arms ----
  const shoulders: [number, number, number, number][] = [
    [cx - 32, pose.lArm, pose.lBend ?? 0, 1],
    [cx + 32, pose.rArm, pose.rBend ?? 0, -1],
  ];
  const drawArm = (sx: number, angleDeg: number, bendDeg: number, side: number) => {
    const a = deg(angleDeg) * side;
    const b = deg(bendDeg) * side;
    // upper arm in sleeve colour, forearm in skin
    const res = drawLimb(ctx, sx, shoulderY, a, 30, 22, ch.shirtShade, b, 28, skin);
    // sleeve hem
    ctx.strokeStyle = shade(ch.shirt, -0.45);
    ctx.lineWidth = 2;
    const hx = sx + Math.sin(a) * 18, hy = shoulderY + Math.cos(a) * 18;
    ctx.beginPath();
    ctx.ellipse(hx, hy, 11, 4, a, 0, Math.PI * 2);
    ctx.stroke();
    drawHand(ctx, res.x, res.y, 12, skin, res.angleEnd + (side > 0 ? Math.PI : 0));
  };
  if (!pose.armsFront) for (const [sx, a, b, side] of shoulders) drawArm(sx, a, b, side);

  // ---- torso ----
  ctx.save();
  ctx.translate(cx, torsoTop + torsoH / 2);
  ctx.rotate(lean);
  const tg = ctx.createLinearGradient(-40, 0, 40, 0);
  tg.addColorStop(0, shade(ch.shirt, 0.25));
  tg.addColorStop(0.45, ch.shirt);
  tg.addColorStop(1, shade(ch.shirt, -0.32));
  ctx.fillStyle = tg;
  roundRect(ctx, -40, -torsoH / 2, 80, torsoH + 6, 20);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // sleeves (short, over the shoulders)
  for (const s of [-1, 1]) {
    const slg = ctx.createLinearGradient(s * 30, -torsoH / 2, s * 52, -torsoH / 2 + 26);
    slg.addColorStop(0, shade(ch.shirt, s < 0 ? 0.2 : -0.05));
    slg.addColorStop(1, shade(ch.shirt, s < 0 ? -0.1 : -0.4));
    ctx.fillStyle = slg;
    ctx.beginPath();
    ctx.moveTo(s * 30, -torsoH / 2 + 2);
    ctx.quadraticCurveTo(s * 54, -torsoH / 2 + 2, s * 52, -torsoH / 2 + 24);
    ctx.lineTo(s * 36, -torsoH / 2 + 26);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = shade(ch.shirt, -0.45);
    ctx.beginPath(); ctx.moveTo(s * 36, -torsoH / 2 + 4); ctx.quadraticCurveTo(s * 40, -torsoH / 2 + 14, s * 36, -torsoH / 2 + 26); ctx.stroke();
  }
  // cloth folds
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-14, torsoH / 2 - 14); ctx.quadraticCurveTo(-8, torsoH / 2 - 4, -18, torsoH / 2 + 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(18, torsoH / 2 - 18); ctx.quadraticCurveTo(14, torsoH / 2 - 6, 22, torsoH / 2 + 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath(); ctx.moveTo(-28, -torsoH / 2 + 14); ctx.quadraticCurveTo(-30, 0, -26, torsoH / 2 - 6); ctx.stroke();
  // hem
  ctx.strokeStyle = shade(ch.shirt, -0.45);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-36, torsoH / 2 + 1); ctx.lineTo(36, torsoH / 2 + 1); ctx.stroke();
  // collar
  ctx.fillStyle = shade(ch.shirt, -0.4);
  ctx.beginPath();
  ctx.ellipse(0, -torsoH / 2 + 4, 16, 7, 0, 0, Math.PI);
  ctx.fill();
  ctx.strokeStyle = shade(ch.shirt, 0.3);
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.ellipse(0, -torsoH / 2 + 4, 17, 8, 0, 0, Math.PI); ctx.stroke();
  // ambient occlusion under the head
  const ao = ctx.createRadialGradient(0, -torsoH / 2 + 2, 2, 0, -torsoH / 2 + 2, 30);
  ao.addColorStop(0, 'rgba(0,0,0,0.28)');
  ao.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = ao;
  ctx.fillRect(-40, -torsoH / 2 - 2, 80, 30);
  // number (front or back)
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.font = `bold ${pose.back ? 34 : 30}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.scale(facing, 1); // keep the digits readable on mirrored (left-facing) frames
  ctx.fillText(ch.number, 0, pose.back ? 8 : 6);
  ctx.strokeText(ch.number, 0, pose.back ? 8 : 6);
  ctx.restore();
  ctx.restore();

  if (pose.armsFront) for (const [sx, a, b, side] of shoulders) drawArm(sx, a, b, side);

  // ---- head ----
  const hx = cx + Math.sin(lean) * 30;
  const hy = headY + 2;
  // neck
  const ng = ctx.createLinearGradient(hx - 10, 0, hx + 10, 0);
  ng.addColorStop(0, ch.skinShade);
  ng.addColorStop(1, shade(ch.skinShade, -0.3));
  ctx.fillStyle = ng;
  ctx.fillRect(hx - 10, hy + 30, 20, 14);
  const hg = ctx.createRadialGradient(hx - 14, hy - 16, 6, hx, hy, headR + 6);
  hg.addColorStop(0, shade(skin, 0.22));
  hg.addColorStop(0.6, skin);
  hg.addColorStop(0.9, ch.skinShade);
  hg.addColorStop(1, shade(ch.skinShade, -0.25));
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.stroke();
  // rim light (upper left)
  ctx.strokeStyle = 'rgba(255,255,240,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(hx, hy, headR - 3, Math.PI * 1.15, Math.PI * 1.6);
  ctx.stroke();
  // ears
  for (const s of [-1, 1]) {
    const eg = ctx.createRadialGradient(hx + s * (headR - 4), hy + 2, 1, hx + s * (headR - 2), hy + 4, 10);
    eg.addColorStop(0, shade(skin, 0.1));
    eg.addColorStop(1, ch.skinShade);
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(hx + s * (headR - 2), hy + 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120,70,50,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(hx + s * (headR - 1), hy + 4, 4.5, s < 0 ? Math.PI * 0.6 : Math.PI * 1.4, s < 0 ? Math.PI * 1.4 : Math.PI * 2.4);
    ctx.stroke();
  }
  if (pose.back) {
    drawBackHair(ctx, hx, hy, headR, ch);
  } else {
    // cheeks
    for (const s of [-1, 1]) {
      const cg = ctx.createRadialGradient(hx + s * 24, hy + 14, 1, hx + s * 24, hy + 14, 11);
      cg.addColorStop(0, 'rgba(255,110,110,0.32)');
      cg.addColorStop(1, 'rgba(255,110,110,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(hx + s * 24, hy + 14, 11, 7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    drawFace(ctx, hx, hy, pose.face, ch);
    drawHair(ctx, hx, hy, headR, ch);
  }
  ctx.restore();
}

function hairGradient(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, ch: Character): CanvasGradient {
  const g = ctx.createRadialGradient(hx - r * 0.5, hy - r * 0.8, r * 0.1, hx, hy - r * 0.2, r * 1.3);
  g.addColorStop(0, shade(ch.hair, 0.35));
  g.addColorStop(0.5, ch.hair);
  g.addColorStop(1, shade(ch.hair, -0.35));
  return g;
}

function hairStrands(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, ch: Character, count: number, yBias: number): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const ang = Math.PI + t * Math.PI;
    const sx = hx + Math.cos(ang) * r * 0.7;
    const sy = hy + yBias + Math.sin(ang) * r * 0.6;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + Math.cos(ang) * 6, sy + Math.sin(ang) * 10, sx + Math.cos(ang) * 10, sy + 10);
    ctx.stroke();
  }
}

function drawCap(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, back: boolean): void {
  const capCol = '#2f5d8a';
  const cg = ctx.createRadialGradient(hx - r * 0.5, hy - r * 0.9, r * 0.1, hx, hy - r * 0.3, r * 1.2);
  cg.addColorStop(0, shade(capCol, 0.35));
  cg.addColorStop(0.6, capCol);
  cg.addColorStop(1, shade(capCol, -0.35));
  ctx.fillStyle = cg;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.beginPath();
  ctx.arc(hx, hy - 8, r + 2, Math.PI, Math.PI * 2);
  ctx.quadraticCurveTo(hx, hy + 2, hx - r - 2, hy - 8);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // panel seams
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx, hy - r - 6); ctx.quadraticCurveTo(hx - 2, hy - r * 0.5, hx, hy - 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx - r * 0.55, hy - r * 0.78); ctx.quadraticCurveTo(hx - r * 0.5, hy - r * 0.4, hx - r * 0.6, hy - 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(hx + r * 0.55, hy - r * 0.78); ctx.quadraticCurveTo(hx + r * 0.5, hy - r * 0.4, hx + r * 0.6, hy - 6); ctx.stroke();
  // band
  ctx.fillStyle = shade(capCol, -0.4);
  roundRect(ctx, hx - r - 2, hy - 12, 2 * r + 4, 8, 3);
  ctx.fill();
  if (back) {
    // strap and opening
    ctx.fillStyle = shade(capCol, -0.5);
    roundRect(ctx, hx - 16, hy - 8, 32, 8, 3);
    ctx.fill();
    ctx.fillStyle = '#3a2412';
    ctx.beginPath(); ctx.ellipse(hx, hy - 10, 9, 4, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    // brim with curve and underside
    const bg = ctx.createLinearGradient(hx, hy - 16, hx, hy - 2);
    bg.addColorStop(0, shade(capCol, -0.2));
    bg.addColorStop(1, shade(capCol, -0.55));
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.moveTo(hx - 6, hy - 14);
    ctx.quadraticCurveTo(hx + r * 0.9, hy - 24, hx + r + 24, hy - 10);
    ctx.quadraticCurveTo(hx + r * 0.9, hy - 2, hx - 6, hy - 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_W;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx, hy - 13); ctx.quadraticCurveTo(hx + r * 0.9, hy - 21, hx + r + 18, hy - 11); ctx.stroke();
  }
  // button
  ctx.fillStyle = '#f5c518';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(hx, hy - r - 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

/** Back of the head: hair covers most of the skull, cap shows its back strap. */
function drawBackHair(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, ch: Character): void {
  ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  ctx.beginPath();
  ctx.arc(hx, hy - 2, r + 1, Math.PI * 0.9, Math.PI * 2.1);
  ctx.quadraticCurveTo(hx + r * 0.5, hy + r * 0.55, hx, hy + r * 0.45);
  ctx.quadraticCurveTo(hx - r * 0.5, hy + r * 0.55, hx - r - 1, hy + r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // nape shadow
  const ng = ctx.createLinearGradient(0, hy + r * 0.1, 0, hy + r * 0.5);
  ng.addColorStop(0, 'rgba(0,0,0,0)');
  ng.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.arc(hx, hy - 2, r, 0, Math.PI);
  ctx.fill();
  if (ch.hairStyle === 'spiky') {
    ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
    ctx.beginPath();
    for (let i = 0; i <= 7; i++) {
      const ang = Math.PI + (i / 7) * Math.PI;
      const rr = r + (i % 2 === 0 ? 20 : 2);
      ctx.lineTo(hx + Math.cos(ang) * rr, hy - 6 + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    hairStrands(ctx, hx, hy, r, ch, 8, -8);
  } else if (ch.hairStyle === 'curly') {
    for (let i = 0; i <= 10; i++) {
      const ang = Math.PI * 0.95 + (i / 10) * Math.PI * 1.1;
      const cxx = hx + Math.cos(ang) * (r - 4), cyy = hy - 4 + Math.sin(ang) * (r - 4);
      const cg = ctx.createRadialGradient(cxx - 5, cyy - 5, 1, cxx, cyy, 15);
      cg.addColorStop(0, shade(ch.hair, 0.4));
      cg.addColorStop(1, shade(ch.hair, -0.3));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(cxx, cyy, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const cxx = hx - 20 + i * 8, cyy = hy + 10 + (i % 2) * 6;
      const cg = ctx.createRadialGradient(cxx - 4, cyy - 4, 1, cxx, cyy, 11);
      cg.addColorStop(0, shade(ch.hair, 0.35));
      cg.addColorStop(1, shade(ch.hair, -0.3));
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cxx, cyy, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  } else if (ch.hairStyle === 'cap') {
    drawCap(ctx, hx, hy, r, true);
  } else {
    hairStrands(ctx, hx, hy, r, ch, 9, -4);
    // crown swirl
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(hx + 6, hy - 14, 7, 0, Math.PI * 1.6); ctx.stroke();
  }
}

function drawEye(ctx: CanvasRenderingContext2D, ex: number, ey: number, rx: number, ry: number, iris: string, lookX = 1.5, lookY = 1): void {
  // white
  const wg = ctx.createRadialGradient(ex, ey - ry * 0.3, 1, ex, ey, ry * 1.2);
  wg.addColorStop(0, '#ffffff');
  wg.addColorStop(1, '#dfe4ea');
  ctx.fillStyle = wg;
  ctx.beginPath();
  ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,40,30,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // iris + pupil (clipped to the eye)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  const ir = Math.min(rx, ry) * 0.62;
  const ig = ctx.createRadialGradient(ex + lookX, ey + lookY, ir * 0.1, ex + lookX, ey + lookY, ir);
  ig.addColorStop(0, shade(iris, 0.3));
  ig.addColorStop(0.7, iris);
  ig.addColorStop(1, shade(iris, -0.45));
  ctx.fillStyle = ig;
  ctx.beginPath(); ctx.arc(ex + lookX, ey + lookY, ir, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a120e';
  ctx.beginPath(); ctx.arc(ex + lookX, ey + lookY, ir * 0.5, 0, Math.PI * 2); ctx.fill();
  // upper eyelid shadow
  const lg = ctx.createLinearGradient(0, ey - ry, 0, ey - ry * 0.3);
  lg.addColorStop(0, 'rgba(60,30,20,0.35)');
  lg.addColorStop(1, 'rgba(60,30,20,0)');
  ctx.fillStyle = lg;
  ctx.fillRect(ex - rx, ey - ry, rx * 2, ry);
  ctx.restore();
  // highlights
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.arc(ex + lookX + 2.2, ey + lookY - 2.5, 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(ex + lookX - 1.5, ey + lookY + 2, 1, 0, Math.PI * 2); ctx.fill();
  // lid line
  ctx.strokeStyle = 'rgba(60,35,25,0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(ex, ey, rx, ry, 0, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

function drawBrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, ctrlY: number, ch: Character): void {
  const col = shade(ch.hair, -0.15);
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo((x1 + x2) / 2, ctrlY, x2, y2);
  ctx.stroke();
  // individual hairs
  ctx.lineWidth = 1;
  ctx.strokeStyle = shade(ch.hair, -0.35);
  for (let i = 0; i < 4; i++) {
    const t = 0.2 + i * 0.2;
    const px = x1 + (x2 - x1) * t;
    const py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * ctrlY + t * t * y2;
    ctx.beginPath();
    ctx.moveTo(px, py + 1.5);
    ctx.lineTo(px + 1.5, py - 2.5);
    ctx.stroke();
  }
}

function drawFace(ctx: CanvasRenderingContext2D, hx: number, hy: number, face: Pose['face'], ch: Character): void {
  const eyeY = hy + 2;
  const eyeDX = 15;
  const iris = irisColor(ch);
  const focused = face === 'focus' || face === 'shout';
  for (const s of [-1, 1]) {
    const ex = hx + s * eyeDX;
    if (face === 'dizzy') {
      ctx.strokeStyle = '#2b1d14';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - 6, eyeY - 6); ctx.lineTo(ex + 6, eyeY + 6);
      ctx.moveTo(ex + 6, eyeY - 6); ctx.lineTo(ex - 6, eyeY + 6);
      ctx.stroke();
      continue;
    }
    drawEye(ctx, ex, eyeY, 8.5, focused ? 6.5 : 10, iris, face === 'ouch' ? 0.5 : 1.5, face === 'ouch' ? 2 : 1);
    // brows
    if (focused) drawBrow(ctx, ex - 9, eyeY - 14 + (s === -1 ? 0 : 5), ex + 9, eyeY - 14 + (s === -1 ? 5 : 0), eyeY - 15, ch);
    else if (face === 'ouch') drawBrow(ctx, ex - 9, eyeY - 12 + (s === -1 ? 5 : 0), ex + 9, eyeY - 12 + (s === -1 ? 0 : 5), eyeY - 11, ch);
    else drawBrow(ctx, ex - 9, eyeY - 15, ex + 9, eyeY - 15, eyeY - 21, ch);
  }
  if (ch.glasses) {
    for (const s of [-1, 1]) {
      const gx = hx + s * eyeDX;
      // lens tint + reflection
      ctx.fillStyle = 'rgba(180,220,255,0.18)';
      ctx.beginPath(); ctx.arc(gx, eyeY, 12.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2d3b4a';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(gx, eyeY, 12.5, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, eyeY, 9.5, Math.PI * 1.15, Math.PI * 1.5); ctx.stroke();
    }
    ctx.strokeStyle = '#2d3b4a';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(hx - 3, eyeY); ctx.lineTo(hx + 3, eyeY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - eyeDX - 12, eyeY - 2); ctx.lineTo(hx - 38, eyeY - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx + eyeDX + 12, eyeY - 2); ctx.lineTo(hx + 38, eyeY - 4); ctx.stroke();
  }
  // nose with shadow
  ctx.fillStyle = 'rgba(90,50,30,0.18)';
  ctx.beginPath();
  ctx.ellipse(hx + 3, eyeY + 12, 5, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,30,0.55)';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx + 1, eyeY + 5);
  ctx.quadraticCurveTo(hx + 6, eyeY + 12, hx + 1, eyeY + 13);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(hx - 1, eyeY + 5); ctx.lineTo(hx + 1, eyeY + 10); ctx.stroke();
  // mouth
  const my = hy + 24;
  ctx.strokeStyle = '#4a2a1e';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  if (face === 'smile') {
    ctx.beginPath();
    ctx.moveTo(hx - 12, my - 2);
    ctx.quadraticCurveTo(hx, my + 9, hx + 12, my - 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(hx - 9, my + 1); ctx.quadraticCurveTo(hx, my + 10, hx + 9, my + 1); ctx.stroke();
    // dimples
    ctx.fillStyle = 'rgba(90,50,30,0.3)';
    ctx.beginPath(); ctx.arc(hx - 14, my - 2, 1.5, 0, Math.PI * 2); ctx.arc(hx + 14, my - 2, 1.5, 0, Math.PI * 2); ctx.fill();
  } else if (face === 'grin') {
    ctx.fillStyle = '#5a1f1f';
    ctx.beginPath();
    ctx.moveTo(hx - 14, my - 3);
    ctx.quadraticCurveTo(hx, my + 17, hx + 14, my - 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(hx - 11, my - 2);
    ctx.lineTo(hx + 11, my - 2);
    ctx.lineTo(hx + 10, my + 3);
    ctx.lineTo(hx - 10, my + 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i += 4) { ctx.beginPath(); ctx.moveTo(hx + i, my - 2); ctx.lineTo(hx + i, my + 3); ctx.stroke(); }
    ctx.fillStyle = '#c84a4a';
    ctx.beginPath(); ctx.ellipse(hx, my + 9, 6, 3.5, 0, 0, Math.PI); ctx.fill();
  } else if (face === 'shout') {
    ctx.fillStyle = '#5a1f1f';
    ctx.beginPath();
    ctx.ellipse(hx, my + 3, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(hx - 7, my - 4, 14, 3.5);
    ctx.fillStyle = '#c84a4a';
    ctx.beginPath(); ctx.ellipse(hx, my + 8, 5, 3, 0, 0, Math.PI); ctx.fill();
  } else if (face === 'focus') {
    ctx.beginPath();
    ctx.moveTo(hx - 9, my + 2);
    ctx.quadraticCurveTo(hx, my + 4, hx + 9, my + 1);
    ctx.stroke();
  } else if (face === 'ouch' || face === 'dizzy') {
    ctx.beginPath();
    ctx.moveTo(hx - 10, my + 5);
    ctx.quadraticCurveTo(hx, my - 5, hx + 10, my + 5);
    ctx.stroke();
    if (face === 'dizzy') {
      ctx.strokeStyle = 'rgba(74,42,30,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(hx - 8, my + 9); ctx.quadraticCurveTo(hx - 4, my + 12, hx, my + 9); ctx.quadraticCurveTo(hx + 4, my + 6, hx + 8, my + 9); ctx.stroke();
    }
  }
  // lower lip shadow
  ctx.fillStyle = 'rgba(90,50,30,0.12)';
  ctx.beginPath(); ctx.ellipse(hx, my + 13, 8, 2.5, 0, 0, Math.PI * 2); ctx.fill();
}

function drawHair(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, ch: Character): void {
  ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_W;
  switch (ch.hairStyle) {
    case 'short': {
      // under-layer (darker) then main shape with a side part and strand highlights
      ctx.fillStyle = shade(ch.hair, -0.3);
      ctx.beginPath();
      ctx.arc(hx, hy - 2, r + 3, Math.PI * 1.02, Math.PI * 1.98);
      ctx.quadraticCurveTo(hx + r * 0.2, hy - r * 0.5, hx + r * 0.05, hy - r * 0.55);
      ctx.quadraticCurveTo(hx - r * 0.35, hy - r * 0.7, hx - r - 3, hy - r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
      ctx.beginPath();
      ctx.arc(hx, hy - 4, r + 1, Math.PI * 1.05, Math.PI * 1.95);
      ctx.quadraticCurveTo(hx + r * 0.2, hy - r * 0.55, hx + r * 0.1, hy - r * 0.6);
      ctx.quadraticCurveTo(hx - r * 0.35, hy - r * 0.75, hx - r * 0.9, hy - r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // fringe tufts
      ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
      for (let i = 0; i < 4; i++) {
        const tx = hx - r * 0.7 + i * r * 0.32;
        ctx.beginPath();
        ctx.moveTo(tx - 8, hy - r * 0.62 + i * 1.5);
        ctx.quadraticCurveTo(tx, hy - r * 0.35 + i * 2, tx + 10, hy - r * 0.6 + i * 1.5);
        ctx.closePath();
        ctx.fill();
      }
      hairStrands(ctx, hx, hy, r, ch, 7, -6);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(hx, hy - 4, r - 7, Math.PI * 1.2, Math.PI * 1.5); ctx.stroke();
      break;
    }
    case 'spiky': {
      ctx.fillStyle = shade(ch.hair, -0.35);
      ctx.beginPath();
      ctx.moveTo(hx - r - 4, hy);
      for (let i = 0; i <= 7; i++) {
        const t = i / 7;
        const ang = Math.PI + t * Math.PI;
        const rr = r + (i % 2 === 0 ? 24 : 4);
        ctx.lineTo(hx + Math.cos(ang) * rr + 3, hy - 4 + Math.sin(ang) * rr);
      }
      ctx.lineTo(hx + r + 4, hy);
      ctx.quadraticCurveTo(hx, hy - r * 0.4, hx - r - 4, hy);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
      ctx.beginPath();
      ctx.moveTo(hx - r - 2, hy - 2);
      const spikes = 7;
      for (let i = 0; i <= spikes; i++) {
        const t = i / spikes;
        const ang = Math.PI + t * Math.PI;
        const rr = r + (i % 2 === 0 ? 20 : 2);
        ctx.lineTo(hx + Math.cos(ang) * rr, hy - 6 + Math.sin(ang) * rr);
      }
      ctx.lineTo(hx + r + 2, hy - 2);
      ctx.quadraticCurveTo(hx, hy - r * 0.45, hx - r - 2, hy - 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // spike highlights
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (let i = 0; i <= spikes; i += 2) {
        const ang = Math.PI + (i / spikes) * Math.PI;
        const tipX = hx + Math.cos(ang) * (r + 18), tipY = hy - 6 + Math.sin(ang) * (r + 18);
        const baseX = hx + Math.cos(ang) * (r - 6), baseY = hy - 6 + Math.sin(ang) * (r - 6);
        ctx.beginPath(); ctx.moveTo(baseX - 3, baseY); ctx.lineTo(tipX - 2, tipY + 2); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < spikes; i += 2) {
        const ang = Math.PI + (i / spikes) * Math.PI;
        ctx.beginPath(); ctx.moveTo(hx + Math.cos(ang) * (r - 4), hy - 6 + Math.sin(ang) * (r - 4)); ctx.lineTo(hx + Math.cos(ang) * r, hy - 6 + Math.sin(ang) * r); ctx.stroke();
      }
      break;
    }
    case 'curly': {
      const n = 9;
      // back layer
      for (let i = 0; i <= n; i++) {
        const ang = Math.PI + (i / n) * Math.PI;
        const cxx = hx + Math.cos(ang) * (r + 1), cyy = hy - 6 + Math.sin(ang) * (r + 1);
        ctx.fillStyle = shade(ch.hair, -0.35);
        ctx.beginPath(); ctx.arc(cxx, cyy, 16, 0, Math.PI * 2); ctx.fill();
      }
      for (let i = 0; i <= n; i++) {
        const ang = Math.PI + (i / n) * Math.PI;
        const cxx = hx + Math.cos(ang) * (r - 4), cyy = hy - 4 + Math.sin(ang) * (r - 4);
        const cg = ctx.createRadialGradient(cxx - 5, cyy - 5, 1, cxx, cyy, 15);
        cg.addColorStop(0, shade(ch.hair, 0.45));
        cg.addColorStop(0.6, ch.hair);
        cg.addColorStop(1, shade(ch.hair, -0.35));
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.arc(cxx, cyy, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
      ctx.beginPath();
      ctx.arc(hx, hy - 6, r - 2, Math.PI, Math.PI * 2);
      ctx.fill();
      // front curls over the forehead
      for (let i = 0; i < 5; i++) {
        const cxx = hx - 24 + i * 12, cyy = hy - r * 0.55 + (i % 2) * 5;
        const cg = ctx.createRadialGradient(cxx - 3, cyy - 3, 1, cxx, cyy, 10);
        cg.addColorStop(0, shade(ch.hair, 0.45));
        cg.addColorStop(1, shade(ch.hair, -0.25));
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.arc(cxx, cyy, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cxx + 2, cyy + 1, 4, 0, Math.PI * 1.5); ctx.stroke();
        ctx.strokeStyle = OUTLINE;
        ctx.lineWidth = OUTLINE_W;
      }
      break;
    }
    case 'cap': {
      // hair peeking out under the cap
      ctx.fillStyle = hairGradient(ctx, hx, hy, r, ch);
      ctx.beginPath();
      ctx.arc(hx, hy - 2, r, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (let i = 0; i < 5; i++) {
        const tx = hx - r * 0.75 + i * r * 0.36;
        ctx.beginPath();
        ctx.moveTo(tx - 7, hy - r * 0.5);
        ctx.quadraticCurveTo(tx, hy - r * 0.25 + (i % 2) * 3, tx + 8, hy - r * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      drawCap(ctx, hx, hy, r, false);
      break;
    }
  }
}

/**
 * Register the cheap shared textures: every character's portrait, the drop shadow and the glow.
 * The big pose sheets are built on demand per character (see ensureCharacterSheet) so a phone only
 * pays for the two or four characters actually on screen.
 */
export function buildCharacterTextures(scene: Phaser.Scene): void {
  const R = SHEET_RES;
  for (const id of Object.keys(CHARACTERS) as CharacterId[]) {
    const pkey = `portrait-${id}`;
    if (scene.textures.exists(pkey)) continue;
    const p = createCanvas(120 * R, 120 * R);
    p.ctx.save();
    p.ctx.scale(R, R);
    p.ctx.translate(60, 60);
    p.ctx.scale(1.05, 1.05);
    p.ctx.translate(-110, -62);
    drawCharacterFrame(p.ctx, CHARACTERS[id], { ...POSES.idle0, face: 'smile' });
    p.ctx.restore();
    scene.textures.addCanvas(pkey, p.canvas);
  }
  if (!scene.textures.exists('shadow')) {
    const s = createCanvas(128, 64);
    const g = s.ctx.createRadialGradient(64, 32, 4, 64, 32, 60);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    s.ctx.fillStyle = g;
    s.ctx.beginPath();
    s.ctx.ellipse(64, 32, 62, 30, 0, 0, Math.PI * 2);
    s.ctx.fill();
    scene.textures.addCanvas('shadow', s.canvas);
  }
  if (!scene.textures.exists('glow')) {
    const s = createCanvas(128, 128);
    const g = s.ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    s.ctx.fillStyle = g;
    s.ctx.fillRect(0, 0, 128, 128);
    scene.textures.addCanvas('glow', s.canvas);
  }
}

/** Texture key for a character's sheet: right-facing frames in `char-<id>`, left-facing in `char-<id>-L`. */
export function sheetKey(id: CharacterId, facing: 1 | -1): string { return facing === -1 ? `char-${id}-L` : `char-${id}`; }

/**
 * Build a character's two pose sheets if they are not there yet. Each sheet packs the poses in a
 * near-square grid (keeps the texture under the 4096 px limit of older GPUs even at 2x).
 */
export function ensureCharacterSheet(scene: Phaser.Scene, id: CharacterId): void {
  if (scene.textures.exists(sheetKey(id, 1))) return;
  const ch = CHARACTERS[id];
  const R = SHEET_RES;
  const n = POSE_NAMES.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  for (const facing of [1, -1] as const) {
    const { canvas, ctx } = createCanvas(cols * FRAME * R, rows * FRAME * R);
    POSE_NAMES.forEach((pose, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      ctx.save();
      ctx.translate(col * FRAME * R, row * FRAME * R);
      ctx.scale(R, R);
      drawCharacterFrame(ctx, ch, POSES[pose], facing);
      ctx.restore();
    });
    const tex = scene.textures.addCanvas(sheetKey(id, facing), canvas)!;
    POSE_NAMES.forEach((pose, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      tex.add(pose, 0, col * FRAME * R, row * FRAME * R, FRAME * R, FRAME * R);
    });
  }
}

/** Drop the pose sheets of every character not in `keep` (they are rebuilt on demand). */
export function purgeCharacterSheets(scene: Phaser.Scene, keep: CharacterId[]): void {
  for (const id of Object.keys(CHARACTERS) as CharacterId[]) {
    if (keep.includes(id)) continue;
    for (const facing of [1, -1] as const) {
      const key = sheetKey(id, facing);
      if (scene.textures.exists(key)) scene.textures.remove(key);
    }
  }
}

/**
 * Animated character sprite with a drop shadow. Pose animations are driven by setAnim.
 */
export class CharacterSprite extends Phaser.GameObjects.Container {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  /** Logical scale: 1 = the 220 px design frame. (sprite.scale is this divided by SHEET_RES.) */
  get charScale(): number { return this._charScale; }
  private _charScale = 1;
  private anim: PoseName[] = ['idle0', 'idle1'];
  private animFps = 2;
  private animTime = 0;
  private loop = true;
  private holdFrame: PoseName | null = null;
  private onAnimDone?: () => void;

  private _character: Character;
  get character(): Character { return this._character; }

  constructor(scene: Phaser.Scene, x: number, y: number, character: Character, scale = 1) {
    super(scene, x, y);
    this._character = character;
    this._charScale = scale;
    ensureCharacterSheet(scene, character.id);
    this.shadow = scene.add.image(0, 0, 'shadow').setScale(1.1 * scale, 0.9 * scale).setAlpha(0.9);
    this.sprite = scene.add.image(0, -FRAME * 0.5 * scale + 14 * scale, sheetKey(character.id, 1), 'idle0').setScale(scale / SHEET_RES);
    this.facing = 1;
    this.add([this.shadow, this.sprite]);
    scene.add.existing(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
  }

  private dead = false;

  /**
   * Stop animating before the game object goes away. The scene's UPDATE emit iterates a snapshot of
   * its listeners, so a sprite destroyed mid-frame (e.g. when the batters swap) would otherwise get
   * one more tick after its image is gone, and setTexture on a destroyed image throws inside the
   * game loop, which halts Phaser for good.
   */
  destroy(fromScene?: boolean): void {
    this.dead = true;
    this.scene?.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    super.destroy(fromScene);
  }

  /** Change the logical scale (perspective scenes call this every frame as depth changes). */
  rescale(scale: number): this {
    if (scale === this._charScale) return this;
    this._charScale = scale;
    this.sprite.setScale(scale / SHEET_RES);
    this.sprite.setY(-FRAME * 0.5 * scale + 14 * scale);
    this.shadow.setScale(1.1 * scale, 0.9 * scale);
    return this;
  }

  private facing: 1 | -1 = 1;
  get facingDir(): 1 | -1 { return this.facing; }
  /** Show a pose on the sheet for the current facing (left-facing frames are pre-drawn so numbers stay readable). */
  private applyFrame(pose: PoseName): void {
    if (this.dead || !this.sprite.scene) return;
    this.sprite.setTexture(sheetKey(this._character.id, this.facing), pose);
  }
  private currentPose(): PoseName { return this.holdFrame ?? this.anim[Math.min(this.anim.length - 1, Math.floor(this.animTime * this.animFps))] ?? this.anim[0]; }

  /** Swap in another character (scenes that reuse one sprite for whoever is up). */
  setCharacter(ch: Character): this {
    if (ch.id === this._character.id) return this;
    ensureCharacterSheet(this.scene, ch.id);
    this._character = ch;
    this.applyFrame(this.currentPose());
    return this;
  }

  /** Face left (-1) or right (1). Default art faces the camera with a slight right bias. */
  setFacing(dir: 1 | -1): this {
    if (dir === this.facing) return this;
    this.facing = dir;
    this.applyFrame(this.currentPose());
    return this;
  }

  setAnim(frames: PoseName[], fps = 6, loop = true, onDone?: () => void): this {
    if (this.anim.join() === frames.join() && this.loop === loop && this.holdFrame === null) return this;
    this.anim = frames;
    this.animFps = fps;
    this.loop = loop;
    this.animTime = 0;
    this.holdFrame = null;
    this.onAnimDone = onDone;
    this.applyFrame(frames[0]);
    return this;
  }

  /** Freeze on one frame. */
  setPose(frame: PoseName): this {
    this.holdFrame = frame;
    this.anim = [frame];
    this.applyFrame(frame);
    return this;
  }

  idle(): this { return this.setAnim(['idle0', 'idle1'], 2, true); }
  run(): this { return this.setAnim(['run0', 'run1', 'run2', 'run3'], 9, true); }
  cheer(): this { return this.setAnim(['cheer0', 'cheer1'], 4, true); }
  sad(): this { return this.setPose('sad'); }

  private tick(_t: number, dt: number): void {
    if (this.dead || this.holdFrame || this.anim.length <= 1) return;
    this.animTime += dt / 1000;
    const idx = Math.floor(this.animTime * this.animFps);
    if (idx >= this.anim.length) {
      if (this.loop) {
        this.animTime = 0;
        this.applyFrame(this.anim[0]);
      } else {
        this.applyFrame(this.anim[this.anim.length - 1]);
        this.holdFrame = this.anim[this.anim.length - 1];
        const cb = this.onAnimDone;
        this.onAnimDone = undefined;
        cb?.();
      }
      return;
    }
    this.applyFrame(this.anim[idx]);
  }
}
