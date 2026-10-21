import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, makePanel, makeDim, confetti } from '../../core/ui';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintConcrete, paintCouchFront, paintLamp, paintPennant, paintPoster, roundRect, shade, rng } from '../../art/environment';
import { DEFAULT_POOL, PoolSim, aimGuide, canPlace, headSpot, pockets, type Ball, type PoolConfig } from './physics';
import { applyShotResult, callPocket, chooseGroup, createGame, groupOf, needsCall, onTheEight, placeCueBall, remaining, resolveIllegalBreak, POCKET_NAMES, type PoolGameState } from './rules';
import { chooseShot, choosePlacement, nearestPocketToEight } from './ai';

/** Visual tuning for the billiards scene. */
export const POOL_VISUAL = {
  /** Near-rail width as a fraction of screen width, per orientation. */
  nearWidthFrac: { landscape: 0.74, portrait: 0.86 },
  /** Near-rail width divided by far-rail width (perspective strength). */
  depthRatio: { landscape: 1.55, portrait: 1.9 },
  railWidth: 0.075,
  /** Keyboard fine-aim speed in degrees per second. */
  aimKeySpeed: 22,
  defaultPower: 0.55,
  aiThinkMs: 900,
  /** Balls are drawn a little larger than true scale for readability. */
  ballVisualScale: 1.22,
};

type Phase = 'idle' | 'placing' | 'aiming' | 'rolling' | 'pending' | 'done';

export class PoolScene extends BaseGameScene {
  readonly gameId = 'pool' as const;
  constructor() { super('PoolScene'); }

  private cfg: PoolConfig = { ...DEFAULT_POOL };
  private state!: PoolGameState;
  private proj!: Projector;
  private phase: Phase = 'idle';
  private aimAngle = Math.PI / 2;
  private power = POOL_VISUAL.defaultPower;
  private sim: PoolSim | null = null;
  private soundIdx = 0;
  private lastSound: Record<string, number> = {};
  private ballImgs = new Map<number, Phaser.GameObjects.Image>();
  private ballShadows = new Map<number, Phaser.GameObjects.Image>();
  private guide!: Phaser.GameObjects.Graphics;
  private cue!: Phaser.GameObjects.Image;
  private pocketMarks!: Phaser.GameObjects.Graphics;
  private powerMeter!: Meter;
  private powerText!: Phaser.GameObjects.Text;
  private shootBtn!: ReturnType<typeof makeButton>;
  private callBtn!: ReturnType<typeof makeButton>;
  private doneBtn!: ReturnType<typeof makeButton>;
  private hintText!: Phaser.GameObjects.Text;
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private fieldTop = 0;
  private fieldBottom = 0;
  private modal: Phaser.GameObjects.GameObject[] = [];
  private opponentSprite?: CharacterSprite;
  private shooterSprite?: CharacterSprite;
  private groupIcons: Phaser.GameObjects.Image[] = [];
  private aiAimTween?: Phaser.Tweens.Tween;
  private pullback = 0;
  private dragging = false;
  private dragPower = false;
  private simStruck = false;

  create(): void {
    this.setupShell({ music: 'basement' });
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom + (P ? 30 : 16);
    this.fieldBottom = P ? H - 290 : H - 165;
    this.buildCamera();
    this.paintBackdrop();
    this.drawTable();
    this.state = createGame(0, this.cfg);
    this.guide = this.add.graphics().setDepth(300);
    this.pocketMarks = this.add.graphics().setDepth(250);
    this.cue = this.add.image(0, 0, 'cue').setOrigin(1, 0.5).setDepth(900).setVisible(false);
    for (const b of this.state.balls) {
      const sh = this.add.image(0, 0, 'shadow').setDepth(200).setAlpha(0.6);
      const img = this.add.image(0, 0, `pool-${b.id}`).setDepth(400);
      this.ballShadows.set(b.id, sh);
      this.ballImgs.set(b.id, img);
    }
    this.buildCharacters();
    this.buildControls();
    this.renderBalls(this.state.balls);
    this.refreshHud();
    this.beginAfterHowTo(() => this.startTurn());
  }

  // ---------- Camera / table geometry ----------
  private buildCamera(): void {
    const W = this.W, P = this.portrait;
    const { tableW: w, tableL: L } = this.cfg;
    const span = this.fieldBottom - this.fieldTop;
    const ratio = P ? POOL_VISUAL.depthRatio.portrait : POOL_VISUAL.depthRatio.landscape;
    const nearW = W * (P ? POOL_VISUAL.nearWidthFrac.portrait : POOL_VISUAL.nearWidthFrac.landscape);
    const camZ = L / (ratio - 1);
    const camH = (w * span * (L + camZ)) / (nearW * L);
    const focal = span / (camH / camZ - camH / (L + camZ));
    const horizonY = this.fieldBottom - (focal * camH) / camZ;
    this.proj = new Projector({ camZ, camH, horizonY, focal, cx: W / 2, camX: w / 2 });
  }

  private sp(x: number, z: number): { sx: number; sy: number; scale: number } {
    return this.proj.project(x, 0, z);
  }

  private paintBackdrop(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const key = `pool-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const wallBase = this.fieldTop + (P ? 90 : 40);
      const ceiling = 0;
      // cinder-block wall
      const wg = ctx.createLinearGradient(0, ceiling, 0, wallBase);
      wg.addColorStop(0, '#4a4036');
      wg.addColorStop(0.35, '#8a7f70');
      wg.addColorStop(1, '#a89c8a');
      ctx.fillStyle = wg;
      ctx.fillRect(0, ceiling, W, wallBase - ceiling);
      ctx.strokeStyle = 'rgba(40,30,20,0.28)';
      ctx.lineWidth = 2;
      const bh = 34, bw = 82;
      for (let y = wallBase; y > 60; y -= bh) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        const off = (Math.round((wallBase - y) / bh) % 2) * (bw / 2);
        for (let x = off; x < W; x += bw) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - bh); ctx.stroke(); }
      }
      // ceiling joists
      ctx.fillStyle = '#3b2a1c';
      for (let x = 20; x < W; x += 170) { ctx.fillRect(x, 0, 26, 70); }
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, 0, W, 10);
      // pipes
      ctx.strokeStyle = '#6f7378'; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(0, 90); ctx.lineTo(W, 96); ctx.stroke();
      ctx.strokeStyle = '#8a8d90'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, 86); ctx.lineTo(W, 92); ctx.stroke();
      // floor (concrete) with a rug
      paintConcrete(ctx, 0, wallBase, W, H - wallBase, 31);
      const fg = ctx.createLinearGradient(0, wallBase, 0, H);
      fg.addColorStop(0, 'rgba(0,0,0,0.25)');
      fg.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, wallBase, W, H - wallBase);
      ctx.fillStyle = '#7a3b2e';
      ctx.beginPath(); ctx.ellipse(W * 0.12, wallBase + 70, 150, 34, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c99a6b'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(W * 0.12, wallBase + 70, 120, 26, 0, 0, Math.PI * 2); ctx.stroke();
      // stairs on the left
      const sx0 = P ? -40 : 40;
      const stepW = P ? 150 : 200;
      for (let i = 0; i < 7; i++) {
        const y = wallBase - 30 - i * 42;
        ctx.fillStyle = shade('#8a5a3a', -0.1 - i * 0.03);
        ctx.fillRect(sx0 + i * 18, y - 20, stepW, 22);
        ctx.fillStyle = shade('#8a5a3a', 0.15);
        ctx.fillRect(sx0 + i * 18, y - 24, stepW, 6);
      }
      ctx.fillStyle = '#5a3a22';
      ctx.fillRect(sx0 + stepW + 10, wallBase - 330, 10, 320);
      ctx.fillRect(sx0 + 120, wallBase - 330, stepW, 10);
      // couch on the far wall, lamp, poster, pennant, shelves
      const cw = Math.min(520, W * 0.32);
      paintCouchFront(ctx, W / 2 - cw / 2, wallBase - 150, cw, 150, '#3f6a4a');
      paintLamp(ctx, W / 2 + cw / 2 + 90, wallBase - 70, 1);
      paintPoster(ctx, W / 2 + cw / 2 + 170, wallBase - 330, 150, 110, '#2e4a7a', 'ACADEMY');
      paintPennant(ctx, W / 2 - cw / 2 - 260, wallBase - 330, 200, 70, '#f5c518', 'ACADEMY HILL');
      // shelves on the right
      const shX = W - (P ? 160 : 260);
      ctx.fillStyle = '#6b4a2e';
      ctx.fillRect(shX, wallBase - 320, P ? 150 : 220, 320);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = '#9c7a52';
        ctx.fillRect(shX + 6, wallBase - 300 + i * 80, (P ? 150 : 220) - 12, 10);
        const r = rng(50 + i);
        for (let k = 0; k < 3; k++) {
          ctx.fillStyle = ['#c9c2b4', '#4a7fb8', '#b85a3a', '#e0d4a8'][Math.floor(r() * 4)];
          ctx.fillRect(shX + 14 + k * 58, wallBase - 300 + i * 80 - 40, 44, 40);
        }
      }
      // hanging table lamp (green shade) above the table
      const lx = W / 2, ly = this.fieldTop - (P ? 60 : 30);
      ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, ly - 60); ctx.stroke();
      const lg = ctx.createLinearGradient(lx - 200, ly - 60, lx + 200, ly);
      lg.addColorStop(0, '#1f5a2a'); lg.addColorStop(0.5, '#3f9a4a'); lg.addColorStop(1, '#174520');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(lx - 90, ly - 60); ctx.lineTo(lx + 90, ly - 60); ctx.lineTo(lx + 230, ly); ctx.lineTo(lx - 230, ly); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath(); ctx.ellipse(lx, ly, 230, 14, 0, 0, Math.PI * 2); ctx.fill();
      const glow = ctx.createRadialGradient(lx, ly + 40, 20, lx, ly + 300, 700);
      glow.addColorStop(0, 'rgba(255,240,170,0.28)');
      glow.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, ly, W, H - ly);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(this.W / 2, this.H / 2, key).setDepth(0);
  }

  private drawTable(): void {
    const g = this.add.graphics().setDepth(100);
    const { tableW: w, tableL: L } = this.cfg;
    const rw = POOL_VISUAL.railWidth;
    const poly = (pts: [number, number][]) => pts.map(([x, z]) => this.sp(x, z));
    // table body shadow on the floor
    const outer = poly([[-rw - 0.05, -rw - 0.05], [w + rw + 0.05, -rw - 0.05], [w + rw + 0.05, L + rw + 0.05], [-rw - 0.05, L + rw + 0.05]]);
    g.fillStyle(0x000000, 0.35);
    g.beginPath(); g.moveTo(outer[0].sx + 18, outer[0].sy + 26); g.lineTo(outer[1].sx + 18, outer[1].sy + 26); g.lineTo(outer[2].sx + 12, outer[2].sy + 18); g.lineTo(outer[3].sx + 12, outer[3].sy + 18); g.closePath(); g.fillPath();
    // apron (wood below the near rail)
    const near = poly([[-rw, -rw], [w + rw, -rw]]);
    const apronH = Math.max(26, (this.fieldBottom - this.fieldTop) * 0.06);
    g.fillStyle(0x3a2414, 1);
    g.fillRect(near[0].sx, near[0].sy, near[1].sx - near[0].sx, apronH);
    g.fillStyle(0x000000, 0.25);
    g.fillRect(near[0].sx, near[0].sy + apronH * 0.6, near[1].sx - near[0].sx, apronH * 0.4);
    // rails
    const rails = poly([[-rw, -rw], [w + rw, -rw], [w + rw, L + rw], [-rw, L + rw]]);
    g.fillStyle(0x6b3f21, 1);
    g.beginPath(); g.moveTo(rails[0].sx, rails[0].sy); g.lineTo(rails[1].sx, rails[1].sy); g.lineTo(rails[2].sx, rails[2].sy); g.lineTo(rails[3].sx, rails[3].sy); g.closePath(); g.fillPath();
    g.lineStyle(3, 0x2a1608, 1);
    g.strokePath();
    g.fillStyle(0x8a5a30, 0.45);
    g.beginPath(); g.moveTo(rails[0].sx, rails[0].sy); g.lineTo(rails[1].sx, rails[1].sy); g.lineTo(rails[1].sx - 10, rails[1].sy - 6); g.lineTo(rails[0].sx + 10, rails[0].sy - 6); g.closePath(); g.fillPath();
    // cloth
    const cloth = poly([[0, 0], [w, 0], [w, L], [0, L]]);
    g.fillStyle(0x2f8f45, 1);
    g.beginPath(); g.moveTo(cloth[0].sx, cloth[0].sy); g.lineTo(cloth[1].sx, cloth[1].sy); g.lineTo(cloth[2].sx, cloth[2].sy); g.lineTo(cloth[3].sx, cloth[3].sy); g.closePath(); g.fillPath();
    // cloth shading toward the far end and a lamp highlight in the middle
    const mid = poly([[0, L * 0.55], [w, L * 0.55]]);
    g.fillStyle(0x1f6a30, 0.35);
    g.beginPath(); g.moveTo(mid[0].sx, mid[0].sy); g.lineTo(mid[1].sx, mid[1].sy); g.lineTo(cloth[2].sx, cloth[2].sy); g.lineTo(cloth[3].sx, cloth[3].sy); g.closePath(); g.fillPath();
    g.fillStyle(0xffffff, 0.06);
    const c = this.sp(w / 2, L / 2);
    g.fillEllipse(c.sx, c.sy, (w * 0.9) * c.scale, (L * 0.35) * c.scale * 0.45);
    // cushion inner edge
    g.lineStyle(4, 0x1d5a2a, 1);
    g.beginPath(); g.moveTo(cloth[0].sx, cloth[0].sy); g.lineTo(cloth[1].sx, cloth[1].sy); g.lineTo(cloth[2].sx, cloth[2].sy); g.lineTo(cloth[3].sx, cloth[3].sy); g.closePath(); g.strokePath();
    // head string
    const hs = poly([[0, L / 4], [w, L / 4]]);
    g.lineStyle(2, 0xffffff, 0.25);
    g.beginPath(); g.moveTo(hs[0].sx, hs[0].sy); g.lineTo(hs[1].sx, hs[1].sy); g.strokePath();
    // foot spot
    const fs = this.sp(w / 2, L * 0.75);
    g.fillStyle(0xffffff, 0.5);
    g.fillEllipse(fs.sx, fs.sy, 10, 5);
    // diamonds on the rails
    g.fillStyle(0xf5e9c8, 0.9);
    for (let i = 1; i < 8; i++) {
      const zz = (L * i) / 8;
      for (const xx of [-rw / 2, w + rw / 2]) { const p = this.sp(xx, zz); g.fillEllipse(p.sx, p.sy, 7, 4); }
    }
    for (let i = 1; i < 4; i++) {
      const xx = (w * i) / 4;
      for (const zz of [-rw / 2, L + rw / 2]) { const p = this.sp(xx, zz); g.fillEllipse(p.sx, p.sy, 7, 4); }
    }
    // pockets
    for (const p of pockets(this.cfg)) {
      const s = this.sp(p.x, p.z);
      const rx = p.r * s.scale * 0.88;
      const ry = rx * 0.55;
      g.fillStyle(0x000000, 1);
      g.fillEllipse(s.sx, s.sy, rx * 2, ry * 2);
      g.lineStyle(5, 0x2b1a0e, 1);
      g.strokeEllipse(s.sx, s.sy, rx * 2 + 6, ry * 2 + 4);
    }
  }

  private buildCharacters(): void {
    const { tableW: w, tableL: L } = this.cfg;
    const span = this.fieldBottom - this.fieldTop;
    const p = this.sp(-0.55, L * 0.62);
    const height = span * (this.portrait ? 0.3 : 0.34);
    const scale = height / 220;
    const opp = this.state.turn === 0 ? 1 : 0;
    this.opponentSprite = new CharacterSprite(this, Math.max(90 * scale + 10, p.sx), p.sy + 20 * scale, this.players[opp].character, scale);
    this.opponentSprite.setDepth(150).idle();
    // their cue, leaning in their hand
    const cue = this.add.image(this.opponentSprite.x + 44 * scale, this.opponentSprite.y - 95 * scale, 'cue').setOrigin(0.5, 0.5).setAngle(-80).setScale(0.95 * scale * (220 / 520) * 1.6, scale * 0.9).setDepth(151);
    this.opponentSprite.setData('cue', cue);
    // shooter's back, bottom corner (hidden while placing the cue ball)
    const sScale = (span * (this.portrait ? 0.26 : 0.3)) / 220;
    const sx = this.portrait ? this.W - 120 * sScale : this.W - 150 * sScale;
    this.shooterSprite = new CharacterSprite(this, sx, this.fieldBottom + (this.portrait ? 150 : 110) * sScale, this.players[this.state.turn].character, sScale);
    this.shooterSprite.setDepth(800).setPose('back-crouch');
    void w;
  }

  private buildControls(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const kb = this.input.keyboard;
    if (kb) {
      const K = Phaser.Input.Keyboard.KeyCodes;
      this.keys = {
        left: kb.addKey(K.A, false, false), right: kb.addKey(K.D, false, false),
        left2: kb.addKey(K.LEFT, false, false), right2: kb.addKey(K.RIGHT, false, false),
        up: kb.addKey(K.W, false, false), down: kb.addKey(K.S, false, false),
        up2: kb.addKey(K.UP, false, false), down2: kb.addKey(K.DOWN, false, false),
      };
      kb.on('keydown', (e: KeyboardEvent) => {
        if ([' ', 'f', 'F', 'Enter', ','].includes(e.key)) this.tryShoot();
        if (e.key === 'c' || e.key === 'C') this.cyclePocket();
      });
    }
    const barY = P ? H - 150 : H - 92;
    const panel = this.add.graphics().setDepth(900);
    const strip = (x: number, y: number, w: number, h: number) => {
      panel.fillStyle(0x0d1f10, 0.82);
      panel.fillRoundedRect(x, y, w, h, 16);
      panel.lineStyle(3, THEME.accent, 0.85);
      panel.strokeRoundedRect(x, y, w, h, 16);
    };
    // Aim hint
    const hw = P ? 230 : 300;
    strip(24, barY - 60, hw, 120);
    this.add.text(24 + hw / 2, barY - 46, 'AIM', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.hintText = this.add.text(24 + hw / 2, barY - 10, this.useTouch ? 'Drag on the table' : 'Drag / A D keys', textStyle(21, '#ffffff', { align: 'center', wordWrap: { width: hw - 20 } })).setOrigin(0.5, 0).setDepth(901);
    // Power bar
    const pw = P ? W - 24 - hw - 24 - 24 - 300 : 560;
    const px = P ? 24 + hw + 24 : W / 2 - pw / 2 - 40;
    strip(px - 16, barY - 60, pw + 32, 120);
    this.add.text(px + pw / 2, barY - 46, 'SHOT POWER', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.powerMeter = new Meter(this, px, barY - 8, pw, 30, { depth: 901, bg: 0x2a2a2a, fg: 0xf5c518 });
    this.powerText = this.add.text(px + pw / 2, barY + 36, '', textStyle(20, '#ffffff')).setOrigin(0.5).setDepth(902);
    const pz = this.add.zone(px + pw / 2, barY + 6, pw + 30, 90).setOrigin(0.5).setInteractive().setDepth(903);
    const setFromPointer = (p: Phaser.Input.Pointer) => { this.setPower((p.x - px) / pw); };
    pz.on('pointerdown', (p: Phaser.Input.Pointer) => { this.dragPower = true; setFromPointer(p); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => { if (this.dragPower && p.isDown) setFromPointer(p); });
    this.input.on('pointerup', () => { this.dragPower = false; });
    this.input.on('pointerupoutside', () => { this.dragPower = false; });
    this.setPower(this.power);
    // Buttons (right)
    const bw = P ? 280 : 300;
    const bx = W - 24 - bw / 2;
    this.shootBtn = makeButton(this, bx, barY, 'SHOOT', () => this.tryShoot(), { width: bw, height: 110, fontSize: 42, depth: 900 });
    this.callBtn = makeButton(this, P ? bx : bx - bw - 20, P ? barY - 125 : barY, 'CALL POCKET', () => this.cyclePocket(), { width: P ? bw : 240, height: P ? 80 : 110, fontSize: 24, depth: 900, color: 0x4fc3f7 });
    this.callBtn.setVisible(false);
    this.doneBtn = makeButton(this, P ? bx : bx - bw - 20, P ? barY - 125 : barY, 'DONE PLACING', () => this.finishPlacing(), { width: P ? bw : 240, height: P ? 80 : 110, fontSize: 24, depth: 900, color: 0x8bc34a });
    this.doneBtn.setVisible(false);
    this.add.text(bx, barY + 66, this.useTouch ? 'tap' : 'SPACE / F  •  P2: ENTER / ,', textStyle(17, '#fff3c4')).setOrigin(0.5).setDepth(901);
    // Pointer handling on the table area
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.fieldTop - 30 || p.y > this.fieldBottom + 40 || this.dragPower) return;
      if (!this.isHumanTurn()) return;
      if (this.phase === 'placing') { this.dragging = true; this.tryPlace(p); return; }
      if (this.phase === 'aiming') {
        if (needsCallUi(this.state) && this.tapPocket(p)) return;
        this.dragging = true;
        this.aimAt(p);
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      if (this.phase === 'placing') this.tryPlace(p);
      else if (this.phase === 'aiming') this.aimAt(p);
    });
    const up = () => { this.dragging = false; };
    this.input.on('pointerup', up);
    this.input.on('pointerupoutside', up);
    function needsCallUi(s: PoolGameState): boolean { return !s.breakPending && onTheEight(s); }
  }

  // ---------- Input helpers ----------
  private isHumanTurn(): boolean { return !this.isAI(this.state.turn); }

  private setPower(v: number): void {
    this.power = Phaser.Math.Clamp(v, 0.08, 1);
    this.powerMeter.set(this.power);
    this.powerText.setText(`${Math.round(this.power * 100)}%`);
  }

  private aimAt(p: Phaser.Input.Pointer): void {
    const t = this.proj.unprojectGround(p.x, p.y);
    const cue = this.cueBall();
    if (!t || !cue) return;
    const dx = t.x - cue.x;
    const dz = t.z - cue.z;
    if (Math.hypot(dx, dz) < 0.02) return;
    this.aimAngle = Math.atan2(dz, dx);
  }

  private tryPlace(p: Phaser.Input.Pointer): void {
    const t = this.proj.unprojectGround(p.x, p.y);
    if (!t) return;
    const r = this.cfg.ballR;
    const x = Phaser.Math.Clamp(t.x, r, this.cfg.tableW - r);
    const z = Phaser.Math.Clamp(t.z, r, this.cfg.tableL - r);
    if (canPlace(this.state.balls, x, z, this.cfg)) {
      const s = placeCueBall(this.state, x, z, this.cfg);
      if (s) { this.state = s; this.renderBalls(this.state.balls); }
    }
  }

  private tapPocket(p: Phaser.Input.Pointer): boolean {
    for (const pk of pockets(this.cfg)) {
      const s = this.sp(pk.x, pk.z);
      if (Math.hypot(p.x - s.sx, p.y - s.sy) < 70) {
        this.state = callPocket(this.state, pk.index);
        Audio.sfx('click');
        this.refreshHud();
        return true;
      }
    }
    return false;
  }

  private cyclePocket(): void {
    if (this.phase !== 'aiming' || !this.isHumanTurn() || !onTheEight(this.state)) return;
    const next = this.state.calledPocket === null ? nearestPocketToEight(this.state, this.cfg) : (this.state.calledPocket + 1) % 6;
    this.state = callPocket(this.state, next);
    Audio.sfx('click');
    this.refreshHud();
  }

  private cueBall(): Ball | undefined { return this.state.balls.find((b) => b.id === 0); }

  // ---------- Turn flow ----------
  private startTurn(): void {
    if (this.finished) return;
    const s = this.state;
    this.setTurn(s.turn);
    this.swapSprites();
    this.refreshHud();
    if (s.winner !== null) return this.endMatch();
    if (s.pending) return this.showPending();
    if (s.ballInHand) {
      if (this.isHumanTurn()) {
        // put the cue ball somewhere visible to start dragging from
        const hs = headSpot(this.cfg);
        let placed = placeCueBall(s, hs.x, hs.z, this.cfg);
        if (!placed) {
          for (let tries = 0; tries < 200 && !placed; tries++) placed = placeCueBall(s, this.cfg.ballR + Math.random() * (this.cfg.tableW - 2 * this.cfg.ballR), this.cfg.ballR + Math.random() * (this.cfg.tableL - 2 * this.cfg.ballR), this.cfg);
        }
        if (placed) this.state = placed;
        this.phase = 'placing';
        this.renderBalls(this.state.balls);
        this.doneBtn.setVisible(true);
        this.shootBtn.setVisible(false);
        this.shooterSprite?.setVisible(false);
        this.hintText.setText('Drag the cue ball to place it');
        this.setSub(`${this.name(s.turn)}: ball in hand — drag the cue ball, then DONE`);
        return;
      }
      const pos = choosePlacement(s, this.cfg);
      const placed = placeCueBall(s, pos.x, pos.z, this.cfg);
      if (placed) this.state = placed;
      this.renderBalls(this.state.balls);
    }
    this.beginAiming();
  }

  private finishPlacing(): void {
    if (this.phase !== 'placing') return;
    this.state = { ...this.state, ballInHand: false };
    this.doneBtn.setVisible(false);
    this.shootBtn.setVisible(true);
    this.shooterSprite?.setVisible(true);
    this.beginAiming();
  }

  private beginAiming(): void {
    const s = this.state;
    this.phase = 'aiming';
    this.shootBtn.setVisible(true);
    this.doneBtn.setVisible(false);
    const cue = this.cueBall();
    if (cue) {
      // default aim: toward the nearest legal ball
      const target = s.balls.filter((b) => b.active && b.id !== 0).sort((a, b) => Math.hypot(a.x - cue.x, a.z - cue.z) - Math.hypot(b.x - cue.x, b.z - cue.z))[0];
      if (target && !this.isAI(s.turn)) this.aimAngle = Math.atan2(target.z - cue.z, target.x - cue.x);
      if (s.breakPending) { this.aimAngle = Math.PI / 2 + (Math.random() - 0.5) * 0.02; this.setPower(0.9); }
    }
    if (!s.breakPending && onTheEight(s) && s.calledPocket === null && this.isHumanTurn()) {
      this.state = callPocket(s, nearestPocketToEight(s, this.cfg));
    }
    this.hintText.setText(this.useTouch ? 'Drag on the table to aim' : 'Drag / A D keys to aim');
    this.refreshHud();
    this.cue.setVisible(true);
    if (this.isAI(s.turn)) this.runAi();
  }

  private runAi(): void {
    this.phase = 'idle';
    this.setSub(`${this.name(this.state.turn)} is lining up a shot...`);
    this.time.delayedCall(POOL_VISUAL.aiThinkMs, () => {
      if (this.finished) return;
      const shot = chooseShot(this.state, this.ai, this.cfg);
      if (shot.calledPocket !== null) this.state = callPocket(this.state, shot.calledPocket);
      this.refreshHud();
      this.phase = 'aiming';
      // sweep the cue toward the chosen angle for feel
      const start = this.aimAngle;
      let delta = shot.angle - start;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      this.setPower(shot.power);
      this.aiAimTween = this.tweens.addCounter({
        from: 0, to: 1, duration: 650, ease: 'Sine.InOut',
        onUpdate: (tw) => { this.aimAngle = start + delta * (tw.getValue() ?? 1); },
        onComplete: () => { this.aimAngle = shot.angle; this.time.delayedCall(250, () => this.shoot()); },
      });
    });
  }

  private tryShoot(): void {
    if (this.phase !== 'aiming' || !this.isHumanTurn()) return;
    if (needsCall(this.state)) { this.state = callPocket(this.state, nearestPocketToEight(this.state, this.cfg)); }
    this.shoot();
  }

  private shoot(): void {
    if (this.phase !== 'aiming') return;
    const cue = this.cueBall();
    if (!cue || !cue.active) return;
    this.phase = 'rolling';
    this.shootBtn.setVisible(false);
    this.callBtn.setVisible(false);
    this.guide.clear();
    this.sim = new PoolSim(this.state.balls, this.cfg);
    this.simStruck = false;
    this.soundIdx = 0;
    const speed = this.power * this.cfg.maxShotSpeed;
    // cue strike animation: pull back then snap forward
    this.tweens.add({
      targets: this, pullback: 40 + this.power * 60, duration: 180, ease: 'Quad.Out', yoyo: true,
      onComplete: () => {
        this.pullback = 0;
        this.cue.setVisible(false);
        Audio.sfx('cueHit');
        this.sim?.strike(speed, this.aimAngle);
        this.simStruck = true;
      },
    });
    this.shooterSprite?.setPose('back-push');
    this.time.delayedCall(500, () => this.shooterSprite?.setPose('back-crouch'));
    this.setSub(`${this.name(this.state.turn)} shoots...`);
  }

  private onSettled(): void {
    if (!this.sim) return;
    const prev = this.state;
    const next = applyShotResult(prev, this.sim.balls, this.sim.events, this.cfg);
    this.sim = null;
    this.state = next;
    this.renderBalls(next.balls);
    this.refreshHud();
    const me = prev.turn;
    if (next.winner !== null) {
      this.phase = 'done';
      this.setSub(next.message);
      if (next.winner === me) { this.announce('EIGHT BALL!', { color: '#f5c518' }); confetti(this, this.W / 2, this.H / 2, 60); }
      else this.announce('EIGHT BALL DOWN', { color: '#ef5350', sub: next.message });
      this.time.delayedCall(1400, () => this.endMatch());
      return;
    }
    if (next.message.startsWith('Foul') || next.message.includes('Scratch')) {
      Audio.sfx('whistle');
      this.announce('FOUL', { color: '#ef5350', size: 64, sub: next.message.replace(/^Foul: /, '') });
      if (Math.random() < 0.5) this.react(me, 'groan', this.W / 2, this.fieldTop + 160);
    } else if (next.turn === me && !next.pending) {
      if (this.sim === null && next.shots > 0 && !prev.breakPending) {
        const pocketedOwn = prev.balls.filter((b) => b.active).length - next.balls.filter((b) => b.active).length;
        if (pocketedOwn > 0 && Math.random() < 0.4) this.react(me, 'cheer', this.W / 2, this.fieldTop + 160);
      }
    }
    this.setSub(next.message);
    this.phase = 'idle';
    this.time.delayedCall(1100, () => this.startTurn());
  }

  private showPending(): void {
    const s = this.state;
    if (!s.pending) return;
    this.phase = 'pending';
    const by = s.pending.by;
    this.setTurn(by);
    if (this.isAI(by)) {
      this.time.delayedCall(900, () => {
        if (!this.state.pending) return;
        if (this.state.pending.type === 'chooseGroup') {
          const solidsLeft = remaining(this.state.balls, 'solid');
          const stripesLeft = remaining(this.state.balls, 'stripe');
          this.state = chooseGroup(this.state, solidsLeft <= stripesLeft ? 'solid' : 'stripe');
        } else {
          this.state = resolveIllegalBreak(this.state, 'accept', this.cfg);
        }
        this.renderBalls(this.state.balls);
        this.setSub(this.state.message);
        this.time.delayedCall(700, () => this.startTurn());
      });
      return;
    }
    const W = this.W, H = this.H;
    const dim = makeDim(this, 0.45).setDepth(2000);
    const panel = makePanel(this, W / 2, H / 2, Math.min(W - 80, 900), 320).setDepth(2001);
    const title = s.pending.type === 'chooseGroup' ? `${this.name(by)}: both groups dropped. Pick your group.` : `${this.name(by)}: illegal break. Accept the table (ball in hand) or rerack?`;
    const t = this.add.text(W / 2, H / 2 - 100, title, displayStyle(28, '#f5c518', { align: 'center', wordWrap: { width: Math.min(W - 140, 820) } })).setOrigin(0.5).setDepth(2002);
    const done = (next: PoolGameState) => {
      this.modal.forEach((o) => o.destroy());
      this.modal = [];
      this.state = next;
      this.renderBalls(this.state.balls);
      this.setSub(this.state.message);
      this.time.delayedCall(400, () => this.startTurn());
    };
    const b1 = s.pending.type === 'chooseGroup'
      ? makeButton(this, W / 2 - 200, H / 2 + 40, 'SOLIDS', () => done(chooseGroup(this.state, 'solid')), { width: 340, height: 100, fontSize: 32, depth: 2002 })
      : makeButton(this, W / 2 - 200, H / 2 + 40, 'ACCEPT TABLE', () => done(resolveIllegalBreak(this.state, 'accept', this.cfg)), { width: 340, height: 100, fontSize: 28, depth: 2002 });
    const b2 = s.pending.type === 'chooseGroup'
      ? makeButton(this, W / 2 + 200, H / 2 + 40, 'STRIPES', () => done(chooseGroup(this.state, 'stripe')), { width: 340, height: 100, fontSize: 32, depth: 2002, color: THEME.accent2 })
      : makeButton(this, W / 2 + 200, H / 2 + 40, 'RERACK', () => done(resolveIllegalBreak(this.state, 'rerack', this.cfg)), { width: 340, height: 100, fontSize: 28, depth: 2002, color: THEME.accent2 });
    this.modal = [dim, panel, t, b1, b2];
  }

  private endMatch(): void {
    if (this.finished) return;
    this.phase = 'done';
    const w = this.state.winner!;
    const l = w === 0 ? 1 : 0;
    const left = (slot: 0 | 1) => { const g = this.state.groups[slot]; return g ? `${remaining(this.state.balls, g)} ${g === 'solid' ? 'solids' : 'stripes'} left` : 'open table'; };
    this.finishMatch({
      winnerSlot: w,
      summary: this.state.message,
      scores: [left(0), left(1)].map((t, i) => (i === w ? 'WON on the 8' : t)) as [string, string],
    });
    void l;
  }

  private swapSprites(): void {
    const opp = this.state.turn === 0 ? 1 : 0;
    if (this.opponentSprite && this.opponentSprite.character.id !== this.players[opp].character.id) {
      const { x, y, sprite } = this.opponentSprite;
      const cue = this.opponentSprite.getData('cue') as Phaser.GameObjects.Image;
      const scale = sprite.scale;
      this.opponentSprite.destroy();
      this.opponentSprite = new CharacterSprite(this, x, y, this.players[opp].character, scale);
      this.opponentSprite.setDepth(150).idle();
      this.opponentSprite.setData('cue', cue);
    }
    if (this.shooterSprite && this.shooterSprite.character.id !== this.players[this.state.turn].character.id) {
      const { x, y, sprite } = this.shooterSprite;
      const scale = sprite.scale;
      this.shooterSprite.destroy();
      this.shooterSprite = new CharacterSprite(this, x, y, this.players[this.state.turn].character, scale);
      this.shooterSprite.setDepth(800).setPose('back-crouch');
    }
  }

  // ---------- HUD ----------
  private refreshHud(): void {
    const s = this.state;
    this.groupIcons.forEach((i) => i.destroy());
    this.groupIcons = [];
    for (const slot of [0, 1] as const) {
      const g = s.groups[slot];
      if (!g) {
        this.setScore(slot, s.open ? 'OPEN TABLE' : '—');
        continue;
      }
      const left = remaining(s.balls, g);
      const onEight = left === 0;
      this.setScore(slot, `${g === 'solid' ? 'SOLIDS' : 'STRIPES'} • ${onEight ? 'on the 8' : `${left} left`}`);
      const rect = this.panelRect(slot);
      const ids = s.balls.filter((b) => b.active && groupOf(b.id) === g).map((b) => b.id);
      const list = onEight ? [8] : ids;
      list.forEach((id, i) => {
        const img = this.add.image(rect.x + 128 + i * 28, rect.y + 98, `pool-${id}`).setScale(0.42).setDepth(9001);
        this.hud.add(img);
        this.groupIcons.push(img);
      });
    }
    let sub = `${this.name(s.turn)}'s shot`;
    if (s.breakPending) sub += ' — BREAK';
    else if (s.ballInHand) sub += ' — ball in hand';
    else if (!s.open && onTheEight(s)) sub += ` — 8 ball, called: ${s.calledPocket === null ? '(tap a pocket)' : POCKET_NAMES[s.calledPocket]}`;
    else if (s.open) sub += ' — open table';
    this.setSub(sub);
    this.callBtn.setVisible(this.phase === 'aiming' && this.isHumanTurn() && !s.breakPending && onTheEight(s));
  }

  // ---------- Rendering ----------
  private renderBalls(balls: Ball[]): void {
    const d = this.cfg.ballR * 2 * POOL_VISUAL.ballVisualScale;
    for (const b of balls) {
      const img = this.ballImgs.get(b.id)!;
      const sh = this.ballShadows.get(b.id)!;
      if (!b.active) { img.setVisible(false); sh.setVisible(false); continue; }
      const p = this.sp(b.x, b.z);
      const px = Math.max(10, d * p.scale);
      img.setVisible(true).setPosition(p.sx, p.sy - px * 0.42).setScale(px / 52).setDepth(400 + (this.cfg.tableL - b.z) * 40);
      sh.setVisible(true).setPosition(p.sx + px * 0.12, p.sy + px * 0.05).setScale((px / 128) * 1.3, (px / 128) * 0.6).setDepth(399 + (this.cfg.tableL - b.z) * 40);
    }
  }

  private drawGuide(): void {
    this.guide.clear();
    this.pocketMarks.clear();
    const s = this.state;
    const cue = this.cueBall();
    if (this.phase !== 'aiming' || !cue || !cue.active) { this.cue.setVisible(false); return; }
    const d = this.cfg.ballR * 2 * POOL_VISUAL.ballVisualScale;
    const c = this.sp(cue.x, cue.z);
    const px = Math.max(10, d * c.scale);
    // cue stick behind the cue ball
    const back = this.sp(cue.x - Math.cos(this.aimAngle) * 0.4, cue.z - Math.sin(this.aimAngle) * 0.4);
    const ang = Math.atan2(back.sy - c.sy, back.sx - c.sx);
    const cueScale = (1.45 * c.scale) / 520;
    const gap = px * 0.6 + this.pullback;
    this.cue.setVisible(true).setPosition(c.sx + Math.cos(ang) * gap, c.sy - px * 0.42 + Math.sin(ang) * gap).setRotation(ang + Math.PI).setScale(cueScale, Math.max(cueScale * 0.9, 0.35));
    // aim line to the ghost ball, then predicted object direction
    const g = aimGuide(s.balls, this.aimAngle, this.cfg);
    const e = this.sp(g.end.x, g.end.z);
    this.guide.lineStyle(3, 0x4ff0ff, 0.9);
    this.dashed(c.sx, c.sy - px * 0.42, e.sx, e.sy - Math.max(10, d * e.scale) * 0.42, 14, 10);
    const epx = Math.max(10, d * e.scale);
    this.guide.lineStyle(2, 0xffffff, 0.9);
    this.guide.strokeCircle(e.sx, e.sy - epx * 0.42, epx / 2);
    if (g.hitBall && g.objectDir) {
      const t = this.sp(g.hitBall.x + g.objectDir.x * 0.35, g.hitBall.z + g.objectDir.z * 0.35);
      const h = this.sp(g.hitBall.x, g.hitBall.z);
      const hpx = Math.max(10, d * h.scale);
      this.guide.lineStyle(3, 0xffffff, 0.6);
      this.guide.beginPath();
      this.guide.moveTo(h.sx, h.sy - hpx * 0.42);
      this.guide.lineTo(t.sx, t.sy - hpx * 0.42);
      this.guide.strokePath();
    }
    // called pocket highlight
    if (!s.breakPending && onTheEight(s)) {
      for (const pk of pockets(this.cfg)) {
        const p = this.sp(pk.x, pk.z);
        const rx = pk.r * p.scale * 1.3;
        const called = s.calledPocket === pk.index;
        this.pocketMarks.lineStyle(called ? 5 : 2, called ? 0xf5c518 : 0xffffff, called ? 1 : 0.45);
        this.pocketMarks.strokeEllipse(p.sx, p.sy, rx * 2, rx * 1.1);
      }
    }
  }

  private dashed(x1: number, y1: number, x2: number, y2: number, dash: number, gap: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = (x2 - x1) / (len || 1);
    const ny = (y2 - y1) / (len || 1);
    let t = 0;
    this.guide.beginPath();
    while (t < len) {
      const a = t;
      const b = Math.min(len, t + dash);
      this.guide.moveTo(x1 + nx * a, y1 + ny * a);
      this.guide.lineTo(x1 + nx * b, y1 + ny * b);
      t += dash + gap;
    }
    this.guide.strokePath();
  }

  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished) return;
    const dt = Math.min(0.1, dtMs / 1000);
    if (this.phase === 'aiming' && this.isHumanTurn()) {
      const kd = (a: string, b: string) => this.keys[a]?.isDown || this.keys[b]?.isDown;
      const sp = (POOL_VISUAL.aimKeySpeed * Math.PI) / 180;
      if (kd('left', 'left2')) this.aimAngle += sp * dt;
      if (kd('right', 'right2')) this.aimAngle -= sp * dt;
      if (kd('up', 'up2')) this.setPower(this.power + 0.6 * dt);
      if (kd('down', 'down2')) this.setPower(this.power - 0.6 * dt);
    }
    if (this.phase === 'rolling' && this.sim && this.simStruck) {
      const before = new Set(this.sim.balls.filter((b) => b.active).map((b) => b.id));
      this.sim.step(dt);
      // sounds (throttled)
      const now = this.time.now;
      for (; this.soundIdx < this.sim.events.sounds.length; this.soundIdx++) {
        const s = this.sim.events.sounds[this.soundIdx];
        if ((this.lastSound[s] ?? 0) + 70 < now) {
          Audio.sfx(s === 'clack' ? 'ballClack' : s === 'cushion' ? 'cushion' : 'pocket');
          this.lastSound[s] = now;
        }
      }
      for (const b of this.sim.balls) {
        if (before.has(b.id) && !b.active) {
          const img = this.ballImgs.get(b.id)!;
          this.tweens.add({ targets: img, scale: 0, alpha: 0, duration: 220, onComplete: () => { img.setVisible(false).setAlpha(1); } });
          this.ballShadows.get(b.id)!.setVisible(false);
        }
      }
      this.renderBalls(this.sim.balls.filter((b) => b.active));
      if (this.sim.settled) this.onSettled();
    }
    this.drawGuide();
  }
}
