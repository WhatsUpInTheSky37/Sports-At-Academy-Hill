/** Painter helpers for the football backdrop (houses, fence, cones). Pure canvas drawing. */
import { mix, rng, shade } from '../../art/environment';

/** Suburban house seen from the field side: gable roof, siding, framed windows, door, chimney. */
export function paintHouseHD(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, opts: { siding?: string; roof?: string; haze?: number; seed?: number; garage?: boolean } = {}): void {
  const haze = opts.haze ?? 0;
  const siding = mix(opts.siding ?? '#efe6cf', '#dfe9f2', haze);
  const roof = mix(opts.roof ?? '#5a4238', '#aebccb', haze);
  const dark = mix('#2a1c14', '#aebccb', haze);
  const r = rng(opts.seed ?? 3);
  const wallTop = y + h * 0.36;
  // shadow on the ground
  ctx.fillStyle = `rgba(0,0,0,${0.22 * (1 - haze)})`;
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h + 2, w * 0.6, h * 0.06, 0, 0, Math.PI * 2); ctx.fill();
  // walls
  const wg = ctx.createLinearGradient(x, wallTop, x, y + h);
  wg.addColorStop(0, shade(siding, 0.08));
  wg.addColorStop(1, shade(siding, -0.18));
  ctx.fillStyle = wg;
  ctx.fillRect(x, wallTop, w, h - (wallTop - y));
  // siding lines
  ctx.strokeStyle = `rgba(0,0,0,${0.12 * (1 - haze)})`;
  ctx.lineWidth = 1;
  const step = Math.max(3, h * 0.045);
  for (let yy = wallTop + step; yy < y + h; yy += step) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke(); }
  // roof (gable) with shingle rows and an overhang shadow on the wall
  ctx.fillStyle = `rgba(0,0,0,${0.18 * (1 - haze)})`;
  ctx.fillRect(x, wallTop, w, h * 0.05);
  const rg = ctx.createLinearGradient(x, y, x, wallTop);
  rg.addColorStop(0, shade(roof, 0.25));
  rg.addColorStop(1, shade(roof, -0.15));
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.08, wallTop + 2);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 1.08, wallTop + 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, h * 0.02); ctx.stroke();
  ctx.strokeStyle = `rgba(0,0,0,${0.15 * (1 - haze)})`;
  ctx.lineWidth = 1;
  for (let t = 0.15; t < 1; t += 0.17) {
    const yy = y + (wallTop - y) * t;
    const half = w * 0.58 * t;
    ctx.beginPath(); ctx.moveTo(x + w / 2 - half, yy); ctx.lineTo(x + w / 2 + half, yy); ctx.stroke();
  }
  // chimney
  ctx.fillStyle = mix('#8d4b3c', '#aebccb', haze);
  ctx.fillRect(x + w * 0.72, y + h * 0.1, w * 0.07, h * 0.2);
  // windows
  const win = (wx: number, wy: number, ww: number, wh: number) => {
    const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
    g.addColorStop(0, mix('#cfe8ff', '#dfe9f2', haze));
    g.addColorStop(1, mix('#5f8fb8', '#c9d6e4', haze));
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeStyle = mix('#ffffff', '#dfe9f2', haze); ctx.lineWidth = Math.max(1, wh * 0.08); ctx.strokeRect(wx, wy, ww, wh);
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh); ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke();
    ctx.fillStyle = mix('#2f5d3a', '#aebccb', haze);
    const sw = ww * 0.22;
    ctx.fillRect(wx - sw - 1, wy - 1, sw, wh + 2);
    ctx.fillRect(wx + ww + 1, wy - 1, sw, wh + 2);
  };
  const wh = h * 0.22, ww = w * 0.16;
  win(x + w * 0.14, wallTop + h * 0.14, ww, wh);
  if (r() > 0.3) win(x + w * 0.42, wallTop + h * 0.14, ww, wh);
  // door with a small stoop
  ctx.fillStyle = mix('#7a3b2e', '#aebccb', haze);
  ctx.fillRect(x + w * 0.72, wallTop + h * 0.2, w * 0.13, h * 0.44);
  ctx.fillStyle = mix('#f5c518', '#dfe9f2', haze);
  ctx.beginPath(); ctx.arc(x + w * 0.83, wallTop + h * 0.44, Math.max(1, h * 0.015), 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = mix('#b9b2a3', '#c9d6e4', haze);
  ctx.fillRect(x + w * 0.69, y + h - h * 0.04, w * 0.19, h * 0.04);
  if (opts.garage) {
    ctx.fillStyle = shade(siding, -0.05);
    ctx.fillRect(x + w, wallTop + h * 0.18, w * 0.6, h - (wallTop - y) - h * 0.18);
    ctx.fillStyle = shade(roof, -0.1);
    ctx.fillRect(x + w - w * 0.03, wallTop + h * 0.1, w * 0.66, h * 0.1);
    ctx.fillStyle = mix('#e8e0d0', '#dfe9f2', haze);
    ctx.fillRect(x + w * 1.06, wallTop + h * 0.3, w * 0.48, h * 0.34);
    ctx.strokeStyle = `rgba(0,0,0,${0.2 * (1 - haze)})`;
    for (let k = 1; k < 4; k++) { const yy = wallTop + h * 0.3 + (h * 0.34 * k) / 4; ctx.beginPath(); ctx.moveTo(x + w * 1.06, yy); ctx.lineTo(x + w * 1.54, yy); ctx.stroke(); }
  }
}

/** Wooden privacy fence across the back of the field: boards with grain, rails, posts, and a cast shadow. */
export function paintFenceHD(ctx: CanvasRenderingContext2D, x0: number, x1: number, baseY: number, height: number, seed = 17): void {
  const r = rng(seed);
  const top = baseY - height;
  const boardW = Math.max(4, height * 0.17);
  for (let x = x0; x < x1; x += boardW) {
    const tone = 0.9 + r() * 0.25;
    const g = ctx.createLinearGradient(x, top, x, baseY);
    g.addColorStop(0, `rgb(${Math.round(176 * tone)},${Math.round(132 * tone)},${Math.round(86 * tone)})`);
    g.addColorStop(1, `rgb(${Math.round(112 * tone)},${Math.round(78 * tone)},${Math.round(44 * tone)})`);
    ctx.fillStyle = g;
    const dy = (r() - 0.5) * height * 0.04;
    ctx.fillRect(x, top + dy, boardW - 1, height - dy);
    // grain
    ctx.strokeStyle = 'rgba(60,35,15,0.25)';
    ctx.lineWidth = 1;
    for (let k = 0; k < 2; k++) {
      const gx = x + 1 + r() * (boardW - 2);
      ctx.beginPath(); ctx.moveTo(gx, top + 2); ctx.bezierCurveTo(gx + 1, top + height * 0.4, gx - 1, top + height * 0.7, gx + (r() - 0.5) * 2, baseY); ctx.stroke();
    }
    // board gap
    ctx.fillStyle = 'rgba(40,22,8,0.55)';
    ctx.fillRect(x + boardW - 1, top, 1, height);
  }
  // rails
  ctx.fillStyle = 'rgba(70,42,20,0.55)';
  ctx.fillRect(x0, top + height * 0.22, x1 - x0, Math.max(1.5, height * 0.045));
  ctx.fillRect(x0, top + height * 0.74, x1 - x0, Math.max(1.5, height * 0.045));
  // posts
  const postW = Math.max(3, height * 0.1);
  for (let x = x0 + boardW * 3; x < x1; x += boardW * 9) {
    const g = ctx.createLinearGradient(x, 0, x + postW, 0);
    g.addColorStop(0, '#8d6238'); g.addColorStop(1, '#4e3016');
    ctx.fillStyle = g;
    ctx.fillRect(x, top - height * 0.06, postW, height + height * 0.06);
    ctx.fillStyle = '#a77a4c';
    ctx.fillRect(x - 1, top - height * 0.08, postW + 2, Math.max(1.5, height * 0.04));
  }
  // top highlight and the shadow the fence throws on the grass
  ctx.fillStyle = 'rgba(255,240,210,0.25)';
  ctx.fillRect(x0, top, x1 - x0, Math.max(1, height * 0.03));
  const sh = ctx.createLinearGradient(0, baseY, 0, baseY + height * 0.5);
  sh.addColorStop(0, 'rgba(0,0,0,0.3)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(x0, baseY, x1 - x0, height * 0.5);
}
