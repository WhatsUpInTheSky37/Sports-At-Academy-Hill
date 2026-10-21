import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, impact, confetti } from '../../core/ui';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintGrass, paintPine, paintSky, paintTreeSide, rng } from '../../art/environment';
import { DEFAULT_SHOT, SPOTS, aiChooseSpot, aiShot, simulateShot, type ShotConfig, type ShotResult, type Spot } from './shot';
import { applyShot, chooseSpot, createHorse, lettersDisplay, type HorseState } from './rules';

/** Visual tuning for the HORSE scene. */
export const HORSE_VISUAL = {
  /** Camera distance behind the shooter and height (m). */
  camBack: 4.4,
  camH: 2.0,
  /** Camera lateral offset so the shooter stands right of centre and the hoop stays visible. */
  camSideLandscape: -1.1,
  camSidePortrait: -0.8,
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
  private house!: Phaser.GameObjects.Graphics;
  private spotZones: Phaser.GameObjects.Zone[] = [];
  private spotLabel!: Phaser.GameObjects.Text;
  private reticle!: Phaser.GameObjects.Container;
  private preview!: Phaser.GameObjects.Graphics;
  private aim = { x: 0, y: 0 }; // -1..1
  private timingMeter!: Meter;
  private timingLabel!: Phaser.GameObjects.Text;
  private powerText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private meterStart = 0;
  private meterHeld = false;
  private aiRelease: number | null = null;
  private shot: ShotResult | null = null;
  private flightT = 0;
  private flightStart = 0;
  private eventIdx = 0;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private dragLast: { x: number; y: number } | null = null;
  private dragMoved = false;
  private fieldTop = 0;
  private fieldBottom = 0;
  private horizon = 0;
  private focal = 1050;
  private lastPreviewKey = '';
  private shootBtn?: Phaser.GameObjects.Container;

  create(): void {
    this.setupShell({ music: 'outdoor' });
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 40;
    this.fieldBottom = P ? H - 330 : H - 170;
    this.horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * 0.30;
    this.focal = P ? 1050 : 1050;
    this.state = createHorse(0);
    this.spotIndex = 0;
    this.aim = { x: 0, y: 0 };
    this.phase = 'idle';
    this.setProjector(SPOTS[this.spotIndex]);
    this.paintBackground();
    this.court = this.add.graphics().setDepth(10);
    this.house = this.add.graphics().setDepth(14);
    this.hoopBack = this.add.graphics().setDepth(30);
    this.hoopFront = this.add.graphics().setDepth(46);
    this.spotLabel = this.add.text(0, 0, '', displayStyle(22, '#f5c518', { strokeThickness: 4 })).setOrigin(0.5, 0).setDepth(12);
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

  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `horse-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const horizon = this.horizon;
      paintSky(ctx, W, H, horizon + 2);
      // warm evening tint on the sky
      const warm = ctx.createLinearGradient(0, 0, 0, horizon);
      warm.addColorStop(0, 'rgba(255,170,80,0)');
      warm.addColorStop(1, 'rgba(255,190,110,0.35)');
      ctx.fillStyle = warm;
      ctx.fillRect(0, 0, W, horizon);
      paintGrass(ctx, 0, horizon - 4, W, H - horizon + 4, 13, '#5b9638');
      // far tree line just above the horizon (behind the fence)
      const r = rng(41);
      const n = Math.ceil(W / 90) + 2;
      for (let i = 0; i < n; i++) {
        const x = -40 + i * 90 + r() * 30;
        const big = i % 3 === 0;
        if (big) paintTreeSide(ctx, x, horizon + 6, 150 + r() * 60, 500 + i);
        else paintPine(ctx, x, horizon + 8, 90 + r() * 70, 600 + i);
      }
      // low evening light wash over the lawn
      const wash = ctx.createLinearGradient(0, horizon, 0, H);
      wash.addColorStop(0, 'rgba(255,200,120,0.18)');
      wash.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, horizon, W, H - horizon);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
  }

  /** Redraw everything whose screen position depends on the current camera. */
  private layoutCourt(): void {
    const pr = this.proj;
    const g = this.court;
    g.clear();
    const hw = HORSE_VISUAL.driveHalfWidth;
    // Driveway slab
    const quad = (x0: number, z0: number, x1: number, z1: number, color: number, alpha = 1) => {
      const a = pr.project(x0, 0, z0), b = pr.project(x1, 0, z0), c = pr.project(x1, 0, z1), d = pr.project(x0, 0, z1);
      g.fillStyle(color, alpha);
      g.fillPoints([{ x: a.sx, y: a.sy }, { x: b.sx, y: b.sy }, { x: c.sx, y: c.sy }, { x: d.sx, y: d.sy }], true);
    };
    const nz = this.nearZ;
    quad(-hw, nz, hw, 1.2, 0x6f6c68);
    // lighter wear strips and cracks
    quad(-hw * 0.5, nz, hw * 0.5, 1.2, 0x7a7773, 0.5);
    const r = rng(7);
    g.lineStyle(2, 0x3a3835, 0.6);
    for (let i = 0; i < 12; i++) {
      let x = -hw + r() * hw * 2, z = nz + r() * (1 - nz);
      const s = pr.project(x, 0, z);
      g.beginPath();
      g.moveTo(s.sx, s.sy);
      for (let k = 0; k < 5; k++) {
        x += (r() - 0.5) * 1.2; z = Math.max(nz, z + (r() - 0.5) * 1.2);
        const p = pr.project(x, 0, z);
        g.lineTo(p.sx, p.sy);
      }
      g.strokePath();
    }
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
    // Fence behind the hoop
    const fz = 3.2;
    g.fillStyle(0x7a5a3a, 1);
    for (let x = -16; x <= 16; x += 0.32) {
      const b = pr.project(x, 0, fz), t = pr.project(x, 1.5, fz);
      if (!b.visible) continue;
      g.fillRect(b.sx - 0.1 * b.scale, t.sy, 0.2 * b.scale, b.sy - t.sy);
    }
    g.fillStyle(0x5c4128, 1);
    for (const yy of [0.5, 1.15]) {
      const l = pr.project(-16, yy, fz), rr = pr.project(16, yy, fz);
      g.fillRect(l.sx, l.sy - 2, rr.sx - l.sx, 5);
    }
    // flower bed along the fence
    for (let x = -8; x <= 8; x += 0.5) {
      const p = pr.project(x, 0, fz - 0.4);
      g.fillStyle([0xe53935, 0xffc107, 0xf06292, 0x8bc34a][Math.floor(Math.abs(x) * 2) % 4], 1);
      g.fillCircle(p.sx, p.sy - 0.15 * p.scale, 0.12 * p.scale);
    }
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
    // Hoop: pole, backboard, rim, net
    const hb = this.hoopBack, hf = this.hoopFront;
    hb.clear(); hf.clear();
    const bz = this.cfg.backboardZ;
    const poleBase = pr.project(0, 0, bz + 0.25), poleTop = pr.project(0, this.cfg.backboardBottom + 0.1, bz + 0.25);
    hb.fillStyle(0x000000, 0.25);
    hb.fillEllipse(poleBase.sx + 0.4 * poleBase.scale, poleBase.sy, 1.4 * poleBase.scale, 0.5 * poleBase.scale);
    hb.lineStyle(Math.max(4, 0.12 * poleBase.scale), 0x2b2b2b, 1);
    hb.lineBetween(poleBase.sx, poleBase.sy, poleTop.sx, poleTop.sy);
    // base weight
    hb.fillStyle(0x3a3a3a, 1);
    hb.fillEllipse(poleBase.sx, poleBase.sy, 0.8 * poleBase.scale, 0.3 * poleBase.scale);
    const bl = pr.project(-this.cfg.backboardHalfWidth, this.cfg.backboardBottom, bz);
    const br = pr.project(this.cfg.backboardHalfWidth, this.cfg.backboardBottom, bz);
    const tl = pr.project(-this.cfg.backboardHalfWidth, this.cfg.backboardTop, bz);
    const tr = pr.project(this.cfg.backboardHalfWidth, this.cfg.backboardTop, bz);
    hb.fillStyle(0xe8e4dc, 1);
    hb.fillPoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: br.sx, y: br.sy }, { x: bl.sx, y: bl.sy }], true);
    hb.lineStyle(3, 0x555555, 1);
    hb.strokePoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: br.sx, y: br.sy }, { x: bl.sx, y: bl.sy }], true);
    // inner square
    const il = pr.project(-0.3, this.cfg.rimHeight, bz), ir = pr.project(0.3, this.cfg.rimHeight, bz), it = pr.project(0.3, this.cfg.rimHeight + 0.45, bz), itl = pr.project(-0.3, this.cfg.rimHeight + 0.45, bz);
    hb.lineStyle(3, 0xd32f2f, 1);
    hb.strokePoints([{ x: itl.sx, y: itl.sy }, { x: it.sx, y: it.sy }, { x: ir.sx, y: ir.sy }, { x: il.sx, y: il.sy }], true);
    // grime
    hb.fillStyle(0x9a948a, 0.25);
    hb.fillEllipse((bl.sx + br.sx) / 2, bl.sy - (bl.sy - tl.sy) * 0.3, (br.sx - bl.sx) * 0.7, (bl.sy - tl.sy) * 0.4);
    // rim (back half behind the ball layer, front half in front)
    const rc = pr.project(0, this.cfg.rimHeight, 0);
    const rn = pr.project(0, this.cfg.rimHeight, -this.cfg.rimRadius), rf = pr.project(0, this.cfg.rimHeight, this.cfg.rimRadius);
    const rrx = this.cfg.rimRadius * rc.scale, rry = Math.max(3, (rn.sy - rf.sy) / 2);
    const rimW = Math.max(3, 0.03 * rc.scale);
    hb.lineStyle(rimW, 0xe65100, 1);
    hb.beginPath();
    hb.arc(rc.sx, rc.sy, 1, Math.PI, 0, false); // placeholder to keep API happy
    hb.strokePath();
    this.strokeHalfEllipse(hb, rc.sx, rc.sy, rrx, rry, true, rimW, 0xe65100);
    // rim bracket to backboard
    hb.lineStyle(rimW, 0xbf360c, 1);
    hb.lineBetween(rc.sx, rf.sy, rc.sx, pr.project(0, this.cfg.rimHeight, bz).sy);
    // net
    hf.lineStyle(2, 0xffffff, 0.9);
    const nb = pr.project(0, this.cfg.rimHeight - 0.42, 0);
    const strands = 10;
    for (let i = 0; i < strands; i++) {
      const a = (i / strands) * Math.PI * 2;
      const x0 = rc.sx + Math.cos(a) * rrx, y0 = rc.sy + Math.sin(a) * rry;
      const x1 = nb.sx + Math.cos(a) * rrx * 0.55, y1 = nb.sy + Math.sin(a) * rry * 0.55;
      hf.lineBetween(x0, y0, x1, y1);
      const a2 = ((i + 0.5) / strands) * Math.PI * 2;
      hf.lineBetween(x0, y0, nb.sx + Math.cos(a2) * rrx * 0.55, nb.sy + Math.sin(a2) * rry * 0.55);
    }
    this.strokeHalfEllipse(hf, rc.sx, rc.sy, rrx, rry, false, rimW, 0xff6f00);
    // Side of the house along the left edge of the driveway (a wall parallel to the drive)
    this.drawHouseWall(nz);
    // Characters
    const sp = SPOTS[this.spotIndex];
    const spp = pr.project(sp.x, 0, sp.z);
    const sScale = (spp.scale * 2.0) / 220;
    this.shooter.setPosition(spp.sx, spp.sy);
    this.shooter.sprite.setScale(sScale);
    this.shooter.shadow.setScale(1.1 * sScale, 0.9 * sScale);
    this.shooter.sprite.setY(-220 * 0.5 * sScale + 14 * sScale);
    const wp = pr.project(-2.6, 0, 0.2);
    const wScale = (wp.scale * 2.0) / 220;
    this.waiter.setPosition(wp.sx, wp.sy);
    this.waiter.sprite.setScale(wScale);
    this.waiter.shadow.setScale(1.1 * wScale, 0.9 * wScale);
    this.waiter.sprite.setY(-220 * 0.5 * wScale + 14 * wScale);
    this.waiter.setFacing(1);
    this.waiter.setDepth(this.waiter.y < this.shooter.y ? 20 : 61);
    // Spot label under the shooter
    const lbl = pr.project(sp.x, 0, sp.z - 0.6);
    this.spotLabel.setPosition(lbl.sx, lbl.sy + 6).setText(`SHOT SPOT: ${sp.name.toUpperCase()}`);
    // reticle centre
    this.lastPreviewKey = '';
  }

  private drawHouseWall(nz: number): void {
    const pr = this.proj;
    const g = this.house;
    g.clear();
    const wx = -HORSE_VISUAL.driveHalfWidth - 0.9;
    const z0 = Math.max(nz, -12), z1 = 1.6;
    if (z1 - z0 < 0.5) return;
    const P = (x: number, y: number, z: number) => pr.project(x, y, z);
    const poly = (pts: { sx: number; sy: number }[], color: number, alpha = 1) => {
      g.fillStyle(color, alpha);
      g.fillPoints(pts.map((p) => ({ x: p.sx, y: p.sy })), true);
    };
    // foundation (stone), siding, roof overhang
    poly([P(wx, 0, z0), P(wx, 0, z1), P(wx, 0.8, z1), P(wx, 0.8, z0)], 0x9a9088);
    poly([P(wx, 0.8, z0), P(wx, 0.8, z1), P(wx, 3.4, z1), P(wx, 3.4, z0)], 0xf1e8d2);
    poly([P(wx, 3.4, z0), P(wx, 3.4, z1), P(wx, 3.75, z1), P(wx, 3.75, z0)], 0x5a4034);
    // everything left of the wall is house too (fill to the screen edge)
    const tl = P(wx, 3.75, z0), tr = P(wx, 3.75, z1);
    poly([{ sx: 0, sy: tl.sy }, tl, tr, { sx: 0, sy: tr.sy }], 0x5a4034);
    const bl = P(wx, 0, z0), br = P(wx, 0, z1);
    // stone pattern
    g.lineStyle(2, 0x6d655e, 0.8);
    for (let z = z0; z < z1; z += 0.8) {
      const a = P(wx, 0, z), b = P(wx, 0.8, z);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
    }
    const m0 = P(wx, 0.4, z0), m1 = P(wx, 0.4, z1);
    g.lineBetween(m0.sx, m0.sy, m1.sx, m1.sy);
    // siding lines
    g.lineStyle(1.5, 0xc9bda4, 0.9);
    for (let y = 1.0; y < 3.4; y += 0.22) {
      const a = P(wx, y, z0), b = P(wx, y, z1);
      g.lineBetween(a.sx, a.sy, b.sx, b.sy);
    }
    // windows with green shutters
    for (const wz of [-8.5, -5.2, -1.9]) {
      if (wz - 0.8 < z0) continue;
      const a = P(wx, 1.5, wz - 0.55), b = P(wx, 1.5, wz + 0.55), c = P(wx, 2.7, wz + 0.55), d = P(wx, 2.7, wz - 0.55);
      poly([P(wx, 1.45, wz - 0.85), P(wx, 1.45, wz - 0.6), P(wx, 2.75, wz - 0.6), P(wx, 2.75, wz - 0.85)], 0x2e5d3a);
      poly([P(wx, 1.45, wz + 0.6), P(wx, 1.45, wz + 0.85), P(wx, 2.75, wz + 0.85), P(wx, 2.75, wz + 0.6)], 0x2e5d3a);
      poly([a, b, c, d], 0x9fd3ff);
      poly([P(wx, 2.1, wz - 0.5), P(wx, 2.1, wz - 0.05), P(wx, 2.65, wz - 0.05), P(wx, 2.65, wz - 0.5)], 0xffffff, 0.35);
      g.lineStyle(3, 0xffffff, 1);
      g.strokePoints([{ x: a.sx, y: a.sy }, { x: b.sx, y: b.sy }, { x: c.sx, y: c.sy }, { x: d.sx, y: d.sy }], true);
      const mx0 = P(wx, 1.5, wz), mx1 = P(wx, 2.7, wz), my0 = P(wx, 2.1, wz - 0.55), my1 = P(wx, 2.1, wz + 0.55);
      g.lineBetween(mx0.sx, mx0.sy, mx1.sx, mx1.sy);
      g.lineBetween(my0.sx, my0.sy, my1.sx, my1.sy);
    }
    // garden hose coiled on the wall + shrubs along the foundation
    const hz = -3.6;
    if (hz > z0) {
      const h = P(wx, 1.1, hz);
      g.lineStyle(Math.max(2, 0.05 * h.scale), 0x2e7d32, 1);
      g.strokeEllipse(h.sx, h.sy, 0.5 * h.scale, 0.5 * h.scale);
      g.strokeEllipse(h.sx, h.sy, 0.32 * h.scale, 0.32 * h.scale);
    }
    for (let z = Math.max(z0 + 0.4, -11); z < 1.2; z += 0.9) {
      const p = P(wx + 0.45, 0, z);
      g.fillStyle(0x3f8a2e, 1);
      g.fillEllipse(p.sx, p.sy - 0.2 * p.scale, 0.7 * p.scale, 0.55 * p.scale);
      g.fillStyle(0x6cc04a, 0.6);
      g.fillEllipse(p.sx - 0.1 * p.scale, p.sy - 0.3 * p.scale, 0.35 * p.scale, 0.25 * p.scale);
    }
    void bl; void br;
  }

  private strokeHalfEllipse(g: Phaser.GameObjects.Graphics, cx: number, cy: number, rx: number, ry: number, back: boolean, width: number, color: number): void {
    g.lineStyle(width, color, 1);
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
    // Timing meter panel (bottom centre)
    const mw = P ? W - 80 : 560;
    const mx = W / 2 - mw / 2;
    const my = P ? H - 200 : H - 110;
    const panel = this.add.graphics().setDepth(900);
    panel.fillStyle(0x0d1f10, 0.82);
    panel.fillRoundedRect(mx - 20, my - 50, mw + 40, 120, 16);
    panel.lineStyle(3, THEME.accent, 0.8);
    panel.strokeRoundedRect(mx - 20, my - 50, mw + 40, 120, 16);
    this.add.text(W / 2, my - 38, 'SHOT TIMING', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    const pa = this.cfg.perfectAt;
    const ph = this.cfg.perfectMs / this.cfg.meterMs;
    const gh = this.cfg.goodMs / this.cfg.meterMs;
    this.timingMeter = new Meter(this, mx, my - 6, mw, 26, {
      depth: 901, bg: 0x2a2a2a, fg: 0x000000,
      bands: [
        { from: pa - gh, to: pa + gh, color: 0x8bc34a },
        { from: pa - ph, to: pa + ph, color: 0xf5c518 },
      ],
    });
    this.timingMeter.set(0, 0);
    this.add.text(mx + 40, my + 34, 'EARLY = SHORT', displayStyle(16, '#8bc34a', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    this.add.text(mx + mw * pa, my + 34, 'PERFECT', displayStyle(18, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    this.add.text(mx + mw - 40, my + 34, 'LATE = LONG', displayStyle(16, '#8bc34a', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    this.timingLabel = this.add.text(W / 2, my + 7, '', displayStyle(24, '#ffffff')).setOrigin(0.5).setDepth(902);
    // Power / hint panel (bottom-left)
    const hw = P ? 300 : 330;
    const hx = 30, hy = P ? H - 150 : H - 150;
    const hint = this.add.graphics().setDepth(900);
    hint.fillStyle(0x0d1f10, 0.82);
    hint.fillRoundedRect(hx, hy, hw, 120, 16);
    hint.lineStyle(3, THEME.accent, 0.8);
    hint.strokeRoundedRect(hx, hy, hw, 120, 16);
    this.add.text(hx + hw / 2, hy + 12, 'CHOOSE SPOT  •  AIM', displayStyle(18, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.hintText = this.add.text(hx + hw / 2, hy + 44, this.useTouch ? 'Tap a chalk circle to pick a spot\nDrag on the hoop to aim' : 'Arrow keys / WASD: pick a spot\nDrag with the mouse to aim', textStyle(18, '#ffffff', { align: 'center' })).setOrigin(0.5, 0).setDepth(901);
    this.powerText = this.add.text(hx + hw / 2, hy + 94, '', textStyle(17, THEME.textDim)).setOrigin(0.5, 0).setDepth(901);
    // SHOOT button: hold to start the meter, release to shoot
    const bw = 300;
    this.shootBtn = makeButton(this, W - 30 - bw / 2, H - 90, 'SHOOT', () => { /* handled on down/up */ }, { width: bw, height: 110, fontSize: 44, depth: 900 });
    this.shootBtn.list.forEach((o) => {
      if (o instanceof Phaser.GameObjects.Zone) {
        o.off('pointerup');
        o.on('pointerdown', () => { Audio.unlock(); this.pressShoot(); });
        o.on('pointerup', () => this.releaseShoot());
        o.on('pointerupoutside', () => this.releaseShoot());
        o.on('pointerout', () => this.releaseShoot());
      }
    });
    this.add.text(W - 30 - bw / 2, H - 24, this.useTouch ? 'hold, release in the gold band' : 'hold SPACE / F, release in the gold band', textStyle(17, '#fff3c4')).setOrigin(0.5).setDepth(901);
    // Drag to aim (anywhere in the field that is not a spot)
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y > this.fieldTop && p.y < this.fieldBottom + 40 && !(this.shootBtn && this.shootBtn.getBounds().contains(p.x, p.y))) {
        this.dragLast = { x: p.x, y: p.y };
        this.dragMoved = false;
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragLast || !p.isDown || !this.humanShooting() || (this.phase !== 'choose' && this.phase !== 'ready' && this.phase !== 'meter')) return;
      const r = this.reticleCenter();
      this.aim.x = Phaser.Math.Clamp(this.aim.x + (p.x - this.dragLast.x) / r.rx * 0.9, -1, 1);
      this.aim.y = Phaser.Math.Clamp(this.aim.y + (p.y - this.dragLast.y) / r.ry * 0.9, -1, 1);
      this.dragLast = { x: p.x, y: p.y };
      this.dragMoved = true;
    });
    const end = () => { this.dragLast = null; };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);
  }

  // ---------- Turn flow ----------
  private humanShooting(): boolean { return !this.isAI(this.state.shooter); }

  private startTurn(): void {
    if (this.finished) return;
    const s = this.state;
    this.setTurn(s.shooter);
    this.refreshHud();
    this.aim = { x: 0, y: 0 };
    this.shot = null;
    this.timingMeter.set(0, 0);
    this.timingLabel.setText('');
    this.powerText.setText('');
    const shooterChar = this.players[s.shooter].character;
    const waiterChar = this.players[s.shooter === 0 ? 1 : 0].character;
    this.shooter.sprite.setTexture(`char-${shooterChar.id}`, 'back-shoot0');
    this.shooter.setPose('back-shoot0');
    this.waiter.sprite.setTexture(`char-${waiterChar.id}`, 'idle0');
    this.waiter.idle();
    if (s.phase === 'match') {
      this.spotIndex = s.spot ?? 0;
      this.phase = 'ready';
      this.setStatus(`${this.name(s.shooter)} must match it from ${SPOTS[this.spotIndex].name}!`);
    } else {
      this.phase = 'choose';
      if (s.spot !== null) this.spotIndex = s.spot;
      this.setStatus(this.isAI(s.shooter) ? `${this.name(s.shooter)} is picking a spot...` : `${this.name(s.shooter)} sets a shot. Pick a spot, then hold SHOOT!`);
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
        // Animate the aim toward the AI's (noisy) target, then run the meter and release at its timing error.
        this.aim.x = Phaser.Math.Clamp(params.aimX, -1, 1);
        this.aim.y = Phaser.Math.Clamp(params.aimY, -1, 1);
        this.aiRelease = this.cfg.perfectAt * this.cfg.meterMs + params.offsetMs;
        this.pressShoot(true);
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

  private pressShoot(ai = false): void {
    if (!ai && !this.humanShooting()) return;
    if (this.phase !== 'choose' && this.phase !== 'ready') return;
    if (this.phase === 'choose') {
      this.state = chooseSpot(this.state, this.spotIndex);
      this.refreshHud();
    }
    this.phase = 'meter';
    this.meterHeld = true;
    this.meterStart = this.time.now;
    this.timingLabel.setText('');
    this.spotZones.forEach((z) => z.disableInteractive());
  }

  private releaseShoot(ai = false): void {
    if (this.phase !== 'meter' || !this.meterHeld) return;
    if (!ai && !this.humanShooting()) return;
    this.meterHeld = false;
    const elapsed = this.time.now - this.meterStart;
    const offsetMs = elapsed - this.cfg.perfectAt * this.cfg.meterMs;
    this.fire(offsetMs);
  }

  private fire(offsetMs: number): void {
    const spot = SPOTS[this.spotIndex];
    const result = simulateShot(spot, offsetMs, this.aim.x, this.aim.y, this.cfg);
    this.shot = result;
    this.flightT = 0;
    this.flightStart = this.time.now;
    this.eventIdx = 0;
    this.phase = 'flight';
    this.aiRelease = null;
    this.preview.clear();
    this.shooter.setPose('back-shoot1');
    Audio.sfx('throw');
    const label = result.timing.toUpperCase();
    const col = result.timing === 'perfect' ? '#f5c518' : '#8bc34a';
    this.timingLabel.setText(label).setColor(col);
    this.powerText.setText(`Power ${Math.round(result.powerFactor * 100)}%`);
    const pos = (offsetMs + this.cfg.perfectAt * this.cfg.meterMs) / this.cfg.meterMs;
    this.timingMeter.set(0, Phaser.Math.Clamp(pos, 0, 1));
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
      this.react(slot, 'cheer', this.shooter.x, this.shooter.y - 420 * this.shooter.sprite.scale);
    } else {
      const why = r.events.some((e) => e.kind === 'backboard') ? 'OFF THE BOARD' : rimmed ? 'RIMS OUT' : 'AIRBALL';
      this.announce(`${why} — MISS`, { color: '#ef5350', size: this.portrait ? 54 : 66, y: ay });
      if (Math.random() < 0.5) this.react(slot, 'groan', this.shooter.x, this.shooter.y - 420 * this.shooter.sprite.scale);
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
    this.drawPreview();
    if (this.phase === 'meter') {
      const elapsed = this.time.now - this.meterStart;
      const pos = elapsed / this.cfg.meterMs;
      this.timingMeter.set(0, Phaser.Math.Clamp(pos, 0, 1));
      if (this.aiRelease !== null) {
        if (elapsed >= this.aiRelease) { this.meterHeld = false; this.fire(this.aiRelease - this.cfg.perfectAt * this.cfg.meterMs); }
      } else if (elapsed >= this.cfg.meterMs) {
        // held too long: auto-release at the very end
        this.meterHeld = false;
        this.fire(this.cfg.meterMs - this.cfg.perfectAt * this.cfg.meterMs);
      }
      return;
    }
    if (this.phase === 'flight' && this.shot) {
      this.flightT = (this.time.now - this.flightStart) / 1000;
      const pts = this.shot.points;
      const idx = Math.min(pts.length - 1, Math.floor(this.flightT * 120));
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

  private placeHeldBall(): void {
    const sp = SPOTS[this.spotIndex];
    this.placeBall(sp.x + 0.08, 1.5, sp.z + 0.45);
    this.ball.setDepth(65);
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
    const show = this.humanShooting() && (this.phase === 'choose' || this.phase === 'ready' || this.phase === 'meter');
    if (!show) { if (this.lastPreviewKey !== '') { this.preview.clear(); this.lastPreviewKey = ''; } return; }
    const key = `${this.spotIndex}:${this.aim.x.toFixed(2)}:${this.aim.y.toFixed(2)}`;
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;
    const r = simulateShot(SPOTS[this.spotIndex], 0, this.aim.x, this.aim.y, this.cfg, 1 / 40);
    this.preview.clear();
    this.preview.lineStyle(3, r.made ? 0x4ff0ff : 0xffffff, 0.45);
    let on = true;
    const end = r.events.find((e) => e.kind === 'swish' || e.kind === 'ground' || e.kind === 'rim' || e.kind === 'backboard');
    for (let i = 1; i < r.points.length; i++) {
      if (end && r.points[i].t > end.t) break;
      const a = this.proj.project(r.points[i - 1].x, r.points[i - 1].y, r.points[i - 1].z);
      const b = this.proj.project(r.points[i].x, r.points[i].y, r.points[i].z);
      if (a.visible && b.visible && on) this.preview.lineBetween(a.sx, a.sy, b.sx, b.sy);
      on = !on;
    }
  }
}
