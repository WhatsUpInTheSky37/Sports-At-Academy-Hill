import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, impact, confetti, shake } from '../../core/ui';
import type { Controls } from '../../core/input';
import { CharacterSprite } from '../../art/characters';
import { createCanvas, paintAsphalt, paintGrass, paintHouseFront, paintPine, paintSky, paintTreeSide, rng } from '../../art/environment';
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
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `hockey-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const cfg = this.cfg;
      const horizon = pr.cam.horizonY;
      paintSky(ctx, W, H, horizon + 2);
      paintGrass(ctx, 0, horizon, W, H - horizon, 11, '#5a9638');
      const r = rng(31);
      // far neighbourhood beyond the fence
      for (let i = 0; i < 9; i++) {
        const x = -30 + i * 7 + r() * 3;
        const z = cfg.rinkL + 16 + r() * 14;
        const p = pr.project(x, 0, z);
        paintHouseFront(ctx, p.sx - 4 * p.scale, p.sy - 5 * p.scale, 8 * p.scale, 5 * p.scale, { siding: ['#f1e6c8', '#d9e4f0', '#e8d4c0'][i % 3] });
      }
      for (let i = 0; i < 18; i++) {
        const x = -36 + i * 4.2 + r() * 2;
        const z = cfg.rinkL + 10 + r() * 16;
        const p = pr.project(x, 0, z);
        paintTreeSide(ctx, p.sx, p.sy, 7 * p.scale, 60 + i);
      }
      // backyard fence across the far end
      const fz = cfg.rinkL + 5.5;
      const fl = pr.project(-16, 0, fz), fr = pr.project(16, 0, fz), ft = pr.project(0, 1.8, fz);
      const fh = fl.sy - ft.sy;
      const fg = ctx.createLinearGradient(0, ft.sy, 0, fl.sy);
      fg.addColorStop(0, '#a87a4c'); fg.addColorStop(1, '#6e4a2a');
      ctx.fillStyle = fg;
      ctx.fillRect(fl.sx, ft.sy, fr.sx - fl.sx, fh);
      ctx.strokeStyle = 'rgba(40,20,5,0.4)';
      ctx.lineWidth = 1.5;
      const slat = Math.max(4, 0.18 * fl.scale);
      for (let x = fl.sx; x < fr.sx; x += slat) { ctx.beginPath(); ctx.moveTo(x, ft.sy); ctx.lineTo(x, fl.sy); ctx.stroke(); }
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(fl.sx, ft.sy + fh * 0.25, fr.sx - fl.sx, 3);
      ctx.fillRect(fl.sx, ft.sy + fh * 0.7, fr.sx - fl.sx, 3);
      // flower beds just before the fence
      for (let i = 0; i < 14; i++) {
        const p = pr.project(-7 + i * 1.1 + r() * 0.4, 0, cfg.rinkL + 4.2 + r() * 0.8);
        ctx.fillStyle = ['#e5533d', '#f5c518', '#f48fb1', '#ffffff'][i % 4];
        ctx.beginPath(); ctx.arc(p.sx, p.sy - 0.3 * p.scale, 0.18 * p.scale, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#2f7a2a';
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy, 0.35 * p.scale, 0.15 * p.scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      // driveway trapezoid
      const hw = cfg.rinkW / 2 + 0.3;
      const nearZ = -HOCKEY_VISUAL.camZ + 0.25; // just in front of the camera
      const a = pr.project(-hw, 0, nearZ), b = pr.project(hw, 0, nearZ), c = pr.project(hw, 0, cfg.rinkL + 3.5), d = pr.project(-hw, 0, cfg.rinkL + 3.5);
      ctx.save();
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.lineTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.closePath(); ctx.clip();
      paintAsphalt(ctx, 0, horizon, W, H - horizon, 13, '#6f6c68');
      // perspective-scaled cracks/patches for depth
      for (let i = 0; i < 26; i++) {
        const p = pr.project((r() - 0.5) * cfg.rinkW, 0, r() * cfg.rinkL);
        ctx.fillStyle = r() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy, (0.2 + r() * 0.4) * p.scale, (0.05 + r() * 0.08) * p.scale, 0, 0, Math.PI * 2); ctx.fill();
      }
      // grass creeping into the cracks, like the real driveway
      ctx.strokeStyle = 'rgba(95,150,60,0.5)';
      for (let z = 1; z < cfg.rinkL; z += 2 + r() * 2.5) {
        const a = pr.project(-cfg.rinkW / 2 + r(), 0, z), b = pr.project(cfg.rinkW / 2 - r(), 0, z + (r() - 0.5) * 0.4);
        ctx.lineWidth = Math.max(1, 0.025 * a.scale);
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
      ctx.restore();
      // chalk side lines + goal lines + centre line
      const line = (x1: number, z1: number, x2: number, z2: number, col: string, w: number, dash?: number[]) => {
        const p1 = pr.project(x1, 0, z1), p2 = pr.project(x2, 0, z2);
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.setLineDash(dash ?? []);
        ctx.beginPath(); ctx.moveTo(p1.sx, p1.sy); ctx.lineTo(p2.sx, p2.sy); ctx.stroke();
        ctx.setLineDash([]);
      };
      line(-cfg.rinkW / 2, nearZ, -cfg.rinkW / 2, cfg.rinkL + 2, 'rgba(255,255,255,0.85)', 4);
      line(cfg.rinkW / 2, nearZ, cfg.rinkW / 2, cfg.rinkL + 2, 'rgba(255,255,255,0.85)', 4);
      line(-cfg.rinkW / 2, cfg.rinkL, cfg.rinkW / 2, cfg.rinkL, 'rgba(255,80,80,0.9)', 3);
      line(-cfg.rinkW / 2, 0, cfg.rinkW / 2, 0, 'rgba(255,80,80,0.9)', 5);
      line(-cfg.rinkW / 2, cfg.rinkL / 2, cfg.rinkW / 2, cfg.rinkL / 2, 'rgba(255,255,255,0.6)', 3, [18, 12]);
      const cp = pr.project(0, 0, cfg.rinkL / 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(cp.sx, cp.sy, 0.9 * cp.scale, 0.33 * cp.scale, 0, 0, Math.PI * 2); ctx.stroke();
      // house along the left (side wall with windows + porch steps)
      const hz0 = nearZ + 0.5, hz1 = cfg.rinkL - 2;
      const hx = -cfg.rinkW / 2 - 2.2;
      const wallH = 5.5;
      const q0 = pr.project(hx, 0, hz0), q1 = pr.project(hx, 0, hz1), q2 = pr.project(hx, wallH, hz1), q3 = pr.project(hx, wallH, hz0);
      const wg = ctx.createLinearGradient(0, q3.sy, 0, q0.sy);
      wg.addColorStop(0, '#f5ecd3'); wg.addColorStop(1, '#d8c9a3');
      ctx.fillStyle = wg;
      ctx.beginPath(); ctx.moveTo(q0.sx, q0.sy); ctx.lineTo(q1.sx, q1.sy); ctx.lineTo(q2.sx, q2.sy); ctx.lineTo(q3.sx, q3.sy); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2; ctx.stroke();
      // siding lines
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      for (let h = 0.3; h < wallH; h += 0.3) {
        const s0 = pr.project(hx, h, hz0), s1 = pr.project(hx, h, hz1);
        ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(s1.sx, s1.sy); ctx.stroke();
      }
      // stone foundation
      const b0 = pr.project(hx, 0.9, hz0), b1 = pr.project(hx, 0.9, hz1);
      ctx.fillStyle = '#9a9388';
      ctx.beginPath(); ctx.moveTo(q0.sx, q0.sy); ctx.lineTo(q1.sx, q1.sy); ctx.lineTo(b1.sx, b1.sy); ctx.lineTo(b0.sx, b0.sy); ctx.closePath(); ctx.fill();
      // windows with green shutters
      for (let z = hz0 + 2; z < hz1 - 2; z += 4.5) {
        const w0 = pr.project(hx, 2.2, z), w1 = pr.project(hx, 2.2, z + 1.4), w2 = pr.project(hx, 3.8, z + 1.4), w3 = pr.project(hx, 3.8, z);
        ctx.fillStyle = '#9fd3ff';
        ctx.beginPath(); ctx.moveTo(w0.sx, w0.sy); ctx.lineTo(w1.sx, w1.sy); ctx.lineTo(w2.sx, w2.sy); ctx.lineTo(w3.sx, w3.sy); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke();
        const s0 = pr.project(hx, 2.2, z - 0.45), s1 = pr.project(hx, 3.8, z - 0.45);
        ctx.fillStyle = '#2e5d3a';
        ctx.beginPath(); ctx.moveTo(s0.sx, s0.sy); ctx.lineTo(w0.sx, w0.sy); ctx.lineTo(w3.sx, w3.sy); ctx.lineTo(s1.sx, s1.sy); ctx.closePath(); ctx.fill();
        const t0 = pr.project(hx, 2.2, z + 1.85), t1 = pr.project(hx, 3.8, z + 1.85);
        ctx.beginPath(); ctx.moveTo(w1.sx, w1.sy); ctx.lineTo(t0.sx, t0.sy); ctx.lineTo(t1.sx, t1.sy); ctx.lineTo(w2.sx, w2.sy); ctx.closePath(); ctx.fill();
      }
      // roof edge
      const r0 = pr.project(hx - 0.6, wallH + 0.2, hz0 - 0.5), r1 = pr.project(hx - 0.6, wallH + 0.2, hz1 + 0.5), r2 = pr.project(hx + 1.2, wallH + 0.9, hz1 + 0.5), r3 = pr.project(hx + 1.2, wallH + 0.9, hz0 - 0.5);
      ctx.fillStyle = '#4a3328';
      ctx.beginPath(); ctx.moveTo(r0.sx, r0.sy); ctx.lineTo(r1.sx, r1.sy); ctx.lineTo(r2.sx, r2.sy); ctx.lineTo(r3.sx, r3.sy); ctx.closePath(); ctx.fill();
      // shrubs along the house foundation and the right-hand hedge of small pines
      for (let z = nearZ + 1; z < cfg.rinkL; z += 1.6) {
        const p = pr.project(-cfg.rinkW / 2 - 1.1, 0, z);
        paintTreeSide(ctx, p.sx, p.sy, 0.9 * p.scale, 400 + Math.round(z * 10));
      }
      for (let z = nearZ + 0.5; z < cfg.rinkL + 3; z += 2.2) {
        const p = pr.project(cfg.rinkW / 2 + 1.5 + (r() - 0.5) * 0.5, 0, z);
        paintPine(ctx, p.sx, p.sy, (2.2 + r() * 0.8) * p.scale, 500 + Math.round(z * 10));
      }
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
  }

  /** Red-framed nets with mesh. The far net is drawn behind players; the near net's frame in front. */
  private drawNets(): void {
    const cfg = this.cfg;
    const pr = this.proj;
    const drawNet = (g: Phaser.GameObjects.Graphics, z: number, dir: 1 | -1) => {
      const hw = cfg.goalW / 2;
      const h = HOCKEY_VISUAL.netHeight;
      const d = cfg.goalDepth * dir;
      const fl = pr.project(-hw, 0, z), fr = pr.project(hw, 0, z), tl = pr.project(-hw, h, z), tr = pr.project(hw, h, z);
      const bl = pr.project(-hw, 0, z + d), br = pr.project(hw, 0, z + d), btl = pr.project(-hw, h * 0.85, z + d), btr = pr.project(hw, h * 0.85, z + d);
      if (!fl.visible || !bl.visible) return;
      // mesh (back, sides, top)
      g.fillStyle(0xffffff, 0.35);
      g.fillPoints([{ x: bl.sx, y: bl.sy }, { x: br.sx, y: br.sy }, { x: btr.sx, y: btr.sy }, { x: btl.sx, y: btl.sy }], true);
      g.fillStyle(0xffffff, 0.22);
      g.fillPoints([{ x: fl.sx, y: fl.sy }, { x: bl.sx, y: bl.sy }, { x: btl.sx, y: btl.sy }, { x: tl.sx, y: tl.sy }], true);
      g.fillPoints([{ x: fr.sx, y: fr.sy }, { x: br.sx, y: br.sy }, { x: btr.sx, y: btr.sy }, { x: tr.sx, y: tr.sy }], true);
      g.fillPoints([{ x: tl.sx, y: tl.sy }, { x: tr.sx, y: tr.sy }, { x: btr.sx, y: btr.sy }, { x: btl.sx, y: btl.sy }], true);
      g.lineStyle(1, 0xffffff, 0.5);
      const n = 8;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        g.lineBetween(bl.sx + (br.sx - bl.sx) * t, bl.sy + (br.sy - bl.sy) * t, btl.sx + (btr.sx - btl.sx) * t, btl.sy + (btr.sy - btl.sy) * t);
        g.lineBetween(bl.sx + (btl.sx - bl.sx) * t, bl.sy + (btl.sy - bl.sy) * t, br.sx + (btr.sx - br.sx) * t, br.sy + (btr.sy - br.sy) * t);
      }
      // red frame
      const w = Math.max(3, 0.08 * fl.scale);
      g.lineStyle(w, 0xd32f2f, 1);
      g.lineBetween(fl.sx, fl.sy, tl.sx, tl.sy);
      g.lineBetween(fr.sx, fr.sy, tr.sx, tr.sy);
      g.lineBetween(tl.sx, tl.sy, tr.sx, tr.sy);
      g.lineStyle(Math.max(2, w * 0.7), 0xd32f2f, 1);
      g.lineBetween(tl.sx, tl.sy, btl.sx, btl.sy);
      g.lineBetween(tr.sx, tr.sy, btr.sx, btr.sy);
      g.lineBetween(bl.sx, bl.sy, btl.sx, btl.sy);
      g.lineBetween(br.sx, br.sy, btr.sx, btr.sy);
      g.lineBetween(bl.sx, bl.sy, br.sx, br.sy);
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
        this.react(scorer, 'cheer', sp.x, sp.y - 180 * sp.sprite.scale);
        const loser = scorer === 0 ? 1 : 0;
        if (Math.random() < 0.5) this.time.delayedCall(700, () => { const l = this.sprites[loser]; this.react(loser, 'groan', l.x, l.y - 180 * l.sprite.scale); });
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
