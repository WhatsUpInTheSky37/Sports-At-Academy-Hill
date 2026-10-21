import Phaser from 'phaser';
import { CHARACTERS, type Character, type CharacterId } from '../core/characters';
import { createCanvas, roundRect, shade } from './canvas';

/** Every character sheet frame is FRAME x FRAME; feet sit near y = 205, centre x = 110. */
export const FRAME = 220;

export type BasePoseName =
  | 'idle0' | 'idle1' | 'run0' | 'run1' | 'run2' | 'run3' | 'swing0' | 'swing1' | 'swing2'
  | 'shoot0' | 'shoot1' | 'throw0' | 'throw1' | 'cheer0' | 'cheer1' | 'sad' | 'grapple' | 'down' | 'crouch' | 'push' | 'dizzy';
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
};

export const POSES: Record<PoseName, Pose> = Object.fromEntries([
  ...Object.entries(BASE_POSES),
  ...Object.entries(BASE_POSES).map(([k, v]) => [`back-${k}`, { ...v, back: true, lean: v.lean ? -v.lean : v.lean }]),
]) as Record<PoseName, Pose>;

const POSE_NAMES = Object.keys(POSES) as PoseName[];

function deg(d: number): number { return (d * Math.PI) / 180; }

function drawLimb(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number, color: string, bend = 0, bendLen = 0, bendColor?: string): { x: number; y: number } {
  // angle measured from straight down (0) rotating toward the character's outside; caller flips sign.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  const ex = x + Math.sin(angle) * len;
  const ey = y + Math.cos(angle) * len;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  if (bendLen > 0) {
    const a2 = angle + bend;
    const fx = ex + Math.sin(a2) * bendLen;
    const fy = ey + Math.cos(a2) * bendLen;
    ctx.strokeStyle = bendColor ?? color;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(fx, fy);
    ctx.stroke();
    return { x: fx, y: fy };
  }
  return { x: ex, y: ey };
}

function outlineLimb(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, len: number, width: number, bend = 0, bendLen = 0): void {
  ctx.save();
  ctx.globalAlpha = 0.35;
  drawLimb(ctx, x, y, angle, len, width + 5, '#1a120c', bend, bendLen);
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
  const outline = 'rgba(26,18,12,0.55)';

  // ---- legs (always behind torso) ----
  const legs: [number, number][] = [[cx - 17, pose.lLeg], [cx + 17, pose.rLeg]];
  for (const [lx, la] of legs) {
    const a = deg(la) * (lx < cx ? 1 : -1);
    outlineLimb(ctx, lx, hipY, -a, legLen, 24);
    const foot = drawLimb(ctx, lx, hipY, -a, legLen, 24, skin);
    // shoe
    ctx.fillStyle = ch.shoes;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(foot.x + (lx < cx ? -3 : 3), foot.y + 4, 19, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(foot.x + (lx < cx ? -6 : 0), foot.y + 1, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // shorts
  ctx.save();
  ctx.translate(cx, hipY - 10);
  ctx.rotate(lean);
  const sg = ctx.createLinearGradient(-36, 0, 36, 0);
  sg.addColorStop(0, shade(ch.shorts, 0.12));
  sg.addColorStop(1, shade(ch.shorts, -0.25));
  ctx.fillStyle = sg;
  roundRect(ctx, -37, -4, 74, 36, 12);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // ---- arms behind torso (unless armsFront) ----
  const shoulders: [number, number, number, number][] = [
    [cx - 32, pose.lArm, pose.lBend ?? 0, 1],
    [cx + 32, pose.rArm, pose.rBend ?? 0, -1],
  ];
  const drawArm = (sx: number, angleDeg: number, bendDeg: number, side: number) => {
    const a = deg(angleDeg) * side;
    const b = deg(bendDeg) * side;
    outlineLimb(ctx, sx, shoulderY, a, 30, 22, b, 28);
    drawLimb(ctx, sx, shoulderY, a, 30, 22, ch.shirtShade);
    const upper = { x: sx + Math.sin(a) * 30, y: shoulderY + Math.cos(a) * 30 };
    const hand = drawLimb(ctx, upper.x, upper.y, a + b, 28, 18, skin);
    ctx.fillStyle = skin;
    ctx.strokeStyle = outline;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(hand.x, hand.y, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  if (!pose.armsFront) for (const [sx, a, b, side] of shoulders) drawArm(sx, a, b, side);

  // ---- torso ----
  ctx.save();
  ctx.translate(cx, torsoTop + torsoH / 2);
  ctx.rotate(lean);
  const tg = ctx.createLinearGradient(-40, 0, 40, 0);
  tg.addColorStop(0, shade(ch.shirt, 0.22));
  tg.addColorStop(0.55, ch.shirt);
  tg.addColorStop(1, shade(ch.shirt, -0.3));
  ctx.fillStyle = tg;
  roundRect(ctx, -40, -torsoH / 2, 80, torsoH + 6, 20);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // collar
  ctx.fillStyle = shade(ch.shirt, -0.35);
  ctx.beginPath();
  ctx.ellipse(0, -torsoH / 2 + 4, 16, 7, 0, 0, Math.PI);
  ctx.fill();
  // number
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 30px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch.number, 0, 6);
  ctx.restore();

  if (pose.armsFront) for (const [sx, a, b, side] of shoulders) drawArm(sx, a, b, side);

  // ---- head ----
  const hx = cx + Math.sin(lean) * 30;
  const hy = headY + 2;
  // neck
  ctx.fillStyle = ch.skinShade;
  ctx.fillRect(hx - 10, hy + 30, 20, 14);
  const hg = ctx.createRadialGradient(hx - 14, hy - 14, 6, hx, hy, headR + 4);
  hg.addColorStop(0, shade(skin, 0.18));
  hg.addColorStop(0.75, skin);
  hg.addColorStop(1, ch.skinShade);
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(hx, hy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // ears
  ctx.fillStyle = skin;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(hx + s * (headR - 2), hy + 4, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // cheeks
  ctx.fillStyle = 'rgba(255,120,120,0.28)';
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + s * 24, hy + 14, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (pose.back) {
    drawBackHair(ctx, hx, hy, headR, ch);
  } else {
    drawFace(ctx, hx, hy, pose.face, ch);
    drawHair(ctx, hx, hy, headR, ch);
  }
  ctx.restore();
}

/** Back of the head: hair covers most of the skull, cap shows its back strap. */
function drawBackHair(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, ch: Character): void {
  const outline = 'rgba(26,18,12,0.6)';
  const g = ctx.createLinearGradient(hx - r, hy - r, hx + r, hy + r);
  g.addColorStop(0, shade(ch.hair, 0.25));
  g.addColorStop(1, shade(ch.hair, -0.25));
  ctx.fillStyle = g;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(hx, hy - 2, r + 1, Math.PI * 0.9, Math.PI * 2.1);
  ctx.quadraticCurveTo(hx + r * 0.5, hy + r * 0.55, hx, hy + r * 0.45);
  ctx.quadraticCurveTo(hx - r * 0.5, hy + r * 0.55, hx - r - 1, hy + r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (ch.hairStyle === 'spiky') {
    ctx.beginPath();
    for (let i = 0; i <= 7; i++) {
      const ang = Math.PI + (i / 7) * Math.PI;
      const rr = r + (i % 2 === 0 ? 20 : 2);
      ctx.lineTo(hx + Math.cos(ang) * rr, hy - 6 + Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (ch.hairStyle === 'curly') {
    for (let i = 0; i <= 10; i++) {
      const ang = Math.PI * 0.95 + (i / 10) * Math.PI * 1.1;
      ctx.beginPath();
      ctx.arc(hx + Math.cos(ang) * (r - 4), hy - 4 + Math.sin(ang) * (r - 4), 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (ch.hairStyle === 'cap') {
    const cg = ctx.createLinearGradient(hx - r, hy - r, hx + r, hy);
    cg.addColorStop(0, shade('#2f5d8a', 0.3));
    cg.addColorStop(1, shade('#2f5d8a', -0.25));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(hx, hy - 6, r + 2, Math.PI, Math.PI * 2);
    ctx.quadraticCurveTo(hx, hy + 8, hx - r - 2, hy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = shade('#2f5d8a', -0.4);
    ctx.fillRect(hx - 16, hy - 4, 32, 9);
    ctx.fillStyle = '#f5c518';
    ctx.beginPath();
    ctx.arc(hx, hy - r - 6, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFace(ctx: CanvasRenderingContext2D, hx: number, hy: number, face: Pose['face'], ch: Character): void {
  const eyeY = hy + 2;
  const eyeDX = 15;
  const outline = '#1a120c';
  // eyes
  for (const s of [-1, 1]) {
    const ex = hx + s * eyeDX;
    if (face === 'dizzy') {
      ctx.strokeStyle = outline;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex - 6, eyeY - 6); ctx.lineTo(ex + 6, eyeY + 6);
      ctx.moveTo(ex + 6, eyeY - 6); ctx.lineTo(ex - 6, eyeY + 6);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 8.5, face === 'focus' ? 7 : 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b1d14';
    ctx.beginPath();
    ctx.arc(ex + 1.5, eyeY + 1, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex + 3, eyeY - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
    // brows
    ctx.strokeStyle = shade(ch.hair, -0.2);
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (face === 'focus' || face === 'shout') {
      ctx.moveTo(ex - 8, eyeY - 14 + (s === -1 ? 0 : 4));
      ctx.lineTo(ex + 8, eyeY - 14 + (s === -1 ? 4 : 0));
    } else if (face === 'ouch') {
      ctx.moveTo(ex - 8, eyeY - 12 + (s === -1 ? 4 : 0));
      ctx.lineTo(ex + 8, eyeY - 12 + (s === -1 ? 0 : 4));
    } else {
      ctx.moveTo(ex - 8, eyeY - 15);
      ctx.quadraticCurveTo(ex, eyeY - 19, ex + 8, eyeY - 15);
    }
    ctx.stroke();
  }
  if (ch.glasses) {
    ctx.strokeStyle = '#2d3b4a';
    ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hx + s * eyeDX, eyeY, 12.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(hx - 3, eyeY); ctx.lineTo(hx + 3, eyeY);
    ctx.stroke();
  }
  // nose
  ctx.strokeStyle = 'rgba(80,50,30,0.5)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(hx + 1, eyeY + 6);
  ctx.lineTo(hx + 4, eyeY + 13);
  ctx.stroke();
  // mouth
  const my = hy + 24;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (face === 'smile') {
    ctx.moveTo(hx - 12, my - 2);
    ctx.quadraticCurveTo(hx, my + 8, hx + 12, my - 2);
    ctx.stroke();
  } else if (face === 'grin' || face === 'shout') {
    ctx.fillStyle = '#5a1f1f';
    ctx.moveTo(hx - 14, my - 3);
    ctx.quadraticCurveTo(hx, my + 16, hx + 14, my - 3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(hx - 10, my - 2, 20, 4);
  } else if (face === 'focus') {
    ctx.moveTo(hx - 9, my + 2);
    ctx.lineTo(hx + 9, my + 1);
    ctx.stroke();
  } else if (face === 'ouch' || face === 'dizzy') {
    ctx.moveTo(hx - 10, my + 5);
    ctx.quadraticCurveTo(hx, my - 5, hx + 10, my + 5);
    ctx.stroke();
  }
}

function drawHair(ctx: CanvasRenderingContext2D, hx: number, hy: number, r: number, ch: Character): void {
  const outline = 'rgba(26,18,12,0.6)';
  const g = ctx.createLinearGradient(hx - r, hy - r, hx + r, hy);
  g.addColorStop(0, shade(ch.hair, 0.25));
  g.addColorStop(1, shade(ch.hair, -0.2));
  ctx.fillStyle = g;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 3;
  switch (ch.hairStyle) {
    case 'short': {
      ctx.beginPath();
      ctx.arc(hx, hy - 4, r + 1, Math.PI * 1.05, Math.PI * 1.95);
      ctx.quadraticCurveTo(hx + r * 0.2, hy - r * 0.55, hx + r * 0.1, hy - r * 0.6);
      ctx.quadraticCurveTo(hx - r * 0.35, hy - r * 0.75, hx - r * 0.9, hy - r * 0.35);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'spiky': {
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
      break;
    }
    case 'curly': {
      const n = 9;
      for (let i = 0; i <= n; i++) {
        const ang = Math.PI + (i / n) * Math.PI;
        ctx.beginPath();
        ctx.arc(hx + Math.cos(ang) * (r - 4), hy - 4 + Math.sin(ang) * (r - 4), 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(hx, hy - 6, r - 2, Math.PI, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cap': {
      // hair peeking out
      ctx.beginPath();
      ctx.arc(hx, hy - 2, r, Math.PI * 1.02, Math.PI * 1.98);
      ctx.closePath();
      ctx.fill();
      // cap crown
      const cg = ctx.createLinearGradient(hx - r, hy - r, hx + r, hy);
      cg.addColorStop(0, shade('#2f5d8a', 0.3));
      cg.addColorStop(1, shade('#2f5d8a', -0.25));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(hx, hy - 8, r + 2, Math.PI, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // brim
      ctx.fillStyle = shade('#2f5d8a', -0.35);
      roundRect(ctx, hx - 4, hy - 16, r + 24, 14, 7);
      ctx.fill();
      ctx.stroke();
      // button
      ctx.fillStyle = '#f5c518';
      ctx.beginPath();
      ctx.arc(hx, hy - r - 6, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Build and register a sprite sheet texture per character: key `char-<id>`, frames = pose names. */
export function buildCharacterTextures(scene: Phaser.Scene): void {
  for (const id of Object.keys(CHARACTERS) as CharacterId[]) {
    const key = `char-${id}`;
    if (scene.textures.exists(key)) continue;
    const ch = CHARACTERS[id];
    const cols = 7;
    const rows = Math.ceil(POSE_NAMES.length / cols);
    const { canvas, ctx } = createCanvas(cols * FRAME, rows * FRAME);
    POSE_NAMES.forEach((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.save();
      ctx.translate(col * FRAME, row * FRAME);
      drawCharacterFrame(ctx, ch, POSES[name]);
      ctx.restore();
    });
    const tex = scene.textures.addCanvas(key, canvas)!;
    POSE_NAMES.forEach((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      tex.add(name, 0, col * FRAME, row * FRAME, FRAME, FRAME);
    });
    // portrait
    const pkey = `portrait-${id}`;
    const p = createCanvas(120, 120);
    p.ctx.save();
    p.ctx.translate(60, 60);
    p.ctx.scale(1.05, 1.05);
    p.ctx.translate(-110, -62);
    drawCharacterFrame(p.ctx, ch, { ...POSES.idle0, face: 'smile' });
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

/**
 * Animated character sprite with a drop shadow. Pose animations are driven by setAnim.
 */
export class CharacterSprite extends Phaser.GameObjects.Container {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  private anim: PoseName[] = ['idle0', 'idle1'];
  private animFps = 2;
  private animTime = 0;
  private loop = true;
  private holdFrame: PoseName | null = null;
  private onAnimDone?: () => void;

  constructor(scene: Phaser.Scene, x: number, y: number, readonly character: Character, scale = 1) {
    super(scene, x, y);
    this.shadow = scene.add.image(0, 0, 'shadow').setScale(1.1 * scale, 0.9 * scale).setAlpha(0.9);
    this.sprite = scene.add.image(0, -FRAME * 0.5 * scale + 14 * scale, `char-${character.id}`, 'idle0').setScale(scale);
    this.add([this.shadow, this.sprite]);
    scene.add.existing(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this));
  }

  /** Flip so the character faces left (-1) or right (1). Default art faces the camera with a slight right bias. */
  setFacing(dir: 1 | -1): this {
    this.sprite.setFlipX(dir === -1);
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
    this.sprite.setFrame(frames[0]);
    return this;
  }

  /** Freeze on one frame. */
  setPose(frame: PoseName): this {
    this.holdFrame = frame;
    this.anim = [frame];
    this.sprite.setFrame(frame);
    return this;
  }

  idle(): this { return this.setAnim(['idle0', 'idle1'], 2, true); }
  run(): this { return this.setAnim(['run0', 'run1', 'run2', 'run3'], 9, true); }
  cheer(): this { return this.setAnim(['cheer0', 'cheer1'], 4, true); }
  sad(): this { return this.setPose('sad'); }

  private tick(_t: number, dt: number): void {
    if (this.holdFrame || this.anim.length <= 1) return;
    this.animTime += dt / 1000;
    const idx = Math.floor(this.animTime * this.animFps);
    if (idx >= this.anim.length) {
      if (this.loop) {
        this.animTime = 0;
        this.sprite.setFrame(this.anim[0]);
      } else {
        this.sprite.setFrame(this.anim[this.anim.length - 1]);
        this.holdFrame = this.anim[this.anim.length - 1];
        const cb = this.onAnimDone;
        this.onAnimDone = undefined;
        cb?.();
      }
      return;
    }
    this.sprite.setFrame(this.anim[idx]);
  }
}
