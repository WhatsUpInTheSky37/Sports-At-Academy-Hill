import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { GAME_H, GAME_W, THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, impact, confetti, shake } from '../../core/ui';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintAsphalt, paintGrass, paintHouseFront, paintPine, paintSky, paintTreeSide, rng } from '../../art/environment';
import { DEFAULT_BATTING, aiSwing, computeContact, simulateFlight, type BattingConfig, type Flight, type Contact } from './batting';
import { DEFAULT_DERBY_RULES, acknowledgeSwitch, applyOutcome, createDerby, type DerbyState } from './rules';

/** Visual tuning for the derby scene. */
export const DERBY_VISUAL = {
  /** Camera distance behind the plate (m), height (m). */
  camZ: 5.2,
  camH: 2.1,
  /** Pitcher position (m). */
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
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
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
    const pp = this.proj.project(0.4, 0, DERBY_VISUAL.pitcherZ);
    this.pitcher = new CharacterSprite(this, pp.sx, pp.sy, this.players[1].character, pp.scale * 2.0 / 220 * 1.15);
    this.pitcher.setDepth(100).idle();
    const plate = this.proj.project(0, 0, 0);
    this.plateScreen = { x: plate.sx, y: plate.sy };
    const bx = P ? W * 0.72 : W * 0.66;
    const by = Math.min(this.fieldBottom + 40, plate.sy + (P ? 150 : 120));
    this.batter = new CharacterSprite(this, bx, by, this.players[0].character, P ? 1.45 : 1.6);
    this.batter.setDepth(500).setPose('back-swing0');
    this.bat = this.add.image(0, 0, 'bat').setOrigin(0.05, 0.5).setDepth(501).setScale(P ? 1.3 : 1.45);
    this.positionBat('swing0');
    // Ball
    this.ballShadow = this.add.image(0, 0, 'shadow').setDepth(90).setVisible(false);
    this.ball = this.add.image(0, 0, 'baseball').setDepth(400).setVisible(false);
    // Contact point / aim centre
    const c = this.proj.project(this.contactWorld.x, this.contactWorld.y, this.contactWorld.z);
    this.aimCenter = { x: c.sx, y: c.sy };
    this.reticle = this.buildReticle().setDepth(600);
    this.preview = this.add.graphics().setDepth(80);
    // Controls panel
    this.buildControls();
    this.setTurn(0);
    this.refreshHud();
    this.beginAfterHowTo(() => this.startTurn());
  }

  // ---------- Presentation setup ----------
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `derby-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const horizon = pr.cam.horizonY;
      paintSky(ctx, W, H, horizon + 2);
      // Lawn
      paintGrass(ctx, 0, horizon, W, H - horizon, 4, '#5c9a3a');
      // perspective mowing stripes
      ctx.save();
      ctx.globalAlpha = 0.12;
      for (let k = -12; k < 12; k++) {
        if (k % 2 !== 0) continue;
        const a = pr.project(k * 4, 0, 0.1);
        const b = pr.project((k + 1) * 4, 0, 0.1);
        const c = pr.project((k + 1) * 4, 0, 120);
        const d = pr.project(k * 4, 0, 120);
        ctx.fillStyle = '#eaffd0';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      // Distant neighbourhood: tiny houses and big far trees behind the boundary
      const r = rng(77);
      for (let i = 0; i < 14; i++) {
        const x = -60 + i * 9 + r() * 4;
        const z = 75 + r() * 20;
        const p = pr.project(x, 0, z);
        const s = p.scale;
        paintHouseFront(ctx, p.sx - 4 * s, p.sy - 5 * s, 8 * s, 5 * s, { siding: ['#f1e6c8', '#d9e4f0', '#e8d4c0'][i % 3] });
      }
      for (let i = 0; i < 26; i++) {
        const x = -70 + i * 5.6 + r() * 3;
        const z = 60 + r() * 25;
        const p = pr.project(x, 0, z);
        paintTreeSide(ctx, p.sx, p.sy, 8 * p.scale, 100 + i);
      }
      // Vinnie's house along the right side, and the driveway the batter stands on
      const dz0 = -4, dz1 = 34;
      const d0 = pr.project(2.2, 0, dz0), d1 = pr.project(6.4, 0, dz0), d2 = pr.project(6.4, 0, dz1), d3 = pr.project(2.2, 0, dz1);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(d0.sx, d0.sy); ctx.lineTo(d1.sx, d1.sy); ctx.lineTo(d2.sx, d2.sy); ctx.lineTo(d3.sx, d3.sy); ctx.closePath(); ctx.clip();
      paintAsphalt(ctx, 0, horizon, W, H - horizon, 5, '#777470');
      ctx.restore();
      const hp = pr.project(6.8, 0, 9);
      const hs = hp.scale;
      paintHouseFront(ctx, hp.sx, hp.sy - 7.5 * hs, 16 * hs, 7.5 * hs, { siding: '#f3ead3', garage: true });
      // Small backyard trees (childhood-sized, jumpable) scattered with gaps
      const yardTrees = [[-16, 30], [-26, 36], [14, 38], [-7, 41], [22, 31], [-32, 27]];
      yardTrees.forEach(([x, z], i) => {
        const p = pr.project(x, 0, z);
        paintPine(ctx, p.sx, p.sy, 2.2 * p.scale, 200 + i);
      });
      // Home run boundary: dashed line + tree line at z = boundary
      const bz = this.cfg.boundaryZ;
      const bl = pr.project(-45, 0, bz), br = pr.project(45, 0, bz);
      ctx.setLineDash([14, 10]);
      ctx.strokeStyle = 'rgba(255,215,0,0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(bl.sx, bl.sy); ctx.lineTo(br.sx, br.sy); ctx.stroke();
      ctx.setLineDash([]);
      for (let x = -46; x <= 46; x += 5.5) {
        const p = pr.project(x + (r() - 0.5) * 1.5, 0, bz + 0.6 + r() * 1.2);
        const h = this.cfg.treeHeight * (0.95 + r() * 0.3);
        paintPine(ctx, p.sx, p.sy, h * p.scale * 1.08, 300 + Math.round(x));
      }
      // Foul lines (chalk) and fair wedge tint
      const fa = (this.cfg.fairAngleDeg * Math.PI) / 180;
      const fl = pr.project(-Math.sin(fa) * 60, 0, Math.cos(fa) * 60);
      const fr = pr.project(Math.sin(fa) * 60, 0, Math.cos(fa) * 60);
      const home = pr.project(0, 0, 0);
      ctx.fillStyle = 'rgba(255,255,150,0.08)';
      ctx.beginPath(); ctx.moveTo(home.sx, home.sy); ctx.lineTo(fl.sx, fl.sy); ctx.lineTo(fr.sx, fr.sy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(home.sx, home.sy); ctx.lineTo(fl.sx, fl.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(home.sx, home.sy); ctx.lineTo(fr.sx, fr.sy); ctx.stroke();
      // Home plate + dirt patch
      const ps = home.scale;
      ctx.fillStyle = 'rgba(120,90,60,0.55)';
      ctx.beginPath(); ctx.ellipse(home.sx, home.sy, 1.6 * ps, 0.5 * ps, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f4f1e8';
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2;
      const pw = 0.43 * ps, ph = 0.16 * ps;
      ctx.beginPath();
      ctx.moveTo(home.sx - pw, home.sy - ph * 0.6); ctx.lineTo(home.sx + pw, home.sy - ph * 0.6); ctx.lineTo(home.sx + pw, home.sy + ph * 0.2); ctx.lineTo(home.sx, home.sy + ph); ctx.lineTo(home.sx - pw, home.sy + ph * 0.2); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // Pitcher's rubber
      const pm = pr.project(0, 0, DERBY_VISUAL.pitcherZ + 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(pm.sx - 0.3 * pm.scale, pm.sy - 2, 0.6 * pm.scale, 4);
      // Boundary label
      const lbl = pr.project(0, 3.8, bz + 1);
      ctx.fillStyle = 'rgba(13,31,16,0.8)';
      ctx.font = 'bold 22px "Arial Black", Arial';
      ctx.textAlign = 'center';
      const txt = 'HOME RUN — OVER THE TREES';
      const tw = ctx.measureText(txt).width + 30;
      ctx.fillRect(lbl.sx - tw / 2, lbl.sy - 18, tw, 34);
      ctx.fillStyle = '#f5c518';
      ctx.fillText(txt, lbl.sx, lbl.sy + 7);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
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

  private positionBat(frame: 'swing0' | 'swing1' | 'swing2'): void {
    const b = this.batter;
    const s = b.sprite.scale;
    const flip = b.sprite.flipX ? -1 : 1;
    const cfg = {
      swing0: { dx: 10, dy: -150, angle: -70 },
      swing1: { dx: -30, dy: -105, angle: -175 },
      swing2: { dx: -40, dy: -70, angle: 150 },
    }[frame];
    this.bat.setPosition(b.x + cfg.dx * s * flip, b.y + cfg.dy * s);
    this.bat.setAngle(cfg.angle * flip);
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
    const pp = this.proj.project(0.4, 0, DERBY_VISUAL.pitcherZ);
    this.pitcher = new CharacterSprite(this, pp.sx, pp.sy, this.players[p].character, pp.scale * 2.0 / 220 * 1.15);
    this.pitcher.setDepth(100).idle();
    const bx = P ? W * 0.72 : W * 0.66;
    const by = Math.min(this.fieldBottom + 40, this.plateScreen.y + (P ? 150 : 120));
    this.batter = new CharacterSprite(this, bx, by, this.players[b].character, P ? 1.45 : 1.6);
    this.batter.setDepth(500).setPose('back-swing0');
    this.positionBat('swing0');
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
    Audio.sfx('throw');
  }

  private resolveSwing(offsetMs: number): void {
    const ax = this.aim.x / this.aimRange;
    const ay = this.aim.y / this.aimRange;
    const contact: Contact = computeContact(offsetMs, ax, ay, this.cfg);
    this.swung = true;
    this.phase = 'flight';
    // bat animation
    this.batter.setPose('back-swing1');
    this.positionBat('swing1');
    Audio.sfx('swing');
    this.time.delayedCall(110, () => { this.batter.setPose('back-swing2'); this.positionBat('swing2'); });
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
      this.batter.setPose('back-swing0');
      this.positionBat('swing0');
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
      const rel = { x: 0.45, y: 1.55, z: DERBY_VISUAL.pitcherZ - 0.4 };
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
    if (!p.visible) { this.ball.setVisible(false); this.ballShadow.setVisible(false); return; }
    const px = Math.max(10, DERBY_VISUAL.ballDiameter * p.scale);
    this.ball.setVisible(true).setPosition(p.sx, p.sy).setScale(px / 40).setDepth(400 + (100 - z));
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
