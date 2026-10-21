/** High-fidelity painters for the darts rec room and the board cabinet. Pure canvas, no game logic. */
import { paintHaze, paintTreeHD, paintVignette, roundRect, rng, shade } from '../../art/environment';
import { BOARD } from './board';

export interface RoomLayout { W: number; H: number; P: boolean; floorY: number; railY: number; boardX: number; boardY: number; boardR: number; }

function woodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, seed: number, vertical = false, radius = 0): void {
  const r = rng(seed);
  const g = vertical ? ctx.createLinearGradient(x, y, x + w, y) : ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, shade(base, 0.18)); g.addColorStop(0.45, base); g.addColorStop(1, shade(base, -0.28));
  ctx.save();
  roundRect(ctx, x, y, w, h, radius); ctx.clip();
  ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  ctx.lineWidth = 1;
  const n = Math.round((vertical ? w : h) / 7);
  for (let i = 0; i < n; i++) {
    const t = (i + r() * 0.8) / n;
    const dark = r() > 0.5;
    ctx.strokeStyle = dark ? `rgba(40,18,5,${0.08 + r() * 0.12})` : `rgba(255,220,170,${0.05 + r() * 0.08})`;
    ctx.beginPath();
    if (vertical) {
      const px = x + t * w;
      ctx.moveTo(px, y);
      ctx.bezierCurveTo(px + (r() - 0.5) * 10, y + h * 0.3, px + (r() - 0.5) * 10, y + h * 0.7, px + (r() - 0.5) * 6, y + h);
    } else {
      const py = y + t * h;
      ctx.moveTo(x, py);
      ctx.bezierCurveTo(x + w * 0.3, py + (r() - 0.5) * 8, x + w * 0.7, py + (r() - 0.5) * 8, x + w, py + (r() - 0.5) * 5);
    }
    ctx.stroke();
  }
  // a couple of knots
  for (let k = 0; k < 2; k++) {
    const kx = x + w * (0.2 + r() * 0.6), ky = y + h * (0.2 + r() * 0.6);
    const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, 14);
    kg.addColorStop(0, 'rgba(40,18,5,0.35)'); kg.addColorStop(1, 'rgba(40,18,5,0)');
    ctx.fillStyle = kg;
    ctx.beginPath(); ctx.ellipse(kx, ky, 14, 9, r(), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function paintRoomHD(ctx: CanvasRenderingContext2D, L: RoomLayout): void {
  const { W, H, P, floorY, railY } = L;
  const r = rng(31);
  // ---- plaster wall with subtle texture and warm falloff ----
  const wg = ctx.createLinearGradient(0, 0, 0, railY);
  wg.addColorStop(0, '#b8956a'); wg.addColorStop(0.5, '#d9b98a'); wg.addColorStop(1, '#e6cc9e');
  ctx.fillStyle = wg; ctx.fillRect(0, 0, W, railY);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(80,50,20,0.05)';
    ctx.fillRect(r() * W, r() * railY, 2 + r() * 2, 1 + r() * 2);
  }
  // soft light from the left window-less side and the lamp
  const lx = W * 0.5;
  const lg = ctx.createRadialGradient(lx, railY * 0.2, 50, lx, railY * 0.2, W * 0.75);
  lg.addColorStop(0, 'rgba(255,240,200,0.22)'); lg.addColorStop(1, 'rgba(60,30,10,0.18)');
  ctx.fillStyle = lg; ctx.fillRect(0, 0, W, railY);
  // ---- wainscot: vertical beadboard with grain ----
  woodGrain(ctx, 0, railY, W, floorY - railY, '#6f4324', 7, true);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
  for (let x = 48; x < W; x += 96) { ctx.beginPath(); ctx.moveTo(x, railY); ctx.lineTo(x, floorY); ctx.stroke(); ctx.strokeStyle = 'rgba(255,220,170,0.12)'; ctx.beginPath(); ctx.moveTo(x + 3, railY); ctx.lineTo(x + 3, floorY); ctx.stroke(); ctx.strokeStyle = 'rgba(0,0,0,0.3)'; }
  // chair rail with bevel
  const railG = ctx.createLinearGradient(0, railY - 14, 0, railY + 8);
  railG.addColorStop(0, '#8a5a32'); railG.addColorStop(0.4, '#5a3418'); railG.addColorStop(1, '#3e2210');
  ctx.fillStyle = railG; ctx.fillRect(0, railY - 14, W, 22);
  ctx.fillStyle = 'rgba(255,230,180,0.4)'; ctx.fillRect(0, railY - 14, W, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, railY + 8, W, 6);
  // baseboard
  ctx.fillStyle = '#3e2210'; ctx.fillRect(0, floorY - 18, W, 18);
  ctx.fillStyle = 'rgba(255,220,170,0.18)'; ctx.fillRect(0, floorY - 18, W, 3);
  // ---- carpet with pile texture and a diamond pattern ----
  const cg = ctx.createLinearGradient(0, floorY, 0, H);
  cg.addColorStop(0, '#5e2b22'); cg.addColorStop(1, '#8a4536');
  ctx.fillStyle = cg; ctx.fillRect(0, floorY, W, H - floorY);
  for (let i = 0; i < 14000; i++) {
    ctx.fillStyle = r() > 0.5 ? 'rgba(255,200,170,0.06)' : 'rgba(30,5,5,0.08)';
    ctx.fillRect(r() * W, floorY + r() * (H - floorY), 2, 3);
  }
  ctx.lineWidth = 2;
  for (let x = -70; x < W + 70; x += 140) {
    for (let y = floorY + 10; y < H + 50; y += 90) {
      const off = ((y - floorY) / 90) % 2 ? 70 : 0;
      ctx.strokeStyle = 'rgba(235,200,120,0.28)';
      ctx.beginPath(); ctx.moveTo(x + off, y); ctx.lineTo(x + off + 70, y - 32); ctx.lineTo(x + off + 140, y); ctx.lineTo(x + off + 70, y + 32); ctx.closePath(); ctx.stroke();
      ctx.fillStyle = 'rgba(40,80,60,0.16)';
      ctx.beginPath(); ctx.moveTo(x + off + 70, y - 14); ctx.lineTo(x + off + 100, y); ctx.lineTo(x + off + 70, y + 14); ctx.lineTo(x + off + 40, y); ctx.closePath(); ctx.fill();
    }
  }
  const sg = ctx.createLinearGradient(0, floorY, 0, floorY + 90);
  sg.addColorStop(0, 'rgba(0,0,0,0.4)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = sg; ctx.fillRect(0, floorY, W, 90);
  // ---- the little bar (left) ----
  const barW = P ? 250 : 430;
  const barTop = floorY - 185;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, -10, barTop + 12, barW + 16, 200, 12); ctx.fill();
  woodGrain(ctx, -20, barTop, barW, 200, '#4a2c16', 9, false, 12);
  // panel mouldings on the bar front
  ctx.strokeStyle = 'rgba(255,220,170,0.18)'; ctx.lineWidth = 2;
  for (let i = 0; i < (P ? 2 : 3); i++) { roundRect(ctx, 8 + i * (barW / (P ? 2 : 3)), barTop + 40, barW / (P ? 2 : 3) - 36, 130, 6); ctx.stroke(); }
  // glossy top
  const tg = ctx.createLinearGradient(0, barTop - 18, 0, barTop + 8);
  tg.addColorStop(0, '#c99a62'); tg.addColorStop(0.35, '#8a5a34'); tg.addColorStop(1, '#5a3418');
  ctx.fillStyle = tg; roundRect(ctx, -20, barTop - 18, barW + 14, 26, 6); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; roundRect(ctx, -10, barTop - 16, barW - 10, 5, 3); ctx.fill();
  // bottles with highlights + a glass
  const bottle = (bx: number, by: number, w: number, h: number, col: string) => {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(bx + w / 2, by + h + 2, w * 0.8, 4, 0, 0, Math.PI * 2); ctx.fill();
    const bg = ctx.createLinearGradient(bx, 0, bx + w, 0);
    bg.addColorStop(0, shade(col, 0.3)); bg.addColorStop(0.4, col); bg.addColorStop(1, shade(col, -0.45));
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(bx + w * 0.3, by); ctx.lineTo(bx + w * 0.7, by); ctx.lineTo(bx + w * 0.7, by + h * 0.25); ctx.quadraticCurveTo(bx + w, by + h * 0.35, bx + w, by + h * 0.5); ctx.lineTo(bx + w, by + h); ctx.lineTo(bx, by + h); ctx.lineTo(bx, by + h * 0.5); ctx.quadraticCurveTo(bx, by + h * 0.35, bx + w * 0.3, by + h * 0.25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; roundRect(ctx, bx + w * 0.18, by + h * 0.45, w * 0.12, h * 0.45, 3); ctx.fill();
    ctx.fillStyle = '#f4e4b0'; ctx.fillRect(bx + w * 0.15, by + h * 0.55, w * 0.7, h * 0.22);
    ctx.fillStyle = '#2a1a0a'; ctx.fillRect(bx + w * 0.3, by - 4, w * 0.4, 6);
  };
  ['#7a1f1f', '#2f6b3a', '#c89b3c', '#3a4a7a'].slice(0, P ? 3 : 4).forEach((c, i) => bottle(34 + i * 46, barTop - 82, 24, 66, c));
  // stools: chrome legs, padded tops
  for (let i = 0; i < (P ? 2 : 3); i++) {
    const sx = 70 + i * 130;
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx, floorY + 132, 44, 10, 0, 0, Math.PI * 2); ctx.fill();
    for (const dx of [-26, 26]) {
      const lg2 = ctx.createLinearGradient(sx + dx - 5, 0, sx + dx + 5, 0);
      lg2.addColorStop(0, '#6a6a6a'); lg2.addColorStop(0.4, '#e8e8e8'); lg2.addColorStop(1, '#5a5a5a');
      ctx.fillStyle = lg2; ctx.fillRect(sx + dx - 5, floorY + 22, 10, 108);
    }
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(sx - 30, floorY + 80, 60, 5);
    const pg = ctx.createRadialGradient(sx - 10, floorY + 10, 4, sx, floorY + 18, 48);
    pg.addColorStop(0, '#4f8f5e'); pg.addColorStop(1, '#1f4a2a');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(sx, floorY + 20, 46, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#163a20'; ctx.beginPath(); ctx.ellipse(sx, floorY + 30, 46, 18, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.ellipse(sx - 12, floorY + 14, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  // trophy shelf
  const shelfY = railY - 150, shelfW = P ? 200 : 300;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(22, shelfY + 14, shelfW, 10);
  woodGrain(ctx, 20, shelfY, shelfW, 14, '#5a3418', 12);
  for (let i = 0; i < (P ? 2 : 4); i++) {
    const tx = 60 + i * 70;
    const tg2 = ctx.createLinearGradient(tx - 14, 0, tx + 14, 0);
    tg2.addColorStop(0, '#fff0a0'); tg2.addColorStop(0.45, '#e8b84a'); tg2.addColorStop(1, '#8a6410');
    ctx.fillStyle = tg2;
    ctx.beginPath(); ctx.moveTo(tx - 15, shelfY - 52); ctx.quadraticCurveTo(tx - 16, shelfY - 24, tx - 5, shelfY - 16); ctx.lineTo(tx + 5, shelfY - 16); ctx.quadraticCurveTo(tx + 16, shelfY - 24, tx + 15, shelfY - 52); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a2a12'; roundRect(ctx, tx - 12, shelfY - 12, 24, 12, 3); ctx.fill();
    ctx.strokeStyle = '#e8b84a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tx - 18, shelfY - 38, 7, Math.PI * 0.5, Math.PI * 1.5); ctx.arc(tx + 18, shelfY - 38, 7, Math.PI * 1.5, Math.PI * 0.5); ctx.stroke();
  }
  // framed photos (landscape only; the cabinet fills the wall in portrait)
  const frame = (fx: number, fy: number, fw: number, fh: number, paint: () => void) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(fx + 6, fy + 8, fw, fh);
    woodGrain(ctx, fx - 10, fy - 10, fw + 20, fh + 20, '#3e2a16', 21);
    ctx.save(); ctx.beginPath(); ctx.rect(fx, fy, fw, fh); ctx.clip(); paint(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
    const gl = ctx.createLinearGradient(fx, fy, fx + fw, fy + fh);
    gl.addColorStop(0, 'rgba(255,255,255,0.18)'); gl.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl; ctx.fillRect(fx, fy, fw, fh);
  };
  if (!P) {
    frame(120, 170, 160, 115, () => {
      const g = ctx.createLinearGradient(0, 170, 0, 285); g.addColorStop(0, '#79b8ea'); g.addColorStop(1, '#5a9a3a');
      ctx.fillStyle = g; ctx.fillRect(120, 170, 160, 115);
      paintTreeHD(ctx, 170, 275, 60, 61); paintTreeHD(ctx, 240, 280, 70, 62);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center'; ctx.fillText('ACADEMY HILL', 200, 262);
    });
    frame(W - 300, 560, 130, 95, () => {
      ctx.fillStyle = '#2e3d5a'; ctx.fillRect(W - 300, 560, 130, 95);
      ctx.fillStyle = '#f5c518'; ctx.font = 'bold 18px "Arial Black"'; ctx.textAlign = 'center'; ctx.fillText('CHAMPS', W - 235, 600);
      ctx.fillStyle = '#fff'; ctx.font = '12px Arial'; ctx.fillText('backyard league', W - 235, 625);
    });
  }
  // ---- window with frame, hazy autumn view and curtains ----
  const winW = P ? 190 : 300, winH = P ? 150 : 260;
  const winX = W - winW - (P ? 30 : 90), winY = P ? Math.round(L.boardY + L.boardR * 1.12 + 40) : 270;
  ctx.save();
  ctx.beginPath(); ctx.rect(winX, winY, winW, winH); ctx.clip();
  const skyG = ctx.createLinearGradient(0, winY, 0, winY + winH);
  skyG.addColorStop(0, '#6aa9e6'); skyG.addColorStop(0.6, '#cfe3f2'); skyG.addColorStop(1, '#f1dfb2');
  ctx.fillStyle = skyG; ctx.fillRect(winX, winY, winW, winH);
  const horizon = winY + winH * 0.62;
  for (let i = 0; i < 6; i++) paintTreeHD(ctx, winX - 20 + i * winW * 0.24, horizon + 6, winH * 0.42, 70 + i, { haze: 0.55 });
  paintHaze(ctx, W, horizon, winH * 0.3);
  const lawn = ctx.createLinearGradient(0, horizon, 0, winY + winH);
  lawn.addColorStop(0, '#8aa84a'); lawn.addColorStop(1, '#5f8a35');
  ctx.fillStyle = lawn; ctx.fillRect(winX, horizon + 4, winW, winH);
  for (let i = 0; i < 4; i++) paintTreeHD(ctx, winX + 20 + i * winW * 0.3, winY + winH * 0.98, winH * 0.55, 50 + i, { haze: 0.1 });
  // autumn tint
  ctx.fillStyle = 'rgba(230,140,50,0.28)'; ctx.fillRect(winX, winY + winH * 0.3, winW, winH * 0.7);
  const glare = ctx.createLinearGradient(winX, winY, winX + winW, winY + winH);
  glare.addColorStop(0, 'rgba(255,255,255,0.25)'); glare.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = glare; ctx.fillRect(winX, winY, winW, winH);
  ctx.restore();
  // frame + muntins
  const fg = ctx.createLinearGradient(0, winY - 12, 0, winY + winH + 12);
  fg.addColorStop(0, '#fbf6ea'); fg.addColorStop(1, '#d9cdb5');
  ctx.strokeStyle = fg; ctx.lineWidth = 14; ctx.strokeRect(winX, winY, winW, winH);
  ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(winX + winW / 2, winY); ctx.lineTo(winX + winW / 2, winY + winH); ctx.moveTo(winX, winY + winH / 2); ctx.lineTo(winX + winW, winY + winH / 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2; ctx.strokeRect(winX - 7, winY - 7, winW + 14, winH + 14);
  ctx.fillStyle = '#e8dcc3'; ctx.fillRect(winX - 16, winY + winH + 6, winW + 32, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(winX - 16, winY + winH + 16, winW + 32, 5);
  // curtains with folds
  for (const [cx, dir] of [[winX - 52, 1], [winX + winW + 8, -1]] as [number, number][]) {
    const cw = 44;
    for (let f = 0; f < 5; f++) {
      const fx = cx + f * (cw / 5);
      const fgr = ctx.createLinearGradient(fx, 0, fx + cw / 5, 0);
      fgr.addColorStop(0, '#7a2420'); fgr.addColorStop(0.5, '#b53a34'); fgr.addColorStop(1, '#6a1e1a');
      ctx.fillStyle = fgr;
      ctx.fillRect(fx, winY - 26, cw / 5 + 1, winH + 56);
    }
    ctx.strokeStyle = 'rgba(240,200,80,0.35)'; ctx.lineWidth = 2;
    for (let y = winY - 16; y < winY + winH + 30; y += 26) { ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx + cw, y + dir * 3); ctx.stroke(); }
    ctx.fillStyle = '#c9a240'; roundRect(ctx, cx - 6, winY - 34, cw + 12, 10, 4); ctx.fill();
  }
  // ---- lamp with a real light pool ----
  const lampX = W - (P ? 110 : 200), lampY = floorY - 60, s = P ? 0.8 : 1;
  // table
  woodGrain(ctx, lampX - 46 * s, lampY, 92 * s, 54 * s, '#4a3324', 15, false, 6);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(lampX, lampY + 56 * s, 50 * s, 8 * s, 0, 0, Math.PI * 2); ctx.fill();
  const stem = ctx.createLinearGradient(lampX - 5, 0, lampX + 5, 0);
  stem.addColorStop(0, '#6a5a3a'); stem.addColorStop(0.4, '#e2c37a'); stem.addColorStop(1, '#5a4a2a');
  ctx.fillStyle = stem; ctx.fillRect(lampX - 5 * s, lampY - 76 * s, 10 * s, 76 * s);
  const shadeG = ctx.createLinearGradient(lampX - 44 * s, 0, lampX + 44 * s, 0);
  shadeG.addColorStop(0, '#d8b26a'); shadeG.addColorStop(0.3, '#fff2c0'); shadeG.addColorStop(0.7, '#f5dc90'); shadeG.addColorStop(1, '#b8924a');
  ctx.fillStyle = shadeG;
  ctx.beginPath(); ctx.moveTo(lampX - 26 * s, lampY - 138 * s); ctx.lineTo(lampX + 26 * s, lampY - 138 * s); ctx.lineTo(lampX + 44 * s, lampY - 74 * s); ctx.lineTo(lampX - 44 * s, lampY - 74 * s); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,20,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  const pool = ctx.createRadialGradient(lampX, lampY - 60 * s, 10, lampX, lampY - 60 * s, 260 * s);
  pool.addColorStop(0, 'rgba(255,225,150,0.42)'); pool.addColorStop(0.5, 'rgba(255,215,140,0.16)'); pool.addColorStop(1, 'rgba(255,215,140,0)');
  ctx.fillStyle = pool; ctx.fillRect(lampX - 300 * s, lampY - 360 * s, 600 * s, 600 * s);
  const down = ctx.createRadialGradient(lampX, lampY, 4, lampX, lampY, 150 * s);
  down.addColorStop(0, 'rgba(255,220,140,0.3)'); down.addColorStop(1, 'rgba(255,220,140,0)');
  ctx.fillStyle = down; ctx.beginPath(); ctx.ellipse(lampX, lampY + 20 * s, 150 * s, 60 * s, 0, 0, Math.PI * 2); ctx.fill();
  // ceiling light over the board
  const g = ctx.createRadialGradient(L.boardX, L.boardY, 40, L.boardX, L.boardY, L.boardR * 2.6);
  g.addColorStop(0, 'rgba(255,240,200,0.3)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  paintVignette(ctx, W, H, 0.32);
}

export interface CabinetLayout { totalW: number; cabH: number; doorW: number; cabW: number; ox: number; oy: number; r: number; }

export function paintCabinetHD(ctx: CanvasRenderingContext2D, C: CabinetLayout): void {
  const { totalW, cabH, doorW, cabW, ox, oy, r } = C;
  const k = r / BOARD.doubleOuterR;
  const rr = rng(44);
  // drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, 12, 32, totalW - 10, cabH, 14); ctx.fill();
  // doors (open, slightly darker) and the back panel
  woodGrain(ctx, 0, 20, doorW + 10, cabH, '#6a3d20', 51, true, 14);
  woodGrain(ctx, totalW - doorW - 10, 20, doorW + 10, cabH, '#6a3d20', 52, true, 14);
  woodGrain(ctx, doorW, 20, cabW, cabH, '#8a5330', 53, false, 14);
  // bevelled edges
  const bevel = (x: number, y: number, w: number, h: number) => {
    ctx.strokeStyle = 'rgba(255,220,170,0.3)'; ctx.lineWidth = 3; roundRect(ctx, x + 3, y + 3, w - 6, h - 6, 12); ctx.stroke();
    ctx.strokeStyle = 'rgba(20,8,0,0.7)'; ctx.lineWidth = 4; roundRect(ctx, x, y, w, h, 14); ctx.stroke();
  };
  bevel(0, 20, doorW + 10, cabH); bevel(totalW - doorW - 10, 20, doorW + 10, cabH); bevel(doorW, 20, cabW, cabH);
  // door shadow onto the back panel
  for (const [x, dir] of [[doorW + 10, 1], [totalW - doorW - 10, -1]] as [number, number][]) {
    const sg = ctx.createLinearGradient(x, 0, x + dir * 40, 0);
    sg.addColorStop(0, 'rgba(0,0,0,0.35)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sg; ctx.fillRect(dir > 0 ? x : x - 40, 22, 40, cabH - 4);
  }
  // chalkboards with chalk dust and a ledge
  for (const dx of [10, totalW - doorW]) {
    const bx = dx + 14, by = 44, bw = doorW - 28, bh = cabH - 60;
    const cg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    cg.addColorStop(0, '#263128'); cg.addColorStop(1, '#17201a');
    ctx.fillStyle = cg; roundRect(ctx, bx, by, bw, bh, 8); ctx.fill();
    ctx.save(); roundRect(ctx, bx, by, bw, bh, 8); ctx.clip();
    for (let i = 0; i < 400; i++) { ctx.fillStyle = `rgba(230,230,220,${0.03 + rr() * 0.08})`; ctx.fillRect(bx + rr() * bw, by + bh * 0.3 + rr() * bh * 0.7, 3 + rr() * 8, 1 + rr() * 2); }
    const smear = ctx.createRadialGradient(bx + bw * 0.5, by + bh * 0.8, 5, bx + bw * 0.5, by + bh * 0.8, bw * 0.7);
    smear.addColorStop(0, 'rgba(220,220,210,0.12)'); smear.addColorStop(1, 'rgba(220,220,210,0)');
    ctx.fillStyle = smear; ctx.fillRect(bx, by, bw, bh);
    ctx.restore();
    ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 5; roundRect(ctx, bx, by, bw, bh, 8); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,220,170,0.25)'; ctx.lineWidth = 1.5; roundRect(ctx, bx + 4, by + 4, bw - 8, bh - 8, 6); ctx.stroke();
    // ledge with chalk and an eraser
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(bx + 6, by + bh - 4, bw - 12, 8);
    ctx.fillStyle = '#f4f0e6'; roundRect(ctx, bx + 18, by + bh - 10, 34, 6, 3); ctx.fill();
    ctx.fillStyle = '#2d2d2d'; roundRect(ctx, bx + bw - 60, by + bh - 12, 40, 9, 2); ctx.fill();
    ctx.fillStyle = '#8a7a6a'; ctx.fillRect(bx + bw - 60, by + bh - 12, 40, 3);
    // brass hinges with screws
    const hx = dx < totalW / 2 ? doorW + 1 : totalW - doorW - 13;
    for (const hy of [cabH * 0.28, cabH * 0.68]) {
      const hg = ctx.createLinearGradient(hx, 0, hx + 12, 0);
      hg.addColorStop(0, '#f2d27a'); hg.addColorStop(0.5, '#b8862a'); hg.addColorStop(1, '#7a5410');
      ctx.fillStyle = hg; roundRect(ctx, hx, hy, 12, 30, 3); ctx.fill();
      ctx.fillStyle = '#5a3c08'; for (const sy of [hy + 7, hy + 23]) { ctx.beginPath(); ctx.arc(hx + 6, sy, 2, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  // ---- board ----
  // black surround with a soft rim
  const sur = ctx.createRadialGradient(ox, oy, r * 0.9, ox, oy, BOARD.boardR * k);
  sur.addColorStop(0, '#1a1a1a'); sur.addColorStop(0.85, '#0e0e0e'); sur.addColorStop(1, '#2a2a2a');
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(ox + 4, oy + 8, BOARD.boardR * k + 2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = sur; ctx.beginPath(); ctx.arc(ox, oy, BOARD.boardR * k, 0, Math.PI * 2); ctx.fill();
  const wedge = (i: number, r0: number, r1: number, fill: string | CanvasGradient) => {
    const a0 = ((i * 18 - 9 - 90) * Math.PI) / 180;
    const a1 = ((i * 18 + 9 - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(ox, oy, r1 * k, a0, a1);
    ctx.arc(ox, oy, r0 * k, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const radial = (c0: string, c1: string) => { const g = ctx.createRadialGradient(ox - r * 0.3, oy - r * 0.3, r * 0.1, ox, oy, r); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
  const darkBed = radial('#262626', '#121212'), lightBed = radial('#f6eccf', '#e2d4ae');
  const red = radial('#e03a3a', '#a81e1e'), green = radial('#3a9a40', '#216b27');
  for (let i = 0; i < 20; i++) {
    const dark = i % 2 === 0;
    const single = dark ? darkBed : lightBed;
    const ring = dark ? red : green;
    wedge(i, BOARD.outerBullR, BOARD.tripleInnerR, single);
    wedge(i, BOARD.tripleInnerR, BOARD.tripleOuterR, ring);
    wedge(i, BOARD.tripleOuterR, BOARD.doubleInnerR, single);
    wedge(i, BOARD.doubleInnerR, BOARD.doubleOuterR, ring);
  }
  // sisal fibre texture: short radial strokes
  ctx.save();
  ctx.beginPath(); ctx.arc(ox, oy, BOARD.doubleOuterR * k, 0, Math.PI * 2); ctx.clip();
  ctx.lineWidth = 1;
  for (let i = 0; i < 6000; i++) {
    const a = rr() * Math.PI * 2, d = Math.sqrt(rr()) * BOARD.doubleOuterR * k;
    const len = 1.5 + rr() * 3;
    ctx.strokeStyle = rr() > 0.5 ? `rgba(255,255,255,${0.04 + rr() * 0.07})` : `rgba(0,0,0,${0.05 + rr() * 0.1})`;
    ctx.beginPath(); ctx.moveTo(ox + Math.cos(a) * d, oy + Math.sin(a) * d); ctx.lineTo(ox + Math.cos(a) * (d + len), oy + Math.sin(a) * (d + len)); ctx.stroke();
  }
  ctx.restore();
  // bulls
  ctx.fillStyle = green; ctx.beginPath(); ctx.arc(ox, oy, BOARD.outerBullR * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = red; ctx.beginPath(); ctx.arc(ox, oy, BOARD.innerBullR * k, 0, Math.PI * 2); ctx.fill();
  // bevelled wires: dark underline then bright highlight
  const wires = (col: string, width: number, off: number) => {
    ctx.strokeStyle = col; ctx.lineWidth = width;
    for (const rad of [BOARD.outerBullR, BOARD.innerBullR, BOARD.tripleInnerR, BOARD.tripleOuterR, BOARD.doubleInnerR, BOARD.doubleOuterR]) {
      ctx.beginPath(); ctx.arc(ox + off, oy + off, rad * k, 0, Math.PI * 2); ctx.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const a = ((i * 18 - 9 - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(ox + off + Math.cos(a) * BOARD.outerBullR * k, oy + off + Math.sin(a) * BOARD.outerBullR * k);
      ctx.lineTo(ox + off + Math.cos(a) * BOARD.doubleOuterR * k, oy + off + Math.sin(a) * BOARD.doubleOuterR * k);
      ctx.stroke();
    }
  };
  wires('rgba(0,0,0,0.55)', Math.max(1.5, k * 1.4), 1);
  wires('#d9d9d9', Math.max(1, k * 0.9), 0);
  wires('rgba(255,255,255,0.6)', Math.max(0.6, k * 0.35), -0.6);
  // embossed number ring
  const ringG = ctx.createRadialGradient(ox, oy, BOARD.doubleOuterR * k, ox, oy, BOARD.boardR * k);
  ringG.addColorStop(0, 'rgba(255,255,255,0.06)'); ringG.addColorStop(0.5, 'rgba(0,0,0,0)'); ringG.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = ringG; ctx.beginPath(); ctx.arc(ox, oy, BOARD.boardR * k, 0, Math.PI * 2); ctx.arc(ox, oy, BOARD.doubleOuterR * k, 0, Math.PI * 2, true); ctx.fill();
  ctx.font = `bold ${Math.round(k * 22)}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nr = (BOARD.doubleOuterR + BOARD.boardR) / 2 * k;
  BOARD.segments.forEach((n, i) => {
    const a = ((i * 18 - 90) * Math.PI) / 180;
    const nx = ox + Math.cos(a) * nr, ny = oy + Math.sin(a) * nr;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(String(n), nx + 1.5, ny + 2);
    ctx.fillStyle = '#f7f3ea'; ctx.fillText(String(n), nx, ny);
  });
  // outer wire ring with highlight
  ctx.strokeStyle = '#5a5a5a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ox, oy, BOARD.boardR * k, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ox, oy, BOARD.boardR * k - 1.5, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  // top-left sheen from the ceiling light
  const sheen = ctx.createRadialGradient(ox - r * 0.5, oy - r * 0.6, 5, ox - r * 0.5, oy - r * 0.6, r * 1.2);
  sheen.addColorStop(0, 'rgba(255,250,230,0.12)'); sheen.addColorStop(1, 'rgba(255,250,230,0)');
  ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(ox, oy, BOARD.boardR * k, 0, Math.PI * 2); ctx.fill();
}
