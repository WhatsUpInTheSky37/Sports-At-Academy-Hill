import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, impact, confetti, shake } from '../../core/ui';
import type { Controls } from '../../core/input';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintAsphalt, paintCypress, paintHaze, paintLawnHD, paintPineHD, paintSkyHD, paintTreeHD, paintVignette, rng } from '../../art/environment';
import { DEFAULT_HOCKEY, NO_INPUT, aiInputs, createAiMemory, createHockey, step, type AiMemory, type HockeyConfig, type HockeyInputs, type HockeyState } from './sim';

/** Visual tuning for the hockey scene. */
export const HOCKEY_VISUAL = {
  /** The camera stands just inside the near net, so only the far net is in view (like the mockup). */
  camZ: 2.0,
  camH: 2.5,
  /** Displayed puck diameter in metres (exaggerated for readability). */
  puckDiameter: 0.3,
  playerHeight: 1.75,
  netHeight: 1.2,
};

export class HockeyScene extends BaseGameScene {
  readonly gameId = 'hockey' as const;
  constructor() { super('HockeyScene'); }
  private cfg: HockeyConfig = { ...DEFAULT_HOCKEY };
  private state!: HockeyState;
  private proj!: Projector;
  private controls: [Controls, Controls] | null = null;
  private aiMem: AiMemory = createAiMemory();
  private sprites: CharacterSprite[] = [];
  private sticks: Phaser.GameObjects.Image[] = [];
  private puckImg!: Phaser.GameObjects.Image;
  private puckShadow!: Phaser.GameObjects.Image;
  private puckRing!: Phaser.GameObjects.Graphics;
  private puckLabel!: Phaser.GameObjects.Text;
  private aimLine!: Phaser.GameObjects.Graphics;
  private netsFront!: Phaser.GameObjects.Graphics;
  private netsBack!: Phaser.GameObjects.Graphics;
  private minimap!: Phaser.GameObjects.Graphics;
  private minimapRect = { x: 0, y: 0, w: 0, h: 0 };
  private powerMeter!: Meter;
  private powerText!: Phaser.GameObjects.Text;
  private fieldTop = 0;
  private fieldBottom = 0;
  private lastSkate = 0;
  private running = false;

  create(): void {
    this.setupShell({ music: 'outdoor' });
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 40;
    this.fieldBottom = P ? H - 300 : H - 160;
    const horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * (P ? 0.3 : 0.33);
    const focal = P ? 1050 : 1250;
    this.proj = new Projector({ camZ: HOCKEY_VISUAL.camZ, camH: HOCKEY_VISUAL.camH, horizonY: horizon, focal, cx: W / 2 });
    this.state = createHockey(this.cfg);
    this.paintBackground();
    this.netsBack = this.add.graphics().setDepth(50);
    this.netsFront = this.add.graphics().setDepth(300).setAlpha(0.6);
    this.drawNets();
    // sprites
    for (const slot of [0, 1] as const) {
      const s = new CharacterSprite(this, 0, 0, this.players[slot].character, 1);
      s.setDepth(500);
      this.sprites.push(s);
      const stick = this.add.image(0, 0, 'hockeystick').setOrigin(0.05, 0.17).setDepth(501);
      this.sticks.push(stick);
    }
    this.puckShadow = this.add.image(0, 0, 'shadow').setDepth(90);
    this.puckRing = this.add.graphics().setDepth(95);
    this.puckImg = this.add.image(0, 0, 'puck').setDepth(400);
    this.puckLabel = this.add.text(0, 0, 'YOUR PUCK', displayStyle(18, '#f5c518', { strokeThickness: 3 })).setOrigin(0.5).setDepth(96).setVisible(false);
    this.aimLine = this.add.graphics().setDepth(94);
    // HUD
    this.setScore(0, '0');
    this.setScore(1, '0');
    this.setSub(`FIRST TO ${this.cfg.winScore}`);
    this.setTurn(null);
    this.buildPanels();
    this.buildMinimap();
    this.beginAfterHowTo(() => this.startMatch());
  }

  private startMatch(): void {
    this.controls = [
      this.makeControls(0, { labels: { a: 'SHOOT', b: 'POKE' } }),
      this.makeControls(1, { labels: { a: 'SHOOT', b: 'POKE' }, touch: false }),
    ];
    this.running = true;
    this.announce('FACE OFF!', { color: '#4ff0ff', size: this.portrait ? 60 : 76, y: this.fieldTop + 200, hold: 900 });
    Audio.sfx('whistle');
  }

  // ---------- background ----------
  /**
   * The driveway seen from inside the near net: house with white siding and blue shutters on the
   * left, the evergreen line on the right and across the far end, the woods hazy beyond.
   */
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `hockey-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const cfg = this.cfg;
      const horizon = pr.cam.horizonY;
      const r = rng(31);
      const nearZ = -HOCKEY_VISUAL.camZ + 0.25;
      const farZ = cfg.rinkL + 3.5;
      const hw = cfg.rinkW / 2 + 0.3;
      const P = (x: number, y: number, z: number) => pr.project(x, y, z);
      const poly = (pts: { sx: number; sy: number }[], fill: string | CanvasGradient, stroke?: string, lw = 2) => {
        ctx.beginPath();
        pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.sx, pt.sy) : ctx.lineTo(pt.sx, pt.sy)));
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
      };
      paintSkyHD(ctx, W, H, horizon + 2, { sunX: W * 0.68, sunY: horizon * 0.3 });
      // hazy woods beyond the far hedge
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 60; i++) woods.push({ x: -120 + i * 4.2 + r() * 2.5, z: farZ + 28 + r() * 50, s: 7 + r() * 6, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = P(t.x, 0, t.z);
        const haze = Math.min(0.85, 0.4 + (t.z - farZ) / 90);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.3 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      paintHaze(ctx, W, horizon, 110);
      // lawn: the whole ground; the driveway is painted over it
      paintLawnHD(ctx, pr, { x0: -30, x1: 30, z0: nearZ, z1: farZ + 14 }, { seed: 11, base: '#579a38', stripeWidth: 2.6 });
      // ---- driveway: asphalt clipped to the projected trapezoid ----
      const a = P(-hw, 0, nearZ), b = P(hw, 0, nearZ), c = P(hw, 0, farZ), d = P(-hw, 0, farZ);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.clip();
      paintAsphalt(ctx, 0, horizon - 10, W, H - horizon + 10, 13, '#6b6966');
      // depth shading: darker and cooler toward the far end, warm sunlight near the camera
      const dg = ctx.createLinearGradient(0, c.sy, 0, a.sy);
      dg.addColorStop(0, 'rgba(60,70,90,0.35)');
      dg.addColorStop(0.5, 'rgba(0,0,0,0)');
      dg.addColorStop(1, 'rgba(255,230,180,0.08)');
      ctx.fillStyle = dg;
      ctx.fillRect(0, c.sy - 4, W, a.sy - c.sy + 8);
      // perspective patches, tar seams and cracks
      for (let i = 0; i < 34; i++) {
        const p = P((r() - 0.5) * cfg.rinkW, 0, r() * cfg.rinkL);
        const pg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, (0.5 + r() * 0.9) * p.scale);
        const dark = r() > 0.45;
        pg.addColorStop(0, dark ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.08)');
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy, (0.5 + r() * 0.9) * p.scale, (0.12 + r() * 0.2) * p.scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 16; i++) {
        let wx = (r() - 0.5) * cfg.rinkW, wz = r() * cfg.rinkL;
        const p0 = P(wx, 0, wz);
        ctx.lineWidth = Math.max(1, 0.012 * p0.scale);
        ctx.beginPath(); ctx.moveTo(p0.sx, p0.sy);
        for (let k = 0; k < 5; k++) {
          wx += (r() - 0.5) * 0.9; wz += (r() - 0.5) * 0.9;
          const p = P(wx, 0, wz);
          ctx.lineTo(p.sx, p.sy);
        }
        ctx.stroke();
      }
      // centre seam running the length of the driveway
      const s0 = P(0.12, 0, nearZ), s1 = P(0.12, 0, farZ);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke();
      // grass creeping into the cracks, like the real driveway: broken seams with small tufts
      for (let z = 0.5; z < cfg.rinkL; z += 1.6 + r() * 2.4) {
        const segs = 2 + Math.floor(r() * 3);
        for (let sgi = 0; sgi < segs; sgi++) {
          const x0 = -cfg.rinkW / 2 + r() * cfg.rinkW, len = 0.6 + r() * 1.8;
          const ga = P(x0, 0, z + (r() - 0.5) * 0.3), gb = P(Math.min(cfg.rinkW / 2, x0 + len), 0, z + (r() - 0.5) * 0.3);
          ctx.strokeStyle = 'rgba(95,150,60,0.4)';
          ctx.lineWidth = Math.max(1, 0.025 * ga.scale);
          ctx.beginPath(); ctx.moveTo(ga.sx, ga.sy); ctx.lineTo(gb.sx, gb.sy); ctx.stroke();
          const n = Math.floor(2 + r() * 4);
          for (let k = 0; k < n; k++) {
            const t = r();
            const tx = ga.sx + (gb.sx - ga.sx) * t, ty = ga.sy + (gb.sy - ga.sy) * t;
            const bl = Math.min(12, 0.07 * ga.scale);
            if (bl < 1.5) continue;
            ctx.strokeStyle = 'rgba(140,195,85,0.55)'; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(tx + (r() - 0.5) * bl * 0.5, ty - bl * 0.6, tx + (r() - 0.5) * bl, ty - bl); ctx.stroke();
          }
        }
      }
      // worn grey edge where the driveway meets the lawn
      ctx.restore();
      // ---- chalk and paint lines ----
      const line = (x1: number, z1: number, x2: number, z2: number, col: string, w: number, dash?: number[]) => {
        const p1 = P(x1, 0, z1), p2 = P(x2, 0, z2);
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.setLineDash(dash ?? []);
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
        ctx.setLineDash([]);
      };
      // chalk is thicker near the camera: draw as thin perspective quads
      const chalkStrip = (x: number, wdt: number, col: string) => {
        poly([P(x - wdt / 2, 0, nearZ), P(x + wdt / 2, 0, nearZ), P(x + wdt / 2, 0, cfg.rinkL + 2), P(x - wdt / 2, 0, cfg.rinkL + 2)], col);
      };
      chalkStrip(-cfg.rinkW / 2, 0.09, 'rgba(255,255,255,0.88)');
      chalkStrip(cfg.rinkW / 2, 0.09, 'rgba(255,255,255,0.88)');
      poly([P(-cfg.rinkW / 2, 0, cfg.rinkL - 0.05), P(cfg.rinkW / 2, 0, cfg.rinkL - 0.05), P(cfg.rinkW / 2, 0, cfg.rinkL + 0.05), P(-cfg.rinkW / 2, 0, cfg.rinkL + 0.05)], 'rgba(230,50,50,0.9)');
      poly([P(-cfg.rinkW / 2, 0, -0.06), P(cfg.rinkW / 2, 0, -0.06), P(cfg.rinkW / 2, 0, 0.06), P(-cfg.rinkW / 2, 0, 0.06)], 'rgba(230,50,50,0.9)');
      line(-cfg.rinkW / 2, cfg.rinkL / 2, cfg.rinkW / 2, cfg.rinkL / 2, 'rgba(255,255,255,0.65)', 3, [18, 12]);
      const cp = P(0, 0, cfg.rinkL / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cp.sx, cp.sy, 0.9 * cp.scale, 0.33 * cp.scale, 0, 0, Math.PI * 2); ctx.stroke();
      // ---- the evergreen line: along the right and across the far end ----
      const trees: { x: number; z: number; h: number; seed: number }[] = [];
      const hedgeX = cfg.rinkW / 2 + 1.6;
      for (let z = nearZ + 0.8; z < farZ + 2; z += 1.7) trees.push({ x: hedgeX + (r() - 0.5) * 0.5, z: z + (r() - 0.5) * 0.3, h: 1.8 + r() * 0.5, seed: 500 + Math.round(z * 10) });
      for (let x = -16; x <= 16; x += 1.7) trees.push({ x: x + (r() - 0.5) * 0.4, z: farZ + 2.2 + r() * 0.8, h: 1.8 + r() * 0.5, seed: 600 + Math.round(x * 10) });
      const backRow = trees.map((t) => ({ x: t.x + (t.x > hedgeX - 1 && t.z < farZ + 1.5 ? 1.6 : (r() - 0.5)), z: t.z + (t.z > farZ + 1.5 ? 1.8 : (r() - 0.5) * 0.6), h: t.h * 1.3, seed: t.seed + 1000 }));
      [...backRow, ...trees].sort((p1, p2) => p2.z - p1.z).forEach((t) => {
        const p = P(t.x, 0, t.z);
        if (!p.visible || p.sx < -200 || p.sx > W + 200) return;
        const haze = Math.max(0, Math.min(0.4, (t.z - 14) / 70));
        if (t.seed % 7 === 0) paintPineHD(ctx, p.sx, p.sy, t.h * p.scale * 1.1, t.seed, { haze });
        else paintCypress(ctx, p.sx, p.sy, t.h * p.scale, t.seed, { haze });
      });
      // ---- the house along the left: white siding, blue shutters, grey roof ----
      const hx = -cfg.rinkW / 2 - 2.4;        // wall facing the driveway
      const hz0 = nearZ + 0.4, hz1 = cfg.rinkL - 1.5;
      const wallH = 3.0, ridgeH = 5.8, ridgeX = hx - 5.5, backX = hx - 11;
      // far gable wall (seen at an angle)
      const g0 = P(backX, 0, hz1), g1 = P(hx, 0, hz1), g2 = P(hx, wallH, hz1), g3 = P(backX, wallH, hz1);
      const gg = ctx.createLinearGradient(g0.sx, 0, g1.sx, 0);
      gg.addColorStop(0, '#d9d4c8'); gg.addColorStop(1, '#ebe6da');
      poly([g0, g1, g2, g3], gg, 'rgba(40,30,20,0.45)');
      poly([g3, g2, P(ridgeX, ridgeH, hz1)], '#e4dfd3', 'rgba(40,30,20,0.45)');
      // side wall along the driveway, lit from the upper left
      const q0 = P(hx, 0, hz0), q1 = P(hx, 0, hz1), q2 = P(hx, wallH, hz1), q3 = P(hx, wallH, hz0);
      const wg = ctx.createLinearGradient(0, q3.sy, 0, q0.sy);
      wg.addColorStop(0, '#fbf8f0'); wg.addColorStop(0.7, '#efeadd'); wg.addColorStop(1, '#d9d2c2');
      poly([q0, q1, q2, q3], wg, 'rgba(40,30,20,0.5)');
      ctx.strokeStyle = 'rgba(0,0,0,0.09)';
      ctx.lineWidth = 1;
      for (let h = 0.22; h < wallH; h += 0.22) {
        const l0 = P(hx, h, hz0), l1 = P(hx, h, hz1);
        ctx.beginPath(); ctx.moveTo(l0.sx, l0.sy); ctx.lineTo(l1.sx, l1.sy); ctx.stroke();
      }
      // roof slope up to the ridge, with shingle lines and a chimney
      const r0 = P(hx + 0.35, wallH, hz0 - 0.3), r1 = P(hx + 0.35, wallH, hz1 + 0.3), r2 = P(ridgeX, ridgeH, hz1 + 0.3), r3 = P(ridgeX, ridgeH, hz0 - 0.3);
      const rg = ctx.createLinearGradient(0, r3.sy, 0, r0.sy);
      rg.addColorStop(0, '#8d8d8b'); rg.addColorStop(1, '#55544f');
      poly([r0, r1, r2, r3], rg, 'rgba(30,30,30,0.6)');
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const l0 = P(hx + 0.35 + (ridgeX - hx - 0.35) * t, wallH + (ridgeH - wallH) * t, hz0 - 0.3);
        const l1 = P(hx + 0.35 + (ridgeX - hx - 0.35) * t, wallH + (ridgeH - wallH) * t, hz1 + 0.3);
        ctx.beginPath(); ctx.moveTo(l0.sx, l0.sy); ctx.lineTo(l1.sx, l1.sy); ctx.stroke();
      }
      poly([P(ridgeX - 0.4, ridgeH - 0.2, cfg.rinkL * 0.55), P(ridgeX + 0.4, ridgeH - 0.2, cfg.rinkL * 0.55), P(ridgeX + 0.4, ridgeH + 0.9, cfg.rinkL * 0.55), P(ridgeX - 0.4, ridgeH + 0.9, cfg.rinkL * 0.55)], '#8f8f8d', 'rgba(0,0,0,0.4)');
      // gutter / fascia
      poly([P(hx + 0.35, wallH - 0.12, hz0 - 0.3), P(hx + 0.35, wallH - 0.12, hz1 + 0.3), P(hx + 0.35, wallH + 0.06, hz1 + 0.3), P(hx + 0.35, wallH + 0.06, hz0 - 0.3)], '#f3f1ea', 'rgba(0,0,0,0.25)', 1);
      // foundation
      poly([q0, q1, P(hx, 0.3, hz1), P(hx, 0.3, hz0)], '#b5b0a4', 'rgba(0,0,0,0.3)', 1);
      // windows with blue shutters, a side door with a light
      const win = (zc: number, w: number, hBottom: number, hTop: number) => {
        const wa = P(hx, hBottom, zc - w / 2), wb = P(hx, hBottom, zc + w / 2), wc = P(hx, hTop, zc + w / 2), wd = P(hx, hTop, zc - w / 2);
        const glass = ctx.createLinearGradient(wd.sx, wd.sy, wb.sx, wb.sy);
        glass.addColorStop(0, '#cfe8ff'); glass.addColorStop(0.5, '#8ec3f0'); glass.addColorStop(1, '#5d8fbf');
        poly([wa, wb, wc, wd], glass, '#ffffff', 3);
        const mid = P(hx, (hBottom + hTop) / 2, zc - w / 2), mid2 = P(hx, (hBottom + hTop) / 2, zc + w / 2);
        const vt = P(hx, hTop, zc), vb = P(hx, hBottom, zc);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(mid.sx, mid.sy); ctx.lineTo(mid2.sx, mid2.sy); ctx.moveTo(vt.sx, vt.sy); ctx.lineTo(vb.sx, vb.sy); ctx.stroke();
        const sh = 0.3;
        const sg = ctx.createLinearGradient(0, wd.sy, 0, wa.sy);
        sg.addColorStop(0, '#3a62c9'); sg.addColorStop(1, '#22418f');
        poly([P(hx, hBottom, zc - w / 2 - sh), wa, wd, P(hx, hTop, zc - w / 2 - sh)], sg, 'rgba(0,0,0,0.4)', 1);
        poly([wb, P(hx, hBottom, zc + w / 2 + sh), P(hx, hTop, zc + w / 2 + sh), wc], sg, 'rgba(0,0,0,0.4)', 1);
      };
      for (let z = hz0 + 2.5; z < hz1 - 2; z += 4.4) win(z, 1.1, 1.1, 2.4);
      const doorZ = hz0 + 9.5;
      poly([P(hx, 0.3, doorZ), P(hx, 0.3, doorZ + 0.9), P(hx, 2.3, doorZ + 0.9), P(hx, 2.3, doorZ)], '#2c4fb8', 'rgba(0,0,0,0.4)', 1);
      const lamp = P(hx, 2.6, doorZ + 0.45);
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath(); ctx.arc(lamp.sx, lamp.sy, Math.max(2, 0.08 * lamp.scale), 0, Math.PI * 2); ctx.fill();
      // low clipped shrubs along the foundation (no trunks), perspective sized
      for (let z = hz0 + 0.6; z < hz1; z += 1.1) {
        const p = P(hx + 0.6, 0, z);
        if (!p.visible) continue;
        const sw = 0.5 * p.scale, sh = 0.42 * p.scale;
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.ellipse(p.sx + sw * 0.2, p.sy + 2, sw * 1.1, sh * 0.2, 0, 0, Math.PI * 2); ctx.fill();
        for (let k = 0; k < 4; k++) {
          const bx = p.sx + (k - 1.5) * sw * 0.45, by = p.sy - sh * (0.55 + (k % 2) * 0.25);
          const br = sw * (0.45 + r() * 0.15);
          const g = ctx.createRadialGradient(bx - br * 0.4, by - br * 0.4, br * 0.05, bx, by, br);
          g.addColorStop(0, '#9fd25a'); g.addColorStop(0.55, '#4f9233'); g.addColorStop(1, '#1f4d1d');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
        }
      }
      paintVignette(ctx, W, H, 0.22);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
  }

  /** The far net: red steel frame with highlights, sagging white mesh, a shadow on the driveway. */
  private drawNets(): void {
    const cfg = this.cfg;
    const pr = this.proj;
    const drawNet = (g: Phaser.GameObjects.Graphics, z: number, dir: 1 | -1) => {
      const hw = cfg.goalW / 2;
      const h = HOCKEY_VISUAL.netHeight;
      const d = cfg.goalDepth * dir;
      const Pp = (x: number, y: number, zz: number) => pr.project(x, y, zz);
      const fl = Pp(-hw, 0, z), fr = Pp(hw, 0, z), tl = Pp(-hw, h, z), tr = Pp(hw, h, z);
      const bl = Pp(-hw, 0, z + d), br = Pp(hw, 0, z + d), btl = Pp(-hw, h * 0.82, z + d), btr = Pp(hw, h * 0.82, z + d);
      if (!fl.visible || !bl.visible) return;
      // shadow on the ground behind the net
      g.fillStyle(0x000000, 0.22);
      g.fillPoints([{ x: fl.sx - 4, y: fl.sy + 2 }, { x: fr.sx + 4, y: fr.sy + 2 }, { x: br.sx + 10, y: br.sy + 1 }, { x: bl.sx - 10, y: bl.sy + 1 }], true);
      // mesh panels (back, sides, top) with a faint white fill
      g.fillStyle(0xffffff, 0.3);
      g.fillPoints([{ x: bl.sx, y: bl.sy }, { x: br.sx, y: br.sy }, { x: btr.sx, y: btr.sy }, { x: btl.sx, y: btl.sy }], true);
      g.fillStyle(0xffffff, 0.16);
      g.fillPoints([{ x: fl.sx, y: fl.sy }, { x: bl.sx, y: bl.sy }, { x: btl.sx, y: btl.sy }, { x: tl.sx, y: tl.sy }], true);
      g.fillPoints([{ x: fr.sx, y: fr.sy }, { x: br.sx, y: br.sy }, { x: btr.sx, y: btr.sy }, { x: tr.sx, y: tr.sy }], true);
      g.fillPoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: btr.sx, y: btr.sy }, { x: btl.sx, y: btl.sy }], true);
      // crossing strands with slight sag
      const n = 10;
      const sag = 0.06 * (btr.sx - btl.sx);
      g.lineStyle(1, 0xffffff, 0.6);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        // verticals on the back panel
        g.lineBetween(bl.sx + (br.sx - bl.sx) * t, bl.sy + (br.sy - bl.sy) * t, btl.sx + (btr.sx - btl.sx) * t, btl.sy + (btr.sy - btl.sy) * t);
        // horizontals on the back panel, sagging in the middle
        const y0 = bl.sy + (btl.sy - bl.sy) * t, y1 = br.sy + (btr.sy - br.sy) * t;
        const segs = 8;
        let px = bl.sx, py = y0;
        for (let k = 1; k <= segs; k++) {
          const u = k / segs;
          const nx = bl.sx + (br.sx - bl.sx) * u;
          const ny = y0 + (y1 - y0) * u + Math.sin(u * Math.PI) * sag * (1 - t) * 0.4;
          g.lineBetween(px, py, nx, ny);
          px = nx; py = ny;
        }
        // side panels
        g.lineBetween(fl.sx + (bl.sx - fl.sx) * t, fl.sy + (bl.sy - fl.sy) * t, tl.sx + (btl.sx - tl.sx) * t, tl.sy + (btl.sy - tl.sy) * t);
        g.lineBetween(fr.sx + (br.sx - fr.sx) * t, fr.sy + (br.sy - fr.sy) * t, tr.sx + (btr.sx - tr.sx) * t, tr.sy + (btr.sy - tr.sy) * t);
        // top panel
        g.lineBetween(tl.sx + (tr.sx - tl.sx) * t, tl.sy + (tr.sy - tl.sy) * t, btl.sx + (btr.sx - btl.sx) * t, btl.sy + (btr.sy - btl.sy) * t);
      }
      // red steel frame: dark edge, red body, light highlight
      const w = Math.max(3, 0.085 * fl.scale);
      const tube = (x1: number, y1: number, x2: number, y2: number, thick: number) => {
        g.lineStyle(thick + 2, 0x7a1010, 1); g.lineBetween(x1, y1, x2, y2);
        g.lineStyle(thick, 0xd93030, 1); g.lineBetween(x1, y1, x2, y2);
        g.lineStyle(Math.max(1, thick * 0.3), 0xff8a80, 0.8); g.lineBetween(x1 - thick * 0.2, y1 - thick * 0.25, x2 - thick * 0.2, y2 - thick * 0.25);
      };
      tube(bl.sx, bl.sy, btl.sx, btl.sy, w * 0.7);
      tube(br.sx, br.sy, btr.sx, btr.sy, w * 0.7);
      tube(bl.sx, bl.sy, br.sx, br.sy, w * 0.7);
      tube(tl.sx, tl.sy, btl.sx, btl.sy, w * 0.7);
      tube(tr.sx, tr.sy, btr.sx, btr.sy, w * 0.7);
      tube(fl.sx, fl.sy, tl.sx, tl.sy, w);
      tube(fr.sx, fr.sy, tr.sx, tr.sy, w);
      tube(tl.sx, tl.sy, tr.sx, tr.sy, w);
    };
    drawNet(this.netsBack, cfg.rinkL, 1);
    // The near net sits behind the camera; its frame is not drawn (see HOCKEY_VISUAL.camZ).
    this.netsFront.setVisible(false);
  }

  private buildPanels(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const touchP = P && this.useTouch;
    const mw = touchP ? 430 : P ? 520 : 600;
    const mx = touchP ? 330 : W / 2 - mw / 2;
    const my = touchP ? H - 330 : P ? H - 150 : H - 92;
    const panel = this.add.graphics().setDepth(900);
    panel.fillStyle(0x0d1f10, 0.8);
    panel.fillRoundedRect(mx - 20, my - 44, mw + 40, 100, 16);
    panel.lineStyle(3, THEME.accent, 0.8);
    panel.strokeRoundedRect(mx - 20, my - 44, mw + 40, 100, 16);
    this.add.text(mx, my - 32, 'SHOT POWER', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0).setDepth(901);
    this.powerText = this.add.text(mx + mw, my - 32, P ? 'hold, then release' : 'hold SHOOT to wind up, release to fire', textStyle(18, THEME.textDim)).setOrigin(1, 0).setDepth(901);
    this.powerMeter = new Meter(this, mx, my + 4, mw, 26, { depth: 901, bg: 0x2a2a2a, fg: 0xf5c518 });
    this.powerMeter.set(0);
    if (!this.useTouch) {
      const hint = (x: number, y: number, title: string, lines: string[], w = 300) => {
        const g = this.add.graphics().setDepth(900);
        g.fillStyle(0x0d1f10, 0.8);
        g.fillRoundedRect(x, y, w, 100, 16);
        g.lineStyle(3, THEME.accent, 0.8);
        g.strokeRoundedRect(x, y, w, 100, 16);
        this.add.text(x + w / 2, y + 12, title, displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
        this.add.text(x + w / 2, y + 44, lines.join('\n'), textStyle(19, '#ffffff', { align: 'center' })).setOrigin(0.5, 0).setDepth(901);
      };
      const y = P ? H - 150 - 44 : H - 136;
      if (this.match.mode === 'local') {
        hint(30, y, 'P1', ['WASD move', 'F shoot • G poke'], P ? 240 : 300);
        hint(W - 30 - (P ? 240 : 300), y, 'P2', ['Arrows move', ', shoot • . poke'], P ? 240 : 300);
      } else {
        hint(30, y, 'MOVE', ['WASD / Arrows'], P ? 240 : 300);
        hint(W - 30 - (P ? 240 : 300), y, 'SHOOT / POKE', ['F (hold) / G'], P ? 240 : 300);
      }
    }
  }

  private buildMinimap(): void {
    const W = this.W, P = this.portrait;
    const cfg = this.cfg;
    const h = P ? 220 : 300;
    const w = Math.round(h * (cfg.rinkW + 1.5) / (cfg.rinkL + 3));
    const x = W - 30 - w;
    const y = P ? this.hudBottom - 30 : 150;
    this.minimapRect = { x, y, w, h };
    const frame = this.add.graphics().setDepth(950);
    frame.fillStyle(0x0d1f10, 0.85);
    frame.fillRoundedRect(x - 10, y - 10, w + 20, h + 20, 12);
    frame.lineStyle(3, THEME.accent, 0.9);
    frame.strokeRoundedRect(x - 10, y - 10, w + 20, h + 20, 12);
    frame.fillStyle(0x4f8f36, 1);
    frame.fillRect(x, y, w, h);
    const sx = w / (cfg.rinkW + 1.5);
    const sz = h / (cfg.rinkL + 3);
    const rx = x + 0.75 * sx, ry = y + 1.5 * sz;
    frame.fillStyle(0x6f6c68, 1);
    frame.fillRect(rx, ry, cfg.rinkW * sx, cfg.rinkL * sz);
    frame.lineStyle(2, 0xffffff, 0.8);
    frame.strokeRect(rx, ry, cfg.rinkW * sx, cfg.rinkL * sz);
    frame.lineStyle(1, 0xffffff, 0.5);
    frame.lineBetween(rx, ry + cfg.rinkL * sz / 2, rx + cfg.rinkW * sx, ry + cfg.rinkL * sz / 2);
    frame.lineStyle(3, 0xd32f2f, 1);
    const gw = cfg.goalW * sx;
    frame.strokeRect(x + w / 2 - gw / 2, ry - cfg.goalDepth * sz, gw, cfg.goalDepth * sz);
    frame.strokeRect(x + w / 2 - gw / 2, ry + cfg.rinkL * sz, gw, cfg.goalDepth * sz);
    this.minimap = this.add.graphics().setDepth(951);
  }

  /** Map world (x, z) to minimap pixels; near net (z=0) at the bottom like the player's view. */
  private mini(x: number, z: number): { x: number; y: number } {
    const { x: mx, y: my, w, h } = this.minimapRect;
    const cfg = this.cfg;
    const sx = w / (cfg.rinkW + 1.5);
    const sz = h / (cfg.rinkL + 3);
    return { x: mx + w / 2 + x * sx, y: my + h - 1.5 * sz - z * sz };
  }

  // ---------- per-frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.running || this.finished) return;
    const dt = Math.min(0.04, dtMs / 1000);
    const inputs: [HockeyInputs, HockeyInputs] = [this.readInputs(0, dt), this.readInputs(1, dt)];
    const events = step(this.state, inputs, dt, this.cfg);
    for (const e of events) this.handleEvent(e);
    this.render(dt);
  }

  private readInputs(slot: 0 | 1, dt: number): HockeyInputs {
    if (this.isAI(slot)) return aiInputs(this.state, slot, this.ai, this.aiMem, dt, this.cfg);
    const c = this.controls?.[slot];
    if (!c) return NO_INPUT;
    // screen up = away from the camera = +z
    return { ax: c.axis.x, az: -c.axis.y, shoot: c.isDown('a'), poke: c.justDown('b') };
  }

  private handleEvent(e: import('./sim').HockeyEvent): void {
    switch (e.type) {
      case 'shot': Audio.sfx('slap'); break;
      case 'poke': Audio.sfx(e.stripped ? 'thud' : 'skate'); if (e.stripped) { const p = this.state.puck; const s = this.proj.project(p.x, 0.1, p.z); impact(this, s.sx, s.sy, 0xffffff, 8, 650, 5); } break;
      case 'pickup': Audio.sfx('click'); break;
      case 'wall': Audio.sfx('bounce'); break;
      case 'goal': {
        Audio.sfx('goalHorn');
        shake(this, 0.004, 200);
        const scorer = e.scorer;
        this.setScore(0, String(this.state.scores[0]));
        this.setScore(1, String(this.state.scores[1]));
        this.announce('GOAL!', { color: '#f5c518', size: this.portrait ? 84 : 100, y: this.fieldTop + 200, sub: `${this.name(scorer)} scores` });
        const sp = this.sprites[scorer];
        confetti(this, sp.x, sp.y - 150, 40);
        this.react(scorer, 'cheer', sp.x, sp.y - 180 * sp.charScale);
        const loser = scorer === 0 ? 1 : 0;
        if (Math.random() < 0.5) this.time.delayedCall(700, () => { const l = this.sprites[loser]; this.react(loser, 'groan', l.x, l.y - 180 * l.charScale); });
        break;
      }
      case 'reset': Audio.sfx('whistle'); this.setStatus(''); break;
      case 'win': {
        const w = e.winner;
        const s = this.state.scores;
        this.time.delayedCall(600, () => this.finishMatch({
          winnerSlot: w,
          summary: `${s[w]} - ${s[w === 0 ? 1 : 0]} goals, first to ${this.cfg.winScore}`,
          scores: [`${s[0]} goals`, `${s[1]} goals`],
        }));
        break;
      }
    }
  }

  private render(dt: number): void {
    const st = this.state;
    const pr = this.proj;
    const cfg = this.cfg;
    // players
    for (const p of st.players) {
      const sp = this.sprites[p.slot];
      const g = pr.project(p.x, 0, p.z);
      const scale = g.scale * HOCKEY_VISUAL.playerHeight / 220;
      sp.setPosition(g.sx, g.sy).setScale(1);
      sp.sprite.setScale(scale);
      sp.sprite.setY(-220 * 0.5 * scale + 14 * scale);
      sp.shadow.setScale(1.1 * scale, 0.9 * scale);
      sp.setDepth(500 + Math.round((cfg.rinkL - p.z) * 10));
      const moving = Math.hypot(p.vx, p.vz) > 0.6;
      const back = p.fz > 0.15;
      sp.setFacing(p.fx < -0.2 ? -1 : 1);
      if (p.pokeTimer > 0) sp.setPose(back ? 'back-push' : 'push');
      else if (p.charging) sp.setPose(back ? 'back-crouch' : 'crouch');
      else if (moving) sp.setAnim(back ? ['back-run0', 'back-run1', 'back-run2', 'back-run3'] : ['run0', 'run1', 'run2', 'run3'], 9, true);
      else sp.setAnim(back ? ['back-idle0', 'back-idle1'] : ['idle0', 'idle1'], 2, true);
      // stick: from the hands toward the stick tip on the ground
      const reach = p.pokeTimer > 0 ? cfg.pokeReach : cfg.carryOffset + 0.25;
      const hands = pr.project(p.x + p.fx * 0.15, 0.75, p.z + p.fz * 0.15);
      const tip = pr.project(p.x + p.fx * reach, 0, p.z + p.fz * reach);
      const stick = this.sticks[p.slot];
      const dx = tip.sx - hands.sx, dy = tip.sy - hands.sy;
      const L = Math.hypot(dx, dy);
      stick.setPosition(hands.sx, hands.sy).setRotation(Math.atan2(dy, dx) - 0.28).setDepth(sp.depth + 1);
      stick.setScale(Math.max(0.3, L / 140), Math.max(0.3, scale * 1.4));
      if (moving && p.slot === 0 && this.time.now - this.lastSkate > 420) { this.lastSkate = this.time.now; Audio.sfx('skate'); }
    }
    // puck
    const pk = st.puck;
    const pp = pr.project(pk.x, 0.03, pk.z);
    const size = Math.max(10, HOCKEY_VISUAL.puckDiameter * pp.scale);
    this.puckImg.setPosition(pp.sx, pp.sy).setScale(size / 40).setDepth(400 + Math.round((cfg.rinkL - pk.z) * 10) + 102).setVisible(pp.visible);
    this.puckShadow.setPosition(pp.sx, pp.sy + size * 0.15).setScale(size / 128 * 1.2, size / 128 * 0.5).setVisible(pp.visible);
    this.puckRing.clear();
    this.puckLabel.setVisible(false);
    if (pk.carrier !== null && pp.visible) {
      const mine = !this.isAI(pk.carrier);
      this.puckRing.lineStyle(4, mine ? 0xf5c518 : 0xef5350, 0.9);
      this.puckRing.strokeEllipse(pp.sx, pp.sy + size * 0.2, size * 1.6, size * 0.7);
      this.puckRing.setDepth(this.puckImg.depth - 1);
      if (mine && this.match.mode === 'single') {
        this.puckLabel.setVisible(true).setPosition(pp.sx, pp.sy + size * 0.6 + 16).setText('YOUR PUCK').setDepth(this.puckImg.depth + 1);
      } else if (this.match.mode === 'local') {
        this.puckLabel.setVisible(true).setPosition(pp.sx, pp.sy + size * 0.6 + 16).setText(`${this.name(pk.carrier).toUpperCase()}'S PUCK`).setDepth(this.puckImg.depth + 1);
      }
    }
    // charge meter and aim cue
    this.aimLine.clear();
    let charge = 0;
    for (const p of st.players) {
      if (p.charging && !this.isAI(p.slot)) charge = Math.max(charge, p.charge);
      if (p.charging && pk.carrier === p.slot) {
        const inp = this.isAI(p.slot) ? NO_INPUT : (this.controls ? { ax: this.controls[p.slot].axis.x, az: -this.controls[p.slot].axis.y } : NO_INPUT);
        let dx = p.fx + inp.ax * 0.45, dz = p.fz + inp.az * 0.45;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        this.aimLine.lineStyle(4, this.isAI(p.slot) ? 0xef5350 : 0x4ff0ff, 0.85);
        const range = 3 + p.charge * 14;
        let on = true;
        for (let s = 0; s < range; s += 0.5) {
          const a = pr.project(pk.x + dx * s, 0.05, pk.z + dz * s);
          const b = pr.project(pk.x + dx * (s + 0.5), 0.05, pk.z + dz * (s + 0.5));
          if (on && a.visible && b.visible) this.aimLine.lineBetween(a.sx, a.sy, b.sx, b.sy);
          on = !on;
        }
      }
    }
    if (this.match.mode === 'single') {
      this.powerMeter.set(charge);
    } else {
      const c0 = st.players[0].charging ? st.players[0].charge : 0;
      const c1 = st.players[1].charging ? st.players[1].charge : 0;
      this.powerMeter.set(Math.max(c0, c1));
    }
    // minimap
    const m = this.minimap;
    m.clear();
    for (const p of st.players) {
      const q = this.mini(p.x, p.z);
      m.fillStyle(p.slot === 0 ? 0xf5c518 : 0xef5350, 1);
      m.fillCircle(q.x, q.y, 6);
      m.lineStyle(1.5, 0x000000, 0.6);
      m.strokeCircle(q.x, q.y, 6);
    }
    const q = this.mini(pk.x, pk.z);
    m.fillStyle(0x111111, 1);
    m.fillCircle(q.x, q.y, 4);
    m.lineStyle(1.5, 0xffffff, 0.9);
    m.strokeCircle(q.x, q.y, 4);
    void dt;
  }
}
