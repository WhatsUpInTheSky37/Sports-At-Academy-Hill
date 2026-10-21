import Phaser from 'phaser';
import { createCanvas, roundRect, rng, shade } from './canvas';

function add(scene: Phaser.Scene, key: string, canvas: HTMLCanvasElement): void {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, canvas);
}

/** Glossy sphere: base shading, soft terminator, bottom reflected light. */
function sphere(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, base: string, opts: { highlight?: number; rim?: string } = {}): void {
  const g = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r);
  g.addColorStop(0, shade(base, opts.highlight ?? 0.5));
  g.addColorStop(0.42, base);
  g.addColorStop(0.85, shade(base, -0.4));
  g.addColorStop(1, shade(base, -0.58));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  // reflected light from below
  const rl = ctx.createRadialGradient(cx + r * 0.2, cy + r * 0.95, r * 0.05, cx + r * 0.2, cy + r * 0.7, r * 0.75);
  rl.addColorStop(0, opts.rim ?? 'rgba(255,255,255,0.22)');
  rl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = rl;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
}

function specular(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, strength = 0.9, size = 0.3): void {
  const s = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, 0, cx - r * 0.4, cy - r * 0.45, r * size);
  s.addColorStop(0, `rgba(255,255,255,${strength})`);
  s.addColorStop(0.5, `rgba(255,255,255,${strength * 0.35})`);
  s.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = s;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
}

function outline(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha = 0.45, w = 1.5): void {
  ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
  ctx.lineWidth = w;
  ctx.beginPath(); ctx.arc(cx, cy, r - w / 2, 0, Math.PI * 2); ctx.stroke();
}

/** Fine dot noise clipped to a circle (pebbled grain). */
function grain(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: number, count: number, alphaLight = 0.18, alphaDark = 0.16): void {
  const rr = rng(seed);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  for (let i = 0; i < count; i++) {
    const a = rr() * Math.PI * 2;
    const d = Math.sqrt(rr()) * r;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    ctx.fillStyle = rr() > 0.5 ? `rgba(255,255,255,${alphaLight})` : `rgba(0,0,0,${alphaDark})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

/** Wood grain lines inside the current clip. */
function woodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number, horizontal = true): void {
  const rr = rng(seed);
  ctx.strokeStyle = 'rgba(70,40,10,0.22)';
  ctx.lineWidth = 1;
  const lines = Math.floor((horizontal ? h : w) / 2.2);
  for (let i = 0; i < lines; i++) {
    const t = (i + 0.5) / lines;
    ctx.beginPath();
    if (horizontal) {
      const yy = y + t * h;
      ctx.moveTo(x, yy);
      for (let k = 1; k <= 8; k++) ctx.lineTo(x + (w * k) / 8, yy + (rr() - 0.5) * 1.6);
    } else {
      const xx = x + t * w;
      ctx.moveTo(xx, y);
      for (let k = 1; k <= 8; k++) ctx.lineTo(xx + (rr() - 0.5) * 1.6, y + (h * k) / 8);
    }
    ctx.stroke();
  }
}

/** Generates all ball / equipment textures used across the seven games. */
export function buildEquipmentTextures(scene: Phaser.Scene): void {
  // ---------------- Baseball ----------------
  {
    const { canvas, ctx } = createCanvas(40, 40);
    const cx = 20, cy = 20, r = 18.5;
    sphere(ctx, cx, cy, r, '#f3efe3', { highlight: 0.25 });
    // leather grain
    grain(ctx, cx, cy, r, 3, 260, 0.12, 0.08);
    // horseshoe seams: two C-curves hugging the left and right edges (circles clipped to the ball)
    const seam = (ox: number) => {
      const sr = r * 1.32;
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2); ctx.clip();
      ctx.strokeStyle = 'rgba(120,90,70,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx + ox, cy, sr, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#c0261f';
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      for (let a = 0; a < Math.PI * 2; a += 0.115) {
        const px = cx + ox + Math.cos(a) * sr, py = cy + Math.sin(a) * sr;
        if (Math.hypot(px - cx, py - cy) > r - 1.2) continue;
        const nx = Math.cos(a), ny = Math.sin(a);
        const tx = -ny, ty = nx;
        ctx.beginPath();
        ctx.moveTo(px + nx * 2.2 + tx * 1.1, py + ny * 2.2 + ty * 1.1);
        ctx.lineTo(px, py);
        ctx.lineTo(px - nx * 2.2 + tx * 1.1, py - ny * 2.2 + ty * 1.1);
        ctx.stroke();
      }
      ctx.restore();
    };
    seam(r * 0.95);
    seam(-r * 0.95);
    specular(ctx, cx, cy, r, 0.7, 0.32);
    outline(ctx, cx, cy, r, 0.4, 1.4);
    add(scene, 'baseball', canvas);
  }
  // ---------------- Basketball ----------------
  {
    const { canvas, ctx } = createCanvas(72, 72);
    const cx = 36, cy = 36, r = 34.5;
    sphere(ctx, cx, cy, r, '#d9661f', { highlight: 0.42 });
    grain(ctx, cx, cy, r, 5, 900, 0.09, 0.09);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    const channel = (draw: () => void) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,200,150,0.35)'; ctx.lineWidth = 3.6; draw();
      ctx.strokeStyle = '#2a1206'; ctx.lineWidth = 2.2; draw();
    };
    channel(() => { ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke(); });
    channel(() => { ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.stroke(); });
    channel(() => { ctx.beginPath(); ctx.arc(cx - 46, cy, 40, -0.9, 0.9); ctx.stroke(); });
    channel(() => { ctx.beginPath(); ctx.arc(cx + 46, cy, 40, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke(); });
    ctx.restore();
    specular(ctx, cx, cy, r, 0.55, 0.42);
    outline(ctx, cx, cy, r, 0.5, 1.6);
    add(scene, 'basketball', canvas);
  }
  // ---------------- Pool balls 0..15 ----------------
  const poolColors = ['#f6f1e2', '#f2c21c', '#1e49b8', '#d71f1f', '#4c1f7a', '#f0731a', '#176f2c', '#7a1414', '#101010'];
  for (let n = 0; n <= 15; n++) {
    const { canvas, ctx } = createCanvas(52, 52);
    const cx = 26, cy = 26, r = 24.5;
    const base = n === 0 ? poolColors[0] : poolColors[n <= 8 ? n : n - 8];
    if (n > 8) {
      sphere(ctx, cx, cy, r, '#f6f1e2', { highlight: 0.25 });
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      // stripe band with curved (spherical) edges
      const g = ctx.createLinearGradient(0, cy - 13, 0, cy + 13);
      g.addColorStop(0, shade(base, 0.12)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -0.25));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - 11);
      ctx.quadraticCurveTo(cx, cy - 15.5, cx + r, cy - 11);
      ctx.lineTo(cx + r, cy + 11);
      ctx.quadraticCurveTo(cx, cy + 15.5, cx - r, cy + 11);
      ctx.closePath();
      ctx.fill();
      // re-apply sphere shading over the stripe
      const sh = ctx.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r);
      sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(0.45, 'rgba(255,255,255,0)'); sh.addColorStop(0.85, 'rgba(0,0,0,0.32)'); sh.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = sh;
      ctx.fillRect(0, 0, 52, 52);
      ctx.restore();
    } else {
      sphere(ctx, cx, cy, r, base, { highlight: n === 8 ? 0.55 : 0.48 });
    }
    if (n > 0) {
      // number circle with thin dark ring, slightly above centre
      const ny = cy + 1;
      const cg = ctx.createRadialGradient(cx - 3, ny - 3, 1, cx, ny, 10.5);
      cg.addColorStop(0, '#fffdf4'); cg.addColorStop(1, '#e6dfc8');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cx, ny, 10.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, ny, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#111';
      ctx.font = `bold ${n >= 10 ? 11 : 13}px Arial, Helvetica, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), cx, ny + 0.5);
      if (n === 6 || n === 9) { ctx.fillRect(cx - 3, ny + 7, 6, 1); }
    } else {
      // cue ball: faint red spot and a subtle ivory tint
      ctx.fillStyle = 'rgba(200,50,40,0.75)';
      ctx.beginPath(); ctx.arc(cx + 6, cy - 7, 2.6, 0, Math.PI * 2); ctx.fill();
    }
    specular(ctx, cx, cy, r, 0.95, 0.3);
    // small secondary reflection (room lamp)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(cx + 8, cy - 12, 3, 1.6, -0.6, 0, Math.PI * 2); ctx.fill();
    outline(ctx, cx, cy, r, 0.5, 1.4);
    add(scene, `pool-${n}`, canvas);
  }
  // ---------------- Puck ----------------
  {
    const { canvas, ctx } = createCanvas(40, 40);
    // rubber side wall
    const sg = ctx.createLinearGradient(3, 0, 37, 0);
    sg.addColorStop(0, '#2b2b2b'); sg.addColorStop(0.5, '#0c0c0c'); sg.addColorStop(1, '#262626');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(20, 24, 17, 11, 0, 0, Math.PI); ctx.lineTo(3, 17); ctx.ellipse(20, 17, 17, 11, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    // ridged edge texture
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 5; x < 36; x += 2.5) { ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, 32); ctx.stroke(); }
    // top face
    const tg = ctx.createRadialGradient(15, 12, 2, 20, 17, 17);
    tg.addColorStop(0, '#4a4a4a'); tg.addColorStop(0.6, '#1b1b1b'); tg.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.ellipse(20, 17, 17, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.ellipse(20, 17, 16, 10, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.ellipse(20, 17, 11, 6.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(20, 17, 17, 11, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(20, 24, 17, 11, 0, 0, Math.PI); ctx.stroke();
    add(scene, 'puck', canvas);
  }
  // ---------------- Football (pointing right) ----------------
  {
    const { canvas, ctx } = createCanvas(64, 40);
    const cx = 32, cy = 20;
    const g = ctx.createRadialGradient(22, 11, 3, cx, cy, 32);
    g.addColorStop(0, '#b97a46'); g.addColorStop(0.45, '#8a4a22'); g.addColorStop(0.85, '#4d2510'); g.addColorStop(1, '#2d140a');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(cx, cy, 30.5, 17, 0, 0, Math.PI * 2); ctx.fill();
    // pebbled leather
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, cy, 30.5, 17, 0, 0, Math.PI * 2); ctx.clip();
    const rr = rng(9);
    for (let i = 0; i < 380; i++) {
      const x = rr() * 64, y = rr() * 40;
      ctx.fillStyle = rr() > 0.5 ? 'rgba(255,220,180,0.1)' : 'rgba(0,0,0,0.12)';
      ctx.fillRect(x, y, 1, 1);
    }
    // white stripes near the points
    ctx.strokeStyle = '#f2ecdf'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(11, 6); ctx.quadraticCurveTo(13.5, 20, 11, 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(53, 6); ctx.quadraticCurveTo(50.5, 20, 53, 34); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(9.5, 6); ctx.quadraticCurveTo(12, 20, 9.5, 34); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(54.5, 6); ctx.quadraticCurveTo(52, 20, 54.5, 34); ctx.stroke();
    ctx.restore();
    // seam
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(14, 19.5); ctx.lineTo(50, 19.5); ctx.stroke();
    // laces: base strip + stitches
    ctx.strokeStyle = '#f7f3ea'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(21, 19.5); ctx.lineTo(43, 19.5); ctx.stroke();
    for (let x = 24; x <= 40; x += 4) {
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, 14.5); ctx.lineTo(x, 24.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(x + 1.3, 15); ctx.lineTo(x + 1.3, 24); ctx.stroke();
      ctx.strokeStyle = '#f7f3ea';
    }
    // specular
    const sp = ctx.createRadialGradient(20, 10, 1, 24, 13, 16);
    sp.addColorStop(0, 'rgba(255,240,220,0.45)'); sp.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = sp;
    ctx.beginPath(); ctx.ellipse(cx, cy, 30.5, 17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(20,8,2,0.75)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy, 30, 16.5, 0, 0, Math.PI * 2); ctx.stroke();
    add(scene, 'football', canvas);
  }
  // ---------------- Dart (pointing up) ----------------
  {
    const { canvas, ctx } = createCanvas(28, 90);
    // steel point
    const pg = ctx.createLinearGradient(11, 0, 17, 0);
    pg.addColorStop(0, '#e8e8e8'); pg.addColorStop(0.5, '#8f8f8f'); pg.addColorStop(1, '#4a4a4a');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(15.6, 26); ctx.lineTo(12.4, 26); ctx.closePath(); ctx.fill();
    // barrel (tungsten, knurled)
    const bg = ctx.createLinearGradient(8, 0, 20, 0);
    bg.addColorStop(0, '#d9d9d9'); bg.addColorStop(0.35, '#8c8c8c'); bg.addColorStop(0.7, '#5a5a5a'); bg.addColorStop(1, '#2e2e2e');
    ctx.fillStyle = bg;
    roundRect(ctx, 9, 25, 10, 27, 3.5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8;
    for (let y = 28; y < 50; y += 2.2) { ctx.beginPath(); ctx.moveTo(9.5, y); ctx.lineTo(18.5, y + 1); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    for (let y = 29; y < 50; y += 2.2) { ctx.beginPath(); ctx.moveTo(9.5, y + 1); ctx.lineTo(18.5, y); ctx.stroke(); }
    // grip rings
    ctx.fillStyle = '#c9a227';
    ctx.fillRect(9, 31, 10, 1.4); ctx.fillRect(9, 44, 10, 1.4);
    // shaft (black nylon)
    const sg = ctx.createLinearGradient(11, 0, 17, 0);
    sg.addColorStop(0, '#555'); sg.addColorStop(0.5, '#1a1a1a'); sg.addColorStop(1, '#0a0a0a');
    ctx.fillStyle = sg;
    roundRect(ctx, 11.2, 52, 5.6, 18, 2); ctx.fill();
    // flight with gradient, seam and shading
    const fg = ctx.createLinearGradient(2, 62, 26, 88);
    fg.addColorStop(0, '#ff6b5e'); fg.addColorStop(0.5, '#d72b1f'); fg.addColorStop(1, '#7a0c05');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.moveTo(14, 60); ctx.lineTo(2, 88); ctx.lineTo(14, 80); ctx.lineTo(26, 88); ctx.closePath(); ctx.fill();
    // flight sheen + seam
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath(); ctx.moveTo(14, 60); ctx.lineTo(2, 88); ctx.lineTo(14, 80); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(14, 60); ctx.lineTo(14, 80); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.moveTo(14, 60); ctx.lineTo(2, 88); ctx.lineTo(14, 80); ctx.lineTo(26, 88); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, 9, 25, 10, 27, 3.5); ctx.stroke();
    add(scene, 'dart', canvas);
  }
  // ---------------- Bat (horizontal, handle at left) ----------------
  {
    const { canvas, ctx } = createCanvas(180, 26);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(14, 9.5); ctx.lineTo(60, 8); ctx.quadraticCurveTo(140, 0.5, 176, 3.5); ctx.quadraticCurveTo(180, 13, 176, 22.5); ctx.quadraticCurveTo(140, 25.5, 60, 18); ctx.lineTo(14, 16.5); ctx.closePath();
    };
    const g = ctx.createLinearGradient(0, 0, 0, 26);
    g.addColorStop(0, '#efcf98'); g.addColorStop(0.35, '#d9a86a'); g.addColorStop(0.7, '#a86f3a'); g.addColorStop(1, '#5e3a18');
    ctx.fillStyle = g;
    body(); ctx.fill();
    ctx.save(); body(); ctx.clip();
    woodGrain(ctx, 10, 1, 170, 24, 17, true);
    // barrel sheen
    const sheen = ctx.createLinearGradient(0, 2, 0, 12);
    sheen.addColorStop(0, 'rgba(255,255,255,0.35)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(60, 1, 120, 12);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,20,5,0.7)'; ctx.lineWidth = 1.4;
    body(); ctx.stroke();
    // knob
    const kg = ctx.createLinearGradient(0, 4, 0, 22);
    kg.addColorStop(0, '#c99a62'); kg.addColorStop(1, '#5a3618');
    ctx.fillStyle = kg;
    roundRect(ctx, 0, 5, 12, 16, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(40,20,5,0.7)'; ctx.stroke();
    // tape grip with wrap lines
    const tg = ctx.createLinearGradient(0, 7, 0, 19);
    tg.addColorStop(0, '#3a3a3a'); tg.addColorStop(0.5, '#141414'); tg.addColorStop(1, '#2a2a2a');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.moveTo(14, 9); ctx.lineTo(48, 8.3); ctx.lineTo(48, 17.7); ctx.lineTo(14, 17); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    for (let x = 16; x < 48; x += 4) { ctx.beginPath(); ctx.moveTo(x, 8.5); ctx.lineTo(x + 3, 17.5); ctx.stroke(); }
    add(scene, 'bat', canvas);
  }
  // ---------------- Hockey stick (shaft pointing right, blade at right end) ----------------
  {
    const { canvas, ctx } = createCanvas(150, 60);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // outline / shadow pass
    ctx.strokeStyle = '#1f130a'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(118, 30); ctx.lineTo(142, 52); ctx.stroke();
    // wood shaft
    const sg = ctx.createLinearGradient(0, 0, 0, 40);
    sg.addColorStop(0, '#e7c58e'); sg.addColorStop(0.5, '#c8954f'); sg.addColorStop(1, '#8a5a28');
    ctx.strokeStyle = sg; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(118, 30); ctx.stroke();
    // grain along the shaft
    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(80,45,10,0.25)'; ctx.lineWidth = 1;
    for (let k = -3; k <= 3; k += 1.5) {
      ctx.beginPath(); ctx.moveTo(10, 10 + k); ctx.lineTo(116, 30 + k); ctx.stroke();
    }
    ctx.restore();
    // shaft highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, 7); ctx.lineTo(116, 27); ctx.stroke();
    // taped blade (black tape with visible wraps)
    ctx.strokeStyle = '#161616'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(116, 30); ctx.lineTo(142, 52); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      const t = i / 7;
      const x = 118 + (142 - 118) * t, y = 32 + (52 - 32) * t;
      ctx.beginPath(); ctx.moveTo(x - 4, y + 4); ctx.lineTo(x + 4, y - 4); ctx.stroke();
    }
    // white grip tape at the top of the shaft
    ctx.strokeStyle = '#eeeeee'; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.moveTo(8, 10); ctx.lineTo(34, 14.7); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) { const x = 10 + i * 4.3, y = 10.4 + i * 0.78; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 2, y + 5); ctx.stroke(); }
    // knob of tape
    ctx.fillStyle = '#dddddd';
    ctx.beginPath(); ctx.arc(8, 10, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
    add(scene, 'hockeystick', canvas);
  }
  // ---------------- Cue (tip at right) ----------------
  {
    const { canvas, ctx } = createCanvas(520, 18);
    const body = () => { ctx.beginPath(); ctx.moveTo(0, 1.5); ctx.lineTo(506, 6); ctx.lineTo(506, 12); ctx.lineTo(0, 16.5); ctx.closePath(); };
    // butt (dark stained wood) and shaft (maple)
    const g = ctx.createLinearGradient(0, 0, 0, 18);
    g.addColorStop(0, '#f3dfb0'); g.addColorStop(0.4, '#d8ad6a'); g.addColorStop(0.8, '#9a6a34'); g.addColorStop(1, '#5a3a18');
    ctx.fillStyle = g;
    body(); ctx.fill();
    ctx.save(); body(); ctx.clip();
    woodGrain(ctx, 150, 1, 356, 16, 23, true);
    // butt sleeve
    const bg = ctx.createLinearGradient(0, 0, 0, 18);
    bg.addColorStop(0, '#5a2d14'); bg.addColorStop(0.45, '#2b140a'); bg.addColorStop(1, '#150905');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 150, 18);
    // inlay points on the butt
    ctx.fillStyle = '#e8d6a8';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(150, 3 + i * 3.4); ctx.lineTo(112, 4 + i * 3.4); ctx.lineTo(150, 5 + i * 3.4); ctx.closePath(); ctx.fill(); }
    // wrap (Irish linen) with a fine cross-hatch
    ctx.fillStyle = '#d9d2c2';
    ctx.fillRect(40, 1, 70, 16);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 0.8;
    for (let x = 40; x < 110; x += 2.5) { ctx.beginPath(); ctx.moveTo(x, 1); ctx.lineTo(x + 1.5, 17); ctx.stroke(); }
    for (let y = 2; y < 17; y += 2.5) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(110, y); ctx.stroke(); }
    // decorative rings
    ctx.fillStyle = '#e8d6a8';
    ctx.fillRect(38, 0, 2, 18); ctx.fillRect(110, 0, 2, 18); ctx.fillRect(149, 0, 2, 18);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, 4, 18); // bumper
    // sheen along the shaft
    const sheen = ctx.createLinearGradient(0, 2, 0, 9);
    sheen.addColorStop(0, 'rgba(255,255,255,0.4)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(150, 1, 356, 8);
    ctx.restore();
    ctx.strokeStyle = 'rgba(40,20,5,0.7)'; ctx.lineWidth = 1.2;
    body(); ctx.stroke();
    // ferrule (white) and chalked blue tip
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(504, 5.5, 9, 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(504.5, 5.5, 9, 7);
    const tg = ctx.createLinearGradient(0, 5, 0, 13);
    tg.addColorStop(0, '#6fb3ea'); tg.addColorStop(0.5, '#2f7fc4'); tg.addColorStop(1, '#1b4f85');
    ctx.fillStyle = tg;
    roundRect(ctx, 513, 5.5, 6.5, 7, 2.5); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
    add(scene, 'cue', canvas);
  }
  // ---------------- Championship belt ----------------
  {
    const { canvas, ctx } = createCanvas(420, 160);
    // leather strap with stitching
    const lg = ctx.createLinearGradient(0, 52, 0, 114);
    lg.addColorStop(0, '#4a2c16'); lg.addColorStop(0.5, '#2a170b'); lg.addColorStop(1, '#1a0d05');
    ctx.fillStyle = lg;
    roundRect(ctx, 0, 53, 420, 60, 14); ctx.fill();
    ctx.strokeStyle = '#6a4424'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(230,200,140,0.75)'; ctx.lineWidth = 1.4;
    roundRect(ctx, 6, 59, 408, 48, 10); ctx.stroke();
    ctx.setLineDash([]);
    // snap studs on the strap
    for (const x of [22, 398]) for (const y of [68, 98]) {
      const sg = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 4);
      sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.4, '#cfcfcf'); sg.addColorStop(1, '#5a5a5a');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    const goldFill = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, '#fff4b8'); g.addColorStop(0.3, '#f6cf3a'); g.addColorStop(0.55, '#d9a51c'); g.addColorStop(0.8, '#a4740b'); g.addColorStop(1, '#6e4c05');
      return g;
    };
    const hammered = (x: number, y: number, w: number, h: number, seed: number) => {
      const rr = rng(seed);
      for (let i = 0; i < (w * h) / 90; i++) {
        const px = x + rr() * w, py = y + rr() * h, pr = 2 + rr() * 3;
        const hg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 0, px, py, pr);
        hg.addColorStop(0, 'rgba(255,255,230,0.16)'); hg.addColorStop(0.6, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(90,60,0,0.1)');
        ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      }
    };
    const plate = (x: number, w: number, h: number, seed: number) => {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
      ctx.fillStyle = goldFill(x, 80 - h / 2, x + w, 80 + h / 2);
      roundRect(ctx, x, 80 - h / 2, w, h, 14); ctx.fill();
      ctx.restore();
      ctx.save(); roundRect(ctx, x, 80 - h / 2, w, h, 14); ctx.clip();
      hammered(x, 80 - h / 2, w, h, seed);
      ctx.restore();
      ctx.strokeStyle = '#5c3f00'; ctx.lineWidth = 3;
      roundRect(ctx, x, 80 - h / 2, w, h, 14); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,245,200,0.6)'; ctx.lineWidth = 1.2;
      roundRect(ctx, x + 4, 80 - h / 2 + 4, w - 8, h - 8, 10); ctx.stroke();
      // gem
      const gx = x + w / 2, gy = 80;
      const gg = ctx.createRadialGradient(gx - 4, gy - 4, 1, gx, gy, 12);
      gg.addColorStop(0, '#ffd3d3'); gg.addColorStop(0.3, '#e8252f'); gg.addColorStop(1, '#5a0008');
      ctx.fillStyle = gg;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; const rr = i % 2 ? 12 : 10; ctx.lineTo(gx + Math.cos(a) * rr, gy + Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3a0005'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.arc(gx - 4, gy - 4, 2.2, 0, Math.PI * 2); ctx.fill();
    };
    plate(56, 72, 72, 41);
    plate(292, 72, 72, 43);
    // centre plate
    ctx.save();
    ctx.translate(210, 80);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
    ctx.fillStyle = goldFill(-95, -72, 95, 72);
    ctx.beginPath(); ctx.ellipse(0, 0, 95, 72, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, 95, 72, 0, 0, Math.PI * 2); ctx.clip();
    hammered(-95, -72, 190, 144, 47);
    ctx.restore();
    ctx.strokeStyle = '#5c3f00'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(0, 0, 95, 72, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,245,200,0.65)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 88, 65, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(90,60,0,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 84, 61, 0, 0, Math.PI * 2); ctx.stroke();
    // star with bevel
    const star = (rO: number, rI: number) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const rr = i % 2 === 0 ? rO : rI; const a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath();
    };
    ctx.fillStyle = 'rgba(80,50,0,0.5)'; ctx.save(); ctx.translate(2, 3); star(34, 15); ctx.fill(); ctx.restore();
    const stg = ctx.createLinearGradient(-30, -30, 30, 30);
    stg.addColorStop(0, '#fff6c8'); stg.addColorStop(0.5, '#e9b51f'); stg.addColorStop(1, '#8c5e05');
    ctx.fillStyle = stg; star(34, 15); ctx.fill();
    ctx.strokeStyle = '#5a4000'; ctx.lineWidth = 2; star(34, 15); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; star(14, 6); ctx.fill();
    // raised lettering
    ctx.font = 'bold 13px "Arial Black", Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const raised = (txt: string, y: number) => {
      ctx.fillStyle = 'rgba(255,250,220,0.85)'; ctx.fillText(txt, -1, y - 1);
      ctx.fillStyle = 'rgba(60,40,0,0.9)'; ctx.fillText(txt, 1, y + 1);
      ctx.fillStyle = '#7a5200'; ctx.fillText(txt, 0, y);
    };
    raised('ACADEMY HILL', 52);
    raised('CHAMP', -46);
    ctx.restore();
    add(scene, 'belt', canvas);
  }
  // ---------------- Soft spark particle ----------------
  {
    const { canvas, ctx } = createCanvas(16, 16);
    const g = ctx.createRadialGradient(8, 8, 0.5, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,240,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 16);
    add(scene, 'spark', canvas);
  }
}
