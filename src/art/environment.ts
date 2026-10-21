import { createCanvas, roundRect, rng, shade } from './canvas';

/** Mottled lawn. */
export function paintGrass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed = 1, base = '#5f9a3c'): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(base, 0.12));
  g.addColorStop(1, shade(base, -0.12));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 900; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    const s = 10 + r() * 40;
    ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,200,0.07)' : 'rgba(0,40,0,0.08)';
    ctx.beginPath();
    ctx.ellipse(px, py, s, s * 0.5, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(20,60,10,0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < (w * h) / 700; i++) {
    const px = x + r() * w;
    const py = y + r() * h;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + (r() - 0.5) * 6, py - 6 - r() * 8);
    ctx.stroke();
  }
}

/** Asphalt / concrete driveway with cracks. */
export function paintAsphalt(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed = 2, base = '#6e6e6e'): void {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shade(base, 0.08));
  g.addColorStop(1, shade(base, -0.15));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 250; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(x + r() * w, y + r() * h, 2 + r() * 3, 2 + r() * 3);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    let px = x + r() * w;
    let py = y + r() * h;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let k = 0; k < 6; k++) {
      px += (r() - 0.5) * 60;
      py += (r() - 0.5) * 60;
      ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  // oil stain
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(x + w * 0.5, y + h * 0.3, 26, 14, 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Small jumpable tree seen from above (childhood-sized). */
export function paintTreeTop(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed = 3): void {
  const rr = rng(seed);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.35, y + r * 0.4, r * 1.05, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, '#8fd05a');
  g.addColorStop(0.6, '#3f8a2e');
  g.addColorStop(1, '#1f5a1a');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const br = r * (0.85 + rr() * 0.25);
    ctx.arc(x + Math.cos(a) * br * 0.45, y + Math.sin(a) * br * 0.45, br * 0.6, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,180,0.18)';
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

/** House roof seen from above, with a chimney and garage block. */
export function paintHouseTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: { roof?: string; garage?: boolean } = {}): void {
  const roof = opts.roof ?? '#7a5a4a';
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, x + 14, y + 18, w, h, 6);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(roof, 0.2));
  g.addColorStop(0.5, roof);
  g.addColorStop(0.5001, shade(roof, -0.25));
  g.addColorStop(1, shade(roof, -0.1));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,15,10,0.6)';
  ctx.lineWidth = 3;
  ctx.stroke();
  // shingle lines
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1.5;
  for (let yy = y + 12; yy < y + h; yy += 14) {
    ctx.beginPath();
    ctx.moveTo(x + 4, yy);
    ctx.lineTo(x + w - 4, yy);
    ctx.stroke();
  }
  // ridge
  ctx.strokeStyle = 'rgba(255,240,220,0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + 10, y + h / 2);
  ctx.lineTo(x + w - 10, y + h / 2);
  ctx.stroke();
  // chimney
  ctx.fillStyle = '#9c4a3c';
  ctx.fillRect(x + w * 0.7, y + h * 0.18, 26, 26);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeRect(x + w * 0.7, y + h * 0.18, 26, 26);
  if (opts.garage) {
    ctx.fillStyle = shade(roof, -0.15);
    roundRect(ctx, x + w - 10, y + h * 0.45, 110, h * 0.5, 6);
    ctx.fill();
    ctx.stroke();
  }
}

/** Front/side view of a suburban house used as a backdrop (perspective scenes). */
export function paintHouseFront(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: { siding?: string; garage?: boolean } = {}): void {
  const siding = opts.siding ?? '#f1e6c8';
  // walls
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(siding, 0.05));
  g.addColorStop(1, shade(siding, -0.2));
  ctx.fillStyle = g;
  ctx.fillRect(x, y + h * 0.3, w, h * 0.7);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (let yy = y + h * 0.3 + 10; yy < y + h; yy += 12) {
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
  }
  // roof
  const rg = ctx.createLinearGradient(x, y, x, y + h * 0.32);
  rg.addColorStop(0, '#5a4034'); rg.addColorStop(1, '#3a2820');
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(x - 20, y + h * 0.32);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w + 20, y + h * 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 3; ctx.stroke();
  // windows
  const win = (wx: number, wy: number, ww: number, wh: number) => {
    ctx.fillStyle = '#9fd3ff';
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(wx + 3, wy + 3, ww * 0.4, wh * 0.45);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
    ctx.fillStyle = '#2e5d3a';
    ctx.fillRect(wx - 12, wy - 2, 10, wh + 4);
    ctx.fillRect(wx + ww + 2, wy - 2, 10, wh + 4);
  };
  win(x + w * 0.12, y + h * 0.42, w * 0.16, h * 0.2);
  win(x + w * 0.42, y + h * 0.42, w * 0.16, h * 0.2);
  // door
  ctx.fillStyle = '#2e5d3a';
  roundRect(ctx, x + w * 0.7, y + h * 0.5, w * 0.14, h * 0.5, 6); ctx.fill();
  ctx.fillStyle = '#f5c518';
  ctx.beginPath(); ctx.arc(x + w * 0.82, y + h * 0.76, 4, 0, Math.PI * 2); ctx.fill();
  if (opts.garage) {
    ctx.fillStyle = '#e8e0d0';
    ctx.fillRect(x + w, y + h * 0.45, w * 0.6, h * 0.55);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    for (let yy = y + h * 0.5; yy < y + h; yy += h * 0.11) {
      ctx.beginPath(); ctx.moveTo(x + w + 8, yy); ctx.lineTo(x + w * 1.6 - 8, yy); ctx.stroke();
    }
    ctx.fillStyle = '#5a4034';
    ctx.fillRect(x + w - 4, y + h * 0.38, w * 0.68, h * 0.08);
  }
}

/** Fluffy side-view tree (for perspective scenes). Small and jumpable at childhood scale. */
export function paintTreeSide(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed = 5): void {
  const r = rng(seed);
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(x - size * 0.08, y - size * 0.5, size * 0.16, size * 0.55);
  const g = ctx.createRadialGradient(x - size * 0.2, y - size * 0.8, size * 0.1, x, y - size * 0.65, size * 0.7);
  g.addColorStop(0, '#9bd467'); g.addColorStop(0.6, '#3f8a2e'); g.addColorStop(1, '#1f5a1a');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    ctx.arc(x + Math.cos(a) * size * 0.3 * (0.8 + r() * 0.4), y - size * 0.65 + Math.sin(a) * size * 0.25, size * 0.32, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x, y + 4, size * 0.4, size * 0.1, 0, 0, Math.PI * 2); ctx.fill();
}

/** Small evergreen (pine) seen from the side; the kids could jump over these. */
export function paintPine(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, seed = 8): void {
  const r = rng(seed);
  const w = h * 0.62;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(x, y + 2, w * 0.55, h * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a2f18';
  ctx.fillRect(x - w * 0.06, y - h * 0.12, w * 0.12, h * 0.14);
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const ty = y - h * 0.08 - t * h * 0.78;
    const tw = w * (1 - t * 0.6) * (0.95 + r() * 0.1);
    const th = h * 0.34;
    const g = ctx.createLinearGradient(x - tw / 2, ty, x + tw / 2, ty);
    g.addColorStop(0, '#2f6b2a');
    g.addColorStop(0.5, '#4f9a3c');
    g.addColorStop(1, '#1f4a1c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, ty - th);
    ctx.lineTo(x + tw / 2, ty);
    ctx.quadraticCurveTo(x, ty + th * 0.12, x - tw / 2, ty);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,40,10,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

/** Wood-paneled basement wall. */
export function paintPanelWall(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base = '#8a5a3a'): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(base, -0.35));
  g.addColorStop(0.6, base);
  g.addColorStop(1, shade(base, -0.1));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const r = rng(9);
  for (let px = x; px < x + w; px += 64) {
    ctx.fillStyle = `rgba(0,0,0,${0.08 + r() * 0.08})`;
    ctx.fillRect(px, y, 4, h);
    ctx.fillStyle = 'rgba(255,220,180,0.06)';
    ctx.fillRect(px + 6, y, 2, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(px + 10 + r() * 44, y);
      ctx.bezierCurveTo(px + 10 + r() * 44, y + h * 0.3, px + 10 + r() * 44, y + h * 0.7, px + 10 + r() * 44, y + h);
      ctx.stroke();
    }
  }
}

/** Worn basement carpet / rug. */
export function paintCarpet(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base = '#6a5b4b', seed = 11): void {
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shade(base, 0.08));
  g.addColorStop(1, shade(base, -0.15));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  const r = rng(seed);
  for (let i = 0; i < (w * h) / 300; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    ctx.fillRect(x + r() * w, y + r() * h, 3, 3);
  }
}

/** Concrete basement floor. */
export function paintConcrete(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed = 12): void {
  paintAsphalt(ctx, x, y, w, h, seed, '#8d8a82');
}

/** Couch viewed from the front (for basement backdrops). */
export function paintCouchFront(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = '#7b4b3a'): void {
  ctx.fillStyle = shade(color, -0.25);
  roundRect(ctx, x, y, w, h, 18); ctx.fill();
  ctx.fillStyle = color;
  roundRect(ctx, x + 10, y + 10, w - 20, h * 0.45, 14); ctx.fill();
  const cushW = (w - 40) / 3;
  for (let i = 0; i < 3; i++) {
    const g = ctx.createLinearGradient(0, y + h * 0.5, 0, y + h);
    g.addColorStop(0, shade(color, 0.18)); g.addColorStop(1, shade(color, -0.1));
    ctx.fillStyle = g;
    roundRect(ctx, x + 20 + i * cushW, y + h * 0.5, cushW - 6, h * 0.4, 12); ctx.fill();
  }
  ctx.fillStyle = shade(color, 0.1);
  roundRect(ctx, x - 6, y + h * 0.3, 26, h * 0.65, 10); ctx.fill();
  roundRect(ctx, x + w - 20, y + h * 0.3, 26, h * 0.65, 10); ctx.fill();
}

/** Lamp on a side table. */
export function paintLamp(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1): void {
  ctx.fillStyle = '#4a3324';
  roundRect(ctx, x - 40 * s, y, 80 * s, 50 * s, 6); ctx.fill();
  ctx.fillStyle = '#c9a66b';
  ctx.fillRect(x - 4 * s, y - 70 * s, 8 * s, 70 * s);
  const g = ctx.createLinearGradient(x, y - 130 * s, x, y - 70 * s);
  g.addColorStop(0, '#fff2b0'); g.addColorStop(1, '#e8c060');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - 24 * s, y - 130 * s); ctx.lineTo(x + 24 * s, y - 130 * s); ctx.lineTo(x + 40 * s, y - 70 * s); ctx.lineTo(x - 40 * s, y - 70 * s); ctx.closePath();
  ctx.fill();
  const glow = ctx.createRadialGradient(x, y - 100 * s, 10, x, y - 100 * s, 180 * s);
  glow.addColorStop(0, 'rgba(255,230,150,0.35)'); glow.addColorStop(1, 'rgba(255,230,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 180 * s, y - 280 * s, 360 * s, 360 * s);
}

/** A pennant / poster on a wall. */
export function paintPoster(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, text: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 5, y + 6, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(h * 0.22)}px "Arial Black", Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2);
}

export function paintPennant(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, text: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(h * 0.3)}px Arial`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 10, y + h / 2);
}

/** Sky gradient with a soft sun. */
export function paintSky(ctx: CanvasRenderingContext2D, w: number, h: number, horizonY: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0, '#5aa7e8');
  g.addColorStop(0.7, '#9fd0f5');
  g.addColorStop(1, '#f6e7b8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizonY);
  const sun = ctx.createRadialGradient(w * 0.78, horizonY * 0.35, 10, w * 0.78, horizonY * 0.35, 160);
  sun.addColorStop(0, 'rgba(255,250,200,1)');
  sun.addColorStop(0.3, 'rgba(255,240,150,0.8)');
  sun.addColorStop(1, 'rgba(255,240,150,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, horizonY);
  // clouds
  const r = rng(21);
  for (let i = 0; i < 5; i++) {
    const cx = r() * w;
    const cy = horizonY * (0.15 + r() * 0.4);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(cx + k * 34 - 60, cy + (k % 2) * 10, 28 + r() * 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export { createCanvas, roundRect, shade, rng };

// ---------------------------------------------------------------------------------------------
// Higher-fidelity painters (perspective-aware). These take a Projector so density, blade size and
// shading follow the camera, which is what makes a procedural yard read as a real place.
// ---------------------------------------------------------------------------------------------
import type { Projector } from '../core/projection';

/** Late-afternoon sky: deep blue overhead, warm haze at the horizon, soft sun, layered clouds. */
export function paintSkyHD(ctx: CanvasRenderingContext2D, w: number, h: number, horizonY: number, opts: { sunX?: number; sunY?: number; seed?: number } = {}): void {
  const g = ctx.createLinearGradient(0, 0, 0, horizonY);
  g.addColorStop(0, '#2f78c9');
  g.addColorStop(0.45, '#6fb0ea');
  g.addColorStop(0.8, '#b7dcf5');
  g.addColorStop(1, '#f4e6c3');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, horizonY + 2);
  const sx = opts.sunX ?? w * 0.74;
  const sy = opts.sunY ?? horizonY * 0.3;
  const glow = ctx.createRadialGradient(sx, sy, 6, sx, sy, Math.max(w, h) * 0.45);
  glow.addColorStop(0, 'rgba(255,252,230,1)');
  glow.addColorStop(0.03, 'rgba(255,248,200,0.95)');
  glow.addColorStop(0.12, 'rgba(255,235,170,0.35)');
  glow.addColorStop(0.5, 'rgba(255,220,150,0.08)');
  glow.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, horizonY + 2);
  // clouds: stacks of soft radial puffs, lit from the sun side
  const r = rng(opts.seed ?? 21);
  for (let i = 0; i < 7; i++) {
    const cx = r() * w;
    const cy = horizonY * (0.1 + r() * 0.45);
    const scale = 0.6 + r() * 0.9;
    const puffs = 6 + Math.floor(r() * 5);
    for (let k = 0; k < puffs; k++) {
      const px = cx + (k - puffs / 2) * 42 * scale + (r() - 0.5) * 30;
      const py = cy + (r() - 0.5) * 22 * scale + Math.abs(k - puffs / 2) * 6;
      const pr = (34 + r() * 22) * scale;
      const cg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.35, pr * 0.1, px, py, pr);
      cg.addColorStop(0, 'rgba(255,255,255,0.95)');
      cg.addColorStop(0.55, 'rgba(250,250,255,0.75)');
      cg.addColorStop(0.85, 'rgba(225,232,245,0.35)');
      cg.addColorStop(1, 'rgba(225,232,245,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
    }
  }
  // thin high wisps
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const y = horizonY * (0.08 + r() * 0.3);
    ctx.lineWidth = 6 + r() * 10;
    ctx.beginPath();
    ctx.moveTo(r() * w, y);
    ctx.bezierCurveTo(r() * w, y - 20, r() * w, y + 20, r() * w, y);
    ctx.stroke();
  }
}

/**
 * Perspective lawn: fills the ground polygon (world rectangle) with a depth-shaded base, mowing
 * stripes, perspective-sized grass tufts, clover patches and sun dapples.
 */
export function paintLawnHD(ctx: CanvasRenderingContext2D, pr: Projector, area: { x0: number; x1: number; z0: number; z1: number }, opts: { seed?: number; base?: string; stripes?: boolean; stripeWidth?: number; tuftDensity?: number } = {}): void {
  const r = rng(opts.seed ?? 4);
  const base = opts.base ?? '#5e9c3c';
  // never let the near edge go behind the camera (the projection collapses there)
  area = { ...area, z0: Math.max(area.z0, -pr.cam.camZ + 0.25) };
  const a = pr.project(area.x0, 0, area.z0), b = pr.project(area.x1, 0, area.z0), c = pr.project(area.x1, 0, area.z1), d = pr.project(area.x0, 0, area.z1);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.clip();
  const top = Math.min(c.sy, d.sy), bottom = Math.max(a.sy, b.sy);
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, shade(base, -0.12));
  g.addColorStop(0.35, shade(base, 0.02));
  g.addColorStop(1, shade(base, 0.16));
  ctx.fillStyle = g;
  ctx.fillRect(0, top - 2, ctx.canvas.width, bottom - top + 4);
  // mowing stripes (alternate bands along x)
  if (opts.stripes !== false) {
    const sw = opts.stripeWidth ?? 3.2;
    for (let x = area.x0; x < area.x1; x += sw * 2) {
      const p0 = pr.project(x, 0, area.z0), p1 = pr.project(x + sw, 0, area.z0), p2 = pr.project(x + sw, 0, area.z1), p3 = pr.project(x, 0, area.z1);
      ctx.fillStyle = 'rgba(235,255,210,0.11)';
      ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy); ctx.lineTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.lineTo(p3.sx, p3.sy); ctx.closePath(); ctx.fill();
    }
  }
  // clover / worn patches
  for (let i = 0; i < 18; i++) {
    const wx = area.x0 + r() * (area.x1 - area.x0), wz = area.z0 + r() * (area.z1 - area.z0);
    const p = pr.project(wx, 0, wz);
    if (!p.visible) continue;
    const rad = (1.2 + r() * 2.5) * p.scale;
    const pg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
    const dark = r() > 0.45;
    pg.addColorStop(0, dark ? 'rgba(20,70,20,0.12)' : 'rgba(210,230,130,0.16)');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.ellipse(p.sx, p.sy, rad, rad * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // grass tufts: perspective-sized, denser far away
  const density = opts.tuftDensity ?? 1;
  const areaM2 = (area.x1 - area.x0) * (area.z1 - area.z0);
  const n = Math.min(16000, Math.floor(areaM2 * 0.9 * density));
  for (let i = 0; i < n; i++) {
    // bias samples toward the camera so the near field is not sparse
    const t = Math.pow(r(), 1.6);
    const wz = area.z0 + t * (area.z1 - area.z0);
    const wx = area.x0 + r() * (area.x1 - area.x0);
    const p = pr.project(wx, 0, wz);
    if (!p.visible || p.scale < 4) continue;
    const bl = Math.min(22, (0.1 + r() * 0.12) * p.scale);
    if (bl < 1.5) continue;
    const light = r();
    ctx.strokeStyle = light > 0.6 ? 'rgba(200,240,130,0.45)' : light > 0.3 ? 'rgba(90,160,60,0.4)' : 'rgba(40,95,35,0.35)';
    ctx.lineWidth = Math.min(2, Math.max(1, bl * 0.08));
    ctx.lineCap = 'round';
    const blades = bl > 8 ? 3 : 1;
    for (let k = 0; k < blades; k++) {
      const ox = (k - 1) * bl * 0.3;
      ctx.beginPath();
      ctx.moveTo(p.sx + ox, p.sy);
      ctx.quadraticCurveTo(p.sx + ox + (r() - 0.5) * bl * 0.3, p.sy - bl * 0.6, p.sx + ox + (r() - 0.5) * bl * 0.5, p.sy - bl);
      ctx.stroke();
    }
  }
  // sun dapples: a few large, very soft pools of light
  for (let i = 0; i < 6; i++) {
    const wx = area.x0 + r() * (area.x1 - area.x0), wz = area.z0 + r() * (area.z1 - area.z0);
    const p = pr.project(wx, 0, wz);
    if (!p.visible) continue;
    const rad = (6 + r() * 8) * p.scale;
    const pg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
    pg.addColorStop(0, 'rgba(255,245,180,0.12)');
    pg.addColorStop(1, 'rgba(255,245,180,0)');
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.ellipse(p.sx, p.sy, rad, rad * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Columnar evergreen (Leyland-cypress style) seen from the side, lit from the upper left. */
export function paintCypress(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, seed = 8, opts: { haze?: number } = {}): void {
  const r = rng(seed);
  const w = h * (0.42 + r() * 0.12);
  const haze = opts.haze ?? 0;
  // shadow on the ground
  ctx.fillStyle = `rgba(0,0,0,${0.28 * (1 - haze)})`;
  ctx.beginPath(); ctx.ellipse(x + w * 0.25, y + 2, w * 0.7, h * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  // trunk
  ctx.fillStyle = '#3f2a16';
  ctx.fillRect(x - w * 0.05, y - h * 0.08, w * 0.1, h * 0.09);
  const blobs = 9;
  for (let i = 0; i < blobs; i++) {
    const t = i / (blobs - 1);                 // 0 bottom .. 1 top
    const cy = y - h * (0.06 + t * 0.86);
    const bw = w * (t < 0.15 ? 0.75 + t * 1.5 : 1 - Math.pow(t, 1.8) * 0.85);
    const bh = h * 0.14;
    const g = ctx.createRadialGradient(x - bw * 0.35, cy - bh * 0.3, bw * 0.05, x, cy, bw * 1.1);
    const lit = mix('#9ad662', '#dfe9f2', haze), mid = mix('#4f9436', '#c9d6e4', haze), dark = mix('#1d4a1c', '#aebccb', haze);
    g.addColorStop(0, lit);
    g.addColorStop(0.45, mid);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.beginPath();
    // fringed ellipse
    const segs = 14;
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const fr = 1 + (k % 2 === 0 ? 0.06 : -0.06) + (r() - 0.5) * 0.08;
      const px = x + Math.cos(a) * bw * fr + (r() - 0.5) * bw * 0.1;
      const py = cy + Math.sin(a) * bh * fr;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  // tip
  ctx.fillStyle = mix('#7fc453', '#dfe9f2', haze);
  ctx.beginPath(); ctx.moveTo(x - w * 0.12, y - h * 0.9); ctx.lineTo(x, y - h * 1.02); ctx.lineTo(x + w * 0.12, y - h * 0.9); ctx.closePath(); ctx.fill();
  // foliage texture strokes
  if (haze < 0.6 && h > 24) {
    ctx.strokeStyle = `rgba(20,60,20,${0.35 * (1 - haze)})`;
    ctx.lineWidth = Math.max(1, h * 0.012);
    for (let i = 0; i < 18; i++) {
      const t = r();
      const cy = y - h * (0.1 + t * 0.8);
      const bw = w * (1 - Math.pow(t, 1.8) * 0.85);
      const px = x + (r() - 0.5) * bw * 1.4;
      ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px + (r() - 0.5) * bw * 0.3, cy + h * 0.05); ctx.stroke();
    }
    ctx.strokeStyle = `rgba(200,240,150,${0.3 * (1 - haze)})`;
    for (let i = 0; i < 10; i++) {
      const t = r();
      const cy = y - h * (0.1 + t * 0.8);
      const bw = w * (1 - Math.pow(t, 1.8) * 0.85);
      const px = x - bw * (0.2 + r() * 0.5);
      ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px + bw * 0.1, cy - h * 0.03); ctx.stroke();
    }
  }
}

/** Tiered pine with lit/shadow sides and fringed branch edges. */
export function paintPineHD(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, seed = 8, opts: { haze?: number } = {}): void {
  const r = rng(seed);
  const w = h * 0.6;
  const haze = opts.haze ?? 0;
  ctx.fillStyle = `rgba(0,0,0,${0.26 * (1 - haze)})`;
  ctx.beginPath(); ctx.ellipse(x + w * 0.2, y + 2, w * 0.6, h * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = mix('#4a2f18', '#b8c3cf', haze);
  ctx.fillRect(x - w * 0.05, y - h * 0.14, w * 0.1, h * 0.15);
  const tiers = 5;
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const ty = y - h * 0.1 - t * h * 0.74;
    const tw = w * (1 - t * 0.62) * (0.95 + r() * 0.1);
    const th = h * 0.3;
    const g = ctx.createLinearGradient(x - tw / 2, ty, x + tw / 2, ty);
    g.addColorStop(0, mix('#8fd05a', '#dfe9f2', haze));
    g.addColorStop(0.45, mix('#3f8a2e', '#c9d6e4', haze));
    g.addColorStop(1, mix('#163d16', '#aebccb', haze));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, ty - th);
    const segs = 6;
    for (let k = 1; k <= segs; k++) {
      const f = k / segs;
      ctx.lineTo(x + tw / 2 * f, ty - th + th * f + (k % 2 ? th * 0.06 : -th * 0.04));
    }
    for (let k = segs; k >= 1; k--) {
      const f = k / segs;
      ctx.lineTo(x - tw / 2 * f, ty - th + th * f + (k % 2 ? th * 0.06 : -th * 0.04));
    }
    ctx.closePath();
    ctx.fill();
  }
}

/** Round deciduous tree with clustered canopy, lit from the upper left. */
export function paintTreeHD(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, seed = 5, opts: { haze?: number } = {}): void {
  const r = rng(seed);
  const haze = opts.haze ?? 0;
  ctx.fillStyle = `rgba(0,0,0,${0.25 * (1 - haze)})`;
  ctx.beginPath(); ctx.ellipse(x + size * 0.1, y + 3, size * 0.45, size * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  const tg = ctx.createLinearGradient(x - size * 0.08, 0, x + size * 0.08, 0);
  tg.addColorStop(0, mix('#6b4a2a', '#b8c3cf', haze)); tg.addColorStop(1, mix('#3a2412', '#aebccb', haze));
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.09, y); ctx.lineTo(x - size * 0.05, y - size * 0.55); ctx.lineTo(x + size * 0.05, y - size * 0.55); ctx.lineTo(x + size * 0.09, y); ctx.closePath(); ctx.fill();
  const cx = x, cy = y - size * 0.68;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const dist = i === 8 ? 0 : size * 0.24 * (0.8 + r() * 0.4);
    const px = cx + Math.cos(a) * dist, py = cy + Math.sin(a) * dist * 0.75;
    const pr = size * (0.26 + r() * 0.08);
    const g = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.05, px, py, pr);
    g.addColorStop(0, mix('#a8dc6c', '#dfe9f2', haze));
    g.addColorStop(0.5, mix('#4f9a38', '#c9d6e4', haze));
    g.addColorStop(1, mix('#1f4f1f', '#aebccb', haze));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
  }
}

/** Atmospheric haze band just above the horizon, to push the far background back. */
export function paintHaze(ctx: CanvasRenderingContext2D, w: number, horizonY: number, depth = 140, color = '244,236,214'): void {
  const g = ctx.createLinearGradient(0, horizonY - depth, 0, horizonY + depth * 0.4);
  g.addColorStop(0, `rgba(${color},0)`);
  g.addColorStop(0.7, `rgba(${color},0.35)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, horizonY - depth, w, depth * 1.4);
}

/** Soft vignette and warm grade over a finished scene. */
export function paintVignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength = 0.35): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(10,20,10,${strength})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,200,120,0.05)';
  ctx.fillRect(0, 0, w, h);
}

/** Linear colour mix of two hex colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace('#', ''), 16), pb = parseInt(b.replace('#', ''), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
