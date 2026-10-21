import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { displayStyle, textStyle, confetti, impact, shake } from '../../core/ui';
import type { Controls } from '../../core/input';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintCarpet, paintConcrete, paintCouchFront, paintLamp, paintPennant, paintPoster, roundRect, shade } from '../../art/environment';
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
      // ceiling / joists above the wall top
      ctx.fillStyle = '#2b1d12';
      ctx.fillRect(0, 0, W, H);
      const wallTop = pr.project(0, V.wallHeight, wz).sy;
      const wallBot = pr.project(0, 0, wz).sy;
      // floor everywhere below the horizon, then walls on top
      paintConcrete(ctx, 0, pr.cam.horizonY - 2, W, H - pr.cam.horizonY + 2, 31);
      // braided rugs on the floor
      const rug = (x: number, z: number, r: number) => {
        const p = pr.project(x, 0, z);
        ctx.save();
        ctx.translate(p.sx, p.sy);
        ctx.scale(1, 0.45);
        ctx.globalAlpha = 0.8;
        for (let i = 7; i >= 0; i--) {
          ctx.fillStyle = ['#6e5a4a', '#8a7a62', '#5c6b4e', '#7a6350'][i % 4];
          ctx.beginPath(); ctx.arc(0, 0, r * p.scale * (i + 1) / 8, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.restore();
      };
      rug(-4.0, 2.9, 0.9);
      rug(3.8, 2.0, 0.7);
      // side walls (cinder block)
      const sideWall = (sx: number) => {
        const c0 = pr.project(sx, 0, -2), c1 = pr.project(sx, V.wallHeight, -2), c2 = pr.project(sx, V.wallHeight, wz), c3 = pr.project(sx, 0, wz);
        const g = ctx.createLinearGradient(c0.sx, 0, c3.sx, 0);
        g.addColorStop(0, '#8d8a80'); g.addColorStop(1, '#6e6b62');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(c0.sx, c0.sy); ctx.lineTo(c1.sx, c1.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(c3.sx, c3.sy); ctx.closePath(); ctx.fill();
        ctx.save(); ctx.clip();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 2;
        for (let h = 0; h <= V.wallHeight; h += 0.25) {
          const a = pr.project(sx, h, -2), b = pr.project(sx, h, wz);
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        }
        for (let z = -2; z <= wz; z += 0.5) {
          const a = pr.project(sx, 0, z), b = pr.project(sx, V.wallHeight, z);
          ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
        }
        ctx.restore();
      };
      sideWall(-V.sideX);
      sideWall(V.sideX);
      // back wall: cinder block with a warm wash
      const wl = pr.project(-V.sideX, 0, wz).sx, wr = pr.project(V.sideX, 0, wz).sx;
      const bg = ctx.createLinearGradient(0, wallTop, 0, wallBot);
      bg.addColorStop(0, '#7d7a70'); bg.addColorStop(0.6, '#a39f93'); bg.addColorStop(1, '#8a877d');
      ctx.fillStyle = bg;
      ctx.fillRect(wl, wallTop, wr - wl, wallBot - wallTop);
      const bs = pr.scaleAt(wz);
      ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.lineWidth = 2;
      for (let y = wallTop; y < wallBot; y += 0.25 * bs) { ctx.beginPath(); ctx.moveTo(wl, y); ctx.lineTo(wr, y); ctx.stroke(); }
      let row = 0;
      for (let y = wallTop; y < wallBot; y += 0.25 * bs, row++) {
        for (let x = wl + (row % 2) * 0.25 * bs; x < wr; x += 0.5 * bs) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 0.25 * bs); ctx.stroke(); }
      }
      // ceiling joists
      ctx.fillStyle = '#3a2817';
      for (let i = -8; i <= 8; i++) {
        const a = pr.project(i * 1.2, V.wallHeight + 0.05, -2.5), b = pr.project(i * 1.2, V.wallHeight + 0.05, wz);
        ctx.beginPath(); ctx.moveTo(a.sx - 10, Math.min(a.sy, 0)); ctx.lineTo(b.sx - 4, b.sy); ctx.lineTo(b.sx + 4, b.sy); ctx.lineTo(a.sx + 10, Math.min(a.sy, 0)); ctx.closePath(); ctx.fill();
      }
      // hanging bulbs
      for (const x of [-2.5, 2.5]) {
        const p = pr.project(x, V.wallHeight - 0.35, 2.5);
        ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p.sx, p.sy - 0.35 * p.scale); ctx.lineTo(p.sx, p.sy); ctx.stroke();
        const glow = ctx.createRadialGradient(p.sx, p.sy, 2, p.sx, p.sy, 0.9 * p.scale);
        glow.addColorStop(0, 'rgba(255,235,170,0.9)'); glow.addColorStop(0.2, 'rgba(255,225,150,0.35)'); glow.addColorStop(1, 'rgba(255,225,150,0)');
        ctx.fillStyle = glow; ctx.fillRect(p.sx - p.scale, p.sy - p.scale, 2 * p.scale, 2 * p.scale);
        ctx.fillStyle = '#fff2b0'; ctx.beginPath(); ctx.arc(p.sx, p.sy, 0.06 * p.scale, 0, Math.PI * 2); ctx.fill();
      }
      // stairs (left)
      const stairX = -4.3;
      for (let i = 0; i < 7; i++) {
        const z0 = wz - 0.2 - i * 0.42, h0 = i * 0.3;
        const a = pr.project(stairX - 0.9, h0 + 0.3, z0), b = pr.project(stairX + 0.3, h0 + 0.3, z0), c = pr.project(stairX + 0.3, h0 + 0.3, z0 + 0.42), d = pr.project(stairX - 0.9, h0 + 0.3, z0 + 0.42);
        ctx.fillStyle = i % 2 ? '#8a5a35' : '#9a6a40';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.fill();
        const e = pr.project(stairX - 0.9, h0, z0), f = pr.project(stairX + 0.3, h0, z0);
        ctx.fillStyle = '#5c3a1e';
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(f.sx, f.sy); ctx.lineTo(e.sx, e.sy); ctx.closePath(); ctx.fill();
      }
      // couch against the back wall, lamp beside it
      const cp = pr.project(-0.3, 0, wz - 0.1);
      const cs = cp.scale;
      paintCouchFront(ctx, cp.sx - 1.1 * cs, cp.sy - 0.95 * cs, 2.4 * cs, 0.95 * cs, '#5f6b3f');
      // plaid pattern on the couch
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = '#c9a35a'; ctx.lineWidth = 2;
      for (let x = cp.sx - 1.1 * cs; x < cp.sx + 1.3 * cs; x += 0.18 * cs) { ctx.beginPath(); ctx.moveTo(x, cp.sy - 0.95 * cs); ctx.lineTo(x, cp.sy); ctx.stroke(); }
      for (let y = cp.sy - 0.95 * cs; y < cp.sy; y += 0.18 * cs) { ctx.beginPath(); ctx.moveTo(cp.sx - 1.1 * cs, y); ctx.lineTo(cp.sx + 1.3 * cs, y); ctx.stroke(); }
      ctx.restore();
      const lp = pr.project(-2.0, 0, wz - 0.15);
      paintLamp(ctx, lp.sx, lp.sy - 0.5 * lp.scale, lp.scale / 95);
      // pennant and picture
      const pn = pr.project(-3.0, 2.0, wz);
      paintPennant(ctx, pn.sx, pn.sy, 0.9 * bs, 0.4 * bs, '#f5c518', 'ACADEMY HILL');
      const po = pr.project(1.4, 1.95, wz);
      paintPoster(ctx, po.sx, po.sy, 0.7 * bs, 0.5 * bs, '#3f6b3a', 'PINES');
      // shelves with boxes (right side) and the belt chair
      const sp = pr.project(this.portrait ? 3.1 : 4.3, 0, wz - 0.05);
      const ss = sp.scale;
      ctx.fillStyle = '#4a4a4a';
      for (let i = 0; i < 4; i++) ctx.fillRect(sp.sx - 0.6 * ss, sp.sy - (0.5 + i * 0.5) * ss, 1.3 * ss, 0.05 * ss);
      ctx.fillRect(sp.sx - 0.62 * ss, sp.sy - 2.05 * ss, 0.05 * ss, 2.05 * ss);
      ctx.fillRect(sp.sx + 0.67 * ss, sp.sy - 2.05 * ss, 0.05 * ss, 2.05 * ss);
      const boxCols = ['#b58b5a', '#6b9bd0', '#c9b58a', '#9b6b4a', '#d0d0d0', '#7f9a6b'];
      for (let i = 0; i < 6; i++) {
        const bx = sp.sx - 0.55 * ss + (i % 3) * 0.42 * ss;
        const by = sp.sy - (0.5 + Math.floor(i / 3) * 0.5) * ss - 0.4 * ss;
        ctx.fillStyle = boxCols[i];
        ctx.fillRect(bx, by, 0.38 * ss, 0.38 * ss);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.strokeRect(bx, by, 0.38 * ss, 0.38 * ss);
      }
      ctx.fillStyle = '#eee'; ctx.font = `bold ${Math.round(0.11 * ss)}px Arial`; ctx.textAlign = 'center';
      ctx.fillText('CURTAINS', sp.sx + 0.08 * ss, sp.sy - 1.2 * ss);
      // folding chair with the belt
      const ch = pr.project(this.portrait ? 2.1 : 2.7, 0, 2.2);
      const chs = ch.scale;
      ctx.strokeStyle = '#8a8a8a'; ctx.lineWidth = Math.max(2, 0.03 * chs);
      ctx.beginPath(); ctx.moveTo(ch.sx - 0.25 * chs, ch.sy); ctx.lineTo(ch.sx - 0.2 * chs, ch.sy - 0.45 * chs); ctx.moveTo(ch.sx + 0.25 * chs, ch.sy); ctx.lineTo(ch.sx + 0.2 * chs, ch.sy - 0.45 * chs); ctx.stroke();
      ctx.fillStyle = '#6b6b6b';
      roundRect(ctx, ch.sx - 0.25 * chs, ch.sy - 0.5 * chs, 0.5 * chs, 0.1 * chs, 3); ctx.fill();
      roundRect(ctx, ch.sx - 0.22 * chs, ch.sy - 0.95 * chs, 0.44 * chs, 0.35 * chs, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(ch.sx - 0.2 * chs, ch.sy - 1.25 * chs, 0.4 * chs, 0.2 * chs);
      ctx.fillStyle = '#222'; ctx.font = `bold ${Math.round(0.1 * chs)}px Arial`; ctx.textAlign = 'center';
      ctx.fillText('THE BELT ↓', ch.sx, ch.sy - 1.11 * chs);
      const belt = this.textures.get('belt').getSourceImage() as HTMLCanvasElement;
      ctx.drawImage(belt, ch.sx - 0.3 * chs, ch.sy - 0.78 * chs, 0.6 * chs, 0.23 * chs);
      // ---- the cushion ring ----
      this.paintRing(ctx);
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
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 8]);
    ctx.beginPath(); chalk.forEach((p, i) => (i ? ctx.lineTo(p.sx, p.sy) : ctx.moveTo(p.sx, p.sy))); ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);
    const lbl = pr.project(-half - 0.5, 0, -0.2);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `italic ${Math.round(0.1 * lbl.scale)}px "Trebuchet MS", Arial`;
    ctx.textAlign = 'right';
    ['HOMEMADE', 'CUSHION RING', '10 x 10 FT'].forEach((line, i) => ctx.fillText(line, lbl.sx, lbl.sy + i * 0.12 * lbl.scale));
    const fabrics = ['#6b6b3f', '#7a6a4a', '#5f6b3f', '#8a6a3a', '#6b5a4a', '#6b6b3f', '#5f6b3f', '#7a6a4a', '#8a7a5a'];
    const cell = t.ringSize / 3;
    // far rows first
    for (let row = 2; row >= 0; row--) {
      for (let col = 0; col < 3; col++) {
        const x0 = -half + col * cell, x1 = x0 + cell;
        const z1 = -half + row * cell + cell, z0 = z1 - cell; // z0 near edge
        const idx = row * 3 + col;
        const base = fabrics[idx];
        // front face
        const f0 = pr.project(x0, 0, z0), f1 = pr.project(x1, 0, z0), f2 = pr.project(x1, h, z0), f3 = pr.project(x0, h, z0);
        ctx.fillStyle = shade(base, -0.35);
        ctx.beginPath(); ctx.moveTo(f0.sx, f0.sy); ctx.lineTo(f1.sx, f1.sy); ctx.lineTo(f2.sx, f2.sy); ctx.lineTo(f3.sx, f3.sy); ctx.closePath(); ctx.fill();
        // top face
        const t0 = pr.project(x0 + 0.02, h, z0 + 0.02), t1 = pr.project(x1 - 0.02, h, z0 + 0.02), t2 = pr.project(x1 - 0.02, h, z1 - 0.02), t3 = pr.project(x0 + 0.02, h, z1 - 0.02);
        const g = ctx.createLinearGradient(t0.sx, t3.sy, t0.sx, t0.sy);
        g.addColorStop(0, shade(base, -0.1)); g.addColorStop(0.5, shade(base, 0.12)); g.addColorStop(1, shade(base, -0.05));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.moveTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy); ctx.lineTo(t2.sx, t2.sy); ctx.lineTo(t3.sx, t3.sy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
        // fabric detail: plaid blanket on some, piping on others
        ctx.save();
        ctx.clip();
        if (idx % 4 === 1 || idx === 6) {
          ctx.globalAlpha = 0.28;
          ctx.strokeStyle = idx === 6 ? '#d9b36b' : '#3a2a1a';
          ctx.lineWidth = 2;
          for (let k = 0; k <= 6; k++) {
            const a = pr.project(x0 + (k / 6) * cell, h, z0), b = pr.project(x0 + (k / 6) * cell, h, z1);
            ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
            const c = pr.project(x0, h, z0 + (k / 6) * cell), d = pr.project(x1, h, z0 + (k / 6) * cell);
            ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
          }
        } else {
          ctx.globalAlpha = 0.18;
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1.5;
          for (let k = 0; k < 40; k++) {
            const px = x0 + ((k * 0.618) % 1) * cell, pz = z0 + ((k * 0.382) % 1) * cell;
            const p = pr.project(px, h, pz);
            ctx.beginPath(); ctx.moveTo(p.sx - 3, p.sy); ctx.lineTo(p.sx + 3, p.sy + 1); ctx.stroke();
          }
        }
        ctx.restore();
        // soft highlight along the near edge
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy); ctx.stroke();
      }
    }
    void paintCarpet;
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
    return { x: c.axis.x, y: c.axis.y, grapple: c.isDown('a'), grappleJust: c.justDown('a'), shoveJust: c.justDown('b'), escapeJust: c.justDown('c') };
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
