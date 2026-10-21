import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { QUALITY } from '../../core/quality';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, impact, confetti, shake } from '../../core/ui';
import type { Controls } from '../../core/input';
import { CharacterSprite, FRAME, handPositions, type PoseName } from '../../art/characters';
import { createCanvas, paintAsphalt, paintCypress, paintHaze, paintLawnHD, paintPineHD, paintSkyHD, paintTreeHD, paintVignette, rng } from '../../art/environment';
import {
  DEFAULT_SHOOTOUT, aiShotPlan, attemptsLeft, createShooter, createShootout, goalieHome, openCorner, pokeRate, puckPosition, recordAttempt, resolveShot, stepShooter,
  type AiShotPlan, type Shooter, type ShootoutConfig, type ShootoutState, type ShotOutcome, type ShotResult,
} from './shootout';

/** Visual tuning for the shootout scene. */
export const HOCKEY_VISUAL = {
  /** The camera stands at the top of the driveway looking down at the net. */
  camZ: 2.0,
  camH: 2.5,
  /** Displayed puck diameter in metres (exaggerated for readability). */
  puckDiameter: 0.3,
  playerHeight: 1.75,
  netHeight: 1.2,
  /** The view zooms toward the net as the shooter skates in (landscape / portrait). */
  maxZoom: { landscape: 2.2, portrait: 2.4 },
  /** The backdrop is rasterised at this multiple of the logical size. */
  superSample: QUALITY.backdropSS,
  /** Seconds the result stays on screen before the next attempt. */
  resultHold: 1500,
  introHold: 1100,
};

type Phase = 'intro' | 'skate' | 'shot' | 'result' | 'done';

export class HockeyScene extends BaseGameScene {
  readonly gameId = 'hockey' as const;
  constructor() { super('HockeyScene'); }
  private cfg: ShootoutConfig = { ...DEFAULT_SHOOTOUT };
  private state!: ShootoutState;
  private proj!: Projector;
  private phase: Phase = 'intro';
  private world!: Phaser.GameObjects.Container;
  private zoom = 1;
  private netAnchor = { sx: 0, sy: 0 };
  private shooter: Shooter = createShooter();
  private shooterSprite!: CharacterSprite;
  private goalieSprite!: CharacterSprite;
  private shooterStick!: Phaser.GameObjects.Image;
  private goalieStick!: Phaser.GameObjects.Image;
  private puckImg!: Phaser.GameObjects.Image;
  private puckShadow!: Phaser.GameObjects.Image;
  private overlay!: Phaser.GameObjects.Graphics;
  private netLabel!: Phaser.GameObjects.Text;
  private netG!: Phaser.GameObjects.Graphics;
  private clockMeter!: Meter;
  private clockText!: Phaser.GameObjects.Text;
  private dots: Phaser.GameObjects.Graphics[] = [];
  private ctrlA: Controls | null = null;
  private ctrlB: Controls | null = null;
  private goalieX = 0;
  private goalieLunge: { from: number; to: number } | null = null;
  private goaliePose: 'goalie' | 'push' | 'sad' | 'cheer' = 'goalie';
  private clock = 0;
  private shot: ShotResult | null = null;
  private shotT = 0;
  private shotFrom = { x: 0, y: 0.03, z: 0 };
  private shotAim = { x: 0, y: 0 };
  private after: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; dur: number } | null = null;
  private puckAt = { x: 0, y: 0.03, z: 0 };
  private aiPlan: AiShotPlan | null = null;
  private aiDwell = 0;
  private skateAnimT = 0;
  private lastSkate = 0;
  private fieldTop = 0;
  private fieldBottom = 0;

  create(): void {
    this.setupShell({ music: 'outdoor' });
    // the scene instance is reused on rematch: reset everything that create() does not assign
    this.phase = 'intro'; this.zoom = 1; this.shot = null; this.after = null; this.aiPlan = null; this.dots = []; this.goalieLunge = null; this.goaliePose = 'goalie';
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 40;
    this.fieldBottom = P ? H - 300 : H - 160;
    const horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * (P ? 0.3 : 0.33);
    const focal = P ? 1250 : 1500;
    this.proj = new Projector({ camZ: HOCKEY_VISUAL.camZ, camH: HOCKEY_VISUAL.camH, horizonY: horizon, focal, cx: W / 2 });
    this.state = createShootout(this.cfg.attempts, 0);
    this.world = this.add.container(0, 0).setDepth(1);
    const na = this.proj.project(0, 0.55, this.cfg.netZ);
    this.netAnchor = { sx: na.sx, sy: na.sy };
    this.paintBackground();
    this.overlay = this.add.graphics().setDepth(40);
    this.world.add(this.overlay);
    this.netG = this.add.graphics().setDepth(50);
    this.world.add(this.netG);
    this.drawNet();
    this.netLabel = this.add.text(0, 0, 'TAP THE NET', displayStyle(14, '#4ff0ff', { strokeThickness: 3 })).setOrigin(0.5).setDepth(60).setVisible(false);
    this.world.add(this.netLabel);
    // sprites (recreated per attempt as the roles swap)
    this.goalieSprite = new CharacterSprite(this, 0, 0, this.players[1].character, 1);
    this.world.add(this.goalieSprite);
    this.shooterSprite = new CharacterSprite(this, 0, 0, this.players[0].character, 1);
    this.world.add(this.shooterSprite);
    this.goalieStick = this.add.image(0, 0, 'hockeystick').setOrigin(0.05, 0.17);
    this.shooterStick = this.add.image(0, 0, 'hockeystick').setOrigin(0.05, 0.17);
    this.world.add([this.goalieStick, this.shooterStick]);
    this.puckShadow = this.add.image(0, 0, 'shadow');
    this.puckImg = this.add.image(0, 0, 'puck');
    this.world.add([this.puckShadow, this.puckImg]);
    // HUD
    this.buildPanels();
    this.refreshHud();
    this.setTurn(0);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointer(p));
    this.beginAfterHowTo(() => this.startMatch());
  }

  private startMatch(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const joyArea = P ? { x: 0, y: H * 0.58, w: W * 0.5, h: H * 0.42 } : { x: 0, y: H * 0.5, w: W * 0.4, h: H * 0.5 };
    // one set of touch controls for whoever is shooting (turns alternate); keyboard P1 + P2 both work
    this.ctrlA = this.makeControls(0, { labels: {}, touch: this.useTouch, joyArea });
    this.ctrlB = this.makeControls(1, { labels: {}, touch: false });
    this.beginAttempt();
  }

  // ---------- background ----------
  /**
   * The driveway seen from its top end: house with white siding and blue shutters on the left, the
   * evergreen line on the right and across the far end, the net at the garage end. Painted at
   * superSample x so the zoomed-in view stays sharp.
   */
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const SS = HOCKEY_VISUAL.superSample;
    const key = `hockey-bg-${W}x${H}@${SS}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W * SS, H * SS);
      ctx.scale(SS, SS);
      const pr = this.proj;
      const cfg = this.cfg;
      const horizon = pr.cam.horizonY;
      const r = rng(31);
      const nearZ = -HOCKEY_VISUAL.camZ + 0.25;
      const farZ = cfg.netZ + 3.5;
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
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 60; i++) woods.push({ x: -120 + i * 4.2 + r() * 2.5, z: farZ + 28 + r() * 50, s: 7 + r() * 6, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = P(t.x, 0, t.z);
        const haze = Math.min(0.85, 0.4 + (t.z - farZ) / 90);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.3 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      paintHaze(ctx, W, horizon, 110);
      paintLawnHD(ctx, pr, { x0: -30, x1: 30, z0: nearZ, z1: farZ + 14 }, { seed: 11, base: '#579a38', stripeWidth: 2.6, tuftDensity: 1.6 });
      // ---- driveway: asphalt clipped to the projected trapezoid ----
      const a = P(-hw, 0, nearZ), b = P(hw, 0, nearZ), c = P(hw, 0, farZ), d = P(-hw, 0, farZ);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.clip();
      paintAsphalt(ctx, 0, horizon - 10, W, H - horizon + 10, 13, '#6b6966');
      const dg = ctx.createLinearGradient(0, c.sy, 0, a.sy);
      dg.addColorStop(0, 'rgba(60,70,90,0.35)');
      dg.addColorStop(0.5, 'rgba(0,0,0,0)');
      dg.addColorStop(1, 'rgba(255,230,180,0.08)');
      ctx.fillStyle = dg;
      ctx.fillRect(0, c.sy - 4, W, a.sy - c.sy + 8);
      for (let i = 0; i < 40; i++) {
        const p = P((r() - 0.5) * cfg.rinkW, 0, r() * cfg.netZ);
        const pg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, (0.5 + r() * 0.9) * p.scale);
        const dark = r() > 0.45;
        pg.addColorStop(0, dark ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.08)');
        pg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy, (0.5 + r() * 0.9) * p.scale, (0.12 + r() * 0.2) * p.scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineCap = 'round';
      for (let i = 0; i < 18; i++) {
        let wx = (r() - 0.5) * cfg.rinkW, wz = r() * cfg.netZ;
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
      const s0 = P(0.12, 0, nearZ), s1 = P(0.12, 0, farZ);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke();
      // grass creeping into the cracks
      for (let z = 0.5; z < cfg.netZ; z += 1.4 + r() * 2.0) {
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
      ctx.restore();
      // ---- chalk and paint lines ----
      const chalkStrip = (x: number, wdt: number, col: string) => {
        poly([P(x - wdt / 2, 0, nearZ), P(x + wdt / 2, 0, nearZ), P(x + wdt / 2, 0, cfg.netZ + 2), P(x - wdt / 2, 0, cfg.netZ + 2)], col);
      };
      chalkStrip(-cfg.rinkW / 2, 0.09, 'rgba(255,255,255,0.88)');
      chalkStrip(cfg.rinkW / 2, 0.09, 'rgba(255,255,255,0.88)');
      // goal line
      poly([P(-cfg.rinkW / 2, 0, cfg.netZ - 0.05), P(cfg.rinkW / 2, 0, cfg.netZ - 0.05), P(cfg.rinkW / 2, 0, cfg.netZ + 0.05), P(-cfg.rinkW / 2, 0, cfg.netZ + 0.05)], 'rgba(230,50,50,0.9)');
      // crease: chalk semicircle in front of the net
      ctx.strokeStyle = 'rgba(80,140,230,0.8)'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) {
        const ang = Math.PI + (i / 24) * Math.PI;
        const p = P(Math.cos(ang) * 1.9, 0, cfg.netZ + Math.sin(ang) * 1.9);
        if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy);
      }
      ctx.stroke();
      // start line (dashed) where each attempt begins
      const l0 = P(-cfg.rinkW / 2, 0, cfg.startZ), l1 = P(cfg.rinkW / 2, 0, cfg.startZ);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([18, 12]);
      ctx.beginPath(); ctx.moveTo(l0.sx, l0.sy); ctx.lineTo(l1.sx, l1.sy); ctx.stroke();
      ctx.setLineDash([]);
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
      const hx = -cfg.rinkW / 2 - 2.4;
      const hz0 = nearZ + 0.4, hz1 = cfg.netZ + 1.5;
      const wallH = 3.0, ridgeH = 5.8, ridgeX = hx - 5.5, backX = hx - 11;
      const g0 = P(backX, 0, hz1), g1 = P(hx, 0, hz1), g2 = P(hx, wallH, hz1), g3 = P(backX, wallH, hz1);
      const gg = ctx.createLinearGradient(g0.sx, 0, g1.sx, 0);
      gg.addColorStop(0, '#d9d4c8'); gg.addColorStop(1, '#ebe6da');
      poly([g0, g1, g2, g3], gg, 'rgba(40,30,20,0.45)');
      poly([g3, g2, P(ridgeX, ridgeH, hz1)], '#e4dfd3', 'rgba(40,30,20,0.45)');
      const q0 = P(hx, 0, hz0), q1 = P(hx, 0, hz1), q2 = P(hx, wallH, hz1), q3 = P(hx, wallH, hz0);
      const wg = ctx.createLinearGradient(0, q3.sy, 0, q0.sy);
      wg.addColorStop(0, '#fbf8f0'); wg.addColorStop(0.7, '#efeadd'); wg.addColorStop(1, '#d9d2c2');
      poly([q0, q1, q2, q3], wg, 'rgba(40,30,20,0.5)');
      ctx.strokeStyle = 'rgba(0,0,0,0.09)';
      ctx.lineWidth = 1;
      for (let h = 0.22; h < wallH; h += 0.22) {
        const m0 = P(hx, h, hz0), m1 = P(hx, h, hz1);
        ctx.beginPath(); ctx.moveTo(m0.sx, m0.sy); ctx.lineTo(m1.sx, m1.sy); ctx.stroke();
      }
      const r0 = P(hx + 0.35, wallH, hz0 - 0.3), r1 = P(hx + 0.35, wallH, hz1 + 0.3), r2 = P(ridgeX, ridgeH, hz1 + 0.3), r3 = P(ridgeX, ridgeH, hz0 - 0.3);
      const rg = ctx.createLinearGradient(0, r3.sy, 0, r0.sy);
      rg.addColorStop(0, '#8d8d8b'); rg.addColorStop(1, '#55544f');
      poly([r0, r1, r2, r3], rg, 'rgba(30,30,30,0.6)');
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      for (let k = 1; k < 8; k++) {
        const t = k / 8;
        const m0 = P(hx + 0.35 + (ridgeX - hx - 0.35) * t, wallH + (ridgeH - wallH) * t, hz0 - 0.3);
        const m1 = P(hx + 0.35 + (ridgeX - hx - 0.35) * t, wallH + (ridgeH - wallH) * t, hz1 + 0.3);
        ctx.beginPath(); ctx.moveTo(m0.sx, m0.sy); ctx.lineTo(m1.sx, m1.sy); ctx.stroke();
      }
      poly([P(ridgeX - 0.4, ridgeH - 0.2, cfg.netZ * 0.55), P(ridgeX + 0.4, ridgeH - 0.2, cfg.netZ * 0.55), P(ridgeX + 0.4, ridgeH + 0.9, cfg.netZ * 0.55), P(ridgeX - 0.4, ridgeH + 0.9, cfg.netZ * 0.55)], '#8f8f8d', 'rgba(0,0,0,0.4)');
      poly([P(hx + 0.35, wallH - 0.12, hz0 - 0.3), P(hx + 0.35, wallH - 0.12, hz1 + 0.3), P(hx + 0.35, wallH + 0.06, hz1 + 0.3), P(hx + 0.35, wallH + 0.06, hz0 - 0.3)], '#f3f1ea', 'rgba(0,0,0,0.25)', 1);
      poly([q0, q1, P(hx, 0.3, hz1), P(hx, 0.3, hz0)], '#b5b0a4', 'rgba(0,0,0,0.3)', 1);
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
      paintVignette(ctx, W, H, 0.2);
      this.textures.addCanvas(key, canvas);
    }
    const img = this.add.image(W / 2, H / 2, key).setDepth(0).setScale(1 / SS);
    this.world.add(img);
  }

  /** The net: red steel frame with highlights, sagging white mesh, a shadow on the driveway. */
  private drawNet(): void {
    const cfg = this.cfg;
    const pr = this.proj;
    const g = this.netG;
    const hw = cfg.goalW / 2;
    const h = HOCKEY_VISUAL.netHeight;
    const z = cfg.netZ;
    const d = cfg.goalDepth;
    const Pp = (x: number, y: number, zz: number) => pr.project(x, y, zz);
    const fl = Pp(-hw, 0, z), fr = Pp(hw, 0, z), tl = Pp(-hw, h, z), tr = Pp(hw, h, z);
    const bl = Pp(-hw, 0, z + d), br = Pp(hw, 0, z + d), btl = Pp(-hw, h * 0.82, z + d), btr = Pp(hw, h * 0.82, z + d);
    g.fillStyle(0x000000, 0.22);
    g.fillPoints([{ x: fl.sx - 4, y: fl.sy + 2 }, { x: fr.sx + 4, y: fr.sy + 2 }, { x: br.sx + 10, y: br.sy + 1 }, { x: bl.sx - 10, y: bl.sy + 1 }], true);
    g.fillStyle(0xffffff, 0.3);
    g.fillPoints([{ x: bl.sx, y: bl.sy }, { x: br.sx, y: br.sy }, { x: btr.sx, y: btr.sy }, { x: btl.sx, y: btl.sy }], true);
    g.fillStyle(0xffffff, 0.16);
    g.fillPoints([{ x: fl.sx, y: fl.sy }, { x: bl.sx, y: bl.sy }, { x: btl.sx, y: btl.sy }, { x: tl.sx, y: tl.sy }], true);
    g.fillPoints([{ x: fr.sx, y: fr.sy }, { x: br.sx, y: br.sy }, { x: btr.sx, y: btr.sy }, { x: tr.sx, y: tr.sy }], true);
    g.fillPoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: btr.sx, y: btr.sy }, { x: btl.sx, y: btl.sy }], true);
    const n = 12;
    const sag = 0.06 * (btr.sx - btl.sx);
    g.lineStyle(1, 0xffffff, 0.6);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      g.lineBetween(bl.sx + (br.sx - bl.sx) * t, bl.sy + (br.sy - bl.sy) * t, btl.sx + (btr.sx - btl.sx) * t, btl.sy + (btr.sy - btl.sy) * t);
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
      g.lineBetween(fl.sx + (bl.sx - fl.sx) * t, fl.sy + (bl.sy - fl.sy) * t, tl.sx + (btl.sx - tl.sx) * t, tl.sy + (btl.sy - tl.sy) * t);
      g.lineBetween(fr.sx + (br.sx - fr.sx) * t, fr.sy + (br.sy - fr.sy) * t, tr.sx + (btr.sx - tr.sx) * t, tr.sy + (btr.sy - tr.sy) * t);
      g.lineBetween(tl.sx + (tr.sx - tl.sx) * t, tl.sy + (tr.sy - tl.sy) * t, btl.sx + (btr.sx - btl.sx) * t, btl.sy + (btr.sy - btl.sy) * t);
    }
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
  }

  private buildPanels(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const touchP = P && this.useTouch;
    const mw = touchP ? W - 340 - 30 : P ? 520 : 600;
    const mx = touchP ? 340 : W / 2 - mw / 2;
    const my = touchP ? H - 330 : P ? H - 150 : H - 92;
    const panel = this.add.graphics().setDepth(900);
    panel.fillStyle(0x0d1f10, 0.8);
    panel.fillRoundedRect(mx - 20, my - 44, mw + 40, 100, 16);
    panel.lineStyle(3, THEME.accent, 0.8);
    panel.strokeRoundedRect(mx - 20, my - 44, mw + 40, 100, 16);
    this.add.text(mx, my - 32, 'SHOT CLOCK', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0).setDepth(901);
    this.clockText = this.add.text(mx + mw, my - 32, '', textStyle(18, THEME.textDim)).setOrigin(1, 0).setDepth(901);
    this.clockMeter = new Meter(this, mx, my + 4, mw, 26, { depth: 901, bg: 0x2a2a2a, fg: 0x4fc3f7 });
    this.clockMeter.set(1);
    const hint = (x: number, y: number, title: string, lines: string[], w = 300) => {
      const g = this.add.graphics().setDepth(900);
      g.fillStyle(0x0d1f10, 0.8);
      g.fillRoundedRect(x, y, w, 100, 16);
      g.lineStyle(3, THEME.accent, 0.8);
      g.strokeRoundedRect(x, y, w, 100, 16);
      this.add.text(x + w / 2, y + 12, title, displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
      this.add.text(x + w / 2, y + 42, lines.join('\n'), textStyle(18, '#ffffff', { align: 'center', wordWrap: { width: w - 24 } })).setOrigin(0.5, 0).setDepth(901);
    };
    if (this.useTouch) {
      if (P) hint(W - 30 - 340, H - 150, 'SHOOT', ['Tap the net where', 'you want the puck'], 340);
      else hint(W - 30 - 330, H - 136, 'SHOOT', ['Tap the net where you want the puck'], 330);
    } else {
      const y = P ? H - 150 - 44 : H - 136;
      hint(30, y, 'SKATE', ['WASD / Arrows'], P ? 240 : 300);
      hint(W - 30 - (P ? 240 : 300), y, 'SHOOT', ['Click the net where you want it', 'F / SPACE: open corner'], P ? 240 : 300);
    }
    // attempt dots under each player's HUD panel
    for (const slot of [0, 1] as const) {
      const g = this.add.graphics().setDepth(9001);
      this.dots.push(g);
    }
    this.drawDots();
  }

  private drawDots(): void {
    for (const slot of [0, 1] as const) {
      const g = this.dots[slot];
      if (!g) continue;
      g.clear();
      const rect = this.panelRect(slot);
      if (!rect) continue;
      const n = this.state.attempts;
      const results = this.state.results.filter((r) => r.slot === slot);
      const y = rect.bottom + 12;
      const x0 = slot === 0 ? rect.x + 24 : rect.right - 24 - (n - 1) * 26;
      for (let i = 0; i < n; i++) {
        const r = results[i];
        const col = !r ? 0x2a3a2d : r.outcome === 'goal' ? 0x8bc34a : 0xef5350;
        g.fillStyle(col, 1);
        g.fillCircle(x0 + i * 26, y, 8);
        g.lineStyle(2, 0xffffff, r ? 0.9 : 0.35);
        g.strokeCircle(x0 + i * 26, y, 8);
      }
      // sudden-death extras
      for (let i = n; i < results.length; i++) {
        const r = results[i];
        g.fillStyle(r.outcome === 'goal' ? 0x8bc34a : 0xef5350, 1);
        g.fillCircle(x0 + i * 26, y, 8);
        g.lineStyle(2, 0xf5c518, 0.9);
        g.strokeCircle(x0 + i * 26, y, 8);
      }
    }
  }

  private refreshHud(): void {
    const s = this.state;
    for (const slot of [0, 1] as const) this.setScore(slot, `${s.goals[slot]} goal${s.goals[slot] === 1 ? '' : 's'}  •  shot ${Math.min(s.taken[slot], s.attempts)}/${s.attempts}`);
    const sh = s.shooter;
    if (s.phase === 'done') this.setSub('SHOOTOUT OVER');
    else if (s.suddenDeath) this.setSub(`SUDDEN DEATH  •  ${this.name(sh)} shooting`);
    else this.setSub(`${this.name(sh)} shooting  •  attempt ${s.taken[sh] + 1} of ${s.attempts}`);
    this.drawDots();
  }

  // ---------- attempt flow ----------
  private beginAttempt(): void {
    if (this.finished) return;
    const s = this.state;
    const sh = s.shooter, gl: 0 | 1 = sh === 0 ? 1 : 0;
    this.phase = 'intro';
    this.setTurn(sh);
    this.refreshHud();
    // swap the characters into their roles
    const shooterChar = this.players[sh].character, goalieChar = this.players[gl].character;
    if (this.shooterSprite.character.id !== shooterChar.id) { this.shooterSprite.destroy(); this.shooterSprite = new CharacterSprite(this, 0, 0, shooterChar, 1); this.world.add(this.shooterSprite); }
    if (this.goalieSprite.character.id !== goalieChar.id) { this.goalieSprite.destroy(); this.goalieSprite = new CharacterSprite(this, 0, 0, goalieChar, 1); this.world.add(this.goalieSprite); }
    this.shooter = createShooter(this.cfg);
    this.goalieX = 0;
    this.goalieLunge = null;
    this.goaliePose = 'goalie';
    this.shot = null; this.after = null;
    this.clock = this.cfg.shotClock;
    this.aiPlan = this.isAI(sh) ? aiShotPlan(this.ai, this.cfg) : null;
    this.aiDwell = 0;
    const left = attemptsLeft(s, sh);
    const sub = s.suddenDeath ? 'sudden death' : `attempt ${s.attempts - left + 1} of ${s.attempts}`;
    this.announce(`${this.name(sh).toUpperCase()} SHOOTS`, { color: '#4ff0ff', size: this.portrait ? 60 : 72, y: this.fieldTop + 200, sub, hold: HOCKEY_VISUAL.introHold });
    Audio.sfx('whistle');
    this.time.delayedCall(HOCKEY_VISUAL.introHold, () => { if (this.phase === 'intro' && !this.finished) this.phase = 'skate'; });
  }

  /** Goalie level: the match difficulty in single player, an even goalie for pass-and-play. */
  private goalieLevel(): number { return this.match.mode === 'single' ? this.ai : 0.5; }

  private onPointer(p: Phaser.Input.Pointer): void {
    if (this.phase !== 'skate' || this.isAI(this.state.shooter) || this.finished) return;
    if (p.y < this.fieldTop || p.y > this.fieldBottom + 60) return;
    if (this.ctrlA?.inJoyArea(p.x, p.y) && this.useTouch) return;
    const aim = this.screenToGoalPlane(p.x, p.y);
    if (!aim) return;
    Audio.unlock();
    this.shoot(aim);
  }

  /** Screen point -> point on the vertical goal plane (z = netZ), or null if it is nowhere near the net. */
  private screenToGoalPlane(sx: number, sy: number): { x: number; y: number } | null {
    const wx = (sx - this.world.x) / this.zoom, wy = (sy - this.world.y) / this.zoom;
    const cam = this.proj.cam;
    const scale = cam.focal / (this.cfg.netZ + cam.camZ);
    const x = (wx - cam.cx) / scale;
    const y = cam.camH - (wy - cam.horizonY) / scale;
    if (y < -0.35) return null;
    if (Math.abs(x) > this.cfg.goalW / 2 + 0.9 || y > this.cfg.goalH + 0.9) return null;
    return { x, y: Phaser.Math.Clamp(y, 0.03, this.cfg.goalH + 0.6) };
  }

  private shoot(aim: { x: number; y: number }): void {
    if (this.phase !== 'skate') return;
    const from = puckPosition(this.shooter, this.cfg);
    const speed = Math.hypot(this.shooter.vx, this.shooter.vz);
    const res = resolveShot(from, aim, speed, this.goalieX, this.goalieLevel(), this.cfg);
    this.shot = res;
    this.shotAim = aim;
    this.shotFrom = { x: from.x, y: 0.03, z: from.z };
    this.shotT = 0;
    this.phase = 'shot';
    this.goalieLunge = { from: this.goalieX, to: res.goalieX };
    this.shooterSprite.setPose('back-wrist');
    this.time.delayedCall(380, () => { if (this.phase !== 'skate') this.shooterSprite.setPose('back-skate0'); });
    Audio.sfx('slap');
  }

  private arrive(): void {
    const res = this.shot!;
    const cfg = this.cfg;
    const endP = { x: res.x, y: res.y, z: cfg.netZ };
    const sideSign = res.x >= 0 ? 1 : -1;
    switch (res.outcome) {
      case 'goal':
        this.after = { from: endP, to: { x: res.x * 0.8, y: 0.03, z: cfg.netZ + cfg.goalDepth * 0.85 }, dur: 0.22 };
        this.goaliePose = 'sad';
        break;
      case 'save':
        this.after = { from: endP, to: { x: res.x + sideSign * 1.4, y: 0.03, z: cfg.netZ - 3.2 }, dur: 0.55 };
        this.goaliePose = 'push';
        break;
      case 'post':
        this.after = { from: endP, to: { x: sideSign * 3.0, y: 0.03, z: cfg.netZ - 2.6 }, dur: 0.5 };
        break;
      case 'wide':
        this.after = { from: endP, to: { x: res.x * 1.4, y: Math.max(0.03, res.y * 0.3), z: cfg.netZ + 3 }, dur: 0.3 };
        break;
    }
    this.finishAttempt(res.outcome);
  }

  private finishAttempt(outcome: ShotOutcome): void {
    if (this.finished) return;
    this.phase = 'result';
    const sh = this.state.shooter, gl: 0 | 1 = sh === 0 ? 1 : 0;
    const netS = this.toScreen(this.netAnchor.sx, this.netAnchor.sy);
    const y = this.fieldTop + 200;
    switch (outcome) {
      case 'goal': {
        Audio.sfx('goalHorn');
        shake(this, 0.004, 200);
        this.announce('GOAL!', { color: '#f5c518', size: this.portrait ? 84 : 100, y, sub: `${this.name(sh)} scores` });
        confetti(this, netS.x, netS.y - 40, 40);
        const sp = this.toScreen(this.shooterSprite.x, this.shooterSprite.y);
        this.react(sh, 'cheer', sp.x, sp.y - 180 * this.shooterSprite.charScale * this.zoom);
        this.shooterSprite.cheer();
        break;
      }
      case 'save': {
        Audio.sfx('thud');
        impact(this, netS.x, netS.y, 0xffffff, 10, 650, 6);
        this.announce('SAVE!', { color: '#ef5350', size: this.portrait ? 72 : 88, y, sub: `${this.name(gl)} stops it` });
        if (Math.random() < 0.6) { const gp = this.toScreen(this.goalieSprite.x, this.goalieSprite.y); this.react(gl, 'taunt', gp.x, gp.y - 170 * this.goalieSprite.charScale * this.zoom); }
        break;
      }
      case 'post':
        Audio.sfx('bounce');
        this.announce('OFF THE POST!', { color: '#ff9800', size: this.portrait ? 60 : 76, y });
        break;
      case 'wide':
        Audio.sfx('out');
        this.announce('WIDE!', { color: '#ef5350', size: this.portrait ? 72 : 88, y, sub: 'missed the net' });
        break;
      case 'poked':
        Audio.sfx('thud');
        this.announce('POKE CHECK!', { color: '#ef5350', size: this.portrait ? 60 : 76, y, sub: `${this.name(gl)} knocks it away` });
        break;
      case 'clock':
        Audio.sfx('whistle');
        this.announce('SHOT CLOCK!', { color: '#ef5350', size: this.portrait ? 60 : 76, y, sub: 'too slow, attempt lost' });
        break;
    }
    if (outcome !== 'goal' && Math.random() < 0.4) {
      const sp = this.toScreen(this.shooterSprite.x, this.shooterSprite.y);
      this.time.delayedCall(600, () => this.react(sh, 'groan', sp.x, sp.y - 180 * this.shooterSprite.charScale * this.zoom));
    }
    this.state = recordAttempt(this.state, outcome);
    this.refreshHud();
    this.time.delayedCall(HOCKEY_VISUAL.resultHold, () => {
      if (this.finished) return;
      if (this.state.phase === 'done') return this.endMatch();
      this.beginAttempt();
    });
  }

  private endMatch(): void {
    this.phase = 'done';
    const w = this.state.winner!;
    const g = this.state.goals;
    this.finishMatch({
      winnerSlot: w,
      summary: `${g[w]} - ${g[w === 0 ? 1 : 0]} in the shootout${this.state.suddenDeath ? ' (sudden death)' : ''}`,
      scores: [`${g[0]} goals`, `${g[1]} goals`],
    });
  }

  // ---------- per-frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished) return;
    const dt = Math.min(0.04, dtMs / 1000);
    const cfg = this.cfg;
    const sh = this.state.shooter;
    if (this.phase === 'skate') {
      // skating input
      let ax = 0, az = 0, fire = false;
      if (this.isAI(sh)) {
        const plan = this.aiPlan!;
        const dx = plan.targetX - this.shooter.x, dz = plan.targetZ - this.shooter.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.3) { ax = dx / d; az = dz / d; }
        else {
          this.aiDwell += dt;
          if (this.aiDwell >= plan.dwell) fire = true;
        }
        if (fire) this.shoot(openCorner(this.goalieX, cfg, { high: plan.high, inset: plan.inset }));
      } else {
        const a = this.ctrlA, b = this.ctrlB;
        if (a?.moving) { ax = a.axis.x; az = -a.axis.y; } else if (b?.moving) { ax = b.axis.x; az = -b.axis.y; }
        if (a?.justDown('a') || b?.justDown('a')) this.shoot(openCorner(this.goalieX, cfg));
      }
      if (this.phase === 'skate') {
        stepShooter(this.shooter, ax, az, dt, cfg);
        const pk = puckPosition(this.shooter, cfg);
        // goalie tracks the puck
        const home = goalieHome(pk, cfg);
        const gs = 2.6 + this.goalieLevel() * 1.4;
        this.goalieX += Phaser.Math.Clamp(home - this.goalieX, -gs * dt, gs * dt);
        // poke check inside the crease
        if (Math.random() < pokeRate(pk, this.goalieLevel(), cfg) * dt) {
          this.goaliePose = 'push';
          this.after = { from: { x: pk.x, y: 0.03, z: pk.z }, to: { x: pk.x * 2 + (pk.x >= 0 ? 1.5 : -1.5), y: 0.03, z: pk.z - 4 }, dur: 0.6 };
          this.shotT = 0;
          this.finishAttempt('poked');
        } else {
          this.clock -= dt;
          if (this.clock <= 0) { this.clock = 0; this.finishAttempt('clock'); }
        }
      }
    }
    if (this.phase === 'shot' && this.shot) {
      this.shotT += dt;
      const res = this.shot;
      const t = Math.min(1, this.shotT / res.travel);
      this.puckAt = {
        x: this.shotFrom.x + (res.x - this.shotFrom.x) * t,
        y: this.shotFrom.y + (res.y - this.shotFrom.y) * t + Math.sin(t * Math.PI) * 0.08,
        z: this.shotFrom.z + (cfg.netZ - this.shotFrom.z) * t,
      };
      if (this.goalieLunge) {
        const react = Math.max(0.05, cfg.goalie.reactBase - cfg.goalie.reactPerLevel * this.goalieLevel());
        const u = res.travel <= react ? 0 : Math.min(1, Math.max(0, (this.shotT - react) / (res.travel - react)));
        this.goalieX = this.goalieLunge.from + (this.goalieLunge.to - this.goalieLunge.from) * u;
      }
      if (t >= 1) { this.shotT = 0; this.arrive(); }
    } else if (this.phase === 'result' && this.after) {
      this.shotT += dt;
      const a = this.after;
      const t = Math.min(1, this.shotT / a.dur);
      const e = 1 - (1 - t) * (1 - t);
      this.puckAt = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, z: a.from.z + (a.to.z - a.from.z) * e };
    } else if (this.phase !== 'result') {
      const pk = puckPosition(this.shooter, cfg);
      this.puckAt = { x: pk.x, y: 0.03, z: pk.z };
    }
    this.render(dt);
  }

  private toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: this.world.x + wx * this.zoom, y: this.world.y + wy * this.zoom };
  }

  private render(dt: number): void {
    const cfg = this.cfg, pr = this.proj, P = this.portrait;
    // ---- zoom toward the net as the shooter closes in ----
    const maxZoom = P ? HOCKEY_VISUAL.maxZoom.portrait : HOCKEY_VISUAL.maxZoom.landscape;
    const zt = Phaser.Math.Clamp((this.shooter.z - cfg.startZ) / (cfg.netZ - cfg.minDist - cfg.startZ), 0, 1);
    const targetZoom = 1 + (maxZoom - 1) * zt * zt * (3 - 2 * zt);
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 5);
    const f = (this.zoom - 1) / (maxZoom - 1);
    const focusY = this.fieldTop + (this.fieldBottom - this.fieldTop) * (P ? 0.42 : 0.4);
    const anchorY = this.netAnchor.sy + (focusY - this.netAnchor.sy) * f;
    // zoomed in, keep both the net and the shooter in view: anchor between them
    const s = this.shooter;
    const g = pr.project(s.x, 0, s.z);
    const anchorX = this.netAnchor.sx + (g.sx - this.netAnchor.sx) * 0.5 * f;
    this.world.setScale(this.zoom);
    this.world.setPosition(this.W / 2 - anchorX * this.zoom, anchorY - this.netAnchor.sy * this.zoom);

    // ---- shooter ----
    const sp = this.shooterSprite;
    const scale = g.scale * HOCKEY_VISUAL.playerHeight / 220;
    sp.setPosition(g.sx, g.sy).rescale(scale).setDepth(1000 - Math.round(s.z * 20));
    sp.setFacing(s.fx < -0.25 ? -1 : 1);
    const moving = Math.hypot(s.vx, s.vz) > 0.5;
    if (this.phase === 'skate' || this.phase === 'intro') {
      if (moving) {
        this.skateAnimT += dt * 7;
        sp.setPose(Math.floor(this.skateAnimT) % 2 === 0 ? 'back-skate0' : 'back-skate1');
        if (this.time.now - this.lastSkate > 420) { this.lastSkate = this.time.now; Audio.sfx('skate'); }
      } else sp.setPose('back-skate0');
    }
    // see-through when the shooter stands between the camera and the net
    sp.setAlpha(Math.abs(s.x) < 1.3 && s.z > cfg.netZ - 5.5 ? 0.6 : 1);
    // stick: from the hands to the puck (or to the ground ahead during the shot)
    const pk = this.phase === 'skate' || this.phase === 'intro' ? this.puckAt : (() => { const q = puckPosition(s, cfg); return { x: q.x, y: 0.03, z: q.z }; })();
    this.placeStick(this.shooterStick, sp, pr.project(pk.x, 0.02, pk.z), scale, 1.2);
    this.shooterStick.setAlpha(sp.alpha);

    // ---- goalie ----
    const gz = cfg.netZ - cfg.goalie.depth;
    const gp = pr.project(this.goalieX, 0, gz);
    const gsc = gp.scale * HOCKEY_VISUAL.playerHeight / 220 * 1.04;
    const gs = this.goalieSprite;
    gs.setPosition(gp.sx, gp.sy).rescale(gsc).setDepth(1000 - Math.round(gz * 20));
    gs.setFacing(1);
    if (this.goaliePose === 'cheer') gs.cheer();
    else gs.setPose(this.goaliePose as PoseName);
    const gtip = pr.project(this.goalieX + 0.62, 0.02, gz - 0.35);
    this.placeStick(this.goalieStick, gs, gtip, gsc, 1.15);

    // ---- puck ----
    const pp = pr.project(this.puckAt.x, this.puckAt.y, this.puckAt.z);
    const ground = pr.project(this.puckAt.x, 0, this.puckAt.z);
    const size = Math.max(9, HOCKEY_VISUAL.puckDiameter * pp.scale);
    const carried = this.phase === 'skate' || this.phase === 'intro';
    this.puckImg.setPosition(pp.sx, pp.sy).setScale(size / 40).setDepth(carried ? sp.depth + 3 : 1000 - Math.round(this.puckAt.z * 20) + 2).setVisible(pp.visible);
    this.puckShadow.setPosition(ground.sx, ground.sy + size * 0.1).setScale(size / 128 * 1.2, size / 128 * 0.5).setAlpha(Math.max(0.15, 0.6 - this.puckAt.y * 0.4)).setVisible(pp.visible).setDepth(this.puckImg.depth - 1);

    // ---- overlay: net target highlight while a human skates, aim marker during the shot ----
    const ov = this.overlay;
    ov.clear();
    this.netLabel.setVisible(false);
    const human = !this.isAI(this.state.shooter);
    if (this.phase === 'skate' && human) {
      const hw = cfg.goalW / 2, h = cfg.goalH;
      const fl = pr.project(-hw, 0, cfg.netZ), fr = pr.project(hw, 0, cfg.netZ), tl = pr.project(-hw, h, cfg.netZ), tr = pr.project(hw, h, cfg.netZ);
      const pulse = 0.35 + 0.25 * Math.sin(this.time.now / 180);
      ov.fillStyle(0x4ff0ff, 0.08 + pulse * 0.08);
      ov.fillPoints([{ x: fl.sx, y: fl.sy }, { x: fr.sx, y: fr.sy }, { x: tr.sx, y: tr.sy }, { x: tl.sx, y: tl.sy }], true);
      ov.lineStyle(2, 0x4ff0ff, 0.5 + pulse * 0.4);
      ov.strokePoints([{ x: fl.sx, y: fl.sy }, { x: fr.sx, y: fr.sy }, { x: tr.sx, y: tr.sy }, { x: tl.sx, y: tl.sy }], true);
      if (this.useTouch) this.netLabel.setVisible(true).setPosition((tl.sx + tr.sx) / 2, tl.sy - 12).setScale(1 / Math.max(1, this.zoom * 0.7));
    }
    if (this.phase === 'shot' || (this.phase === 'result' && this.shot)) {
      const a = pr.project(this.shotAim.x, this.shotAim.y, cfg.netZ);
      const r = Math.max(4, 0.12 * a.scale);
      ov.lineStyle(2, 0xffffff, 0.7);
      ov.strokeCircle(a.sx, a.sy, r);
      ov.lineBetween(a.sx - r * 1.6, a.sy, a.sx + r * 1.6, a.sy);
      ov.lineBetween(a.sx, a.sy - r * 1.6, a.sx, a.sy + r * 1.6);
    }
    this.world.sort('depth');

    // ---- HUD: shot clock ----
    if (this.phase === 'skate') {
      this.clockMeter.set(this.clock / cfg.shotClock);
      this.clockText.setText(`${this.clock.toFixed(1)} s`);
    } else if (this.phase === 'intro') {
      this.clockMeter.set(1);
      this.clockText.setText(`${cfg.shotClock.toFixed(1)} s`);
    }
  }

  /** Anchor a stick at the sprite's hands (from the pose's hand positions) and point it at a ground point. */
  private placeStick(stick: Phaser.GameObjects.Image, sp: CharacterSprite, tip: { sx: number; sy: number }, scale: number, thick: number): void {
    const frame = sp.sprite.frame.name.replace(/^L-/, '') as PoseName;
    const hp = handPositions(frame, sp.facingDir);
    const hx = (hp.left.x + hp.right.x) / 2, hy = (hp.left.y + hp.right.y) / 2;
    const lx = (hx - FRAME / 2) * scale;
    const ly = (hy - FRAME / 2) * scale - FRAME * 0.5 * scale + 14 * scale;
    const x0 = sp.x + lx, y0 = sp.y + ly;
    const dx = tip.sx - x0, dy = tip.sy - y0;
    const L = Math.hypot(dx, dy);
    stick.setPosition(x0, y0).setRotation(Math.atan2(dy, dx) - 0.3).setDepth(sp.depth + 1);
    stick.setScale(Math.max(0.25, L / 140), Math.max(0.25, scale * thick));
  }
}
