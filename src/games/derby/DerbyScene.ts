import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { GAME_H, GAME_W, THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, impact, confetti, shake } from '../../core/ui';
import { CharacterSprite, FRAME, handPositions, type PoseName } from '../../art/characters';
import { createCanvas, paintCypress, paintHaze, paintLawnHD, paintPineHD, paintSkyHD, paintTreeHD, paintVignette, rng } from '../../art/environment';
import { DEFAULT_BATTING, aiSwing, computeContact, simulateFlight, type BattingConfig, type Flight, type Contact } from './batting';
import { DEFAULT_DERBY_RULES, acknowledgeSwitch, applyOutcome, createDerby, type DerbyState } from './rules';

/** Visual tuning for the derby scene. */
export const DERBY_VISUAL = {
  /** Camera distance behind the plate (m), height (m). */
  camZ: 5.2,
  camH: 2.1,
  /** Pitcher position (m): on the lawn just left of the driveway, inside the fair wedge. */
  pitcherX: 0.3,
  pitcherZ: 14,
  /** Displayed ball diameter in metres (exaggerated for readability). */
  ballDiameter: 0.17,
  /** Aim reticle travel in px (landscape) at full offset. */
  aimRange: 150,
  /** Keyboard aim speed px/s. */
  aimSpeed: 650,
  /** Delay between pitches, ms. */
  pitchGap: 900,
};

type Phase = 'idle' | 'windup' | 'pitch' | 'flight' | 'result' | 'switch' | 'done';

export class DerbyScene extends BaseGameScene {
  readonly gameId = 'derby' as const;
  constructor() { super('DerbyScene'); }
  private cfg: BattingConfig = { ...DEFAULT_BATTING };
  private state!: DerbyState;
  private proj!: Projector;
  private phase: Phase = 'idle';
  private batter!: CharacterSprite;
  private pitcher!: CharacterSprite;
  private bat!: Phaser.GameObjects.Image;
  private swingArc!: Phaser.GameObjects.Graphics;
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private trail!: Phaser.GameObjects.Graphics;
  private boardTexts: { name: Phaser.GameObjects.Text; num: Phaser.GameObjects.Text; outs: Phaser.GameObjects.Text }[] | null = null;
  private trailPts: { x: number; y: number; r: number }[] = [];
  private reticle!: Phaser.GameObjects.Container;
  private aim = { x: 0, y: 0 }; // px offsets
  private aimCenter = { x: 0, y: 0 };
  private aimRange = DERBY_VISUAL.aimRange;
  private timingMeter!: Meter;
  private timingLabel!: Phaser.GameObjects.Text;
  private feedback!: Phaser.GameObjects.Text;
  private preview!: Phaser.GameObjects.Graphics;
  private pitchT = 0; // seconds since release
  private swung = false;
  private swingPressed = false;
  private flight: Flight | null = null;
  private flightT = 0;
  private aiTarget: { x: number; y: number; offsetMs: number } | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private dragLast: { x: number; y: number } | null = null;
  private plateScreen = { x: 0, y: 0 };
  private contactWorld = { x: 0, y: 0.95, z: 0.4 };
  private swingBtn?: Phaser.GameObjects.Container;
  private fieldTop = 0;
  private fieldBottom = 0;

  create(): void {
    this.setupShell({ music: 'outdoor' });
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 40;
    this.fieldBottom = P ? H - 330 : H - 170;
    const horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * 0.28;
    const focal = P ? 1250 : 1150;
    this.proj = new Projector({ camZ: DERBY_VISUAL.camZ, camH: DERBY_VISUAL.camH, horizonY: horizon, focal, cx: W / 2 });
    this.aimRange = P ? 120 : DERBY_VISUAL.aimRange;
    this.paintBackground();
    this.state = createDerby(DEFAULT_DERBY_RULES, 0);

    // Characters
    const pp = this.proj.project(DERBY_VISUAL.pitcherX, 0, DERBY_VISUAL.pitcherZ);
    this.pitcher = new CharacterSprite(this, pp.sx, pp.sy, this.players[1].character, pp.scale * 2.0 / 220 * 1.15);
    this.pitcher.setDepth(100).idle();
    const plate = this.proj.project(0, 0, 0);
    this.plateScreen = { x: plate.sx, y: plate.sy };
    const bx = plate.sx - (P ? 230 : 300);
    const by = plate.sy + (P ? 60 : 40);
    this.batter = new CharacterSprite(this, bx, by, this.players[0].character, P ? 1.45 : 1.6);
    this.batter.setDepth(500).setPose('back-bat0');
    this.bat = this.add.image(0, 0, 'bat').setOrigin(0.05, 0.5).setDepth(501).setScale(P ? 1.3 : 1.45);
    this.swingArc = this.add.graphics().setDepth(499);
    this.positionBat('bat0');
    // Ball
    this.ballShadow = this.add.image(0, 0, 'shadow').setDepth(90).setVisible(false);
    this.trail = this.add.graphics().setDepth(399);
    this.ball = this.add.image(0, 0, 'baseball').setDepth(400).setVisible(false);
    // Contact point / aim centre
    const c = this.proj.project(this.contactWorld.x, this.contactWorld.y, this.contactWorld.z);
    this.aimCenter = { x: c.sx, y: c.sy };
    this.reticle = this.buildReticle().setDepth(600);
    this.preview = this.add.graphics().setDepth(80);
    this.buildScoreboardText();
    // Controls panel
    this.buildControls();
    this.setTurn(0);
    this.refreshHud();
    this.beginAfterHowTo(() => this.startTurn());
  }

  // ---------- Presentation setup ----------
  /**
   * The backyard as seen from the plate: lawn ahead, the evergreen line wrapping around the left,
   * back and right of the yard (the house is behind the batter and never in view).
   */
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `derby-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const horizon = pr.cam.horizonY;
      const r = rng(77);
      const cfg = this.cfg;
      paintSkyHD(ctx, W, H, horizon + 2, { sunX: W * 0.72, sunY: horizon * 0.28 });
      // beyond the tree line: the big old woods behind the neighbourhood, hazy with distance
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 40; i++) woods.push({ x: -90 + i * 4.6 + r() * 3, z: cfg.boundaryZ + 14 + r() * 40, s: 7 + r() * 6, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = pr.project(t.x, 0, t.z);
        const haze = Math.min(0.8, 0.3 + (t.z - cfg.boundaryZ) / 70);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.3 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      paintHaze(ctx, W, horizon, 110);
      // the lawn: everything inside the tree line, plus a margin
      paintLawnHD(ctx, pr, { x0: -cfg.yardLeft - 6, x1: cfg.yardRight + 6, z0: -6, z1: cfg.boundaryZ + 6 }, { seed: 4, base: '#5a9a3a', stripeWidth: 3.4 });
      // fair wedge tint, foul lines, home run line along the hedge
      const cen = cfg.fairCenterDeg, half = cfg.fairAngleDeg;
      const ray = (deg: number, dist: number) => pr.project(Math.sin((deg * Math.PI) / 180) * dist, 0, Math.cos((deg * Math.PI) / 180) * dist);
      const home = pr.project(0, 0, 0);
      const flDist = Math.min(cfg.boundaryZ / Math.cos(((cen - half) * Math.PI) / 180), cfg.yardLeft / Math.max(0.05, Math.sin(((half - cen) * Math.PI) / 180)));
      const frDist = Math.min(cfg.boundaryZ / Math.cos(((cen + half) * Math.PI) / 180), cfg.yardRight / Math.max(0.05, Math.sin(((half + cen) * Math.PI) / 180)));
      const fl = ray(cen - half, flDist), fr = ray(cen + half, frDist);
      ctx.fillStyle = 'rgba(255,255,160,0.07)';
      ctx.beginPath(); ctx.moveTo(home.sx, home.sy); ctx.lineTo(fl.sx, fl.sy); ctx.lineTo(fr.sx, fr.sy); ctx.closePath(); ctx.fill();
      const chalk = (a: { sx: number; sy: number }, b: { sx: number; sy: number }, w: number) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      };
      chalk(home, fl, 3.5); chalk(home, fr, 3.5);
      ctx.setLineDash([16, 12]);
      ctx.strokeStyle = 'rgba(255,215,0,0.9)'; ctx.lineWidth = 4;
      const bl = pr.project(-cfg.yardLeft, 0, cfg.boundaryZ - 1.2), br = pr.project(cfg.yardRight, 0, cfg.boundaryZ - 1.2);
      ctx.beginPath(); ctx.moveTo(bl.sx, bl.sy); ctx.lineTo(br.sx, br.sy); ctx.stroke();
      const ll0 = pr.project(-cfg.yardLeft + 1.2, 0, 2), ll1 = pr.project(-cfg.yardLeft + 1.2, 0, cfg.boundaryZ - 1.2);
      const rl0 = pr.project(cfg.yardRight - 1.2, 0, 2), rl1 = pr.project(cfg.yardRight - 1.2, 0, cfg.boundaryZ - 1.2);
      ctx.beginPath(); ctx.moveTo(ll0.sx, ll0.sy); ctx.lineTo(ll1.sx, ll1.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rl0.sx, rl0.sy); ctx.lineTo(rl1.sx, rl1.sy); ctx.stroke();
      ctx.setLineDash([]);
      // the evergreen line wrapping around three sides, with childhood-sized trees and small gaps
      const trees: { x: number; z: number; h: number; seed: number }[] = [];
      const spacing = 2.1;
      for (let x = -cfg.yardLeft; x <= cfg.yardRight; x += spacing) trees.push({ x: x + (r() - 0.5) * 0.5, z: cfg.boundaryZ + 0.6 + r() * 0.8, h: cfg.treeHeight * (0.9 + r() * 0.35), seed: 300 + Math.round(x * 3) });
      for (let z = 1.5; z < cfg.boundaryZ; z += spacing) {
        trees.push({ x: -cfg.yardLeft - 0.4 + (r() - 0.5) * 0.5, z: z + (r() - 0.5) * 0.4, h: cfg.treeHeight * (0.9 + r() * 0.35), seed: 400 + Math.round(z * 3) });
        trees.push({ x: cfg.yardRight + 0.4 + (r() - 0.5) * 0.5, z: z + (r() - 0.5) * 0.4, h: cfg.treeHeight * (0.9 + r() * 0.35), seed: 500 + Math.round(z * 3) });
      }
      // a second, slightly taller row behind the first makes the line read as a solid wall of green
      const backRow = trees.map((t) => ({ x: t.x + (t.x < -cfg.yardLeft + 1 ? -1.8 : t.x > cfg.yardRight - 1 ? 1.8 : (r() - 0.5) * 1.2), z: t.z + (Math.abs(t.z - cfg.boundaryZ) < 3 ? 2 : (r() - 0.5) * 0.8), h: t.h * 1.3, seed: t.seed + 1000 }));
      [...backRow, ...trees].sort((a, b) => b.z - a.z).forEach((t) => {
        const p = pr.project(t.x, 0, t.z);
        if (!p.visible) return;
        const haze = Math.max(0, Math.min(0.45, (t.z - 20) / 90));
        if (t.seed % 7 === 0) paintPineHD(ctx, p.sx, p.sy, t.h * p.scale * 1.1, t.seed, { haze });
        else paintCypress(ctx, p.sx, p.sy, t.h * p.scale, t.seed, { haze });
      });
      // home plate (a real rubber plate) and a worn dirt patch
      const ps = home.scale;
      const dirt = ctx.createRadialGradient(home.sx, home.sy, 0, home.sx, home.sy, 2.2 * ps);
      dirt.addColorStop(0, 'rgba(140,110,70,0.45)'); dirt.addColorStop(1, 'rgba(140,110,70,0)');
      ctx.fillStyle = dirt;
      ctx.beginPath(); ctx.ellipse(home.sx, home.sy, 2.2 * ps, 0.8 * ps, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f1e8';
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
      const pw = 0.43 * ps, ph = 0.16 * ps;
      ctx.beginPath();
      ctx.moveTo(home.sx - pw, home.sy - ph * 0.6); ctx.lineTo(home.sx + pw, home.sy - ph * 0.6); ctx.lineTo(home.sx + pw, home.sy + ph * 0.2); ctx.lineTo(home.sx, home.sy + ph); ctx.lineTo(home.sx - pw, home.sy + ph * 0.2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // bucket of baseballs beside the plate
      const bk = pr.project(1.9, 0, 0.6);
      const bs = bk.scale;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(bk.sx + 0.1 * bs, bk.sy + 2, 0.36 * bs, 0.12 * bs, 0, 0, Math.PI * 2); ctx.fill();
      const bg = ctx.createLinearGradient(bk.sx - 0.3 * bs, 0, bk.sx + 0.3 * bs, 0);
      bg.addColorStop(0, '#f4f4f4'); bg.addColorStop(0.5, '#d8d8d8'); bg.addColorStop(1, '#9a9a9a');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(bk.sx - 0.27 * bs, bk.sy - 0.45 * bs); ctx.lineTo(bk.sx + 0.27 * bs, bk.sy - 0.45 * bs); ctx.lineTo(bk.sx + 0.23 * bs, bk.sy); ctx.lineTo(bk.sx - 0.23 * bs, bk.sy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
      for (let i = 0; i < 6; i++) { ctx.fillStyle = '#f7f3e8'; ctx.beginPath(); ctx.arc(bk.sx - 0.16 * bs + (i % 3) * 0.16 * bs, bk.sy - 0.46 * bs - Math.floor(i / 3) * 0.08 * bs, 0.065 * bs, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(180,40,40,0.6)'; ctx.lineWidth = 1; ctx.stroke(); }
      // the well cap: a short steel casing that sticks up out of the lawn; the pitcher throws from just in front of it
      this.paintWellCap(ctx, DERBY_VISUAL.pitcherX + 0.9, DERBY_VISUAL.pitcherZ + 1.0);
      // the homemade scoreboard standing at the right tree line
      this.paintScoreboard(ctx);
      // boundary label over the back hedge
      const lbl = pr.project(0, 3.2, cfg.boundaryZ + 1);
      ctx.fillStyle = 'rgba(13,31,16,0.8)';
      ctx.font = 'bold 22px "Arial Black", Arial';
      ctx.textAlign = 'center';
      const txt = 'HOME RUN — OVER THE TREES';
      const tw = ctx.measureText(txt).width + 30;
      ctx.fillRect(lbl.sx - tw / 2, lbl.sy - 18, tw, 34);
      ctx.fillStyle = '#f5c518';
      ctx.fillText(txt, lbl.sx, lbl.sy + 7);
      paintVignette(ctx, W, H, 0.22);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
  }

  /** Steel well casing cap (about 15 cm across, knee high) with a domed lid. */
  private paintWellCap(ctx: CanvasRenderingContext2D, x: number, z: number): void {
    const pr = this.proj;
    const base = pr.project(x, 0, z);
    const top = pr.project(x, 0.55, z);
    const s = base.scale;
    const rw = 0.11 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(base.sx + rw * 0.9, base.sy + 1, rw * 1.8, rw * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(base.sx - rw, 0, base.sx + rw, 0);
    g.addColorStop(0, '#5a5f66'); g.addColorStop(0.35, '#b8bec6'); g.addColorStop(0.6, '#8b9199'); g.addColorStop(1, '#3f4349');
    ctx.fillStyle = g;
    ctx.fillRect(base.sx - rw, top.sy, rw * 2, base.sy - top.sy);
    ctx.fillStyle = '#2f3338';
    ctx.beginPath(); ctx.ellipse(base.sx, base.sy, rw, rw * 0.35, 0, 0, Math.PI); ctx.fill();
    const lid = ctx.createRadialGradient(base.sx - rw * 0.3, top.sy - rw * 0.4, rw * 0.1, base.sx, top.sy - rw * 0.2, rw * 1.4);
    lid.addColorStop(0, '#d7dce2'); lid.addColorStop(0.6, '#8d939b'); lid.addColorStop(1, '#4a4f55');
    ctx.fillStyle = lid;
    ctx.beginPath(); ctx.ellipse(base.sx, top.sy - rw * 0.2, rw * 1.2, rw * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(base.sx + rw * 0.5, top.sy - rw * 0.3, rw * 0.18, rw * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    // worn grass patch where everyone stands to pitch
    ctx.fillStyle = 'rgba(140,110,70,0.35)';
    const pm = pr.project(x, 0, z - 1.1);
    ctx.beginPath(); ctx.ellipse(pm.sx, pm.sy, 0.5 * pm.scale, 0.18 * pm.scale, 0, 0, Math.PI * 2); ctx.fill();
  }

  /** World position of the homemade plywood scoreboard (right tree line). */
  private scoreboardSpec(): { x: number; z: number; w: number; h: number; postH: number } {
    return this.portrait
      ? { x: this.cfg.yardRight - 3.3, z: 34, w: 5.5, h: 2.8, postH: 1.0 }
      : { x: this.cfg.yardRight - 3.3, z: 16, w: 5.5, h: 2.8, postH: 1.0 };
  }

  private paintScoreboard(ctx: CanvasRenderingContext2D): void {
    const pr = this.proj;
    const sb = this.scoreboardSpec();
    const bl = pr.project(sb.x - sb.w / 2, sb.postH, sb.z), br = pr.project(sb.x + sb.w / 2, sb.postH, sb.z);
    const tl = pr.project(sb.x - sb.w / 2, sb.postH + sb.h, sb.z), tr = pr.project(sb.x + sb.w / 2, sb.postH + sb.h, sb.z);
    const s = bl.scale;
    void br;
    for (const px of [sb.x - sb.w / 2 + 0.3, sb.x + sb.w / 2 - 0.3]) {
      const g0 = pr.project(px, 0, sb.z), g1 = pr.project(px, sb.postH + sb.h - 0.3, sb.z);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(g0.sx + 0.2 * s, g0.sy + 1, 0.25 * s, 0.08 * s, 0, 0, Math.PI * 2); ctx.fill();
      const pg = ctx.createLinearGradient(g0.sx - 0.07 * s, 0, g0.sx + 0.07 * s, 0);
      pg.addColorStop(0, '#8a6a46'); pg.addColorStop(0.5, '#b58b5c'); pg.addColorStop(1, '#5c4328');
      ctx.fillStyle = pg;
      ctx.fillRect(g0.sx - 0.07 * s, g1.sy, 0.14 * s, g0.sy - g1.sy);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(tl.sx + 4, tl.sy + 6, tr.sx - tl.sx, bl.sy - tl.sy);
    const wg = ctx.createLinearGradient(0, tl.sy, 0, bl.sy);
    wg.addColorStop(0, '#f1e3b8'); wg.addColorStop(1, '#d9c48f');
    ctx.fillStyle = wg;
    ctx.fillRect(tl.sx, tl.sy, tr.sx - tl.sx, bl.sy - tl.sy);
    ctx.strokeStyle = 'rgba(70,45,20,0.45)'; ctx.lineWidth = 1;
    for (let y = tl.sy + 6; y < bl.sy; y += 9) { ctx.beginPath(); ctx.moveTo(tl.sx + 2, y); ctx.lineTo(tr.sx - 2, y + 1); ctx.stroke(); }
    ctx.strokeStyle = '#1d4426'; ctx.lineWidth = Math.max(2, 0.08 * s);
    ctx.strokeRect(tl.sx + 0.08 * s, tl.sy + 0.08 * s, tr.sx - tl.sx - 0.16 * s, bl.sy - tl.sy - 0.16 * s);
    ctx.fillStyle = '#1d4426';
    ctx.fillRect(tl.sx + 0.08 * s, tl.sy + 0.08 * s, tr.sx - tl.sx - 0.16 * s, 0.42 * s);
    ctx.fillStyle = '#f5c518';
    ctx.font = `bold ${Math.max(9, 0.26 * s)}px "Arial Black", Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ACADEMY HILL DERBY', (tl.sx + tr.sx) / 2, tl.sy + 0.29 * s);
    ctx.strokeStyle = 'rgba(29,68,38,0.6)'; ctx.lineWidth = Math.max(1, 0.04 * s);
    ctx.beginPath(); ctx.moveTo((tl.sx + tr.sx) / 2, tl.sy + 0.55 * s); ctx.lineTo((tl.sx + tr.sx) / 2, bl.sy - 0.1 * s); ctx.stroke();
  }

  /** Dynamic scoreboard numbers, projected onto the board. */
  private buildScoreboardText(): void {
    const pr = this.proj;
    const sb = this.scoreboardSpec();
    const s = pr.project(sb.x, sb.postH, sb.z).scale;
    const mk = (size: number, color: string) => this.add.text(0, 0, '', displayStyle(Math.max(9, size * s), color, { strokeThickness: 0, align: 'center' })).setOrigin(0.5).setDepth(85);
    this.boardTexts = [0, 1].map((slot) => {
      const dx = slot === 0 ? -sb.w / 4 : sb.w / 4;
      const px = pr.project(sb.x + dx, sb.postH + sb.h - 0.75, sb.z);
      const hr = pr.project(sb.x + dx, sb.postH + sb.h - 1.35, sb.z);
      const ol = pr.project(sb.x + dx, sb.postH + 0.3, sb.z);
      return { name: mk(0.24, '#1d4426').setPosition(px.sx, px.sy), num: mk(0.62, '#b3261e').setPosition(hr.sx, hr.sy), outs: mk(0.2, '#1d4426').setPosition(ol.sx, ol.sy) };
    });
  }

  private refreshScoreboard(): void {
    if (!this.boardTexts) return;
    const st = this.state;
    for (const slot of [0, 1] as const) {
      const t = this.boardTexts[slot];
      t.name.setText(this.name(slot).toUpperCase());
      t.num.setText(String(st.scores[slot]));
      t.outs.setText(`OUTS ${Math.min(st.outs[slot], st.outsLimit)}/${st.outsLimit}`);
    }
  }

  private buildReticle(): Phaser.GameObjects.Container {
    const c = this.add.container(this.aimCenter.x, this.aimCenter.y);
    const g = this.add.graphics();
    g.lineStyle(4, 0x4ff0ff, 0.95);
    g.strokeCircle(0, 0, 46);
    g.lineStyle(3, 0x4ff0ff, 0.9);
    g.beginPath(); g.moveTo(-70, 0); g.lineTo(-24, 0); g.moveTo(24, 0); g.lineTo(70, 0); g.moveTo(0, -70); g.lineTo(0, -24); g.moveTo(0, 24); g.lineTo(0, 70); g.strokePath();
    g.fillStyle(0x4ff0ff, 0.9);
    g.fillCircle(0, 0, 5);
    const t = this.add.text(0, 82, 'AIM', displayStyle(20, '#4ff0ff', { strokeThickness: 3 })).setOrigin(0.5);
    c.add([g, t]);
    // aim range ring (faint)
    const ring = this.add.graphics();
    ring.lineStyle(2, 0xffffff, 0.18);
    ring.strokeRoundedRect(this.aimCenter.x - this.aimRange - 10, this.aimCenter.y - this.aimRange - 10, this.aimRange * 2 + 20, this.aimRange * 2 + 20, 24);
    ring.setDepth(79);
    return c;
  }

  private buildControls(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      const map: Record<string, number[]> = {
        left: [K.A, K.LEFT], right: [K.D, K.RIGHT], up: [K.W, K.UP], down: [K.S, K.DOWN],
        swing: [K.SPACE, K.F, K.ENTER, K.COMMA],
      };
      for (const [name, codes] of Object.entries(map)) {
        codes.forEach((code, i) => { this.keys[`${name}${i}`] = kb.addKey(code, false, false); });
      }
      kb.on('keydown', (e: KeyboardEvent) => {
        if ([' ', 'f', 'F', 'Enter', ','].includes(e.key)) this.swingPressed = true;
      });
    }
    // Timing meter + labels (bottom centre)
    const mw = P ? W - 80 : 620;
    const mx = W / 2 - mw / 2;
    const my = P ? H - 200 : H - 110;
    const panel = this.add.graphics().setDepth(900);
    panel.fillStyle(0x0d1f10, 0.8);
    panel.fillRoundedRect(mx - 20, my - 50, mw + 40, 120, 16);
    panel.lineStyle(3, THEME.accent, 0.8);
    panel.strokeRoundedRect(mx - 20, my - 50, mw + 40, 120, 16);
    this.add.text(W / 2, my - 36, 'SWING TIMING', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    const perfectHalf = this.cfg.perfectMs / 1000 / this.cfg.pitchSeconds;
    const goodHalf = this.cfg.goodMs / 1000 / this.cfg.pitchSeconds;
    const contactHalf = this.cfg.maxContactMs / 1000 / this.cfg.pitchSeconds;
    this.timingMeter = new Meter(this, mx, my - 4, mw, 26, {
      depth: 901, bg: 0x2a2a2a, fg: 0x000000,
      bands: [
        { from: 0.7 - contactHalf, to: 0.7 + contactHalf, color: 0x4b6b2a },
        { from: 0.7 - goodHalf, to: 0.7 + goodHalf, color: 0x8bc34a },
        { from: 0.7 - perfectHalf, to: 0.7 + perfectHalf, color: 0xf5c518 },
      ],
    });
    this.timingMeter.set(0, 0);
    this.add.text(mx + 40, my + 34, 'EARLY', displayStyle(18, '#8bc34a', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    this.add.text(mx + mw * 0.7, my + 34, 'PERFECT', displayStyle(18, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    this.add.text(mx + mw - 40, my + 34, 'LATE', displayStyle(18, '#8bc34a', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    this.timingLabel = this.add.text(W / 2, my - 4 + 14, '', displayStyle(26, '#ffffff')).setOrigin(0.5).setDepth(902);
    this.feedback = this.add.text(W / 2, this.fieldTop + (P ? 90 : 60), '', displayStyle(P ? 34 : 40, '#ffffff', { align: 'center' })).setOrigin(0.5).setDepth(905);
    // Aim hint (bottom-left)
    const hint = this.add.graphics().setDepth(900);
    const hw = P ? 300 : 330;
    const hx = 30, hy = P ? H - 150 : H - 150;
    hint.fillStyle(0x0d1f10, 0.8);
    hint.fillRoundedRect(hx, hy, hw, 120, 16);
    hint.lineStyle(3, THEME.accent, 0.8);
    hint.strokeRoundedRect(hx, hy, hw, 120, 16);
    this.add.text(hx + hw / 2, hy + 14, 'MOVE AIM', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.add.text(hx + hw / 2, hy + 48, this.useTouch ? 'Drag on the field' : 'WASD / Arrow keys', textStyle(22, '#ffffff')).setOrigin(0.5, 0).setDepth(901);
    this.add.text(hx + hw / 2, hy + 80, 'Aim low = loft. Aim high = line drive.', textStyle(17, THEME.textDim)).setOrigin(0.5, 0).setDepth(901);
    // Swing button (always shown; keyboard also works)
    const bw = P ? 300 : 300;
    this.swingBtn = makeButton(this, W - 30 - bw / 2, P ? H - 90 : H - 90, 'SWING', () => { this.swingPressed = true; }, { width: bw, height: 110, fontSize: 44, depth: 900 });
    this.swingBtn.list.forEach((o) => { if (o instanceof Phaser.GameObjects.Zone) { o.off('pointerup'); o.on('pointerdown', () => { this.swingPressed = true; Audio.unlock(); }); } });
    this.add.text(W - 30 - bw / 2, P ? H - 24 : H - 24, this.useTouch ? 'tap' : 'SPACE / F  •  P2: ENTER / ,', textStyle(18, '#fff3c4')).setOrigin(0.5).setDepth(901);
    // Drag to aim anywhere on the field
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y > this.fieldTop && p.y < this.fieldBottom + 60 && !(this.swingBtn && this.swingBtn.getBounds().contains(p.x, p.y))) this.dragLast = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragLast || !p.isDown) return;
      if (!this.isHumanBatting()) return;
      this.aim.x += (p.x - this.dragLast.x) * 1.4;
      this.aim.y += (p.y - this.dragLast.y) * 1.4;
      this.dragLast = { x: p.x, y: p.y };
      this.clampAim();
    });
    const endDrag = () => { this.dragLast = null; };
    this.input.on('pointerup', endDrag);
    this.input.on('pointerupoutside', endDrag);
  }

  private clampAim(): void {
    const r = this.aimRange;
    this.aim.x = Phaser.Math.Clamp(this.aim.x, -r, r);
    this.aim.y = Phaser.Math.Clamp(this.aim.y, -r, r);
  }

  private isHumanBatting(): boolean { return !this.isAI(this.state.batter); }

  /** Put the bat in the batter's hands for a batting pose; the knob sits between the hands. */
  private positionBat(frame: 'bat0' | 'bat1' | 'bat2' | 'bat3'): void {
    const b = this.batter;
    const s = b.sprite.scale;
    const hp = handPositions(('back-' + frame) as PoseName, b.facingDir);
    const hx = (hp.left.x + hp.right.x) / 2;
    const hy = (hp.left.y + hp.right.y) / 2;
    // frame-local -> container-local (sprite is centred at (0, -FRAME/2*s + 14*s))
    const lx = (hx - FRAME / 2) * s;
    const ly = (hy - FRAME / 2) * s - FRAME * 0.5 * s + 14 * s;
    const angle = { bat0: -112, bat1: -118, bat2: -6, bat3: -150 }[frame];
    this.bat.setPosition(b.x + lx, b.y + ly);
    this.bat.setAngle(angle);
    this.bat.setDepth(frame === 'bat3' ? 499 : 501);
  }

  /** Quick motion-blur arc for the swing. */
  private showSwingArc(): void {
    const b = this.batter;
    const s = b.sprite.scale;
    const hp = handPositions('back-bat2', b.facingDir);
    const cx = b.x + ((hp.left.x + hp.right.x) / 2 - FRAME / 2) * s;
    const cy = b.y + ((hp.left.y + hp.right.y) / 2 - FRAME / 2) * s - FRAME * 0.5 * s + 14 * s;
    const r = 150 * s;
    this.swingArc.clear();
    this.swingArc.setAlpha(1);
    for (let i = 0; i < 5; i++) {
      this.swingArc.fillStyle(0xffffff, 0.16 - i * 0.025);
      this.swingArc.slice(cx, cy, r * (1 - i * 0.06), Phaser.Math.DegToRad(-150 + i * 10), Phaser.Math.DegToRad(10), false);
      this.swingArc.fillPath();
    }
    this.tweens.add({ targets: this.swingArc, alpha: 0, duration: 220, onComplete: () => this.swingArc.clear() });
  }

  // ---------- Turn flow ----------
  private startTurn(): void {
    const b = this.state.batter;
    this.setTurn(b);
    this.swapRoles();
    this.refreshHud();
    this.phase = 'idle';
    this.aim = { x: 0, y: 0 };
    this.feedback.setText(`${this.name(b)} is up!  ${this.state.round > 1 ? `Tiebreak round ${this.state.round - 1}: ` : ''}${this.state.outsLimit} outs`);
    this.time.delayedCall(DERBY_VISUAL.pitchGap, () => this.windup());
  }

  private swapRoles(): void {
    const b = this.state.batter;
    const p = b === 0 ? 1 : 0;
    this.batter.destroy();
    this.pitcher.destroy();
    const W = this.W, P = this.portrait;
    const pp = this.proj.project(DERBY_VISUAL.pitcherX, 0, DERBY_VISUAL.pitcherZ);
    this.pitcher = new CharacterSprite(this, pp.sx, pp.sy, this.players[p].character, pp.scale * 2.0 / 220 * 1.15);
    this.pitcher.setDepth(100).idle();
    const bx = this.plateScreen.x - (P ? 230 : 300);
    const by = this.plateScreen.y + (P ? 60 : 40);
    this.batter = new CharacterSprite(this, bx, by, this.players[b].character, P ? 1.45 : 1.6);
    this.batter.setDepth(500).setPose('back-bat0');
    this.positionBat('bat0');
  }

  private windup(): void {
    if (this.finished) return;
    this.phase = 'windup';
    this.swung = false;
    this.swingPressed = false;
    this.pitcher.setAnim(['throw0', 'throw0'], 2, true);
    if (this.isAI(this.state.batter)) {
      const sw = aiSwing(this.ai);
      this.aiTarget = { x: sw.aimX * this.aimRange, y: sw.aimY * this.aimRange, offsetMs: sw.offsetMs };
    } else {
      this.aiTarget = null;
    }
    this.timingLabel.setText('');
    this.time.delayedCall(500, () => this.releasePitch());
  }

  private releasePitch(): void {
    if (this.finished) return;
    this.phase = 'pitch';
    this.pitchT = 0;
    this.pitcher.setAnim(['throw1', 'throw1'], 2, true);
    this.ball.setVisible(true);
    this.ballShadow.setVisible(true);
    this.batter.setPose('back-bat1');
    this.positionBat('bat1');
    Audio.sfx('throw');
  }

  private resolveSwing(offsetMs: number): void {
    const ax = this.aim.x / this.aimRange;
    const ay = this.aim.y / this.aimRange;
    const contact: Contact = computeContact(offsetMs, ax, ay, this.cfg);
    this.swung = true;
    this.phase = 'flight';
    // bat animation
    this.batter.setPose('back-bat2');
    this.positionBat('bat2');
    this.showSwingArc();
    Audio.sfx('swing');
    this.time.delayedCall(110, () => { this.batter.setPose('back-bat3'); this.positionBat('bat3'); });
    const label = contact.timing === 'miss' ? 'MISS' : contact.timing.toUpperCase();
    const col = contact.timing === 'perfect' ? '#f5c518' : contact.timing === 'miss' ? '#ef5350' : '#8bc34a';
    this.timingLabel.setText(label).setColor(col);
    if (contact.miss) {
      this.flight = null;
      this.feedback.setText('Swing and a miss!').setColor('#ef5350');
      // let the pitch continue past the batter then record the out
      this.time.delayedCall(500, () => this.finishPitch('out', 'miss'));
      return;
    }
    Audio.sfx(contact.quality > 0.8 ? 'homerun' : 'hit');
    impact(this, this.aimCenter.x, this.aimCenter.y, 0xffffff, 12, 650, 8);
    if (contact.quality > 0.85) shake(this, 0.004, 120);
    this.flight = simulateFlight(contact, this.cfg);
    this.flightT = 0;
    const q = Math.round(contact.quality * 100);
    this.feedback.setText(`${label} — ${contact.fair ? 'contact ' + q + '%' : 'FOUL'}`).setColor(col);
  }

  private finishPitch(outcome: 'homerun' | 'out' | 'take', reason: string): void {
    if (this.finished) return;
    this.phase = 'result';
    this.ball.setVisible(false);
    this.ballShadow.setVisible(false);
    this.flight = null;
    this.pitcher.idle();
    const b = this.state.batter;
    const prev = this.state;
    this.state = applyOutcome(this.state, outcome, DEFAULT_DERBY_RULES);
    if (outcome === 'homerun') {
      this.announce('HOME RUN!', { color: '#f5c518', size: this.portrait ? 80 : 96, y: this.fieldTop + 200 });
      confetti(this, this.W / 2, this.fieldTop + 200, 50);
      Audio.sfx('cheer');
      this.react(b, 'cheer', this.batter.x, this.batter.y - 330 * this.batter.sprite.scale);
    } else if (outcome === 'out') {
      const msg: Record<string, string> = { miss: 'STRIKE — OUT', foul: 'FOUL BALL — OUT', short: 'SHORT — OUT', trees: 'INTO THE TREES — OUT', popup: 'POP UP — OUT', grounder: 'GROUNDER — OUT' };
      this.announce(msg[reason] ?? 'OUT', { color: '#ef5350', size: this.portrait ? 60 : 72, y: this.fieldTop + 200 });
      Audio.sfx('out');
      if (Math.random() < 0.4) this.react(b, 'groan', this.batter.x, this.batter.y - 330 * this.batter.sprite.scale);
    } else {
      this.feedback.setText('Took the pitch. No out.').setColor('#ffffff');
    }
    this.refreshHud();
    this.time.delayedCall(1100, () => {
      this.batter.setPose('back-bat0');
      this.positionBat('bat0');
      if (this.state.phase === 'done') return this.endMatch();
      if (this.state.phase === 'switch') {
        const nr = this.state.newRound;
        this.state = acknowledgeSwitch(this.state);
        if (nr) {
          this.announce('TIE! TIEBREAK ROUND', { color: '#4ff0ff', size: this.portrait ? 56 : 70, y: this.fieldTop + 200, sub: `${DEFAULT_DERBY_RULES.tiebreakOuts} outs each` });
          this.time.delayedCall(1600, () => this.startTurn());
        } else {
          this.announce(`${this.name(this.state.batter).toUpperCase()}'S TURN`, { size: this.portrait ? 56 : 70, y: this.fieldTop + 200 });
          this.time.delayedCall(1200, () => this.startTurn());
        }
        return;
      }
      void prev;
      this.windup();
    });
  }

  private endMatch(): void {
    this.phase = 'done';
    const w = this.state.winner!;
    const s = this.state.scores;
    this.finishMatch({
      winnerSlot: w,
      summary: `${s[w]} - ${s[w === 0 ? 1 : 0]} home runs${this.state.round > 1 ? ` (after ${this.state.round - 1} tiebreak round${this.state.round > 2 ? 's' : ''})` : ''}`,
      scores: [`${s[0]} HR`, `${s[1]} HR`],
    });
  }

  private refreshHud(): void {
    this.refreshScoreboard();
    const s = this.state;
    for (const slot of [0, 1] as const) {
      this.setScore(slot, `${s.scores[slot]} HR  •  ${Math.min(s.outs[slot], s.outsLimit)}/${s.outsLimit} outs`);
    }
    this.setSub(`${this.name(s.batter)} batting  •  ${s.round > 1 ? `Tiebreak ${s.round - 1}  •  ` : ''}outs ${s.outs[s.batter]} / ${s.outsLimit}`);
  }

  // ---------- Per-frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished) return;
    const dt = Math.min(0.05, dtMs / 1000);
    // Aim input
    if (this.isHumanBatting()) {
      let dx = 0, dy = 0;
      const kd = (n: string) => (this.keys[`${n}0`]?.isDown || this.keys[`${n}1`]?.isDown) ?? false;
      if (kd('left')) dx -= 1;
      if (kd('right')) dx += 1;
      if (kd('up')) dy -= 1;
      if (kd('down')) dy += 1;
      if (dx || dy) {
        this.aim.x += dx * DERBY_VISUAL.aimSpeed * dt;
        this.aim.y += dy * DERBY_VISUAL.aimSpeed * dt;
        this.clampAim();
      }
    } else if (this.aiTarget && (this.phase === 'windup' || this.phase === 'pitch')) {
      this.aim.x += (this.aiTarget.x - this.aim.x) * Math.min(1, dt * 6);
      this.aim.y += (this.aiTarget.y - this.aim.y) * Math.min(1, dt * 6);
    }
    this.reticle.setPosition(this.aimCenter.x + this.aim.x, this.aimCenter.y + this.aim.y);
    this.drawPreview();

    if (this.phase === 'pitch') {
      this.pitchT += dt;
      const progress = this.pitchT / this.cfg.pitchSeconds; // 1 at the plate
      // ball position: from release to contact point with a gentle arc
      const rel = { x: DERBY_VISUAL.pitcherX + 0.4, y: 1.55, z: DERBY_VISUAL.pitcherZ - 0.4 };
      const tgt = this.contactWorld;
      const p = Math.min(progress, 1.35);
      const wx = rel.x + (tgt.x - rel.x) * p;
      const wz = rel.z + (tgt.z - rel.z) * p;
      const wy = rel.y + (tgt.y - rel.y) * p + Math.sin(Math.min(p, 1) * Math.PI) * 0.25;
      this.placeBall(wx, wy, wz);
      const barPos = 0.7 + (progress - 1) * 1.0;
      this.timingMeter.set(0, Phaser.Math.Clamp(barPos, 0, 1));
      const offsetMs = (progress - 1) * this.cfg.pitchSeconds * 1000;
      if (!this.swung) {
        let swingNow = false;
        if (this.isHumanBatting()) {
          swingNow = this.swingPressed;
        } else if (this.aiTarget) {
          swingNow = offsetMs >= this.aiTarget.offsetMs;
        }
        this.swingPressed = false;
        if (swingNow) {
          this.resolveSwing(offsetMs);
          return;
        }
      }
      if (progress > 1.35) {
        // pitch went by untouched
        this.finishPitch('take', 'take');
      }
      return;
    }
    this.swingPressed = false;
    if (this.phase === 'flight' && this.flight) {
      this.flightT += dt;
      const pts = this.flight.points;
      const idx = Math.min(pts.length - 1, Math.floor(this.flightT * 60));
      const pt = pts[idx];
      this.placeBall(pt.x, pt.y, pt.z);
      if (idx >= pts.length - 1) {
        const f = this.flight;
        const land = this.proj.project(f.landing.x, 0, f.landing.z);
        if (land.visible && land.sx > -50 && land.sx < this.W + 50) impact(this, land.sx, land.sy, 0xd7c9a0, 8, 450, Math.max(3, 6 * land.scale / 40));
        this.finishPitch(f.homeRun ? 'homerun' : 'out', f.reason);
      }
    }
  }

  private placeBall(x: number, y: number, z: number): void {
    const p = this.proj.project(x, y, z);
    const g = this.proj.project(x, 0, z);
    if (!p.visible) { this.ball.setVisible(false); this.ballShadow.setVisible(false); this.trail.clear(); this.trailPts = []; return; }
    const px = Math.max(10, DERBY_VISUAL.ballDiameter * p.scale);
    this.ball.setVisible(true).setPosition(p.sx, p.sy).setScale(px / 40).setDepth(400 + (100 - z)).setAngle(this.ball.angle + 14);
    // motion trail
    if (this.phase === 'flight') {
      this.trailPts.push({ x: p.sx, y: p.sy, r: px / 2 });
      if (this.trailPts.length > 14) this.trailPts.shift();
      this.trail.clear();
      this.trailPts.forEach((t, i) => {
        const a = (i / this.trailPts.length) * 0.35;
        this.trail.fillStyle(0xffffff, a);
        this.trail.fillCircle(t.x, t.y, t.r * (0.4 + (i / this.trailPts.length) * 0.6));
      });
    } else if (this.trailPts.length) { this.trail.clear(); this.trailPts = []; }
    this.ballShadow.setVisible(true).setPosition(g.sx, g.sy).setScale(px / 128 * 1.4, px / 128 * 0.7).setAlpha(Math.max(0.15, 0.6 - y * 0.03));
  }

  private lastPreviewKey = '';
  private drawPreview(): void {
    if (this.phase === 'flight' || this.phase === 'result') { this.preview.clear(); this.lastPreviewKey = ''; return; }
    const key = `${Math.round(this.aim.x)}:${Math.round(this.aim.y)}`;
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;
    const c = computeContact(0, this.aim.x / this.aimRange, this.aim.y / this.aimRange, this.cfg);
    this.preview.clear();
    if (c.miss) return;
    const f = simulateFlight(c, this.cfg, 1 / 20);
    this.preview.lineStyle(3, f.homeRun ? 0x4ff0ff : 0xffffff, 0.5);
    let on = true;
    for (let i = 1; i < f.points.length; i++) {
      const a = this.proj.project(f.points[i - 1].x, f.points[i - 1].y, f.points[i - 1].z);
      const b = this.proj.project(f.points[i].x, f.points[i].y, f.points[i].z);
      if (!a.visible || !b.visible) continue;
      if (on) { this.preview.beginPath(); this.preview.moveTo(a.sx, a.sy); this.preview.lineTo(b.sx, b.sy); this.preview.strokePath(); }
      on = !on;
    }
  }
}
