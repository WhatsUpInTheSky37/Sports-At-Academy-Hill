import Phaser from 'phaser';
import { createCanvas, roundRect, shade } from './canvas';

function add(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
}

function ball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, base: string, highlight = 0.55): void {
  const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, shade(base, highlight));
  g.addColorStop(0.5, base);
  g.addColorStop(1, shade(base, -0.45));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Generates all ball / equipment textures used across the seven games. */
export function buildEquipmentTextures(scene: Phaser.Scene): void {
  // Baseball
  {
    const { canvas, ctx } = createCanvas(40, 40);
    ball(ctx, 20, 20, 18, '#f4f1e8', 0.3);
    ctx.strokeStyle = '#c62828';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(8, 20, 16, -0.9, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 20, 16, Math.PI - 0.9, Math.PI + 0.9);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let i = -3; i <= 3; i++) {
      const y = 20 + i * 4.5;
      ctx.beginPath(); ctx.moveTo(14, y - 2); ctx.lineTo(18, y + 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(26, y - 2); ctx.lineTo(22, y + 2); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(20, 20, 18, 0, Math.PI * 2); ctx.stroke();
    add(scene, 'baseball', canvas);
  }
  // Basketball
  {
    const { canvas, ctx } = createCanvas(72, 72);
    ball(ctx, 36, 36, 34, '#e8762b', 0.4);
    ctx.strokeStyle = '#3a1a08';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(36, 2); ctx.lineTo(36, 70); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(2, 36); ctx.lineTo(70, 36); ctx.stroke();
    ctx.beginPath(); ctx.arc(-6, 36, 36, -0.95, 0.95); ctx.stroke();
    ctx.beginPath(); ctx.arc(78, 36, 36, Math.PI - 0.95, Math.PI + 0.95); ctx.stroke();
    ctx.beginPath(); ctx.arc(36, 36, 34, 0, Math.PI * 2); ctx.stroke();
    add(scene, 'basketball', canvas);
  }
  // Pool balls 0..15 (0 = cue)
  const poolColors = ['#f8f4e6', '#f3c13a', '#2b56c7', '#d9342b', '#5a2d82', '#f07a1f', '#1f7a3a', '#8b1e1e', '#111111'];
  for (let n = 0; n <= 15; n++) {
    const { canvas, ctx } = createCanvas(52, 52);
    const base = n === 0 ? poolColors[0] : poolColors[n <= 8 ? n : n - 8];
    if (n > 8) {
      ball(ctx, 26, 26, 24, '#f8f4e6', 0.3);
      ctx.save();
      ctx.beginPath(); ctx.arc(26, 26, 24, 0, Math.PI * 2); ctx.clip();
      const g = ctx.createLinearGradient(0, 10, 0, 42);
      g.addColorStop(0, shade(base, 0.2)); g.addColorStop(1, shade(base, -0.3));
      ctx.fillStyle = g;
      ctx.fillRect(0, 11, 52, 30);
      ctx.restore();
      const hl = ctx.createRadialGradient(17, 15, 2, 26, 26, 24);
      hl.addColorStop(0, 'rgba(255,255,255,0.75)'); hl.addColorStop(0.35, 'rgba(255,255,255,0.08)'); hl.addColorStop(1, 'rgba(0,0,0,0.4)');
      ctx.fillStyle = hl;
      ctx.beginPath(); ctx.arc(26, 26, 24, 0, Math.PI * 2); ctx.fill();
    } else {
      ball(ctx, 26, 26, 24, base, n === 8 ? 0.5 : 0.45);
    }
    if (n > 0) {
      ctx.fillStyle = '#fbf7ea';
      ctx.beginPath(); ctx.arc(26, 26, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.font = 'bold 13px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 26, 27);
    } else {
      ctx.fillStyle = 'rgba(210,60,40,0.8)';
      ctx.beginPath(); ctx.arc(31, 19, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(26, 26, 24, 0, Math.PI * 2); ctx.stroke();
    add(scene, `pool-${n}`, canvas);
  }
  // Puck
  {
    const { canvas, ctx } = createCanvas(40, 40);
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath(); ctx.ellipse(20, 23, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(0, 8, 0, 30);
    g.addColorStop(0, '#3a3a3a'); g.addColorStop(1, '#141414');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(20, 18, 17, 12, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(20, 18, 12, 8, 0, 0, Math.PI * 2); ctx.stroke();
    add(scene, 'puck', canvas);
  }
  // Football (pointing right)
  {
    const { canvas, ctx } = createCanvas(64, 40);
    const g = ctx.createRadialGradient(24, 12, 4, 32, 20, 30);
    g.addColorStop(0, '#b5673a'); g.addColorStop(0.6, '#7a3e1d'); g.addColorStop(1, '#3f1e0b');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(32, 20, 30, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a1206'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#f5f5f5';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(44, 20); ctx.stroke();
    for (let x = 24; x <= 40; x += 4) { ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 24); ctx.stroke(); }
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(8, 12); ctx.quadraticCurveTo(10, 20, 8, 28); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(56, 12); ctx.quadraticCurveTo(54, 20, 56, 28); ctx.stroke();
    add(scene, 'football', canvas);
  }
  // Dart (pointing up)
  {
    const { canvas, ctx } = createCanvas(28, 90);
    ctx.fillStyle = '#c0c0c0';
    ctx.fillRect(13, 0, 2, 26);
    const bg = ctx.createLinearGradient(8, 0, 20, 0);
    bg.addColorStop(0, '#f6d365'); bg.addColorStop(0.5, '#b8860b'); bg.addColorStop(1, '#6b4a00');
    ctx.fillStyle = bg;
    roundRect(ctx, 9, 24, 10, 26, 4); ctx.fill();
    ctx.fillStyle = '#222';
    roundRect(ctx, 11, 50, 6, 18, 2); ctx.fill();
    // flights
    const fg = ctx.createLinearGradient(0, 60, 0, 90);
    fg.addColorStop(0, '#ef5350'); fg.addColorStop(1, '#8e0000');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(14, 60); ctx.lineTo(2, 88); ctx.lineTo(14, 80); ctx.lineTo(26, 88); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    add(scene, 'dart', canvas);
  }
  // Bat (horizontal, handle at left)
  {
    const { canvas, ctx } = createCanvas(180, 26);
    const g = ctx.createLinearGradient(0, 0, 0, 26);
    g.addColorStop(0, '#e2b87a'); g.addColorStop(0.5, '#b8824a'); g.addColorStop(1, '#6e4521');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(4, 10); ctx.lineTo(60, 8); ctx.quadraticCurveTo(140, 0, 176, 4); ctx.quadraticCurveTo(180, 13, 176, 22); ctx.quadraticCurveTo(140, 26, 60, 18); ctx.lineTo(4, 16); ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,5,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#222'; roundRect(ctx, 0, 6, 10, 14, 4); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(10, 9, 28, 8);
    add(scene, 'bat', canvas);
  }
  // Hockey stick (shaft pointing right, blade at right end)
  {
    const { canvas, ctx } = createCanvas(150, 60);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2a1a0a'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(118, 30); ctx.lineTo(142, 52); ctx.stroke();
    ctx.strokeStyle = '#d9a35c'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(118, 30); ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(116, 30); ctx.lineTo(142, 52); ctx.stroke();
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(20 + i * 7, 8 + i * 1.3); ctx.lineTo(22 + i * 7, 17 + i * 1.3); ctx.stroke(); }
    add(scene, 'hockeystick', canvas);
  }
  // Cue (tip at right)
  {
    const { canvas, ctx } = createCanvas(520, 18);
    const g = ctx.createLinearGradient(0, 0, 0, 18);
    g.addColorStop(0, '#f0d9a8'); g.addColorStop(0.5, '#c9975a'); g.addColorStop(1, '#6f4a22');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(510, 6); ctx.lineTo(510, 12); ctx.lineTo(0, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a1a10'; ctx.fillRect(0, 2, 150, 14);
    ctx.fillStyle = '#eee'; ctx.fillRect(506, 5, 8, 8);
    ctx.fillStyle = '#3b8ed0'; ctx.fillRect(513, 6, 6, 6);
    add(scene, 'cue', canvas);
  }
  // Championship belt
  {
    const { canvas, ctx } = createCanvas(420, 160);
    ctx.fillStyle = '#2a1b10';
    roundRect(ctx, 0, 55, 420, 56, 14); ctx.fill();
    ctx.strokeStyle = '#5c3b1e'; ctx.lineWidth = 3; ctx.stroke();
    const plate = (x: number, w: number, h: number) => {
      const g = ctx.createLinearGradient(x, 80 - h / 2, x + w, 80 + h / 2);
      g.addColorStop(0, '#fff2a8'); g.addColorStop(0.45, '#f5c518'); g.addColorStop(1, '#a67c00');
      ctx.fillStyle = g;
      roundRect(ctx, x, 80 - h / 2, w, h, 16); ctx.fill();
      ctx.strokeStyle = '#6b4c00'; ctx.lineWidth = 4; ctx.stroke();
    };
    plate(60, 70, 70); plate(290, 70, 70);
    ctx.save(); ctx.translate(210, 80);
    const g = ctx.createRadialGradient(-20, -20, 10, 0, 0, 80);
    g.addColorStop(0, '#fff6c0'); g.addColorStop(0.6, '#f5c518'); g.addColorStop(1, '#8a6400');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, 95, 72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6b4c00'; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#b8860b';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 34 : 15;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a4000'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#5a4000';
    ctx.font = 'bold 13px "Arial Black", Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ACADEMY HILL', 0, 54);
    ctx.fillText('CHAMP', 0, -44);
    ctx.restore();
    add(scene, 'belt', canvas);
  }
  // Generic soft spark particle
  {
    const { canvas, ctx } = createCanvas(16, 16);
    const g = ctx.createRadialGradient(8, 8, 1, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
    add(scene, 'spark', canvas);
  }
}
