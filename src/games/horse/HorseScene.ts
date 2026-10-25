import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, impact, confetti } from '../../core/ui';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintAsphalt, paintCypress, paintHaze, paintLawnHD, paintPineHD, paintSkyHD, paintTreeHD, paintVignette, rng } from '../../art/environment';
import { DEFAULT_SHOT, FLICK, SPOTS, aiChooseSpot, aiShot, assistShot, flickToShot, gaussian, powerFromOffset, shotNoise, simulateShotPower, type ShotConfig, type ShotResult, type Spot } from './shot';
import { applyShot, chooseSpot, createHorse, lettersDisplay, type HorseState } from './rules';

/** Visual tuning for the HORSE scene. */
export const HORSE_VISUAL = {
  /** Camera distance behind the shooter and height (m). */
  camBack: 5.2,
  camH: 2.3,
  /** Camera lateral offset so the shooter stands right of centre and the hoop stays visible. */
  camSideLandscape: -1.35,
  camSidePortrait: -0.95,
  /** Displayed ball diameter (m), slightly exaggerated for readability. */
  ballDiameter: 0.26,
  /** Driveway half width (m) and the chalk shooting area. */
  driveHalfWidth: 3.3,
  areaNearZ: -1.6,
  areaFarZ: -9.4,
  /** Delays (ms). */
  aiThinkMs: 900,
  aiShootMs: 1000,
  resultHoldMs: 1500,
  /** Keyboard: seconds for a held shoot key to charge from zero to full power. */
  chargeSeconds: 1.1,
  /** How much of the flight the live preview reveals (the rest is up to you). */
  previewFraction: 0.62,
};

type Phase = 'idle' | 'choose' | 'ready' | 'meter' | 'flight' | 'result' | 'done';

export class HorseScene extends BaseGameScene {
  readonly gameId = 'horse' as const;
  constructor() { super('HorseScene'); }

  private cfg: ShotConfig = { ...DEFAULT_SHOT };
  private state!: HorseState;
  private proj!: Projector;
  private phase: Phase = 'idle';
  private spotIndex = 0;
  private shooter!: CharacterSprite;
  private waiter!: CharacterSprite;
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private court!: Phaser.GameObjects.Graphics;
  private hoopFront!: Phaser.GameObjects.Graphics;
  private hoopBack!: Phaser.GameObjects.Graphics;
  private spotZones: Phaser.GameObjects.Zone[] = [];
  private spotTitle!: Phaser.GameObjects.Text;
  private reticle!: Phaser.GameObjects.Container;
  private preview!: Phaser.GameObjects.Graphics;
  private aim = { x: 0, y: 0 }; // -1..1
  /** Current shot power (1 = perfect) while charging or flicking. */
  private power = 0;
  private powerBar!: Meter;
  private powerLabel!: Phaser.GameObjects.Text;
  private timingLabel!: Phaser.GameObjects.Text;
  private powerText!: Phaser.GameObjects.Text;
  private meterHeld = false;
  private aiTarget: { power: number; aimX: number } | null = null;
  private aiChargeT = 0;
  private flick: { x0: number; y0: number; x: number; y: number; id: number } | null = null;
  private shot: ShotResult | null = null;
  private flightT = 0;
  private eventIdx = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private fieldTop = 0;
  private fieldBottom = 0;
  private horizon = 0;
  private focal = 1050;
  private lastPreviewKey = '';
  private shootBtn?: Phaser.GameObjects.Container;

  create(): void {
    this.setupShell({ music: 'outdoor' });
    const H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 40;
    this.fieldBottom = P ? H - 330 : H - 170;
    this.horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * 0.30;
    this.focal = P ? 1050 : 1050;
    this.state = createHorse(0);
    this.spotIndex = 0;
    this.aim = { x: 0, y: 0 };
    this.power = 0;
    this.flick = null;
    this.aiTarget = null;
    this.meterHeld = false;
    this.shot = null;
    this.phase = 'idle';
    this.bgImage = undefined;
    this.setProjector(SPOTS[this.spotIndex]);
    this.court = this.add.graphics().setDepth(10);
    this.hoopBack = this.add.graphics().setDepth(30);
    this.hoopFront = this.add.graphics().setDepth(46);
    this.waiter = new CharacterSprite(this, 0, 0, this.players[1].character, 1);
    this.waiter.setDepth(20).idle();
    this.shooter = new CharacterSprite(this, 0, 0, this.players[0].character, 1);
    this.shooter.setDepth(60).setPose('back-shoot0');
    this.ballShadow = this.add.image(0, 0, 'shadow').setDepth(11).setVisible(false);
    this.ball = this.add.image(0, 0, 'basketball').setDepth(45).setVisible(false);
    this.preview = this.add.graphics().setDepth(40);
    this.reticle = this.buildReticle().setDepth(70);
    this.buildControls();
    this.layoutCourt();
    this.refreshHud();
    // a pause mid-hold swallows the SHOOT key-up: on resume cancel the charge instead of firing at max
    const onResume = () => this.cancelHeldShot();
    this.events.on(Phaser.Scenes.Events.RESUME, onResume);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.RESUME, onResume));
    this.beginAfterHowTo(() => this.startTurn());
  }

  // ---------- Camera / background ----------
  private camWorldZ = 0;
  /** Nearest depth that is still in front of the camera. */
  private get nearZ(): number { return this.camWorldZ + 0.4; }

  private setProjector(spot: Spot): void {
    const camX = spot.x * 0.7 + (this.portrait ? HORSE_VISUAL.camSidePortrait : HORSE_VISUAL.camSideLandscape);
    const camWorldZ = spot.z - HORSE_VISUAL.camBack;
    this.camWorldZ = camWorldZ;
    this.proj = new Projector({ camZ: -camWorldZ, camH: HORSE_VISUAL.camH, horizonY: this.horizon, focal: this.focal, cx: this.W / 2, camX });
  }

  private bgImage?: Phaser.GameObjects.Image;

  /**
   * Static scenery for the current camera (one texture per shooting spot): sky, hazy woods, the
   * evergreen line behind the fence, lawn, fence, the asphalt driveway and the house wall beside it.
   */
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `horse-bg-${W}x${H}-${this.spotIndex}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const horizon = this.horizon;
      const r = rng(41 + this.spotIndex);
      const hw = HORSE_VISUAL.driveHalfWidth;
      const nz = this.nearZ;
      const P = (x: number, y: number, z: number) => pr.project(x, y, z);
      paintSkyHD(ctx, W, H, horizon + 2, { sunX: W * 0.78, sunY: horizon * 0.25, seed: 23 });
      // woods behind the neighbourhood, hazy with distance
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 44; i++) woods.push({ x: -90 + i * 4.4 + r() * 3, z: 30 + r() * 45, s: 5 + r() * 4, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = P(t.x, 0, t.z);
        const haze = Math.min(0.82, 0.4 + (t.z - 25) / 70);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.3 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      paintHaze(ctx, W, horizon, 90);
      // lawn everywhere (the driveway is painted over it)
      paintLawnHD(ctx, pr, { x0: -30, x1: 30, z0: nz - 1, z1: 14 }, { seed: 13, base: '#5a9a3a', stripeWidth: 3.2 });
      // childhood-sized evergreen line just behind the fence, with gaps
      const hedge: { x: number; z: number; h: number; seed: number }[] = [];
      for (let x = -24; x <= 24; x += 2.0) hedge.push({ x: x + (r() - 0.5) * 0.6, z: 4.6 + r() * 1.2, h: 1.6 + r() * 0.6, seed: 600 + Math.round(x * 3) });
      for (let z = 5; z < 13; z += 2.0) hedge.push({ x: 9.5 + (r() - 0.5) * 0.5, z, h: 1.7 + r() * 0.5, seed: 700 + Math.round(z * 3) });
      hedge.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = P(t.x, 0, t.z);
        if (!p.visible) return;
        if (t.seed % 6 === 0) paintPineHD(ctx, p.sx, p.sy, t.h * 1.1 * p.scale, t.seed, { haze: 0.05 });
        else paintCypress(ctx, p.sx, p.sy, t.h * p.scale, t.seed, { haze: 0.05 });
      });
      // wooden picket fence behind the hoop
      const fz = 3.2;
      const railL = P(-16, 0, fz), railR = P(16, 0, fz);
      if (railL.visible && railR.visible) {
        for (let x = -16; x <= 16; x += 0.32) {
          const b = P(x, 0, fz), t = P(x, 1.5, fz);
          if (!b.visible) continue;
          const g = ctx.createLinearGradient(b.sx - 0.1 * b.scale, 0, b.sx + 0.1 * b.scale, 0);
          g.addColorStop(0, '#9a7449'); g.addColorStop(0.5, '#7a5a3a'); g.addColorStop(1, '#4f3a22');
          ctx.fillStyle = g;
          ctx.fillRect(b.sx - 0.1 * b.scale, t.sy, 0.2 * b.scale, b.sy - t.sy);
          ctx.fillStyle = '#9a7449';
          ctx.beginPath(); ctx.moveTo(b.sx - 0.1 * b.scale, t.sy); ctx.lineTo(b.sx, t.sy - 0.08 * b.scale); ctx.lineTo(b.sx + 0.1 * b.scale, t.sy); ctx.closePath(); ctx.fill();
        }
        for (const yy of [0.5, 1.15]) {
          const l = P(-16, yy, fz), rr = P(16, yy, fz);
          ctx.fillStyle = '#5c4128';
          ctx.fillRect(l.sx, l.sy - 3, rr.sx - l.sx, 6);
          ctx.fillStyle = 'rgba(255,230,190,0.25)';
          ctx.fillRect(l.sx, l.sy - 3, rr.sx - l.sx, 2);
        }
        // fence shadow on the lawn and a flower bed in front
        const sh = ctx.createLinearGradient(0, railL.sy, 0, railL.sy + 0.6 * railL.scale);
        sh.addColorStop(0, 'rgba(0,0,0,0.3)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sh;
        ctx.fillRect(railL.sx, railL.sy, railR.sx - railL.sx, 0.6 * railL.scale);
        for (let x = -8; x <= 8; x += 0.5) {
          const p = P(x, 0, fz - 0.4);
          ctx.fillStyle = '#2f6b2a';
          ctx.beginPath(); ctx.ellipse(p.sx, p.sy - 0.1 * p.scale, 0.22 * p.scale, 0.14 * p.scale, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = ['#e53935', '#ffc107', '#f06292', '#ffffff'][Math.floor(Math.abs(x) * 2) % 4];
          ctx.beginPath(); ctx.arc(p.sx, p.sy - 0.2 * p.scale, 0.09 * p.scale, 0, Math.PI * 2); ctx.fill();
        }
      }
      // driveway: asphalt clipped to the projected slab, with wear, cracks, grass in the seams and an oil stain
      const d0 = P(-hw, 0, nz), d1 = P(hw, 0, nz), d2 = P(hw, 0, 1.2), d3 = P(-hw, 0, 1.2);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(d0.sx, d0.sy); ctx.lineTo(d1.sx, d1.sy); ctx.lineTo(d2.sx, d2.sy); ctx.lineTo(d3.sx, d3.sy); ctx.closePath(); ctx.clip();
      paintAsphalt(ctx, 0, d2.sy - 4, W, d0.sy - d2.sy + 8, 17, '#6c6966');
      // lighter worn wheel tracks
      for (const tx of [-hw * 0.55, hw * 0.55]) {
        const a = P(tx - 0.45, 0, nz), b = P(tx + 0.45, 0, nz), c = P(tx + 0.45, 0, 1.2), d = P(tx - 0.45, 0, 1.2);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fill();
      }
      // expansion seam down the middle with grass growing in it
      const s0 = P(0.05, 0, nz), s1 = P(0.05, 0, 1.2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke();
      ctx.strokeStyle = 'rgba(95,150,60,0.6)';
      for (let z = nz + 0.3; z < 1.2; z += 0.35 + r() * 0.5) {
        const p = P(0.05 + (r() - 0.5) * 0.08, 0, z);
        ctx.lineWidth = Math.max(1, 0.02 * p.scale);
        ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.sx + (r() - 0.5) * 0.08 * p.scale, p.sy - 0.06 * p.scale); ctx.stroke();
      }
      // hairline cracks
      ctx.strokeStyle = 'rgba(20,20,20,0.28)';
      for (let i = 0; i < 8; i++) {
        let x = -hw + r() * hw * 2, z = nz + r() * (1 - nz);
        const st = P(x, 0, z);
        ctx.lineWidth = Math.max(1, 0.008 * st.scale);
        ctx.beginPath(); ctx.moveTo(st.sx, st.sy);
        for (let k = 0; k < 5; k++) {
          x += (r() - 0.5) * 1.0; z = Math.max(nz, z + (r() - 0.5) * 1.0);
          const q = P(x, 0, z);
          ctx.lineTo(q.sx, q.sy);
        }
        ctx.stroke();
      }
      // oil stain near the garage end
      const os = P(-0.8, 0, -7.5);
      if (os.visible) {
        const og = ctx.createRadialGradient(os.sx, os.sy, 0, os.sx, os.sy, 0.7 * os.scale);
        og.addColorStop(0, 'rgba(10,10,15,0.45)'); og.addColorStop(1, 'rgba(10,10,15,0)');
        ctx.fillStyle = og;
        ctx.beginPath(); ctx.ellipse(os.sx, os.sy, 0.7 * os.scale, 0.25 * os.scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      // edge grass creeping over the slab
      ctx.strokeStyle = 'rgba(110,170,70,0.6)';
      for (const ex of [-hw, hw]) {
        for (let z = nz + 0.2; z < 1.2; z += 0.25 + r() * 0.3) {
          const p = P(ex + (ex < 0 ? 0.05 : -0.05), 0, z);
          ctx.lineWidth = Math.max(1, 0.02 * p.scale);
          ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.lineTo(p.sx + (ex < 0 ? 1 : -1) * 0.12 * p.scale * r(), p.sy - 0.05 * p.scale); ctx.stroke();
        }
      }
      ctx.restore();
      // soft shadow along the driveway edge next to the house
      const e0 = P(-hw, 0, nz), e1 = P(-hw, 0, 1.2), e2 = P(-hw + 0.8, 0, 1.2), e3 = P(-hw + 0.8, 0, nz);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.beginPath(); ctx.moveTo(e0.sx, e0.sy); ctx.lineTo(e1.sx, e1.sy); ctx.lineTo(e2.sx, e2.sy); ctx.lineTo(e3.sx, e3.sy); ctx.closePath(); ctx.fill();
      this.paintHouseWall(ctx, nz);
      paintVignette(ctx, W, H, 0.22);
      this.textures.addCanvas(key, canvas);
    }
    if (this.bgImage) this.bgImage.setTexture(key);
    else this.bgImage = this.add.image(W / 2, H / 2, key).setDepth(0);
    // one backdrop per spot adds up fast (each is a full-screen canvas): keep only the last few
    const keep = this.bgKeys.filter((k) => k !== key);
    keep.push(key);
    while (keep.length > 3) { const old = keep.shift()!; if (this.textures.exists(old)) this.textures.remove(old); }
    this.bgKeys = keep;
  }
  private bgKeys: string[] = [];

  /** The side of the house along the left edge of the driveway: white siding, blue shutters, stone foundation, shrubs. */
  private paintHouseWall(ctx: CanvasRenderingContext2D, nz: number): void {
    const pr = this.proj;
    const wx = -HORSE_VISUAL.driveHalfWidth - 0.9;
    const z0 = Math.max(nz, -12), z1 = 1.6;
    if (z1 - z0 < 0.5) return;
    const P = (x: number, y: number, z: number) => pr.project(x, y, z);
    const poly = (pts: { sx: number; sy: number }[], fill: string | CanvasGradient, stroke?: string) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
    };
    const wallH = 3.4, roofH = 3.78;
    // roof overhang and everything left of the wall (the roof seen from below)
    const tl = P(wx, roofH, z0), tr = P(wx, roofH, z1);
    const rg = ctx.createLinearGradient(0, Math.min(tl.sy, tr.sy) - 200, 0, Math.max(tl.sy, tr.sy));
    rg.addColorStop(0, '#6a5044'); rg.addColorStop(1, '#3d2a20');
    poly([{ sx: 0, sy: Math.min(tl.sy, tr.sy) - 2000 }, { sx: 0, sy: tl.sy }, tl, tr, { sx: 0, sy: tr.sy }], rg);
    poly([P(wx, wallH, z0), P(wx, wallH, z1), tr, tl], '#4a362c', 'rgba(0,0,0,0.5)');
    // siding with a vertical gradient (lit top, shaded under the eave is darker)
    const sTop = P(wx, wallH, z0), sBot = P(wx, 0.8, z0);
    const sg = ctx.createLinearGradient(0, sTop.sy, 0, sBot.sy);
    sg.addColorStop(0, '#d9d1c0'); sg.addColorStop(0.18, '#f6f1e6'); sg.addColorStop(1, '#ebe4d4');
    poly([P(wx, 0.8, z0), P(wx, 0.8, z1), P(wx, wallH, z1), P(wx, wallH, z0)], sg);
    ctx.strokeStyle = 'rgba(90,70,50,0.22)'; ctx.lineWidth = 1.5;
    for (let y = 1.0; y < wallH; y += 0.22) {
      const a = P(wx, y, z0), b = P(wx, y, z1);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy - 2); ctx.lineTo(b.sx, b.sy - 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(90,70,50,0.22)';
    }
    // stone foundation
    const fg = ctx.createLinearGradient(0, P(wx, 0.8, z0).sy, 0, P(wx, 0, z0).sy);
    fg.addColorStop(0, '#a89e94'); fg.addColorStop(1, '#7d746b');
    poly([P(wx, 0, z0), P(wx, 0, z1), P(wx, 0.8, z1), P(wx, 0.8, z0)], fg, 'rgba(0,0,0,0.35)');
    ctx.strokeStyle = 'rgba(60,50,45,0.5)'; ctx.lineWidth = 2;
    for (let z = z0; z < z1; z += 0.8) {
      const a = P(wx, 0, z), b = P(wx, 0.8, z);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    const m0 = P(wx, 0.4, z0), m1 = P(wx, 0.4, z1);
    ctx.beginPath(); ctx.moveTo(m0.sx, m0.sy); ctx.lineTo(m1.sx, m1.sy); ctx.stroke();
    // windows with blue shutters, glass reflection and a sill
    for (const wz of [-8.5, -5.2, -1.9]) {
      if (wz - 0.8 < z0) continue;
      const a = P(wx, 1.5, wz - 0.55), b = P(wx, 1.5, wz + 0.55), c = P(wx, 2.7, wz + 0.55), d = P(wx, 2.7, wz - 0.55);
      const shutter = (zz0: number, zz1: number) => {
        const q = [P(wx, 1.45, zz0), P(wx, 1.45, zz1), P(wx, 2.75, zz1), P(wx, 2.75, zz0)];
        const g = ctx.createLinearGradient(q[0].sx, 0, q[1].sx, 0);
        g.addColorStop(0, '#3a63c9'); g.addColorStop(1, '#223f8f');
        poly(q, g, 'rgba(0,0,0,0.4)');
        ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
        for (let y = 1.6; y < 2.7; y += 0.12) { const s0 = P(wx, y, zz0), s1 = P(wx, y, zz1); ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke(); }
      };
      shutter(wz - 0.85, wz - 0.6);
      shutter(wz + 0.6, wz + 0.85);
      const gg = ctx.createLinearGradient(a.sx, d.sy, b.sx, a.sy);
      gg.addColorStop(0, '#bfe3ff'); gg.addColorStop(0.5, '#86c2ee'); gg.addColorStop(1, '#5a95c9');
      poly([a, b, c, d], gg);
      poly([P(wx, 2.1, wz - 0.5), P(wx, 2.1, wz - 0.05), P(wx, 2.65, wz - 0.05), P(wx, 2.65, wz - 0.5)], 'rgba(255,255,255,0.35)');
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.stroke();
      const mx0 = P(wx, 1.5, wz), mx1 = P(wx, 2.7, wz), my0 = P(wx, 2.1, wz - 0.55), my1 = P(wx, 2.1, wz + 0.55);
      ctx.beginPath(); ctx.moveTo(mx0.sx, mx0.sy); ctx.lineTo(mx1.sx, mx1.sy); ctx.moveTo(my0.sx, my0.sy); ctx.lineTo(my1.sx, my1.sy); ctx.stroke();
      poly([P(wx, 1.42, wz - 0.65), P(wx, 1.42, wz + 0.65), P(wx, 1.5, wz + 0.65), P(wx, 1.5, wz - 0.65)], '#ffffff', 'rgba(0,0,0,0.3)');
    }
    // garden hose on a hook, downspout, shrubs along the foundation
    const hz = -3.6;
    if (hz > z0) {
      const h = P(wx, 1.1, hz);
      ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = Math.max(2, 0.05 * h.scale);
      ctx.beginPath(); ctx.ellipse(h.sx, h.sy, 0.25 * h.scale, 0.25 * h.scale, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#43a047';
      ctx.beginPath(); ctx.ellipse(h.sx, h.sy, 0.16 * h.scale, 0.16 * h.scale, 0, 0, Math.PI * 2); ctx.stroke();
    }
    const ds = P(wx, 0, 1.3), dt = P(wx, roofH, 1.3);
    if (ds.visible) { ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = Math.max(3, 0.08 * ds.scale); ctx.beginPath(); ctx.moveTo(dt.sx, dt.sy); ctx.lineTo(ds.sx, ds.sy); ctx.stroke(); }
    for (let z = Math.max(z0 + 0.4, -11); z < 1.2; z += 0.9) {
      const p = P(wx + 0.45, 0, z);
      const bg = ctx.createRadialGradient(p.sx - 0.15 * p.scale, p.sy - 0.4 * p.scale, 0.05 * p.scale, p.sx, p.sy - 0.25 * p.scale, 0.45 * p.scale);
      bg.addColorStop(0, '#8fd05a'); bg.addColorStop(0.6, '#3f8a2e'); bg.addColorStop(1, '#1f4f1c');
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath(); ctx.ellipse(p.sx + 0.1 * p.scale, p.sy, 0.4 * p.scale, 0.12 * p.scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.ellipse(p.sx, p.sy - 0.25 * p.scale, 0.38 * p.scale, 0.3 * p.scale, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  /** Redraw everything whose screen position depends on the current camera. */
  private layoutCourt(): void {
    const pr = this.proj;
    const g = this.court;
    g.clear();
    const hw = HORSE_VISUAL.driveHalfWidth;
    const nz = this.nearZ;
    this.paintBackground();
    // Chalk shooting area (dashed rectangle)
    g.lineStyle(4, 0xffffff, 0.8);
    const dash = (x0: number, z0: number, x1: number, z1: number) => {
      const segs = 14;
      for (let i = 0; i < segs; i += 2) {
        const a = pr.project(x0 + ((x1 - x0) * i) / segs, 0, z0 + ((z1 - z0) * i) / segs);
        const b = pr.project(x0 + ((x1 - x0) * (i + 1)) / segs, 0, z0 + ((z1 - z0) * (i + 1)) / segs);
        g.lineBetween(a.sx, a.sy, b.sx, b.sy);
      }
    };
    const aw = hw - 0.3;
    const farZ = Math.max(HORSE_VISUAL.areaFarZ, nz);
    dash(-aw, HORSE_VISUAL.areaNearZ, aw, HORSE_VISUAL.areaNearZ);
    if (farZ === HORSE_VISUAL.areaFarZ) dash(-aw, farZ, aw, farZ);
    dash(-aw, HORSE_VISUAL.areaNearZ, -aw, farZ);
    dash(aw, HORSE_VISUAL.areaNearZ, aw, farZ);
    // Chalk spots
    this.spotZones.forEach((z) => z.destroy());
    this.spotZones = [];
    SPOTS.forEach((s) => {
      if (s.z - 0.5 < nz) return;
      const c = pr.project(s.x, 0, s.z);
      const n = pr.project(s.x, 0, s.z + 0.5), f = pr.project(s.x, 0, s.z - 0.5);
      const rx = 0.55 * c.scale, ry = Math.max(4, Math.abs(f.sy - n.sy) / 2);
      const selected = this.state.spot === s.id || (this.state.phase === 'set' && this.spotIndex === s.id);
      g.lineStyle(selected ? 6 : 3, selected ? 0xf5c518 : 0xffffff, selected ? 1 : 0.75);
      g.strokeEllipse(c.sx, c.sy, rx * 2, ry * 2);
      if (selected) {
        g.fillStyle(0xf5c518, 0.18);
        g.fillEllipse(c.sx, c.sy, rx * 2, ry * 2);
      }
      const zone = this.add.zone(c.sx, c.sy, Math.max(90, rx * 2.2), Math.max(60, ry * 2.6)).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(13);
      zone.on('pointerdown', () => this.onSpotTap(s.id));
      this.spotZones.push(zone);
    });
    // Hoop: weighted base, steel pole, backboard, rim with drop shadow, net
    const hb = this.hoopBack, hf = this.hoopFront;
    hb.clear(); hf.clear();
    const bz = this.cfg.backboardZ;
    const poleBase = pr.project(0, 0, bz + 0.25), poleTop = pr.project(0, this.cfg.backboardBottom + 0.1, bz + 0.25);
    hb.fillStyle(0x000000, 0.28);
    hb.fillEllipse(poleBase.sx + 0.5 * poleBase.scale, poleBase.sy + 0.02 * poleBase.scale, 1.6 * poleBase.scale, 0.5 * poleBase.scale);
    // water-filled plastic base: a rounded wedge with a highlight
    const bw = 0.95 * poleBase.scale, bh = 0.34 * poleBase.scale;
    hb.fillStyle(0x1f2a44, 1);
    hb.fillRoundedRect(poleBase.sx - bw / 2, poleBase.sy - bh, bw, bh, Math.min(10, bh * 0.4));
    hb.fillStyle(0x34466e, 1);
    hb.fillRoundedRect(poleBase.sx - bw / 2 + 3, poleBase.sy - bh + 3, bw - 6, bh * 0.45, Math.min(8, bh * 0.3));
    hb.fillStyle(0x0d1322, 1);
    hb.fillEllipse(poleBase.sx, poleBase.sy - 1, bw * 0.9, bh * 0.35);
    // pole: dark steel with a bright highlight stripe
    const pw = Math.max(5, 0.12 * poleBase.scale);
    hb.lineStyle(pw, 0x24262a, 1);
    hb.lineBetween(poleBase.sx, poleBase.sy - bh * 0.6, poleTop.sx, poleTop.sy);
    hb.lineStyle(Math.max(2, pw * 0.3), 0x8a8f99, 1);
    hb.lineBetween(poleBase.sx - pw * 0.22, poleBase.sy - bh * 0.6, poleTop.sx - pw * 0.22, poleTop.sy);
    // backboard with a drop shadow, grey border and red target square
    const bl = pr.project(-this.cfg.backboardHalfWidth, this.cfg.backboardBottom, bz);
    const br = pr.project(this.cfg.backboardHalfWidth, this.cfg.backboardBottom, bz);
    const tl = pr.project(-this.cfg.backboardHalfWidth, this.cfg.backboardTop, bz);
    const tr = pr.project(this.cfg.backboardHalfWidth, this.cfg.backboardTop, bz);
    const off = Math.max(3, 0.04 * bl.scale);
    hb.fillStyle(0x000000, 0.22);
    hb.fillPoints([{ x: tl.sx + off, y: tl.sy + off }, { x: tr.sx + off, y: tr.sy + off }, { x: br.sx + off, y: br.sy + off }, { x: bl.sx + off, y: bl.sy + off }], true);
    hb.fillStyle(0xf4f1ea, 1);
    hb.fillPoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: br.sx, y: br.sy }, { x: bl.sx, y: bl.sy }], true);
    hb.fillStyle(0xd8d4cc, 0.6);
    hb.fillPoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: tr.sx, y: tr.sy + (br.sy - tr.sy) * 0.35 }, { x: tl.sx, y: tl.sy + (bl.sy - tl.sy) * 0.35 }], true);
    hb.lineStyle(Math.max(3, 0.05 * bl.scale), 0x6b6b6b, 1);
    hb.strokePoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: br.sx, y: br.sy }, { x: bl.sx, y: bl.sy }], true);
    const il = pr.project(-0.3, this.cfg.rimHeight, bz), ir = pr.project(0.3, this.cfg.rimHeight, bz), it = pr.project(0.3, this.cfg.rimHeight + 0.45, bz), itl = pr.project(-0.3, this.cfg.rimHeight + 0.45, bz);
    hb.lineStyle(Math.max(3, 0.035 * bl.scale), 0xd32f2f, 1);
    hb.strokePoints([{ x: itl.sx, y: itl.sy }, { x: it.sx, y: it.sy }, { x: ir.sx, y: ir.sy }, { x: il.sx, y: il.sy }], true);
    hb.fillStyle(0x9a948a, 0.18);
    hb.fillEllipse((bl.sx + br.sx) / 2, bl.sy - (bl.sy - tl.sy) * 0.3, (br.sx - bl.sx) * 0.7, (bl.sy - tl.sy) * 0.4);
    // rim: thick orange ring with a dark underside and a drop shadow on the backboard
    const rc = pr.project(0, this.cfg.rimHeight, 0);
    const rn = pr.project(0, this.cfg.rimHeight, -this.cfg.rimRadius), rf = pr.project(0, this.cfg.rimHeight, this.cfg.rimRadius);
    const rrx = this.cfg.rimRadius * rc.scale, rry = Math.max(3, (rn.sy - rf.sy) / 2);
    const rimW = Math.max(4, 0.045 * rc.scale);
    this.strokeHalfEllipse(hb, rc.sx + off * 0.5, rc.sy + off, rrx, rry, true, rimW, 0x000000, 0.25);
    this.strokeHalfEllipse(hb, rc.sx, rc.sy + rimW * 0.35, rrx, rry, true, rimW, 0xa63a00);
    this.strokeHalfEllipse(hb, rc.sx, rc.sy, rrx, rry, true, rimW, 0xe65100);
    // bracket to the backboard
    hb.lineStyle(rimW, 0xbf360c, 1);
    hb.lineBetween(rc.sx, rf.sy, rc.sx, pr.project(0, this.cfg.rimHeight, bz).sy);
    hb.lineStyle(Math.max(2, rimW * 0.35), 0xff8a50, 1);
    hb.lineBetween(rc.sx - rimW * 0.2, rf.sy, rc.sx - rimW * 0.2, pr.project(0, this.cfg.rimHeight, bz).sy);
    // net: strands converge and cross, with a soft shadow pass behind the white
    const nb = pr.project(0, this.cfg.rimHeight - 0.42, 0);
    const strands = 12;
    for (const pass of [0, 1]) {
      hf.lineStyle(pass === 0 ? 3 : 1.8, pass === 0 ? 0x000000 : 0xffffff, pass === 0 ? 0.15 : 0.95);
      for (let i = 0; i < strands; i++) {
        const a = (i / strands) * Math.PI * 2;
        const x0 = rc.sx + Math.cos(a) * rrx, y0 = rc.sy + Math.sin(a) * rry;
        const a2 = ((i + 0.5) / strands) * Math.PI * 2;
        const xm = (rc.sx + nb.sx) / 2 + Math.cos(a2) * rrx * 0.8, ym = (y0 + nb.sy) / 2 + Math.sin(a2) * rry * 0.8;
        hf.lineBetween(x0, y0, xm, ym);
        hf.lineBetween(xm, ym, nb.sx + Math.cos(a) * rrx * 0.5, nb.sy + Math.sin(a) * rry * 0.5);
      }
      // bottom loop
      hf.strokeEllipse(nb.sx, nb.sy, rrx * 1.0, rry * 1.0);
    }
    this.strokeHalfEllipse(hf, rc.sx, rc.sy + rimW * 0.35, rrx, rry, false, rimW, 0xa63a00);
    this.strokeHalfEllipse(hf, rc.sx, rc.sy, rrx, rry, false, rimW, 0xff6f00);
    this.strokeHalfEllipse(hf, rc.sx, rc.sy - rimW * 0.25, rrx, rry, false, Math.max(1.5, rimW * 0.3), 0xffb27a);
    // Characters
    const sp = SPOTS[this.spotIndex];
    const spp = pr.project(sp.x, 0, sp.z);
    const sScale = (spp.scale * 1.85) / 220;
    this.shooter.setPosition(spp.sx, spp.sy).rescale(sScale);
    // the waiting player stands beside the hoop on the side opposite the shooter so they never overlap
    const wp = pr.project(sp.x >= 0 ? -2.6 : 2.6, 0, 0.2);
    const wScale = (wp.scale * 1.85) / 220;
    this.waiter.setPosition(wp.sx, wp.sy).rescale(wScale);
    this.waiter.setFacing(sp.x >= 0 ? 1 : -1);
    this.waiter.setDepth(this.waiter.y < this.shooter.y ? 20 : 61);
    this.spotTitle?.setText(`SPOT: ${sp.name.toUpperCase()}`);
    // reticle centre
    this.lastPreviewKey = '';
  }

  private strokeHalfEllipse(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, back: boolean, width: number, color: number, alpha = 1): void {
    g.lineStyle(width, color, alpha);
    g.beginPath();
    const n = 24;
    for (let i = 0; i <= n; i++) {
      const a = (back ? Math.PI : 0) + (i / n) * Math.PI;
      const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokePath();
  }

  private reticleCenter(): { x: number; y: number; rx: number; ry: number } {
    const c = this.proj.project(0, this.cfg.rimHeight + 0.35, 0);
    return { x: c.sx, y: c.sy, rx: 0.5 * c.scale, ry: 0.36 * c.scale };
  }

  private buildReticle(): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    g.lineStyle(4, 0x4ff0ff, 0.95);
    g.strokeCircle(0, 0, 30);
    g.lineStyle(3, 0x4ff0ff, 0.9);
    g.beginPath(); g.moveTo(-48, 0); g.lineTo(-16, 0); g.moveTo(16, 0); g.lineTo(48, 0); g.moveTo(0, -48); g.lineTo(0, -16); g.moveTo(0, 16); g.lineTo(0, 48); g.strokePath();
    g.fillStyle(0x4ff0ff, 0.9);
    g.fillCircle(0, 0, 4);
    const t = this.add.text(52, 0, 'AIM', displayStyle(18, '#4ff0ff', { strokeThickness: 3 })).setOrigin(0, 0.5);
    c.add([g, t]);
    return c;
  }

  private buildControls(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      const map: Record<string, number[]> = { left: [K.A, K.LEFT], right: [K.D, K.RIGHT], up: [K.W, K.UP], down: [K.S, K.DOWN] };
      for (const [name, codes] of Object.entries(map)) codes.forEach((code, i) => { this.keys[`${name}${i}`] = kb.addKey(code, false, false); });
      const shootKeys = ['SPACE', 'F', 'ENTER', 'COMMA'];
      shootKeys.forEach((k) => {
        kb.on(`keydown-${k}`, (e: KeyboardEvent) => { if (!e.repeat) this.pressShoot(); });
        kb.on(`keyup-${k}`, () => this.releaseShoot());
      });
      kb.on('keydown-LEFT', () => this.cycleSpot(-1));
      kb.on('keydown-A', () => this.cycleSpot(-1));
      kb.on('keydown-DOWN', () => this.cycleSpot(-1));
      kb.on('keydown-S', () => this.cycleSpot(-1));
      kb.on('keydown-RIGHT', () => this.cycleSpot(1));
      kb.on('keydown-D', () => this.cycleSpot(1));
      kb.on('keydown-UP', () => this.cycleSpot(1));
      kb.on('keydown-W', () => this.cycleSpot(1));
    }
    // Vertical POWER bar on the right edge of the field: pull (or hold) until the marker sits in the gold band
    const bh = P ? 420 : 380;
    const bx = W - (P ? 70 : 84), by = (this.fieldTop + this.fieldBottom) / 2 - bh / 2 + (P ? 40 : 0);
    const panel = this.add.graphics().setDepth(900);
    panel.fillStyle(0x0d1f10, 0.82);
    panel.fillRoundedRect(bx - 34, by - 48, 68, bh + 96, 16);
    panel.lineStyle(3, THEME.accent, 0.8);
    panel.strokeRoundedRect(bx - 34, by - 48, 68, bh + 96, 16);
    this.add.text(bx, by - 30, 'POWER', displayStyle(16, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    const maxP = FLICK.maxPull / FLICK.sweetPull;          // bar top
    const perfectHalf = (this.cfg.perfectMs / 100) * this.cfg.powerPer100Ms / maxP;
    const goodHalf = (this.cfg.goodMs / 100) * this.cfg.powerPer100Ms / maxP;
    const sweet = 1 / maxP;
    this.powerBar = new Meter(this, bx - 14, by, 28, bh, {
      depth: 901, bg: 0x2a2a2a, fg: 0x4fc3f7, vertical: true,
      bands: [
        { from: sweet - goodHalf, to: sweet + goodHalf, color: 0x8bc34a },
        { from: sweet - perfectHalf, to: sweet + perfectHalf, color: 0xf5c518 },
      ],
    });
    this.powerBar.set(0);
    this.powerLabel = this.add.text(bx, by + bh + 30, 'short', textStyle(14, THEME.textDim)).setOrigin(0.5).setDepth(901);
    // Bottom-centre strip: result label + hints
    const mw = P ? W - 80 - 100 : 560;
    const mx = P ? 40 : W / 2 - mw / 2;
    const my = P ? H - 200 : H - 110;
    const strip = this.add.graphics().setDepth(900);
    strip.fillStyle(0x0d1f10, 0.82);
    strip.fillRoundedRect(mx - 20, my - 50, mw + 40, 120, 16);
    strip.lineStyle(3, THEME.accent, 0.8);
    strip.strokeRoundedRect(mx - 20, my - 50, mw + 40, 120, 16);
    this.spotTitle = this.add.text(mx + mw / 2, my - 38, 'SPOT', displayStyle(18, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.add.text(mx + mw / 2, my - 10, this.useTouch
      ? 'Tap a chalk circle to pick a spot, then\nput a finger on the court and FLICK UP to shoot'
      : 'Arrows / WASD pick a spot. Flick up with the mouse to shoot,\nor hold SPACE / F and release in the gold band (A / D aim)', textStyle(P ? 16 : 17, '#ffffff', { align: 'center' })).setOrigin(0.5, 0).setDepth(901);
    this.timingLabel = this.add.text(mx + mw / 2, my + 46, '', displayStyle(22, '#ffffff')).setOrigin(0.5).setDepth(902);
    this.powerText = this.add.text(mx + mw / 2, my + 46, '', textStyle(17, THEME.textDim)).setOrigin(0.5).setDepth(901).setVisible(false);
    // SHOOT button (keyboard / mouse users): hold to charge, release to shoot
    if (!this.useTouch) {
      const bw = P ? 240 : 280;
      this.shootBtn = makeButton(this, W - 30 - bw / 2 - (P ? 0 : 110), H - 90, 'SHOOT', () => { /* handled on down/up */ }, { width: bw, height: 100, fontSize: 40, depth: 900 });
      this.shootBtn.list.forEach((o) => {
        if (o instanceof Phaser.GameObjects.Zone) {
          o.off('pointerup');
          o.on('pointerdown', () => { Audio.unlock(); this.pressShoot(); });
          o.on('pointerup', () => this.releaseShoot());
          o.on('pointerupoutside', () => this.releaseShoot());
          o.on('pointerout', () => this.releaseShoot());
        }
      });
    }
    // Flick to shoot: press on the court, pull up, release
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y <= this.fieldTop || p.y >= this.fieldBottom + 40) return;
      if (this.shootBtn && this.shootBtn.getBounds().contains(p.x, p.y)) return;
      if (p.x > W - 140) return; // the power bar
      if (!this.humanShooting() || (this.phase !== 'choose' && this.phase !== 'ready')) return;
      this.flick = { x0: p.x, y0: p.y, x: p.x, y: p.y, id: p.id };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.flick || this.flick.id !== p.id || !p.isDown) return;
      this.flick.x = p.x; this.flick.y = p.y;
      const f = flickToShot(p.x - this.flick.x0, p.y - this.flick.y0, W, H);
      if (f.pull >= FLICK.minPull) {
        this.aim.x = f.aimX;
        this.power = f.powerFactor;
        if (this.phase === 'choose') { this.lockSpot(); }
        this.shooter.setPose('back-shoot1');
        this.placeHeldBall();
      }
    });
    const endFlick = (p: Phaser.Input.Pointer) => {
      const fl = this.flick;
      if (!fl || fl.id !== p.id) return;
      this.flick = null;
      const f = flickToShot(p.x - fl.x0, p.y - fl.y0, W, H);
      if (f.pull < FLICK.minPull || !this.humanShooting() || (this.phase !== 'choose' && this.phase !== 'ready')) {
        if (this.phase === 'ready' && !this.meterHeld) { this.shooter.setPose('back-shoot0'); this.placeHeldBall(); }
        return;
      }
      if (this.phase === 'choose') this.lockSpot();
      Audio.unlock();
      this.fire(f.powerFactor, f.aimX, true);
    };
    this.input.on('pointerup', endFlick);
    this.input.on('pointerupoutside', endFlick);
  }

  /** The setter commits to the current spot. */
  private lockSpot(): void {
    if (this.phase !== 'choose') return;
    this.state = chooseSpot(this.state, this.spotIndex);
    this.phase = 'ready';
    this.spotZones.forEach((z) => z.disableInteractive());
    this.refreshHud();
  }

  // ---------- Turn flow ----------
  private humanShooting(): boolean { return !this.isAI(this.state.shooter); }

  private startTurn(): void {
    if (this.finished) return;
    const s = this.state;
    this.setTurn(s.shooter);
    this.refreshHud();
    this.aim = { x: 0, y: 0 };
    this.power = 0;
    this.flick = null;
    this.aiTarget = null;
    this.meterHeld = false;
    this.shot = null;
    this.powerBar.set(0);
    this.powerLabel.setText('');
    this.timingLabel.setText('');
    this.powerText.setText('');
    const shooterChar = this.players[s.shooter].character;
    const waiterChar = this.players[s.shooter === 0 ? 1 : 0].character;
    this.shooter.setCharacter(shooterChar).setPose('back-shoot0');
    this.waiter.setCharacter(waiterChar).idle();
    if (s.phase === 'match') {
      this.spotIndex = s.spot ?? 0;
      this.phase = 'ready';
      this.setStatus(`${this.name(s.shooter)} must match it from ${SPOTS[this.spotIndex].name}! ${this.isAI(s.shooter) ? '' : this.useTouch ? 'Flick up to shoot.' : 'Flick up or hold SHOOT.'}`);
    } else {
      this.phase = 'choose';
      if (s.spot !== null) this.spotIndex = s.spot;
      this.setStatus(this.isAI(s.shooter) ? `${this.name(s.shooter)} is picking a spot...` : `${this.name(s.shooter)} sets a shot. Pick a spot, then ${this.useTouch ? 'flick up to shoot' : 'flick up or hold SHOOT'}!`);
    }
    this.setProjector(SPOTS[this.spotIndex]);
    this.layoutCourt();
    this.placeHeldBall();
    if (this.isAI(s.shooter)) this.runAI();
  }

  private runAI(): void {
    const s = this.state;
    const think = s.phase === 'set' ? HORSE_VISUAL.aiThinkMs : 500;
    this.time.delayedCall(think, () => {
      if (this.finished) return;
      if (this.state.phase === 'set') {
        const spot = aiChooseSpot(this.ai);
        this.spotIndex = spot.id;
        this.state = chooseSpot(this.state, spot.id);
        this.setProjector(spot);
        this.layoutCourt();
        this.placeHeldBall();
        this.phase = 'ready';
        this.setStatus(`${this.name(this.state.shooter)} picks ${spot.name}.`);
        this.refreshHud();
      }
      const params = aiShot(this.ai, SPOTS[this.spotIndex]);
      this.time.delayedCall(HORSE_VISUAL.aiShootMs, () => {
        if (this.finished) return;
        // The CPU winds up: the bar charges toward its (noisy) power, then it lets go.
        this.aim.x = Phaser.Math.Clamp(params.aimX, -1, 1);
        this.aim.y = 0;
        this.aiTarget = { power: powerFromOffset(params.offsetMs, this.cfg), aimX: this.aim.x };
        this.aiChargeT = 0;
        this.phase = 'meter';
        this.shooter.setPose('back-shoot1');
        this.placeHeldBall();
      });
    });
  }

  private onSpotTap(id: number): void {
    if (this.phase !== 'choose' || !this.humanShooting()) return;
    Audio.sfx('click');
    this.selectSpot(id);
  }

  private cycleSpot(d: number): void {
    if (this.phase !== 'choose' || !this.humanShooting()) return;
    Audio.sfx('tick');
    this.selectSpot((this.spotIndex + d + SPOTS.length) % SPOTS.length);
  }

  private selectSpot(id: number): void {
    this.spotIndex = id;
    this.state = chooseSpot(this.state, id);
    this.setProjector(SPOTS[id]);
    this.layoutCourt();
    this.placeHeldBall();
    this.refreshHud();
  }

  /** Keyboard / SHOOT button: hold to charge the power bar, release to shoot. */
  private pressShoot(): void {
    if (!this.humanShooting()) return;
    if (this.phase !== 'choose' && this.phase !== 'ready') return;
    if (this.phase === 'choose') this.lockSpot();
    this.phase = 'meter';
    this.meterHeld = true;
    this.power = 0;
    this.timingLabel.setText('');
    this.shooter.setPose('back-shoot1');
    this.placeHeldBall();
  }

  private releaseShoot(): void {
    if (this.phase !== 'meter' || !this.meterHeld) return;
    if (!this.humanShooting()) return;
    this.meterHeld = false;
    this.fire(this.power, this.aim.x, true);
  }

  /** Pausing mid-hold swallows the key-up; on resume drop the charge instead of auto-firing at max. */
  private cancelHeldShot(): void {
    if (this.phase !== 'meter' || !this.meterHeld) return;
    this.meterHeld = false;
    this.power = 0;
    this.phase = 'ready';
    this.powerBar.set(0);
    this.powerLabel.setText('');
    this.timingLabel.setText('');
    this.shooter.setPose('back-shoot0');
    this.placeHeldBall();
  }

  /** Let it fly. `noisy` adds the distance-based wobble every real shot has (the CPU's error is already in its target). */
  private fire(powerFactor: number, aimX: number, noisy: boolean): void {
    const spot = SPOTS[this.spotIndex];
    let pf = powerFactor, ax = aimX;
    if (noisy) {
      // a person's nearly-right release gets a nudge toward perfect, then the distance wobble
      ({ powerFactor: pf, aimX: ax } = assistShot(pf, ax));
      const n = shotNoise(spot);
      pf *= 1 + gaussian(n.powerSd);
      ax += gaussian(n.aimSd);
    }
    this.power = pf;
    const result = simulateShotPower(spot, pf, ax, this.aim.y, this.cfg);
    this.shot = result;
    this.flightT = 0;
    this.eventIdx = 0;
    this.phase = 'flight';
    this.flick = null;
    this.aiTarget = null;
    this.preview.clear();
    this.lastPreviewKey = '';
    this.shooter.setPose('back-shoot1');
    this.ballShadow.setVisible(true);
    Audio.sfx('throw');
    const label = result.timing === 'early' ? 'SHORT' : result.timing === 'late' ? 'LONG' : 'PERFECT';
    const col = result.timing === 'perfect' ? '#f5c518' : '#8bc34a';
    this.timingLabel.setText(label).setColor(col);
    this.powerBar.set(Phaser.Math.Clamp(pf / (FLICK.maxPull / FLICK.sweetPull), 0, 1));
    this.powerLabel.setText(`${Math.round(pf * 100)}%`);
  }

  private resolveShot(): void {
    const r = this.shot!;
    this.phase = 'result';
    const slot = this.state.shooter;
    const banked = r.events.some((e) => e.kind === 'backboard') && r.made;
    const rimmed = r.events.some((e) => e.kind === 'rim');
    const prev = this.state;
    this.state = applyShot(this.state, r.made);
    const W = this.W;
    const ay = this.fieldTop + 200;
    if (r.made) {
      this.announce(banked ? 'BANK! GOOD!' : rimmed ? "IT'S GOOD!" : 'SWISH!', { color: '#f5c518', size: this.portrait ? 70 : 84, y: ay });
      confetti(this, W / 2, ay, 30);
      this.react(slot, 'cheer', this.shooter.x, Math.max(this.fieldTop + 120, this.shooter.y - 230 * this.shooter.charScale));
    } else {
      const why = r.events.some((e) => e.kind === 'backboard') ? 'OFF THE BOARD' : rimmed ? 'RIMS OUT' : 'AIRBALL';
      this.announce(`${why} — MISS`, { color: '#ef5350', size: this.portrait ? 54 : 66, y: ay });
      if (Math.random() < 0.5) this.react(slot, 'groan', this.shooter.x, Math.max(this.fieldTop + 120, this.shooter.y - 230 * this.shooter.charScale));
    }
    this.refreshHud();
    let delay = HORSE_VISUAL.resultHoldMs;
    if (this.state.lastEvent === 'match-missed') {
      const letters = this.state.letters[slot];
      this.time.delayedCall(900, () => {
        this.announce(`${this.name(slot).toUpperCase()} GETS THE "${['H', 'O', 'R', 'S', 'E'][letters - 1]}"`, { color: '#ffe082', size: this.portrait ? 46 : 56, y: ay + 90, hold: 1400 });
        Audio.sfx('whistle');
      });
      delay += 1200;
    } else if (this.state.lastEvent === 'set-missed') {
      this.time.delayedCall(900, () => this.announce(`${this.name(this.state.setter).toUpperCase()} TAKES OVER AS SETTER`, { size: this.portrait ? 40 : 50, y: ay + 90, hold: 1200 }));
      delay += 900;
    } else if (this.state.lastEvent === 'set-made') {
      this.time.delayedCall(900, () => this.announce(`${this.name(this.state.shooter).toUpperCase()} MUST MATCH IT`, { color: '#4ff0ff', size: this.portrait ? 44 : 54, y: ay + 90, hold: 1200 }));
      delay += 900;
    }
    void prev;
    this.time.delayedCall(delay, () => {
      if (this.state.phase === 'done') return this.endMatch();
      this.startTurn();
    });
  }

  private endMatch(): void {
    this.phase = 'done';
    const w = this.state.winner!;
    const l = w === 0 ? 1 : 0;
    this.finishMatch({
      winnerSlot: w,
      summary: `${this.name(l)} spelled H-O-R-S-E after ${this.state.shotsTaken} shots`,
      scores: [lettersDisplay(this.state.letters[0]), lettersDisplay(this.state.letters[1])],
      points: [this.state.letters[0], this.state.letters[1]],
    });
  }

  private refreshHud(): void {
    const s = this.state;
    this.setScore(0, lettersDisplay(s.letters[0]));
    this.setScore(1, lettersDisplay(s.letters[1]));
    if (s.phase === 'done') { this.setSub('Game over'); return; }
    const spotName = s.spot !== null ? SPOTS[s.spot].name : SPOTS[this.spotIndex].name;
    this.setSub(s.phase === 'match'
      ? `${this.name(s.shooter)} MATCHING  •  ${spotName}`
      : `${this.name(s.shooter)} SETTING  •  make it, ${this.name(s.shooter === 0 ? 1 : 0)} has to match it`);
  }

  // ---------- Per-frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished) return;
    const dt = Math.min(0.05, dtMs / 1000);
    // Keyboard aim nudging once a spot is locked (ready / meter)
    if (this.humanShooting() && (this.phase === 'ready' || this.phase === 'meter')) {
      let dx = 0, dy = 0;
      const kd = (n: string) => (this.keys[`${n}0`]?.isDown || this.keys[`${n}1`]?.isDown) ?? false;
      if (kd('left')) dx -= 1;
      if (kd('right')) dx += 1;
      if (kd('up')) dy -= 1;
      if (kd('down')) dy += 1;
      if (dx || dy) {
        this.aim.x = Phaser.Math.Clamp(this.aim.x + dx * 1.6 * dt, -1, 1);
        this.aim.y = Phaser.Math.Clamp(this.aim.y + dy * 1.6 * dt, -1, 1);
      }
    }
    const rc = this.reticleCenter();
    this.reticle.setPosition(rc.x + this.aim.x * rc.rx, rc.y + this.aim.y * rc.ry);
    this.reticle.setVisible(this.phase === 'choose' || this.phase === 'ready' || this.phase === 'meter');
    const maxP = FLICK.maxPull / FLICK.sweetPull;
    if (this.phase === 'meter') {
      if (this.aiTarget) {
        // CPU wind-up: the bar climbs to its chosen power, then the shot goes
        this.aiChargeT += dt;
        const u = Math.min(1, this.aiChargeT / 0.7);
        this.power = this.aiTarget.power * u;
        if (u >= 1) { this.fire(this.aiTarget.power, this.aiTarget.aimX, false); return; }
      } else if (this.meterHeld) {
        this.power = Math.min(maxP, this.power + (maxP / HORSE_VISUAL.chargeSeconds) * dt);
        if (this.power >= maxP) { this.meterHeld = false; this.fire(this.power, this.aim.x, true); return; }
      }
    }
    const charging = this.phase === 'meter' || (this.flick !== null && this.power > 0);
    if (charging) {
      this.powerBar.set(Phaser.Math.Clamp(this.power / maxP, 0, 1));
      this.powerLabel.setText(this.power < 1 - (this.cfg.goodMs / 100) * this.cfg.powerPer100Ms ? 'short' : this.power > 1 + (this.cfg.goodMs / 100) * this.cfg.powerPer100Ms ? 'long' : 'good');
    }
    this.drawPreview();
    if (this.phase === 'flight' && this.shot) {
      // advanced by the (scaled) frame delta so a fast-forwarded CPU turn plays the flight faster too
      this.flightT += dt;
      const pts = this.shot.points;
      const idx = Math.max(0, Math.min(pts.length - 1, Math.floor(this.flightT * 120)));
      const p = pts[idx];
      this.placeBall(p.x, p.y, p.z);
      while (this.eventIdx < this.shot.events.length && this.shot.events[this.eventIdx].t <= this.flightT) {
        const ev = this.shot.events[this.eventIdx++];
        const sp = this.proj.project(p.x, p.y, p.z);
        if (ev.kind === 'rim') { Audio.sfx('rim'); impact(this, sp.sx, sp.sy, 0xffa726, 6, 80, 5); }
        else if (ev.kind === 'backboard') { Audio.sfx('backboard'); impact(this, sp.sx, sp.sy, 0xffffff, 6, 80, 5); }
        else if (ev.kind === 'ground') Audio.sfx('bounce');
        else if (ev.kind === 'swish') { Audio.sfx('swish'); impact(this, sp.sx, sp.sy, 0xf5c518, 10, 80, 6); }
      }
      if (idx >= pts.length - 1) this.resolveShot();
    }
  }

  /** Before the wind-up the ball is tucked at the chest (hidden from behind); during the meter it is raised overhead. */
  private placeHeldBall(): void {
    if (this.phase === 'meter') {
      const sc = this.shooter.charScale;
      const sp = SPOTS[this.spotIndex];
      const depthScale = this.proj.project(sp.x, 0, sp.z).scale;
      const px = Math.max(14, HORSE_VISUAL.ballDiameter * depthScale);
      this.ball.setVisible(true).setPosition(this.shooter.x + 12 * sc, this.shooter.y - 214 * sc).setScale(px / 72).setDepth(65);
      this.ballShadow.setVisible(false);
    } else {
      this.ball.setVisible(false);
      this.ballShadow.setVisible(false);
    }
  }

  private placeBall(x: number, y: number, z: number): void {
    const p = this.proj.project(x, y, z);
    const g = this.proj.project(x, 0, z);
    if (!p.visible) { this.ball.setVisible(false); this.ballShadow.setVisible(false); return; }
    const px = Math.max(14, HORSE_VISUAL.ballDiameter * p.scale);
    this.ball.setVisible(true).setPosition(p.sx, p.sy).setScale(px / 72).setDepth(z > this.cfg.backboardZ - 0.1 ? 25 : 45);
    this.ballShadow.setVisible(true).setPosition(g.sx, g.sy).setScale(px / 128 * 1.3, px / 128 * 0.5).setAlpha(Math.max(0.12, 0.55 - y * 0.08));
  }

  private drawPreview(): void {
    const live = this.flick !== null || (this.phase === 'meter' && this.meterHeld);
    const show = this.humanShooting() && (this.phase === 'choose' || this.phase === 'ready' || this.phase === 'meter');
    if (!show) { if (this.lastPreviewKey !== '') { this.preview.clear(); this.lastPreviewKey = ''; } return; }
    const pf = live ? this.power : 1;
    const key = `${this.spotIndex}:${this.aim.x.toFixed(2)}:${pf.toFixed(2)}:${live ? 1 : 0}`;
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;
    this.preview.clear();
    if (live && pf < 0.3) return;
    const r = simulateShotPower(SPOTS[this.spotIndex], pf, this.aim.x, this.aim.y, this.cfg, 1 / 40);
    // the preview only reveals the launch (not whether it drops): a faint ideal arc before you pull, a bright live one while you do
    const end = r.events.find((e) => e.kind === 'swish' || e.kind === 'ground' || e.kind === 'rim' || e.kind === 'backboard');
    const endT = end ? end.t : r.points[r.points.length - 1].t;
    const cut = endT * (live ? HORSE_VISUAL.previewFraction : 0.5);
    this.preview.lineStyle(live ? 4 : 3, live ? 0x4ff0ff : 0xffffff, live ? 0.8 : 0.3);
    let on = true;
    for (let i = 1; i < r.points.length; i++) {
      if (r.points[i].t > cut) break;
      const a = this.proj.project(r.points[i - 1].x, r.points[i - 1].y, r.points[i - 1].z);
      const b = this.proj.project(r.points[i].x, r.points[i].y, r.points[i].z);
      if (a.visible && b.visible && on) this.preview.lineBetween(a.sx, a.sy, b.sx, b.sy);
      on = !on;
    }
    // ball ghost at the end of the shown arc
    const last = r.points.filter((pt) => pt.t <= cut).pop();
    if (last && live) {
      const p = this.proj.project(last.x, last.y, last.z);
      if (p.visible) { this.preview.lineStyle(2, 0x4ff0ff, 0.9); this.preview.strokeCircle(p.sx, p.sy, Math.max(6, HORSE_VISUAL.ballDiameter * p.scale * 0.5)); }
    }
  }
}
