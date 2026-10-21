/**
 * High-fidelity basement painters shared by the billiards and wrestling scenes.
 * Plain canvas 2D; some helpers take the pseudo-3D Projector so walls can be drawn in perspective.
 */
import type { Projector } from '../../core/projection';
import { rng, roundRect, shade } from '../../art/canvas';

export interface LightSpot { x: number; y: number; r: number; color?: string; strength?: number; }

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Cinder-block wall in screen space with per-block shading, mortar, chips and a warm light falloff. */
export function paintCinderWallHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: { blockW?: number; blockH?: number; base?: string; seed?: number; lights?: LightSpot[] } = {}): void {
  const bw = opts.blockW ?? 84, bh = opts.blockH ?? 36;
  const base = opts.base ?? '#9a9284';
  const r = rng(opts.seed ?? 41);
  // mortar bed
  ctx.fillStyle = shade(base, -0.45);
  ctx.fillRect(x, y, w, h);
  let row = 0;
  for (let by = y + h - bh; by > y - bh; by -= bh, row++) {
    const off = (row % 2) * (bw / 2);
    for (let bx = x - bw + off; bx < x + w; bx += bw) {
      const tint = (r() - 0.5) * 0.12;
      // light falloff: brighter near lights
      let lit = 0;
      for (const l of opts.lights ?? []) {
        const d = Math.hypot(bx + bw / 2 - l.x, by + bh / 2 - l.y);
        lit += Math.max(0, 1 - d / l.r) * (l.strength ?? 0.35);
      }
      const g = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      g.addColorStop(0, shade(base, 0.14 + tint + lit));
      g.addColorStop(0.6, shade(base, tint + lit * 0.8));
      g.addColorStop(1, shade(base, -0.14 + tint + lit * 0.6));
      ctx.fillStyle = g;
      roundRect(ctx, bx + 2, by + 2, bw - 4, bh - 4, 3);
      ctx.fill();
      // block texture: pits
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 6; k++) ctx.fillRect(bx + 4 + r() * (bw - 8), by + 4 + r() * (bh - 8), 1.5, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(bx + 3, by + 3, bw - 6, 2);
      // the occasional chipped corner
      if (r() > 0.93) { ctx.fillStyle = shade(base, -0.3); ctx.beginPath(); ctx.moveTo(bx + bw - 2, by + 2); ctx.lineTo(bx + bw - 12, by + 2); ctx.lineTo(bx + bw - 2, by + 9); ctx.closePath(); ctx.fill(); }
    }
  }
  // damp stain near the floor and a rust streak
  const stain = ctx.createLinearGradient(0, y + h - 90, 0, y + h);
  stain.addColorStop(0, 'rgba(60,45,30,0)'); stain.addColorStop(1, 'rgba(60,45,30,0.28)');
  ctx.fillStyle = stain; ctx.fillRect(x, y + h - 90, w, 90);
  ctx.strokeStyle = 'rgba(120,60,20,0.18)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(x + w * 0.31, y); ctx.lineTo(x + w * 0.315, y + h * 0.5); ctx.stroke();
}

/** A row of cinder blocks drawn on a projected vertical plane (side or back wall). */
export function paintCinderWallProjected(ctx: CanvasRenderingContext2D, pr: Projector, plane: { kind: 'side'; x: number; z0: number; z1: number } | { kind: 'back'; z: number; x0: number; x1: number }, height: number, opts: { base?: string; seed?: number; lightAt?: { x: number; z: number; r: number } } = {}): void {
  const base = opts.base ?? '#9a9284';
  const r = rng(opts.seed ?? 43);
  const bh = 0.2, bw = 0.4;
  const P = (x: number, y: number, z: number) => pr.project(x, y, z);
  const quad = (a: { sx: number; sy: number }, b: { sx: number; sy: number }, c: { sx: number; sy: number }, d: { sx: number; sy: number }, fill: string | CanvasGradient) => {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fill();
  };
  // mortar bed for the whole wall
  if (plane.kind === 'side') quad(P(plane.x, 0, plane.z0), P(plane.x, 0, plane.z1), P(plane.x, height, plane.z1), P(plane.x, height, plane.z0), shade(base, -0.45));
  else quad(P(plane.x0, 0, plane.z), P(plane.x1, 0, plane.z), P(plane.x1, height, plane.z), P(plane.x0, height, plane.z), shade(base, -0.45));
  let row = 0;
  for (let y0 = 0; y0 < height; y0 += bh, row++) {
    const y1 = Math.min(height, y0 + bh);
    const off = (row % 2) * (bw / 2);
    const u0 = plane.kind === 'side' ? plane.z0 : plane.x0;
    const u1 = plane.kind === 'side' ? plane.z1 : plane.x1;
    for (let u = u0 - bw + off; u < u1; u += bw) {
      const ua = Math.max(u0, u + 0.012), ub = Math.min(u1, u + bw - 0.012);
      if (ub <= ua) continue;
      const tint = (r() - 0.5) * 0.12;
      let lit = 0;
      if (opts.lightAt) {
        const wx = plane.kind === 'side' ? plane.x : (ua + ub) / 2;
        const wz = plane.kind === 'side' ? (ua + ub) / 2 : plane.z;
        const d = Math.hypot(wx - opts.lightAt.x, wz - opts.lightAt.z, (y0 + y1) / 2 - height * 0.8);
        lit = Math.max(0, 1 - d / opts.lightAt.r) * 0.35;
      }
      const ya = y0 + 0.012, yb = y1 - 0.012;
      const a = plane.kind === 'side' ? P(plane.x, ya, ua) : P(ua, ya, plane.z);
      const b = plane.kind === 'side' ? P(plane.x, ya, ub) : P(ub, ya, plane.z);
      const c = plane.kind === 'side' ? P(plane.x, yb, ub) : P(ub, yb, plane.z);
      const d = plane.kind === 'side' ? P(plane.x, yb, ua) : P(ua, yb, plane.z);
      const g = ctx.createLinearGradient(a.sx, c.sy, a.sx, a.sy);
      g.addColorStop(0, shade(base, 0.12 + tint + lit));
      g.addColorStop(1, shade(base, -0.12 + tint + lit * 0.7));
      quad(a, b, c, d, g);
    }
  }
}

/** Exposed floor joists overhead with cross bracing shadows. */
export function paintJoists(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, spacing = 170): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#1d140c'); g.addColorStop(1, '#3a2a1b');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  for (let jx = x + 20; jx < x + w; jx += spacing) {
    const jg = ctx.createLinearGradient(jx, 0, jx + 28, 0);
    jg.addColorStop(0, '#6b4b2e'); jg.addColorStop(0.5, '#4e3620'); jg.addColorStop(1, '#2d1c0f');
    ctx.fillStyle = jg;
    ctx.fillRect(jx, y, 28, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(jx + 28, y, 10, h);
  }
  // subfloor boards
  ctx.strokeStyle = 'rgba(255,220,180,0.08)';
  ctx.lineWidth = 2;
  for (let by = y + 8; by < y + h; by += 16) { ctx.beginPath(); ctx.moveTo(x, by); ctx.lineTo(x + w, by); ctx.stroke(); }
}

/** Copper / steel pipes with specular highlights. */
export function paintPipes(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, opts: { copper?: boolean; thickness?: number } = {}): void {
  const t = opts.thickness ?? 10;
  const col = opts.copper ? ['#5a2d12', '#c97a46', '#f0b88a', '#5a2d12'] : ['#3b3f44', '#8a9096', '#d8dde2', '#3b3f44'];
  const g = ctx.createLinearGradient(0, y - t / 2, 0, y + t / 2);
  g.addColorStop(0, col[0]); g.addColorStop(0.35, col[2]); g.addColorStop(0.6, col[1]); g.addColorStop(1, col[3]);
  ctx.strokeStyle = g; ctx.lineWidth = t; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y + 4); ctx.stroke();
  // hangers
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3;
  for (let hx = x0 + 120; hx < x1; hx += 260) { ctx.beginPath(); ctx.moveTo(hx, y - 40); ctx.lineTo(hx, y); ctx.stroke(); }
}

/** Bare hanging bulb with a cord and a warm pool of light below it. */
export function paintBulb(ctx: CanvasRenderingContext2D, x: number, cordTop: number, y: number, size = 1): void {
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 3 * size;
  ctx.beginPath(); ctx.moveTo(x, cordTop); ctx.lineTo(x, y - 26 * size); ctx.stroke();
  ctx.fillStyle = '#3a3a3a';
  roundRect(ctx, x - 8 * size, y - 30 * size, 16 * size, 14 * size, 3); ctx.fill();
  const glow = ctx.createRadialGradient(x, y, 2 * size, x, y, 260 * size);
  glow.addColorStop(0, 'rgba(255,240,190,0.9)');
  glow.addColorStop(0.08, 'rgba(255,230,160,0.5)');
  glow.addColorStop(0.3, 'rgba(255,220,140,0.16)');
  glow.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - 260 * size, y - 260 * size, 520 * size, 520 * size);
  const bulb = ctx.createRadialGradient(x - 3 * size, y - 4 * size, 1, x, y, 13 * size);
  bulb.addColorStop(0, '#ffffff'); bulb.addColorStop(0.5, '#fff6c8'); bulb.addColorStop(1, 'rgba(255,230,160,0.7)');
  ctx.fillStyle = bulb;
  ctx.beginPath(); ctx.arc(x, y, 13 * size, 0, Math.PI * 2); ctx.fill();
}

/** Concrete slab floor: speckle, stains, cracks and expansion joints. */
export function paintConcreteHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed = 31, opts: { base?: string } = {}): void {
  const base = opts.base ?? '#8e8b84';
  const r = rng(seed);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(base, -0.22)); g.addColorStop(0.5, shade(base, -0.04)); g.addColorStop(1, shade(base, 0.06));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // speckle
  for (let i = 0; i < (w * h) / 180; i++) {
    const px = x + r() * w, py = y + r() * h;
    const t = (py - y) / h;
    ctx.fillStyle = r() > 0.5 ? `rgba(255,255,255,${0.03 + t * 0.06})` : `rgba(0,0,0,${0.05 + t * 0.06})`;
    const s = 1 + r() * 2.5 * (0.4 + t);
    ctx.fillRect(px, py, s, s * 0.6);
  }
  // stains
  for (let i = 0; i < 9; i++) {
    const px = x + r() * w, py = y + h * (0.2 + r() * 0.8);
    const t = (py - y) / h;
    const rad = (40 + r() * 120) * (0.4 + t);
    const sg = ctx.createRadialGradient(px, py, 0, px, py, rad);
    const dark = r() > 0.4;
    sg.addColorStop(0, dark ? 'rgba(40,30,20,0.22)' : 'rgba(200,190,170,0.14)');
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(px, py, rad, rad * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // expansion joints (perspective-ish: converge slightly)
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 2;
  for (let k = -2; k <= 2; k++) {
    const far = x + w / 2 + k * w * 0.12, near = x + w / 2 + k * w * 0.32;
    ctx.beginPath(); ctx.moveTo(far, y); ctx.lineTo(near, y + h); ctx.stroke();
  }
  // cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    let px = x + r() * w, py = y + h * (0.3 + r() * 0.7);
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let k = 0; k < 7; k++) { px += (r() - 0.5) * 50; py += (r() - 0.3) * 30; ctx.lineTo(px, py); }
    ctx.stroke();
  }
}

/** Braided oval rug. */
export function paintBraidedRug(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, seed = 7): void {
  const r = rng(seed);
  const cols = ['#7a5a46', '#9a7a5a', '#5c6b4e', '#a08466', '#6b4a3a'];
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(cx + 4, cy + 4, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  const rings = 9;
  for (let i = rings; i >= 1; i--) {
    const f = i / rings;
    ctx.fillStyle = cols[i % cols.length];
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * f, ry * f, 0, 0, Math.PI * 2); ctx.fill();
    // braid stitches
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1.5;
    const n = Math.floor(24 * f) + 8;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r() * 0.1;
      const px = cx + Math.cos(a) * rx * (f - 0.04), py = cy + Math.sin(a) * ry * (f - 0.04);
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(a + 1.2) * 4, py + Math.sin(a + 1.2) * 2); ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.ellipse(cx - rx * 0.2, cy - ry * 0.3, rx * 0.4, ry * 0.3, 0, 0, Math.PI * 2); ctx.fill();
}

/** Plaid couch, front view, with cushions, seams, piping, arms and feet. */
export function paintCouchHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color = '#5f6b3f', opts: { plaid?: boolean } = {}): void {
  // floor shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h + 6, w * 0.55, h * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  // back
  const bg = ctx.createLinearGradient(0, y, 0, y + h * 0.55);
  bg.addColorStop(0, shade(color, 0.12)); bg.addColorStop(1, shade(color, -0.2));
  ctx.fillStyle = bg;
  roundRect(ctx, x + 12, y, w - 24, h * 0.62, 16); ctx.fill();
  // back cushions (3) with a tufted dip
  const n = 3; const cw = (w - 44) / n;
  for (let i = 0; i < n; i++) {
    const cx = x + 22 + i * cw;
    const g = ctx.createRadialGradient(cx + cw * 0.4, y + h * 0.18, 4, cx + cw / 2, y + h * 0.3, cw * 0.8);
    g.addColorStop(0, shade(color, 0.25)); g.addColorStop(0.7, shade(color, 0.02)); g.addColorStop(1, shade(color, -0.2));
    ctx.fillStyle = g;
    roundRect(ctx, cx, y + 8, cw - 6, h * 0.5, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5;
    roundRect(ctx, cx + 4, y + 12, cw - 14, h * 0.5 - 8, 12); ctx.stroke();
  }
  // seat cushions
  for (let i = 0; i < n; i++) {
    const cx = x + 22 + i * cw;
    const sy = y + h * 0.55;
    const g = ctx.createLinearGradient(0, sy, 0, sy + h * 0.35);
    g.addColorStop(0, shade(color, 0.3)); g.addColorStop(0.35, shade(color, 0.08)); g.addColorStop(1, shade(color, -0.25));
    ctx.fillStyle = g;
    roundRect(ctx, cx, sy, cw - 6, h * 0.36, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.stroke();
    // piping
    ctx.strokeStyle = 'rgba(255,245,220,0.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + 6, sy + h * 0.14); ctx.lineTo(cx + cw - 12, sy + h * 0.14); ctx.stroke();
    // sag crease
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx + 10, sy + h * 0.3); ctx.quadraticCurveTo(cx + cw / 2, sy + h * 0.36, cx + cw - 16, sy + h * 0.3); ctx.stroke();
  }
  // arms
  for (const ax of [x, x + w - 30]) {
    const g = ctx.createLinearGradient(ax, 0, ax + 30, 0);
    g.addColorStop(0, shade(color, 0.2)); g.addColorStop(1, shade(color, -0.3));
    ctx.fillStyle = g;
    roundRect(ctx, ax, y + h * 0.3, 30, h * 0.66, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.stroke();
  }
  // plaid
  if (opts.plaid !== false) {
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#e8c070'; ctx.lineWidth = 3;
    for (let px = x + 8; px < x + w; px += 26) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke(); }
    for (let py = y + 6; py < y + h; py += 26) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x + w, py); ctx.stroke(); }
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1.5;
    for (let px = x + 20; px < x + w; px += 26) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px, y + h); ctx.stroke(); }
    ctx.restore();
  }
  // feet
  ctx.fillStyle = '#2a1a0e';
  ctx.fillRect(x + 10, y + h - 2, 14, 10); ctx.fillRect(x + w - 24, y + h - 2, 14, 10);
}

/** Metal utility shelf with labelled boxes, jars and a paint can. */
export function paintShelfHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed = 50): void {
  const r = rng(seed);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 6, y + 8, w, h);
  const post = ctx.createLinearGradient(x, 0, x + 10, 0);
  post.addColorStop(0, '#6a6a6a'); post.addColorStop(0.5, '#9a9a9a'); post.addColorStop(1, '#4a4a4a');
  ctx.fillStyle = post;
  ctx.fillRect(x, y, 10, h); ctx.fillRect(x + w - 10, y, 10, h);
  const shelves = 4;
  for (let i = 0; i < shelves; i++) {
    const sy = y + h - 8 - i * (h / shelves);
    const sg = ctx.createLinearGradient(0, sy - 10, 0, sy + 6);
    sg.addColorStop(0, '#b5a07a'); sg.addColorStop(0.5, '#8c7250'); sg.addColorStop(1, '#5c4830');
    ctx.fillStyle = sg;
    ctx.fillRect(x + 4, sy - 10, w - 8, 14);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x + 4, sy + 4, w - 8, 5);
    // items
    let ix = x + 14;
    while (ix < x + w - 50) {
      const kind = r();
      if (kind < 0.55) {
        const bw = 46 + r() * 30, bh = 32 + r() * 26;
        const col = ['#c9b58a', '#b58b5a', '#d8ccb0', '#a67c52'][Math.floor(r() * 4)];
        const g = ctx.createLinearGradient(ix, 0, ix + bw, 0);
        g.addColorStop(0, shade(col, 0.1)); g.addColorStop(1, shade(col, -0.25));
        ctx.fillStyle = g; ctx.fillRect(ix, sy - 10 - bh, bw, bh);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(ix, sy - 10 - bh, bw, bh);
        ctx.strokeStyle = 'rgba(90,60,30,0.6)'; ctx.beginPath(); ctx.moveTo(ix + bw / 2, sy - 10 - bh); ctx.lineTo(ix + bw / 2, sy - 10); ctx.stroke();
        if (bw > 56) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(ix + 8, sy - 10 - bh * 0.6, bw - 16, 10); }
        ix += bw + 8;
      } else if (kind < 0.8) {
        const jw = 18 + r() * 8, jh = 26 + r() * 10;
        ctx.fillStyle = 'rgba(200,230,240,0.55)'; roundRect(ctx, ix, sy - 10 - jh, jw, jh, 4); ctx.fill();
        ctx.fillStyle = ['#c0392b', '#d4a017', '#6b8e23'][Math.floor(r() * 3)]; ctx.fillRect(ix + 2, sy - 10 - jh * 0.6, jw - 4, jh * 0.5);
        ctx.fillStyle = '#777'; ctx.fillRect(ix - 1, sy - 12 - jh, jw + 2, 5);
        ix += jw + 6;
      } else {
        const cw = 34, ch = 36;
        const g = ctx.createLinearGradient(ix, 0, ix + cw, 0);
        g.addColorStop(0, '#d0d0d0'); g.addColorStop(0.5, '#f0f0f0'); g.addColorStop(1, '#9a9a9a');
        ctx.fillStyle = g; ctx.fillRect(ix, sy - 10 - ch, cw, ch);
        ctx.fillStyle = ['#2e4a7a', '#b84a2a', '#4a7a3a'][Math.floor(r() * 3)]; ctx.fillRect(ix + 3, sy - 10 - ch * 0.75, cw - 6, ch * 0.45);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(ix + cw / 2, sy - 10 - ch, cw * 0.4, Math.PI, 0); ctx.stroke();
        ix += cw + 8;
      }
    }
  }
}

/** Wooden basement stairs seen from the side, with a railing. */
export function paintStairsHD(ctx: CanvasRenderingContext2D, x: number, floorY: number, stepW: number, steps: number, dir: 1 | -1 = 1): void {
  const rise = 40, run = 22;
  for (let i = 0; i < steps; i++) {
    const sy = floorY - i * rise;
    const sx = x + dir * i * run;
    // riser
    const rg = ctx.createLinearGradient(0, sy - rise, 0, sy);
    rg.addColorStop(0, '#5c3a1e'); rg.addColorStop(1, '#3a2412');
    ctx.fillStyle = rg;
    ctx.fillRect(Math.min(sx, sx + dir * stepW), sy - rise, stepW, rise);
    // tread with wood grain
    const tg = ctx.createLinearGradient(0, sy - rise - 8, 0, sy - rise);
    tg.addColorStop(0, '#c08a55'); tg.addColorStop(1, '#8a5a30');
    ctx.fillStyle = tg;
    ctx.fillRect(Math.min(sx, sx + dir * stepW) - 4, sy - rise - 8, stepW + 8, 9);
    ctx.strokeStyle = 'rgba(60,30,10,0.4)'; ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(Math.min(sx, sx + dir * stepW), sy - rise - 6 + k * 3); ctx.lineTo(Math.min(sx, sx + dir * stepW) + stepW, sy - rise - 5 + k * 3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.min(sx, sx + dir * stepW), sy - rise + 1, stepW, 6);
  }
  // stringer side
  ctx.fillStyle = '#4a2e18';
  ctx.beginPath();
  ctx.moveTo(x + (dir === 1 ? stepW : 0), floorY);
  ctx.lineTo(x + (dir === 1 ? stepW : 0) + dir * (steps - 1) * run, floorY - steps * rise + 8);
  ctx.lineTo(x + (dir === 1 ? stepW : 0) + dir * (steps - 1) * run + dir * 14, floorY - steps * rise + 8);
  ctx.lineTo(x + (dir === 1 ? stepW : 0) + dir * 14, floorY);
  ctx.closePath(); ctx.fill();
  // railing
  ctx.strokeStyle = '#2b1a0d'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  const bx0 = x + (dir === 1 ? stepW * 0.9 : stepW * 0.1), by0 = floorY - 90;
  const bx1 = bx0 + dir * (steps - 1) * run, by1 = floorY - steps * rise - 80;
  ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.lineTo(bx1, by1); ctx.stroke();
  ctx.lineWidth = 4;
  for (let i = 0; i < steps; i += 2) {
    const px = bx0 + dir * i * run, py = by0 + (by1 - by0) * (i / (steps - 1));
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py + 85); ctx.stroke();
  }
}

/** Washer and dryer pair in a corner. */
export function paintWasherDryer(ctx: CanvasRenderingContext2D, x: number, y: number, s = 1): void {
  for (let i = 0; i < 2; i++) {
    const bx = x + i * 92 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(bx + 6 * s, y + 6 * s, 88 * s, 100 * s);
    const g = ctx.createLinearGradient(bx, 0, bx + 88 * s, 0);
    g.addColorStop(0, '#f4f4f2'); g.addColorStop(0.6, '#dcdcda'); g.addColorStop(1, '#a9a9a7');
    ctx.fillStyle = g;
    roundRect(ctx, bx, y, 88 * s, 100 * s, 6 * s); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#c9c9c7'; ctx.fillRect(bx, y, 88 * s, 16 * s);
    for (let k = 0; k < 3; k++) { ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(bx + 20 * s + k * 16 * s, y + 8 * s, 4 * s, 0, Math.PI * 2); ctx.fill(); }
    if (i === 0) {
      const dg = ctx.createRadialGradient(bx + 40 * s, y + 56 * s, 4, bx + 44 * s, y + 58 * s, 28 * s);
      dg.addColorStop(0, '#7fa6c8'); dg.addColorStop(0.7, '#2c4a66'); dg.addColorStop(1, '#101a26');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(bx + 44 * s, y + 58 * s, 28 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#eee'; ctx.lineWidth = 4 * s; ctx.stroke();
    } else {
      ctx.fillStyle = '#bdbdbb'; roundRect(ctx, bx + 10 * s, y + 28 * s, 68 * s, 60 * s, 4 * s); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}

/** Framed poster with glass glare. */
export function paintPosterHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, lines: string[]): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 6, y + 8, w, h);
  ctx.fillStyle = '#2a1c10'; ctx.fillRect(x - 6, y - 6, w + 12, h + 12);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, shade(color, 0.15)); g.addColorStop(1, shade(color, -0.3));
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2; ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = Math.round(Math.min(h * 0.22, (w * 1.6) / Math.max(...lines.map((l) => l.length))));
  ctx.font = `bold ${fs}px "Arial Black", Arial`;
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * fs * 1.2));
  const glare = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
  glare.addColorStop(0, 'rgba(255,255,255,0.22)'); glare.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = glare; ctx.fillRect(x, y, w, h);
}

/** Felt pennant on the wall. */
export function paintPennantHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, text: string): void {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(x + 4, y + 5); ctx.lineTo(x + w + 4, y + h / 2 + 5); ctx.lineTo(x + 4, y + h + 5); ctx.closePath(); ctx.fill();
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, shade(color, 0.1)); g.addColorStop(1, shade(color, -0.25));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x, y, 14, h);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(h * 0.3)}px Arial`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 24, y + h / 2);
}

/** Warm corner falloff so the room feels lit from its lamps, plus a gentle vignette. */
export function paintRoomGrade(ctx: CanvasRenderingContext2D, w: number, h: number, lights: LightSpot[], strength = 0.5): void {
  // darken everything, then re-light around lamps
  ctx.fillStyle = `rgba(10,8,6,${strength * 0.45})`;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const g = ctx.createRadialGradient(l.x, l.y, 10, l.x, l.y, l.r);
    g.addColorStop(0, rgba(l.color ?? '#ffd9a0', (l.strength ?? 0.35) * 0.6));
    g.addColorStop(1, rgba(l.color ?? '#ffd9a0', 0));
    ctx.fillStyle = g;
    ctx.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
  }
  ctx.restore();
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.8);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(0,0,0,${strength * 0.6})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}
