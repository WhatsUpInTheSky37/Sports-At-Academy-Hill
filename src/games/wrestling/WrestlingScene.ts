import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { displayStyle, textStyle, confetti, impact, shake } from '../../core/ui';
import type { Controls } from '../../core/input';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintLamp, roundRect, shade, rng } from '../../art/environment';
import { paintBraidedRug, paintBulb, paintCinderWallProjected, paintConcreteHD, paintCouchHD, paintPennantHD, paintPipes, paintPosterHD, paintRoomGrade, paintShelfHD, paintWasherDryer } from '../pool/basementArt';
import { NO_INPUT, WRESTLING_TUNING, createWrestling, escapeWindowHit, isVulnerable, other, step, vulnerabilityLeft, type Inputs, type WrestlingEvent, type WrestlingState } from './sim';
import { aiInputs, createAiMemory, type AiMemory } from './ai';

/** Visual tuning for the wrestling scene. */
export const WRESTLING_VISUAL = {
  cushionHeight: 0.16,
  /** World height of a character sprite frame (m). */
  spriteHeight: 1.5,
  wallZ: 6.5,
  wallHeight: 2.5,
  sideX: 5.2,
};

export class WrestlingScene extends BaseGameScene {
  readonly gameId = 'wrestling' as const;
  constructor() { super('WrestlingScene'); }

  private proj!: Projector;
  private state!: WrestlingState;
  private sprites!: [CharacterSprite, CharacterSprite];
  private controls!: [Controls | null, Controls | null];
  private aiMem: AiMemory = createAiMemory();
  private fx!: Phaser.GameObjects.Graphics;
  private hudFx!: Phaser.GameObjects.Graphics;
  private staminaLabels: Phaser.GameObjects.Text[] = [];
  private countText!: Phaser.GameObjects.Text;
  private escapeLabel!: Phaser.GameObjects.Text;
  private pinLabel!: Phaser.GameObjects.Text;
  private barLabel!: Phaser.GameObjects.Text;
  private introDone = false;
  private running = false;
  private ringOutShown = false;
  private lastCount = 0;

  create(): void {
    this.setupShell({ music: 'basement' });
    const W = this.W, H = this.H, P = this.portrait;
    const horizon = this.hudBottom + (P ? 60 : 36);
    this.proj = new Projector(P
      ? { camZ: 7, camH: 3.2, horizonY: horizon, focal: Math.min(1700, (W - 60) * 5.475 / WRESTLING_TUNING.ringSize), cx: W / 2 }
      : { camZ: 7, camH: 2.6, horizonY: horizon, focal: 1400, cx: W / 2 });
    this.paintBackground();
    this.state = createWrestling();
    this.aiMem = createAiMemory();
    this.fx = this.add.graphics().setDepth(50);
    this.hudFx = this.add.graphics().setDepth(9100);
    this.sprites = [this.makeSprite(0), this.makeSprite(1)];
    this.controls = [
      this.makeControls(0, { labels: { a: 'GRAB / PIN', b: 'SHOVE', c: 'ESCAPE' } }),
      this.isAI(1) ? null : this.makeControls(1, { touch: false }),
    ];
    for (const slot of [0, 1] as const) {
      this.setScore(slot, '');
      const r = this.panelRect(slot);
      this.staminaLabels.push(this.add.text(r.x + 120, r.y + 46, 'STAMINA', displayStyle(18, '#f5c518', { strokeThickness: 0 })).setDepth(9101));
    }
    this.countText = this.add.text(W / 2, H * 0.45, '', displayStyle(P ? 150 : 180, '#f5c518', { strokeThickness: 12 })).setOrigin(0.5).setDepth(9200).setVisible(false);
    this.escapeLabel = this.add.text(W / 2, 0, '', displayStyle(26, '#ffffff', { align: 'center' })).setOrigin(0.5).setDepth(9201).setVisible(false);
    this.pinLabel = this.add.text(0, 0, 'PIN WINDOW', displayStyle(22, '#ffeb3b', { strokeThickness: 4 })).setOrigin(0.5).setDepth(60).setVisible(false);
    const barY = P ? H - 540 : H - 82;
    this.barLabel = this.add.text(W / 2, barY - 34, 'GRAPPLE ADVANTAGE', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5).setDepth(9101);
    if (!this.useTouch || this.match.mode === 'local') {
      const hint = this.match.mode === 'local'
        ? 'P1: WASD move • F grab/pin • G shove • H escape      P2: Arrows • , grab/pin • . shove • / escape'
        : 'WASD move • F grab/pin • G shove/takedown • H escape';
      this.add.text(W / 2, barY + 42, hint, textStyle(P ? 18 : 20, '#fff3c4', { align: 'center', wordWrap: { width: W - 60 } })).setOrigin(0.5, 0).setDepth(9101);
    }
    this.setSub('First three-count wins the belt');
    this.setTurn(null);
    this.beginAfterHowTo(() => this.startMatch());
  }

  private makeSprite(slot: 0 | 1): CharacterSprite {
    const s = new CharacterSprite(this, 0, 0, this.players[slot].character, 1);
    s.idle();
    return s;
  }

  private startMatch(): void {
    this.running = true;
    Audio.sfx('whistle');
    this.announce('READY...', { size: this.portrait ? 64 : 80, hold: 700 });
    this.time.delayedCall(900, () => { if (!this.finished) this.announce('WRESTLE!', { color: '#f5c518', size: this.portrait ? 80 : 100, hold: 800 }); });
  }

  // ---------- background ----------
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `wrestling-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const V = WRESTLING_VISUAL;
      const wz = V.wallZ;
      ctx.fillStyle = '#1a120b';
      ctx.fillRect(0, 0, W, H);
      const wallTop = pr.project(0, V.wallHeight, wz).sy;
      const wallBot = pr.project(0, 0, wz).sy;
      // floor everywhere below the horizon
      paintConcreteHD(ctx, 0, pr.cam.horizonY - 2, W, H - pr.cam.horizonY + 2, 31, { base: '#8b877f' });
      // braided rugs
      const rug = (x: number, z: number, r: number, seed: number) => {
        const p = pr.project(x, 0, z);
        paintBraidedRug(ctx, p.sx, p.sy, r * p.scale, r * p.scale * 0.42, seed);
      };
      rug(-4.0, 2.9, 0.9, 7);
      rug(3.8, 2.0, 0.7, 9);
      // walls: cinder block in perspective with the bulbs lighting them
      paintCinderWallProjected(ctx, pr, { kind: 'side', x: -V.sideX, z0: -2, z1: wz }, V.wallHeight, { seed: 43, base: '#8f8a7e', lightAt: { x: -2.5, z: 2.5, r: 6 } });
      paintCinderWallProjected(ctx, pr, { kind: 'side', x: V.sideX, z0: -2, z1: wz }, V.wallHeight, { seed: 44, base: '#8f8a7e', lightAt: { x: 2.5, z: 2.5, r: 6 } });
      paintCinderWallProjected(ctx, pr, { kind: 'back', z: wz, x0: -V.sideX, x1: V.sideX }, V.wallHeight, { seed: 45, base: '#9a948a', lightAt: { x: 0, z: 2.5, r: 7.5 } });
      const bs = pr.scaleAt(wz);
      // damp line and a floor drain
      const dl = pr.project(-V.sideX, 0, wz), dr = pr.project(V.sideX, 0, wz);
      const damp = ctx.createLinearGradient(0, wallBot - 0.5 * bs, 0, wallBot);
      damp.addColorStop(0, 'rgba(50,40,30,0)'); damp.addColorStop(1, 'rgba(50,40,30,0.35)');
      ctx.fillStyle = damp; ctx.fillRect(dl.sx, wallBot - 0.5 * bs, dr.sx - dl.sx, 0.5 * bs);
      const drain = pr.project(4.2, 0, 4.6);
      ctx.fillStyle = '#4a4a4a'; ctx.beginPath(); ctx.ellipse(drain.sx, drain.sy, 0.16 * drain.scale, 0.07 * drain.scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
      for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(drain.sx - 0.12 * drain.scale, drain.sy + k * 0.025 * drain.scale); ctx.lineTo(drain.sx + 0.12 * drain.scale, drain.sy + k * 0.025 * drain.scale); ctx.stroke(); }
      // ceiling joists with shaded faces, a duct and pipes
      for (let i = -8; i <= 8; i++) {
        const a = pr.project(i * 1.2, V.wallHeight + 0.05, -2.5), b = pr.project(i * 1.2, V.wallHeight + 0.05, wz);
        const jg = ctx.createLinearGradient(a.sx - 10, 0, a.sx + 10, 0);
        jg.addColorStop(0, '#6a4a2c'); jg.addColorStop(0.5, '#4a3219'); jg.addColorStop(1, '#2a1a0c');
        ctx.fillStyle = jg;
        ctx.beginPath(); ctx.moveTo(a.sx - 10, Math.min(a.sy, 0)); ctx.lineTo(b.sx - 4, b.sy); ctx.lineTo(b.sx + 4, b.sy); ctx.lineTo(a.sx + 10, Math.min(a.sy, 0)); ctx.closePath(); ctx.fill();
      }
      const pipeA = pr.project(-V.sideX, V.wallHeight - 0.12, wz - 0.4), pipeB = pr.project(V.sideX, V.wallHeight - 0.12, wz - 0.4);
      paintPipes(ctx, pipeA.sx, pipeB.sx, pipeA.sy, { copper: true, thickness: Math.max(4, 0.05 * bs) });
      const ductA = pr.project(-V.sideX, V.wallHeight - 0.3, wz - 1.2), ductB = pr.project(V.sideX, V.wallHeight - 0.3, wz - 1.2);
      const dg = ctx.createLinearGradient(0, ductA.sy - 0.2 * bs, 0, ductA.sy + 0.15 * bs);
      dg.addColorStop(0, '#9aa0a6'); dg.addColorStop(0.5, '#d3d8dc'); dg.addColorStop(1, '#5f666b');
      ctx.fillStyle = dg;
      ctx.fillRect(ductA.sx, ductA.sy - 0.2 * bs, ductB.sx - ductA.sx, 0.35 * bs);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
      for (let x = ductA.sx; x < ductB.sx; x += 0.9 * bs) { ctx.beginPath(); ctx.moveTo(x, ductA.sy - 0.2 * bs); ctx.lineTo(x, ductA.sy + 0.15 * bs); ctx.stroke(); }
      // hanging bulbs with light pools
      for (const x of [-2.5, 2.5]) {
        const p = pr.project(x, V.wallHeight - 0.35, 2.5);
        const top = pr.project(x, V.wallHeight + 0.05, 2.5);
        paintBulb(ctx, p.sx, top.sy, p.sy, Math.max(0.6, p.scale / 160));
      }
      // stairs (left), with shaded risers/treads and a railing
      const stairX = -4.3;
      for (let i = 0; i < 7; i++) {
        const z0 = wz - 0.2 - i * 0.42, h0 = i * 0.3;
        const a = pr.project(stairX - 0.9, h0 + 0.3, z0), b = pr.project(stairX + 0.3, h0 + 0.3, z0), c = pr.project(stairX + 0.3, h0 + 0.3, z0 + 0.42), d = pr.project(stairX - 0.9, h0 + 0.3, z0 + 0.42);
        const tg = ctx.createLinearGradient(0, c.sy, 0, a.sy);
        tg.addColorStop(0, '#7a4e2a'); tg.addColorStop(1, '#b07e4e');
        ctx.fillStyle = tg;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(40,20,5,0.4)'; ctx.lineWidth = 1; ctx.stroke();
        const e = pr.project(stairX - 0.9, h0, z0), f = pr.project(stairX + 0.3, h0, z0);
        const rg = ctx.createLinearGradient(0, a.sy, 0, e.sy);
        rg.addColorStop(0, '#4a2c14'); rg.addColorStop(1, '#2d1a0a');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(f.sx, f.sy); ctx.lineTo(e.sx, e.sy); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = '#2b1a0d'; ctx.lineWidth = Math.max(3, 0.05 * bs); ctx.lineCap = 'round';
      const r0 = pr.project(stairX + 0.3, 1.0, wz - 0.2), r1 = pr.project(stairX + 0.3, 1.0 + 6 * 0.3, wz - 0.2 - 6 * 0.42);
      ctx.beginPath(); ctx.moveTo(r0.sx, r0.sy); ctx.lineTo(r1.sx, r1.sy); ctx.stroke();
      ctx.lineWidth = Math.max(2, 0.03 * bs);
      for (let i = 0; i < 7; i += 2) {
        const top = pr.project(stairX + 0.3, 1.0 + i * 0.3, wz - 0.2 - i * 0.42), bot = pr.project(stairX + 0.3, i * 0.3 + 0.3, wz - 0.2 - i * 0.42);
        ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(bot.sx, bot.sy); ctx.stroke();
      }
      // couch against the back wall, lamp beside it
      const cp = pr.project(-0.3, 0, wz - 0.1);
      const cs = cp.scale;
      paintCouchHD(ctx, cp.sx - 1.2 * cs, cp.sy - 0.95 * cs, 2.5 * cs, 0.95 * cs, '#5f6b3f');
      const lp = pr.project(-2.0, 0, wz - 0.15);
      paintLamp(ctx, lp.sx, lp.sy - 0.5 * lp.scale, lp.scale / 95);
      // pennant and poster
      const pn = pr.project(-3.0, 2.0, wz);
      paintPennantHD(ctx, pn.sx, pn.sy, 0.9 * bs, 0.4 * bs, '#f5c518', 'ACADEMY HILL');
      const po = pr.project(1.4, 2.0, wz);
      paintPosterHD(ctx, po.sx, po.sy, 0.7 * bs, 0.5 * bs, '#3f6b3a', ['PINES', 'WRESTLING']);
      // shelves with boxes (right side) and the washer/dryer beside them
      const sp = pr.project(this.portrait ? 3.1 : 4.3, 0, wz - 0.05);
      const ss = sp.scale;
      paintShelfHD(ctx, sp.sx - 0.65 * ss, sp.sy - 2.05 * ss, 1.3 * ss, 2.05 * ss, 50);
      ctx.fillStyle = '#eee'; ctx.font = `bold ${Math.round(0.11 * ss)}px Arial`; ctx.textAlign = 'center';
      ctx.fillText('CURTAINS', sp.sx + 0.08 * ss, sp.sy - 1.25 * ss);
      if (!this.portrait) {
        const wd = pr.project(-3.95, 0, wz - 0.05);
        paintWasherDryer(ctx, wd.sx, wd.sy - 0.8 * wd.scale, wd.scale / 125);
      }
      // folding chair with the belt
      const ch = pr.project(this.portrait ? 2.1 : 2.7, 0, 2.2);
      const chs = ch.scale;
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath(); ctx.ellipse(ch.sx + 0.05 * chs, ch.sy + 0.02 * chs, 0.36 * chs, 0.12 * chs, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = Math.max(2, 0.03 * chs);
      ctx.beginPath(); ctx.moveTo(ch.sx - 0.25 * chs, ch.sy); ctx.lineTo(ch.sx - 0.2 * chs, ch.sy - 0.45 * chs); ctx.moveTo(ch.sx + 0.25 * chs, ch.sy); ctx.lineTo(ch.sx + 0.2 * chs, ch.sy - 0.45 * chs); ctx.stroke();
      const seat = ctx.createLinearGradient(0, ch.sy - 0.5 * chs, 0, ch.sy - 0.4 * chs);
      seat.addColorStop(0, '#8a8a8a'); seat.addColorStop(1, '#555');
      ctx.fillStyle = seat;
      roundRect(ctx, ch.sx - 0.25 * chs, ch.sy - 0.5 * chs, 0.5 * chs, 0.1 * chs, 3); ctx.fill();
      const back = ctx.createLinearGradient(ch.sx - 0.22 * chs, 0, ch.sx + 0.22 * chs, 0);
      back.addColorStop(0, '#7a7a7a'); back.addColorStop(0.5, '#5a5a5a'); back.addColorStop(1, '#3f3f3f');
      ctx.fillStyle = back;
      roundRect(ctx, ch.sx - 0.22 * chs, ch.sy - 0.95 * chs, 0.44 * chs, 0.35 * chs, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(ch.sx - 0.2 * chs, ch.sy - 1.25 * chs, 0.4 * chs, 0.2 * chs);
      ctx.fillStyle = '#222'; ctx.font = `bold ${Math.round(0.1 * chs)}px Arial`; ctx.textAlign = 'center';
      ctx.fillText('THE BELT ↓', ch.sx, ch.sy - 1.11 * chs);
      const belt = this.textures.get('belt').getSourceImage() as HTMLCanvasElement;
      ctx.drawImage(belt, ch.sx - 0.3 * chs, ch.sy - 0.78 * chs, 0.6 * chs, 0.23 * chs);
      // glint on the belt plate
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createLinearGradient(ch.sx - 0.1 * chs, ch.sy - 0.78 * chs, ch.sx + 0.08 * chs, ch.sy - 0.55 * chs);
      gl.addColorStop(0, 'rgba(255,255,255,0)'); gl.addColorStop(0.5, 'rgba(255,255,230,0.55)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl;
      ctx.fillRect(ch.sx - 0.12 * chs, ch.sy - 0.78 * chs, 0.24 * chs, 0.23 * chs);
      ctx.restore();
      // ---- the cushion ring ----
      this.paintRing(ctx);
      const l1 = pr.project(-2.5, 0, 2.5), l2 = pr.project(2.5, 0, 2.5);
      paintRoomGrade(ctx, W, H, [{ x: l1.sx, y: l1.sy - 0.6 * l1.scale, r: W * 0.42, strength: 0.32 }, { x: l2.sx, y: l2.sy - 0.6 * l2.scale, r: W * 0.42, strength: 0.32 }], 0.4);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
  }

  private paintRing(ctx: CanvasRenderingContext2D): void {
    const pr = this.proj;
    const t = WRESTLING_TUNING;
    const h = WRESTLING_VISUAL.cushionHeight;
    const half = t.ringSize / 2;
    // chalk outline on the floor
    const chalk = [pr.project(-half - 0.25, 0, -half - 0.25), pr.project(half + 0.25, 0, -half - 0.25), pr.project(half + 0.25, 0, half + 0.25), pr.project(-half - 0.25, 0, half + 0.25)];
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.beginPath(); chalk.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy))); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    const lbl = pr.project(-half - 0.5, 0, -0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `italic ${Math.round(0.1 * lbl.scale)}px "Trebuchet MS", Arial`;
    ctx.textAlign = 'right';
    ['HOMEMADE', 'CUSHION RING', '10 x 10 FT'].forEach((line, i) => ctx.fillText(line, lbl.sx, lbl.sy + i * 0.12 * lbl.scale));
    // soft contact shadow under the whole ring
    const c0 = pr.project(-half - 0.1, 0, -half - 0.1), c1 = pr.project(half + 0.1, 0, -half - 0.1), c2 = pr.project(half + 0.1, 0, half + 0.1), c3 = pr.project(-half - 0.1, 0, half + 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.moveTo(c0.sx - 6, c0.sy + 8); ctx.lineTo(c1.sx + 6, c1.sy + 8); ctx.lineTo(c2.sx + 4, c2.sy + 3); ctx.lineTo(c3.sx - 4, c3.sy + 3); ctx.closePath(); ctx.fill();
    const fabrics = ['#6b6b3f', '#7a6a4a', '#5f6b3f', '#8a6a3a', '#6b5a4a', '#6b6b3f', '#5f6b3f', '#7a6a4a', '#8a7a5a'];
    const cell = t.ringSize / 3;
    const r = rng(77);
    // far rows first
    for (let row = 2; row >= 0; row--) {
      for (let col = 0; col < 3; col++) {
        const x0 = -half + col * cell, x1 = x0 + cell;
        const z1 = -half + row * cell + cell, z0 = z1 - cell; // z0 near edge
        const idx = row * 3 + col;
        const base = fabrics[idx];
        const sag = 0.035; // cushions dip a little in the middle
        // front face (darker, with a piped bottom edge)
        const f0 = pr.project(x0, 0, z0), f1 = pr.project(x1, 0, z0), f2 = pr.project(x1, h, z0), f3 = pr.project(x0, h, z0);
        const fg = ctx.createLinearGradient(0, f2.sy, 0, f0.sy);
        fg.addColorStop(0, shade(base, -0.22)); fg.addColorStop(1, shade(base, -0.45));
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.moveTo(f0.sx, f0.sy); ctx.lineTo(f1.sx, f1.sy); ctx.lineTo(f2.sx, f2.sy); ctx.lineTo(f3.sx, f3.sy); ctx.closePath(); ctx.fill();
        // side face on the outer right column
        if (col === 2) {
          const s0 = pr.project(x1, 0, z0), s1 = pr.project(x1, 0, z1), s2 = pr.project(x1, h, z1), s3 = pr.project(x1, h, z0);
          ctx.fillStyle = shade(base, -0.32);
          ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.lineTo(s2.sx, s2.sy); ctx.lineTo(s3.sx, s3.sy); ctx.closePath(); ctx.fill();
        }
        if (col === 0) {
          const s0 = pr.project(x0, 0, z0), s1 = pr.project(x0, 0, z1), s2 = pr.project(x0, h, z1), s3 = pr.project(x0, h, z0);
          ctx.fillStyle = shade(base, -0.32);
          ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.lineTo(s2.sx, s2.sy); ctx.lineTo(s3.sx, s3.sy); ctx.closePath(); ctx.fill();
        }
        // top face with a sag: edges bow inward slightly
        const t0 = pr.project(x0 + 0.02, h, z0 + 0.02), t1 = pr.project(x1 - 0.02, h, z0 + 0.02), t2 = pr.project(x1 - 0.02, h, z1 - 0.02), t3 = pr.project(x0 + 0.02, h, z1 - 0.02);
        const m01 = pr.project((x0 + x1) / 2, h - sag, z0 + 0.02), m12 = pr.project(x1 - 0.02, h - sag, (z0 + z1) / 2), m23 = pr.project((x0 + x1) / 2, h - sag, z1 - 0.02), m30 = pr.project(x0 + 0.02, h - sag, (z0 + z1) / 2);
        const topPath = () => {
          ctx.beginPath();
          ctx.moveTo(t0.sx, t0.sy);
          ctx.quadraticCurveTo(m01.sx, m01.sy, t1.sx, t1.sy);
          ctx.quadraticCurveTo(m12.sx, m12.sy, t2.sx, t2.sy);
          ctx.quadraticCurveTo(m23.sx, m23.sy, t3.sx, t3.sy);
          ctx.quadraticCurveTo(m30.sx, m30.sy, t0.sx, t0.sy);
          ctx.closePath();
        };
        const centre = pr.project((x0 + x1) / 2, h, (z0 + z1) / 2);
        const g = ctx.createRadialGradient(centre.sx - 0.2 * centre.scale, centre.sy - 0.15 * centre.scale, 2, centre.sx, centre.sy, cell * 0.75 * centre.scale);
        g.addColorStop(0, shade(base, 0.22)); g.addColorStop(0.55, shade(base, 0.04)); g.addColorStop(1, shade(base, -0.18));
        ctx.fillStyle = g;
        topPath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
        // fabric detail
        ctx.save();
        topPath(); ctx.clip();
        if (idx % 4 === 1 || idx === 6) {
          // plaid / striped blanket thrown over this cushion
          ctx.globalAlpha = 0.3;
          ctx.strokeStyle = idx === 6 ? '#d9b36b' : '#3a2a1a';
          ctx.lineWidth = 2.5;
          for (let k = 0; k <= 8; k++) {
            const a = pr.project(x0 + (k / 8) * cell, h, z0), b = pr.project(x0 + (k / 8) * cell, h, z1);
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
            const c = pr.project(x0, h, z0 + (k / 8) * cell), d = pr.project(x1, h, z0 + (k / 8) * cell);
            ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
          }
          ctx.globalAlpha = 0.18;
          ctx.strokeStyle = idx === 6 ? '#8a2a2a' : '#c9a35a';
          ctx.lineWidth = 6;
          for (let k = 1; k < 8; k += 3) {
            const a = pr.project(x0 + (k / 8) * cell, h, z0), b = pr.project(x0 + (k / 8) * cell, h, z1);
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
          }
        } else if (idx === 4) {
          // curtain with a floral print in the middle cell
          ctx.globalAlpha = 0.22;
          for (let k = 0; k < 18; k++) {
            const p = pr.project(x0 + 0.1 + r() * (cell - 0.2), h, z0 + 0.1 + r() * (cell - 0.2));
            ctx.fillStyle = k % 2 ? '#c94a5a' : '#e8d070';
            ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.035 * p.scale, 0, Math.PI * 2); ctx.fill();
          }
        } else {
          // upholstery weave and a tufted seam cross
          ctx.globalAlpha = 0.14;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.2;
          for (let k = 0; k < 60; k++) {
            const px = x0 + ((k * 0.618) % 1) * cell, pz = z0 + ((k * 0.382) % 1) * cell;
            const p = pr.project(px, h, pz);
            ctx.beginPath(); ctx.moveTo(p.sx - 3, p.sy); ctx.lineTo(p.sx + 3, p.sy + 1); ctx.stroke();
          }
          ctx.globalAlpha = 0.3;
          ctx.strokeStyle = shade(base, -0.5); ctx.lineWidth = 2;
          const sa = pr.project(x0 + 0.1, h, (z0 + z1) / 2), sb = pr.project(x1 - 0.1, h, (z0 + z1) / 2);
          ctx.beginPath(); ctx.moveTo(sa.sx, sa.sy); ctx.lineTo(sb.sx, sb.sy); ctx.stroke();
          const sc = pr.project((x0 + x1) / 2, h, z0 + 0.1), sd = pr.project((x0 + x1) / 2, h, z1 - 0.1);
          ctx.beginPath(); ctx.moveTo(sc.sx, sc.sy); ctx.lineTo(sd.sx, sd.sy); ctx.stroke();
          ctx.fillStyle = shade(base, -0.45);
          ctx.beginPath(); ctx.arc(centre.sx, centre.sy, 0.02 * centre.scale, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        // piping along the top edges and a highlight on the near edge
        ctx.strokeStyle = 'rgba(255,245,220,0.35)'; ctx.lineWidth = 2;
        topPath(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(t0.sx, t0.sy); ctx.quadraticCurveTo(m01.sx, m01.sy, t1.sx, t1.sy); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,245,220,0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(f0.sx, f0.sy + 1); ctx.lineTo(f1.sx, f1.sy + 1); ctx.stroke();
      }
    }
  }

  // ---------- frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished || !this.running) return;
    const dt = Math.min(0.1, dtMs / 1000);
    const inputs: [Inputs, Inputs] = [this.readInputs(0, dt), this.readInputs(1, dt)];
    const sub = 1 / 120;
    let left = dt;
    while (left > 0) {
      const h = Math.min(sub, left);
      left -= h;
      step(this.state, inputs, h);
      for (const e of this.state.events) this.handleEvent(e);
      // one-shot inputs only apply to the first substep
      inputs[0].grappleJust = inputs[0].shoveJust = inputs[0].escapeJust = false;
      inputs[1].grappleJust = inputs[1].shoveJust = inputs[1].escapeJust = false;
      if (this.state.phase === 'done') break;
    }
    this.render();
  }

  private readInputs(slot: 0 | 1, dt: number): Inputs {
    if (this.isAI(slot)) return aiInputs(this.state, slot, this.ai, dt, this.aiMem);
    const c = this.controls[slot];
    if (!c) return { ...NO_INPUT };
    return { x: c.axis.x, y: -c.axis.y, grapple: c.isDown('a'), grappleJust: c.justDown('a'), shoveJust: c.justDown('b'), escapeJust: c.justDown('c') };
  }

  private screenOf(slot: 0 | 1): { x: number; y: number } {
    const w = this.state.w[slot];
    const p = this.proj.project(w.x, WRESTLING_VISUAL.cushionHeight, w.z);
    return { x: p.sx, y: p.sy };
  }

  private handleEvent(e: WrestlingEvent): void {
    const P = this.portrait;
    const nm = (s: 0 | 1) => this.name(s);
    const pos = (s: 0 | 1) => this.screenOf(s);
    switch (e.type) {
      case 'grapple': Audio.sfx('grab'); break;
      case 'shove': {
        Audio.sfx('slap');
        const p = pos(other(e.by));
        impact(this, p.x, p.y - 80, 0xffffff, e.strong ? 12 : 7, 70, 7);
        if (e.strong) shake(this, 0.003, 100);
        break;
      }
      case 'takedown': {
        Audio.sfx('thud');
        shake(this, 0.005, 160);
        const p = pos(other(e.by));
        impact(this, p.x, p.y - 30, 0xffd54f, 14, 70, 9);
        this.announce('TAKEDOWN!', { size: P ? 54 : 64, hold: 700, color: '#ffeb3b' });
        if (Math.random() < 0.6) this.react(e.by, 'taunt', pos(e.by).x, pos(e.by).y - 170);
        break;
      }
      case 'takedownFailed': { Audio.sfx('groan'); this.announce('REVERSED!', { size: P ? 44 : 54, hold: 600, color: '#80deea' }); break; }
      case 'grappleBroken': { Audio.sfx('slap'); this.announce(`${nm(other(e.loser)).toUpperCase()} BREAKS FREE!`, { size: P ? 40 : 50, hold: 700 }); break; }
      case 'pinStart': { Audio.sfx('grab'); this.lastCount = 0; break; }
      case 'count': {
        Audio.sfx('countBeep');
        this.countText.setText(String(e.n)).setVisible(true).setScale(0.4).setAlpha(1);
        this.tweens.add({ targets: this.countText, scale: 1, duration: 220, ease: 'Back.Out' });
        this.tweens.add({ targets: this.countText, alpha: 0, delay: 500, duration: 300, onComplete: () => { if (this.state.phase !== 'done') this.countText.setVisible(false); } });
        shake(this, 0.004, 120);
        break;
      }
      case 'pinReleased': Audio.sfx('groan'); break;
      case 'escape': {
        Audio.sfx('whistle');
        this.announce('ESCAPE!', { size: P ? 56 : 70, hold: 700, color: '#8bc34a' });
        const p = pos(e.by);
        this.react(e.by, 'cheer', p.x, p.y - 170);
        break;
      }
      case 'escapeMissed': Audio.sfx('click'); break;
      case 'ringOut': {
        Audio.sfx('whistle');
        this.announce('OUT OF THE RING!', { size: P ? 50 : 64, hold: 900, color: '#ef5350', sub: 'Back to the middle, you two.' });
        break;
      }
      case 'reset': { this.announce('WRESTLE!', { size: P ? 60 : 72, hold: 500, color: '#f5c518' }); break; }
      case 'getUp': break;
      case 'win': this.win(e.winner); break;
    }
  }

  private win(winner: 0 | 1): void {
    this.running = false;
    const W = this.W, P = this.portrait;
    this.countText.setText('3').setVisible(true).setAlpha(1).setScale(1);
    this.tweens.add({ targets: this.countText, alpha: 0, delay: 500, duration: 300 });
    Audio.sfx('whistle');
    Audio.sfx('cheer');
    this.sprites[winner].cheer();
    this.sprites[other(winner)].setPose('down');
    const p = this.screenOf(winner);
    this.react(winner, 'cheer', p.x, p.y - 180);
    confetti(this, W / 2, this.H * 0.4, 80);
    this.time.delayedCall(500, () => {
      this.announce(`${this.name(winner).toUpperCase()} WINS THE BELT!`, { size: P ? 54 : 72, hold: 1600, color: '#f5c518' });
      const belt = this.add.image(W / 2, this.H * 0.6, 'belt').setDepth(9150).setScale(0.2).setAlpha(0);
      this.tweens.add({ targets: belt, scale: P ? 1.4 : 1.6, alpha: 1, duration: 500, ease: 'Back.Out' });
      this.tweens.add({ targets: belt, y: belt.y - 20, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    });
    const secs = Math.round(this.state.time);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    this.time.delayedCall(2200, () => this.finishMatch({
      winnerSlot: winner,
      summary: `Pinned with a three-count at ${mm}:${ss}`,
      scores: ['PIN', 'PIN'].map((v, i) => (i === winner ? 'PIN (1-2-3)' : 'pinned')) as [string, string],
    }));
  }

  // ---------- render ----------
  private render(): void {
    const s = this.state;
    const t = WRESTLING_TUNING;
    const pr = this.proj;
    const W = this.W, H = this.H, P = this.portrait;
    const fx = this.fx;
    fx.clear();
    this.pinLabel.setVisible(false);
    // sprites
    const order: (0 | 1)[] = s.w[0].z > s.w[1].z ? [0, 1] : [1, 0];
    for (const slot of order) {
      const w = s.w[slot];
      const p = pr.project(w.x, WRESTLING_VISUAL.cushionHeight, w.z);
      const sp = this.sprites[slot];
      const scale = p.scale * WRESTLING_VISUAL.spriteHeight / 220;
      sp.setPosition(p.sx, p.sy);
      sp.sprite.setScale(scale);
      sp.sprite.setY(-220 * 0.5 * scale + 14 * scale);
      sp.shadow.setScale(1.1 * scale, 0.9 * scale);
      sp.setDepth(100 + (10 - w.z) * 10);
      sp.setFacing(w.facing);
      if (s.phase !== 'done') {
        switch (w.state) {
          case 'idle': if (w.moving) sp.run(); else sp.idle(); break;
          case 'stagger': sp.setPose('dizzy'); break;
          case 'grapple': sp.setPose('grapple'); break;
          case 'down': sp.setPose('down'); break;
          case 'pinned': sp.setPose('down'); break;
          case 'pinning': sp.setPose('push'); break;
        }
      }
      // vulnerability indicator
      if (isVulnerable(w)) {
        const left = vulnerabilityLeft(w);
        const frac = w.state === 'pinned' ? 1 : left / t.downDuration;
        const pulse = 0.55 + 0.35 * Math.sin(s.time * 9);
        const rx = 0.9 * p.scale, ry = 0.38 * p.scale;
        fx.lineStyle(6, 0xffeb3b, pulse);
        fx.strokeEllipse(p.sx, p.sy + 4, rx * 2, ry * 2);
        fx.fillStyle(0xffeb3b, 0.12 + 0.1 * pulse);
        fx.fillEllipse(p.sx, p.sy + 4, rx * 2, ry * 2);
        // vulnerability timer bar under the label
        const tw = Math.min(rx * 1.6, 260), th = 10;
        fx.fillStyle(0x000000, 0.5);
        fx.fillRoundedRect(p.sx - tw / 2 - 3, p.sy + ry + 40 - 3, tw + 6, th + 6, 5);
        fx.fillStyle(0xff7043, 0.95);
        fx.fillRoundedRect(p.sx - tw / 2, p.sy + ry + 40, tw * frac, th, 4);
        this.pinLabel.setVisible(true).setPosition(p.sx, p.sy + ry + 24).setText(w.state === 'pinned' ? 'PINNED!' : 'PIN WINDOW');
      }
      // active-player ring under a human's wrestler in single player
      if (!this.isAI(slot) && this.match.mode === 'single' && w.state !== 'down' && w.state !== 'pinned') {
        fx.lineStyle(3, 0xf5c518, 0.6);
        fx.strokeEllipse(p.sx, p.sy + 4, 0.7 * p.scale * 2, 0.3 * p.scale * 2);
      }
    }
    // grapple line between them
    if (s.grapple.active) {
      const a = this.screenOf(0), b = this.screenOf(1);
      fx.lineStyle(4, 0xffffff, 0.35);
      fx.lineBetween(a.x, a.y - 60, b.x, b.y - 60);
    }
    // ---- HUD graphics ----
    const hud = this.hudFx;
    hud.clear();
    for (const slot of [0, 1] as const) {
      const r = this.panelRect(slot);
      const x = r.x + 120, y = r.y + 72, w = r.width - 140, h = 20;
      hud.fillStyle(0x000000, 0.5);
      hud.fillRoundedRect(x - 3, y - 3, w + 6, h + 6, 8);
      hud.fillStyle(0x333333, 1);
      hud.fillRoundedRect(x, y, w, h, 6);
      const f = Math.max(0, s.w[slot].stamina / t.staminaMax);
      hud.fillStyle(f > 0.5 ? 0xf5c518 : f > 0.25 ? 0xff8a2a : 0xef5350, 1);
      if (f > 0) hud.fillRoundedRect(x, y, w * f, h, 6);
    }
    // grapple advantage bar (bottom centre)
    const bw = P ? W - 360 : 520, bh = 28;
    const bx = W / 2 - bw / 2, by = P ? H - 540 : H - 82;
    hud.fillStyle(0x0d1f10, 0.85);
    hud.fillRoundedRect(bx - 16, by - 44, bw + 32, bh + 60, 14);
    hud.lineStyle(3, THEME.accent, 0.8);
    hud.strokeRoundedRect(bx - 16, by - 44, bw + 32, bh + 60, 14);
    hud.fillStyle(0x333333, 1);
    hud.fillRoundedRect(bx, by, bw, bh, 8);
    const adv = s.grapple.active ? s.grapple.advantage : 0;
    const split = (adv + 1) / 2;
    hud.fillStyle(this.players[0].character.accent, s.grapple.active ? 1 : 0.35);
    hud.fillRoundedRect(bx, by, bw * split, bh, { tl: 8, bl: 8, tr: 0, br: 0 });
    hud.fillStyle(this.players[1].character.accent, s.grapple.active ? 1 : 0.35);
    hud.fillRoundedRect(bx + bw * split, by, bw * (1 - split), bh, { tl: 0, bl: 0, tr: 8, br: 8 });
    hud.fillStyle(0xffffff, 1);
    hud.fillRect(bx + bw * split - 3, by - 6, 6, bh + 12);
    this.barLabel.setText(s.grapple.active ? (P ? 'TUG! push + tap GRAB • SHOVE = takedown' : 'GRAPPLE ADVANTAGE — push toward them, tap GRAB, SHOVE to take down') : 'GRAPPLE ADVANTAGE');
    // escape bar while a pin is active
    if (s.pin.active) {
      const def = other(s.pin.attacker);
      const ew = P ? W - 200 : 620, eh = 34;
      const ex = W / 2 - ew / 2, ey = P ? H * 0.62 : H * 0.72;
      hud.fillStyle(0x0d1f10, 0.9);
      hud.fillRoundedRect(ex - 20, ey - 60, ew + 40, eh + 90, 16);
      hud.lineStyle(4, 0xef5350, 0.9);
      hud.strokeRoundedRect(ex - 20, ey - 60, ew + 40, eh + 90, 16);
      hud.fillStyle(0x333333, 1);
      hud.fillRoundedRect(ex, ey, ew, eh, 8);
      const win = t.escapeWindow;
      hud.fillStyle(0x8bc34a, 1);
      hud.fillRect(ex + ew * (0.5 - win / 2), ey, ew * win, eh);
      const inWin = escapeWindowHit(s.pin.marker);
      hud.fillStyle(s.pin.lockout > 0 ? 0xef5350 : inWin ? 0xffffff : 0xf5c518, 1);
      hud.fillRoundedRect(ex + ew * s.pin.marker - 6, ey - 8, 12, eh + 16, 4);
      const human = !this.isAI(def);
      this.escapeLabel.setVisible(true).setPosition(W / 2, ey - 34)
        .setText(human ? `${this.name(def).toUpperCase()}: TAP ESCAPE WHEN THE MARKER IS IN THE GREEN${s.pin.lockout > 0 ? '  (locked!)' : ''}` : `${this.name(s.pin.attacker).toUpperCase()} HAS THE PIN — ${this.name(def)} is trying to escape`)
        .setColor(s.pin.lockout > 0 ? '#ef5350' : '#ffffff');
      // count progress
      const cp = (s.pin.count + s.pin.progress / t.pinCountSeconds) / t.pinCounts;
      hud.fillStyle(0x222222, 1);
      hud.fillRoundedRect(ex, ey + eh + 10, ew, 12, 6);
      hud.fillStyle(0xf5c518, 1);
      hud.fillRoundedRect(ex, ey + eh + 10, ew * cp, 12, 6);
    } else {
      this.escapeLabel.setVisible(false);
    }
    // status line
    if (s.phase === 'fight') {
      const a = s.w[0], b = s.w[1];
      let msg = '';
      if (s.pin.active) msg = `${this.name(s.pin.attacker)} is going for the pin! Count: ${s.pin.count}`;
      else if (s.grapple.active) msg = 'Locked up!';
      else if (a.state === 'down') msg = `${this.name(0)} is down — ${this.name(1)} can pin!`;
      else if (b.state === 'down') msg = `${this.name(1)} is down — ${this.name(0)} can pin!`;
      else if (a.state === 'stagger' || b.state === 'stagger') msg = `${a.state === 'stagger' ? this.name(0) : this.name(1)} is staggered!`;
      this.setStatus(msg);
    } else if (s.phase === 'ringout') {
      this.setStatus('Back in the ring!');
    }
    const secs = Math.floor(s.time);
    this.setSub(`First three-count wins  •  ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`);
    this.setTurn(null);
  }
}
