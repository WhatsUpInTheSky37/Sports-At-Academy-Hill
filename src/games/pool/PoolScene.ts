import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, makePanel, makeDim, confetti } from '../../core/ui';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintLamp, roundRect, shade, rng } from '../../art/environment';
import { paintBraidedRug, paintCinderWallHD, paintConcreteHD, paintCouchHD, paintJoists, paintPennantHD, paintPipes, paintPosterHD, paintRoomGrade, paintShelfHD, paintStairsHD, paintWasherDryer } from './basementArt';
import { DEFAULT_POOL, NO_SPIN, PoolSim, aimGuide, canPlace, headSpot, pockets, type Ball, type PoolConfig, type Spin } from './physics';
import { applyShotResult, callPocket, chooseGroup, createGame, groupOf, needsCall, onTheEight, placeCueBall, remaining, resolveIllegalBreak, POCKET_NAMES, type PoolGameState } from './rules';
import { chooseShot, choosePlacement, nearestPocketToEight } from './ai';

/** Visual tuning for the billiards scene. */
export const POOL_VISUAL = {
  /**
   * Near-rail width as a fraction of screen width, per orientation. In landscape the table is seen
   * from the side (its 9 ft length runs across the screen); in portrait from the head end.
   */
  nearWidthFrac: { landscape: 0.8, portrait: 0.68 },
  /** Near-rail width divided by far-rail width (perspective strength); close to 1 reads as regulation 2:1. */
  depthRatio: { landscape: 1.22, portrait: 1.2 },
  /** On-screen cue length in metres (short enough that the butt stays on screen to grab). */
  cueLength: 0.9,
  /** Largest strike offset from the cue-ball centre (fraction of the radius) before a miscue. */
  maxStrikeOffset: 0.8,
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
  /** Landscape shows the table side-on: table x maps to screen depth and table z runs across. */
  private swap = false;
  private spin: Spin = { ...NO_SPIN };
  private spinGfx!: Phaser.GameObjects.Graphics;
  private spinLabel!: Phaser.GameObjects.Text;
  private spinBox = { x: 0, y: 0, r: 44, sx: 0, sy: 0, sh: 90 };
  private uiDrag: 'none' | 'spin' | 'lift' = 'none';
  private lastTurnSlot: 0 | 1 | null = null;

  create(): void {
    this.setupShell({ music: 'basement' });
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom + (P ? 30 : 16);
    this.fieldBottom = P ? H - 290 : H - 165;
    this.buildCamera();
    this.paintBackdrop();
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
  /** Table coords -> view coords (what the projector sees). */
  private tv(x: number, z: number): { vx: number; vz: number } {
    return this.swap ? { vx: z, vz: x } : { vx: x, vz: z };
  }
  private get vw(): number { return this.swap ? this.cfg.tableL : this.cfg.tableW; }
  private get vL(): number { return this.swap ? this.cfg.tableW : this.cfg.tableL; }
  /** Screen -> table coords on the cloth plane. */
  private tableAt(sx: number, sy: number): { x: number; z: number } | null {
    const t = this.proj.unprojectGround(sx, sy);
    if (!t) return null;
    return this.swap ? { x: t.z, z: t.x } : { x: t.x, z: t.z };
  }
  private depthOf(x: number, z: number): number { return this.vL - this.tv(x, z).vz; }

  private buildCamera(): void {
    const W = this.W, P = this.portrait;
    this.swap = !P;
    const w = this.vw, L = this.vL;
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
    const v = this.tv(x, z);
    return this.proj.project(v.vx, 0, v.vz);
  }
  /** View-space projection (for the table outline, which is drawn in view coordinates). */
  private vsp(vx: number, vz: number): { sx: number; sy: number; scale: number } {
    return this.proj.project(vx, 0, vz);
  }

  private paintBackdrop(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const key = `pool-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const wallBase = this.fieldTop + (P ? 90 : 40);
      const joistH = Math.max(60, wallBase * 0.14);
      const lampX = W / 2, lampY = this.fieldTop - (P ? 60 : 30);
      // walls, joists, pipes
      paintCinderWallHD(ctx, 0, joistH - 6, W, wallBase - joistH + 6, { seed: 41, lights: [{ x: lampX, y: lampY + 120, r: W * 0.55, strength: 0.3 }, { x: W * 0.18, y: wallBase - 120, r: 420, strength: 0.25 }] });
      paintJoists(ctx, 0, 0, W, joistH, P ? 150 : 180);
      paintPipes(ctx, 0, W, joistH + 18, { copper: true, thickness: 9 });
      paintPipes(ctx, 0, W, joistH + 40, { thickness: 14 });
      // floor
      paintConcreteHD(ctx, 0, wallBase, W, H - wallBase, 31);
      paintBraidedRug(ctx, W * 0.12, wallBase + 80, P ? 120 : 170, P ? 34 : 44, 7);
      // stairs on the left
      paintStairsHD(ctx, P ? -60 : 30, wallBase - 6, P ? 130 : 180, 7, 1);
      // couch on the far wall, lamp, poster, pennant
      const cw = Math.min(520, W * 0.32);
      paintCouchHD(ctx, W / 2 - cw / 2, wallBase - 150, cw, 150, '#4f6a46');
      paintLamp(ctx, W / 2 + cw / 2 + 90, wallBase - 70, 1);
      paintPosterHD(ctx, W / 2 + cw / 2 + 170, wallBase - 340, 160, 120, '#2e4a7a', ['ACADEMY', 'HILL']);
      paintPennantHD(ctx, W / 2 - cw / 2 - 270, wallBase - 330, 210, 72, '#f5c518', 'ACADEMY HILL');
      // shelves and the washer/dryer in the right corner
      const shW = P ? 160 : 240;
      paintShelfHD(ctx, W - shW - (P ? 10 : 40), wallBase - 330, shW, 330, 50);
      if (!P) paintWasherDryer(ctx, 400, wallBase - 104, 1);
      // hanging green table lamp above the table
      ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(lampX, 0); ctx.lineTo(lampX, lampY - 60); ctx.stroke();
      const lg = ctx.createLinearGradient(lampX - 230, lampY - 60, lampX + 230, lampY);
      lg.addColorStop(0, '#123a1a'); lg.addColorStop(0.35, '#2f8a3f'); lg.addColorStop(0.55, '#6fcf7a'); lg.addColorStop(1, '#0f3016');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(lampX - 90, lampY - 60); ctx.lineTo(lampX + 90, lampY - 60); ctx.lineTo(lampX + 230, lampY); ctx.lineTo(lampX - 230, lampY); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#b8862b'; ctx.fillRect(lampX - 232, lampY - 3, 464, 6);
      const under = ctx.createLinearGradient(0, lampY, 0, lampY + 16);
      under.addColorStop(0, '#fff6c0'); under.addColorStop(1, 'rgba(255,246,192,0)');
      ctx.fillStyle = under;
      ctx.beginPath(); ctx.ellipse(lampX, lampY + 2, 230, 16, 0, 0, Math.PI * 2); ctx.fill();
      const glow = ctx.createRadialGradient(lampX, lampY + 40, 20, lampX, lampY + 300, 760);
      glow.addColorStop(0, 'rgba(255,240,170,0.3)');
      glow.addColorStop(1, 'rgba(255,240,170,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, lampY, W, H - lampY);
      // the table itself (static, so it lives in the backdrop texture)
      this.paintTable(ctx);
      paintRoomGrade(ctx, W, H, [{ x: lampX, y: this.fieldTop + (this.fieldBottom - this.fieldTop) * 0.45, r: W * 0.6, strength: 0.3 }, { x: W / 2 + cw / 2 + 90, y: wallBase - 170, r: 360, strength: 0.3 }], 0.45);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(this.W / 2, this.H / 2, key).setDepth(0);
  }

  /** Paints the table (rails, apron, felt, pockets, sights) in perspective onto the backdrop canvas. */
  private paintTable(ctx: CanvasRenderingContext2D): void {
    const { tableW: tw, tableL: tL } = this.cfg;
    // the outline is laid out in view space (w across the screen, L into it); table features map through sp()
    const w = this.vw, L = this.vL;
    const rw = POOL_VISUAL.railWidth;
    const poly = (pts: [number, number][]) => pts.map(([x, z]) => this.vsp(x, z));
    const path = (pts: { sx: number; sy: number }[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy))); ctx.closePath(); };
    // floor shadow
    const outer = poly([[-rw - 0.05, -rw - 0.05], [w + rw + 0.05, -rw - 0.05], [w + rw + 0.05, L + rw + 0.05], [-rw - 0.05, L + rw + 0.05]]);
    const midX = outer[0].sx + (outer[1].sx - outer[0].sx) / 2;
    const sh = ctx.createRadialGradient(midX, outer[0].sy + 40, 20, midX, outer[0].sy + 40, (outer[1].sx - outer[0].sx) * 0.7);
    sh.addColorStop(0, 'rgba(0,0,0,0.45)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sh;
    path([{ sx: outer[0].sx - 30, sy: outer[0].sy + 50 }, { sx: outer[1].sx + 30, sy: outer[1].sy + 50 }, { sx: outer[2].sx + 14, sy: outer[2].sy + 22 }, { sx: outer[3].sx - 14, sy: outer[3].sy + 22 }]); ctx.fill();
    // apron (wood below the near rail) with grain
    const near = poly([[-rw, -rw], [w + rw, -rw]]);
    const apronH = Math.max(26, (this.fieldBottom - this.fieldTop) * 0.06);
    const ag = ctx.createLinearGradient(0, near[0].sy, 0, near[0].sy + apronH);
    ag.addColorStop(0, '#5a3418'); ag.addColorStop(0.5, '#3e2210'); ag.addColorStop(1, '#22120a');
    ctx.fillStyle = ag;
    ctx.fillRect(near[0].sx, near[0].sy, near[1].sx - near[0].sx, apronH);
    ctx.strokeStyle = 'rgba(255,200,140,0.08)'; ctx.lineWidth = 1;
    for (let k = 3; k < apronH; k += 5) { ctx.beginPath(); ctx.moveTo(near[0].sx, near[0].sy + k); ctx.lineTo(near[1].sx, near[0].sy + k + 1); ctx.stroke(); }
    // rails with wood-grain gradient (lit from the lamp above)
    const rails = poly([[-rw, -rw], [w + rw, -rw], [w + rw, L + rw], [-rw, L + rw]]);
    const rg = ctx.createLinearGradient(0, rails[2].sy, 0, rails[0].sy);
    rg.addColorStop(0, '#4a2a12'); rg.addColorStop(0.5, '#7a4a24'); rg.addColorStop(0.8, '#8c5a2e'); rg.addColorStop(1, '#5e3618');
    ctx.fillStyle = rg;
    path(rails); ctx.fill();
    ctx.save(); path(rails); ctx.clip();
    ctx.strokeStyle = 'rgba(40,20,5,0.25)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const t = i / 70;
      const a = { sx: rails[3].sx + (rails[0].sx - rails[3].sx) * t, sy: rails[3].sy + (rails[0].sy - rails[3].sy) * t };
      const b = { sx: rails[2].sx + (rails[1].sx - rails[2].sx) * t, sy: rails[2].sy + (rails[1].sy - rails[2].sy) * t };
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.bezierCurveTo(a.sx + (b.sx - a.sx) * 0.3, a.sy + 3, a.sx + (b.sx - a.sx) * 0.7, b.sy - 3, b.sx, b.sy); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,10,4,0.8)'; ctx.lineWidth = 3; path(rails); ctx.stroke();
    ctx.fillStyle = 'rgba(255,220,170,0.22)';
    path([rails[0], rails[1], { sx: rails[1].sx - 10, sy: rails[1].sy - 7 }, { sx: rails[0].sx + 10, sy: rails[0].sy - 7 }]); ctx.fill();
    // felt: base, lamp pool, weave
    const cloth = poly([[0, 0], [w, 0], [w, L], [0, L]]);
    const fg = ctx.createLinearGradient(0, cloth[2].sy, 0, cloth[0].sy);
    fg.addColorStop(0, '#1f6e30'); fg.addColorStop(0.5, '#2d8c42'); fg.addColorStop(1, '#2a7f3c');
    ctx.fillStyle = fg;
    path(cloth); ctx.fill();
    ctx.save(); path(cloth); ctx.clip();
    const c = this.vsp(w / 2, L / 2);
    const pool = ctx.createRadialGradient(c.sx, c.sy, 10, c.sx, c.sy, (Math.min(w, L) * 1.3) * c.scale);
    pool.addColorStop(0, 'rgba(255,250,200,0.2)'); pool.addColorStop(0.6, 'rgba(255,250,200,0.05)'); pool.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.strokeStyle = 'rgba(0,0,0,0.035)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = { sx: cloth[3].sx + (cloth[0].sx - cloth[3].sx) * t, sy: cloth[3].sy + (cloth[0].sy - cloth[3].sy) * t };
      const b = { sx: cloth[2].sx + (cloth[1].sx - cloth[2].sx) * t, sy: cloth[2].sy + (cloth[1].sy - cloth[2].sy) * t };
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const a = { sx: cloth[0].sx + (cloth[1].sx - cloth[0].sx) * t, sy: cloth[0].sy };
      const b = { sx: cloth[3].sx + (cloth[2].sx - cloth[3].sx) * t, sy: cloth[3].sy };
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(10,50,20,0.9)'; ctx.lineWidth = 5; path(cloth); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,220,140,0.25)'; ctx.lineWidth = 1.5;
    path([{ sx: cloth[0].sx + 3, sy: cloth[0].sy - 3 }, { sx: cloth[1].sx - 3, sy: cloth[1].sy - 3 }, { sx: cloth[2].sx - 2, sy: cloth[2].sy - 2 }, { sx: cloth[3].sx + 2, sy: cloth[3].sy - 2 }]); ctx.stroke();
    // head string and foot spot (table coordinates)
    const hs = [this.sp(0, tL / 4), this.sp(tw, tL / 4)];
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hs[0].sx, hs[0].sy); ctx.lineTo(hs[1].sx, hs[1].sy); ctx.stroke();
    const fs = this.sp(tw / 2, tL * 0.75);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(fs.sx, fs.sy, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
    // diamond sights (mother-of-pearl)
    const sight = (x: number, z: number) => {
      const p = this.sp(x, z);
      const s = Math.max(3, 0.03 * p.scale);
      const g = ctx.createLinearGradient(p.sx - s, p.sy - s, p.sx + s, p.sy + s);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#e8e2d0'); g.addColorStop(1, '#a89e88');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(p.sx, p.sy - s * 0.7); ctx.lineTo(p.sx + s, p.sy); ctx.lineTo(p.sx, p.sy + s * 0.7); ctx.lineTo(p.sx - s, p.sy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    };
    for (let i = 1; i < 8; i++) { if (i === 4) continue; for (const xx of [-rw / 2, tw + rw / 2]) sight(xx, (tL * i) / 8); }
    for (let i = 1; i < 4; i++) { if (i === 2) continue; for (const zz of [-rw / 2, tL + rw / 2]) sight((tw * i) / 4, zz); }
    // pockets with chrome liners
    for (const p of pockets(this.cfg)) {
      const s = this.sp(p.x, p.z);
      const rx = p.r * s.scale * 0.88;
      const ry = rx * 0.55;
      const liner = ctx.createLinearGradient(s.sx - rx, s.sy - ry, s.sx + rx, s.sy + ry);
      liner.addColorStop(0, '#f2f2f2'); liner.addColorStop(0.35, '#8e8e8e'); liner.addColorStop(0.6, '#e0e0e0'); liner.addColorStop(1, '#4a4a4a');
      ctx.fillStyle = liner;
      ctx.beginPath(); ctx.ellipse(s.sx, s.sy, rx + 7, ry + 5, 0, 0, Math.PI * 2); ctx.fill();
      const hole = ctx.createRadialGradient(s.sx, s.sy + ry * 0.3, 1, s.sx, s.sy, rx);
      hole.addColorStop(0, '#000'); hole.addColorStop(0.75, '#050505'); hole.addColorStop(1, '#1a1a1a');
      ctx.fillStyle = hole;
      ctx.beginPath(); ctx.ellipse(s.sx, s.sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(s.sx, s.sy, rx + 7, ry + 5, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    }
  }

  private buildCharacters(): void {
    const { tableW: w, tableL: L } = this.cfg;
    const span = this.fieldBottom - this.fieldTop;
    const p = this.swap ? this.sp(w + 0.55, L * 0.2) : this.sp(-0.55, L * 0.62);
    const height = span * (this.portrait ? 0.3 : 0.34);
    const scale = height / 220;
    const opp = this.state.turn === 0 ? 1 : 0;
    this.opponentSprite = new CharacterSprite(this, Math.max(90 * scale + 10, p.sx), p.sy + 20 * scale, this.players[opp].character, scale);
    if (this.swap) this.opponentSprite.setFacing(-1);
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
    // Strike point picker (where the cue hits the cue ball) + cue lift for massé
    const hw = P ? 250 : 320;
    strip(24, barY - 60, hw, 120);
    this.add.text(24 + hw / 2, barY - 56, 'STRIKE THE CUE BALL', displayStyle(17, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    const sr = P ? 36 : 40;
    this.spinBox = { x: 24 + 16 + sr, y: barY + 8, r: sr, sx: 24 + 2 * sr + 46, sy: barY - 26, sh: 62 };
    this.spinGfx = this.add.graphics().setDepth(902);
    this.spinLabel = this.add.text(24 + hw - (P ? 54 : 68), barY + 2, '', textStyle(P ? 14 : 16, '#ffffff', { align: 'center', wordWrap: { width: P ? 90 : 118 } })).setOrigin(0.5).setDepth(902);
    this.add.text(24 + 2 * sr + 58, barY + 42, 'LIFT', textStyle(12, THEME.textDim)).setOrigin(0.5, 0).setDepth(902);
    this.hintText = this.add.text(24 + 16 + sr, barY + sr + 14, '', textStyle(12, THEME.textDim)).setOrigin(0.5, 0).setDepth(902).setVisible(false);
    const spinZone = this.add.zone(this.spinBox.x, this.spinBox.y, sr * 2 + 36, sr * 2 + 36).setOrigin(0.5).setInteractive().setDepth(903);
    const liftZone = this.add.zone(this.spinBox.sx + 12, this.spinBox.sy + this.spinBox.sh / 2, 60, this.spinBox.sh + 30).setOrigin(0.5).setInteractive().setDepth(903);
    const setSpinFrom = (p: Phaser.Input.Pointer) => {
      const dx = (p.x - this.spinBox.x) / this.spinBox.r;
      const dy = (p.y - this.spinBox.y) / this.spinBox.r;
      const len = Math.hypot(dx, dy);
      const max = POOL_VISUAL.maxStrikeOffset;
      const k = len > max ? max / len : 1;
      this.spin = { ...this.spin, side: dx * k, top: -dy * k };
      if (len < 0.12) this.spin = { ...this.spin, side: 0, top: 0 };
      this.drawSpinPicker();
    };
    const setLiftFrom = (p: Phaser.Input.Pointer) => {
      const t = (this.spinBox.sy + this.spinBox.sh - p.y) / this.spinBox.sh;
      this.spin = { ...this.spin, elevation: Phaser.Math.Clamp(t, 0, 1) };
      if (this.spin.elevation < 0.08) this.spin.elevation = 0;
      this.drawSpinPicker();
    };
    spinZone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.uiDrag = 'spin'; setSpinFrom(p); });
    liftZone.on('pointerdown', (p: Phaser.Input.Pointer) => { this.uiDrag = 'lift'; setLiftFrom(p); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (this.uiDrag === 'spin') setSpinFrom(p);
      else if (this.uiDrag === 'lift') setLiftFrom(p);
    });
    this.input.on('pointerup', () => { this.uiDrag = 'none'; });
    this.input.on('pointerupoutside', () => { this.uiDrag = 'none'; });
    this.drawSpinPicker();
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
      if (p.y < this.fieldTop - 30 || p.y > this.fieldBottom + 40 || this.dragPower || this.uiDrag !== 'none') return;
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

  /** The pointer holds the BUTT of the cue: the cue points from the pointer through the cue ball. */
  private aimAt(p: Phaser.Input.Pointer): void {
    const t = this.tableAt(p.x, p.y);
    const cue = this.cueBall();
    if (!t || !cue) return;
    const dx = cue.x - t.x;
    const dz = cue.z - t.z;
    if (Math.hypot(dx, dz) < 0.02) return;
    this.aimAngle = Math.atan2(dz, dx);
  }

  private tryPlace(p: Phaser.Input.Pointer): void {
    const t = this.tableAt(p.x, p.y);
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
    if (this.isAI(s.turn) || this.lastTurnSlot !== s.turn) { this.spin = { ...NO_SPIN }; this.drawSpinPicker(); }
    this.lastTurnSlot = s.turn;
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
        this.hintText.setText('');
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
    this.hintText.setText('');
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
        this.sim?.strike(speed, this.aimAngle, this.isHumanTurn() ? this.spin : NO_SPIN);
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
    const leftN = (slot: 0 | 1) => { const g = this.state.groups[slot]; return g ? remaining(this.state.balls, g) : 7; };
    // the board counts how many of the loser's balls were still up when the 8 dropped
    this.finishMatch({
      winnerSlot: w,
      summary: this.state.message,
      scores: [left(0), left(1)].map((t, i) => (i === w ? 'WON on the 8' : t)) as [string, string],
      points: w === 0 ? [leftN(1), 0] : [0, leftN(0)],
    });
    void l;
  }

  private swapSprites(): void {
    const opp = this.state.turn === 0 ? 1 : 0;
    if (this.opponentSprite && this.opponentSprite.character.id !== this.players[opp].character.id) {
      const { x, y, charScale } = this.opponentSprite;
      const cue = this.opponentSprite.getData('cue') as Phaser.GameObjects.Image;
      const scale = charScale;
      this.opponentSprite.destroy();
      this.opponentSprite = new CharacterSprite(this, x, y, this.players[opp].character, scale);
      this.opponentSprite.setDepth(150).idle();
      this.opponentSprite.setData('cue', cue);
    }
    if (this.shooterSprite && this.shooterSprite.character.id !== this.players[this.state.turn].character.id) {
      const { x, y, charScale } = this.shooterSprite;
      const scale = charScale;
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
      img.setVisible(true).setPosition(p.sx, p.sy - px * 0.42).setScale(px / 52).setDepth(400 + this.depthOf(b.x, b.z) * 40);
      // shadow falls away from the lamp over the table centre
      const lx = (b.x - this.cfg.tableW / 2) / this.cfg.tableW;
      const lz = (b.z - this.cfg.tableL / 2) / this.cfg.tableL;
      sh.setVisible(true).setPosition(p.sx + px * (0.05 + lx * 0.5), p.sy + px * (0.06 - lz * 0.25)).setScale((px / 128) * 1.25, (px / 128) * 0.55).setAlpha(0.65).setDepth(399 + this.depthOf(b.x, b.z) * 40);
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
    const cueScale = (POOL_VISUAL.cueLength * c.scale) / 520;
    const gap = px * 0.6 + this.pullback;
    this.cue.setVisible(true).setPosition(c.sx + Math.cos(ang) * gap, c.sy - px * 0.42 + Math.sin(ang) * gap).setRotation(ang + Math.PI).setScale(cueScale, Math.max(cueScale * 0.9, 0.35));
    // grab handle on the butt of the cue (this is what the player drags to aim)
    if (this.isHumanTurn()) {
      const bl = gap + 520 * cueScale;
      const bx = c.sx + Math.cos(ang) * bl, by = c.sy - px * 0.42 + Math.sin(ang) * bl;
      this.guide.lineStyle(3, 0xf5c518, 0.9);
      this.guide.strokeCircle(bx, by, 26);
      this.guide.fillStyle(0xf5c518, 0.22);
      this.guide.fillCircle(bx, by, 26);
    }
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

  /** Cue-ball diagram with the strike point, plus the cue-lift slider and an effect label. */
  private drawSpinPicker(): void {
    if (!this.spinGfx) return;
    const g = this.spinGfx;
    const { x, y, r, sx, sy, sh } = this.spinBox;
    g.clear();
    // ball
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(x + 3, y + 4, r + 2);
    g.fillStyle(0xf4f1e8, 1);
    g.fillCircle(x, y, r);
    g.fillStyle(0xffffff, 0.8);
    g.fillCircle(x - r * 0.35, y - r * 0.35, r * 0.28);
    g.lineStyle(1.5, 0x8a8a8a, 0.9);
    g.strokeCircle(x, y, r);
    g.lineStyle(1, 0x000000, 0.18);
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.strokePath();
    g.strokeCircle(x, y, r * POOL_VISUAL.maxStrikeOffset);
    // strike point
    const px = x + this.spin.side * r, py = y - this.spin.top * r;
    g.fillStyle(0xd32f2f, 1);
    g.fillCircle(px, py, 6);
    g.lineStyle(2, 0xffffff, 0.9);
    g.strokeCircle(px, py, 6);
    // lift slider
    g.fillStyle(0x000000, 0.45);
    g.fillRoundedRect(sx, sy, 24, sh, 8);
    g.fillStyle(0x4fc3f7, 0.9);
    const lh = this.spin.elevation * sh;
    g.fillRoundedRect(sx + 4, sy + sh - lh, 16, Math.max(0.01, lh), 6);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(sx - 4, sy + sh - lh - 4, 32, 8, 3);
    const effect = this.spinEffectName();
    this.spinLabel.setText(effect);
  }

  private spinEffectName(): string {
    const { side, top, elevation } = this.spin;
    const parts: string[] = [];
    if (elevation > 0.35 && Math.abs(side) > 0.2) return `MASSÉ ${side < 0 ? 'LEFT' : 'RIGHT'}`;
    if (top > 0.25) parts.push('FOLLOW');
    else if (top < -0.25) parts.push('DRAW');
    if (side > 0.25) parts.push('RIGHT ENGLISH');
    else if (side < -0.25) parts.push('LEFT ENGLISH');
    if (elevation > 0.35) parts.push('RAISED CUE');
    if (!parts.length) return 'CENTER BALL';
    return parts.join(' + ');
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
