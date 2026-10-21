import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, makeButton, impact, confetti } from '../../core/ui';
import { CharacterSprite } from '../../art/characters';
import { createCanvas } from '../../art/environment';
import { paintCabinetHD, paintRoomHD } from './art';
import { BOARD, aiTarget, checkouts, gaussian, scoreAt, targetLabel, targetPoint, type Hit } from './board';
import { DEFAULT_DARTS_RULES, applyDart, createGame, dartsLeft, turnTotal, type DartsState } from './rules';

/** Tuning for the darts scene. */
export const DARTS_CONFIG = {
  /** Keyboard aim speed, mm per second. */
  aimSpeed: 160,
  /** Drag sensitivity: screen px to board mm multiplier (1 = 1:1 after board scaling). */
  dragSensitivity: 1.0,
  /** Hand sway amplitude in mm while resting, and extra while the aim is moving. */
  swayMm: 5,
  swayMoveMm: 9,
  /** Release timing marker speed (radians/sec of the ping-pong). */
  timingSpeed: 3.6,
  /** Landing scatter (mm): base, plus timingError (0..1) * timingErrorMm. */
  baseScatterMm: 3,
  timingErrorMm: 42,
  /** AI landing scatter sd (mm) by difficulty: easy, normal, hard. */
  aiScatterMm: [22, 12, 6],
  /** Max aim distance from the bull, mm. */
  aimLimitMm: 215,
};

type Phase = 'idle' | 'aim' | 'throwing' | 'between' | 'done';

export class DartsScene extends BaseGameScene {
  readonly gameId = 'darts' as const;
  constructor() { super('DartsScene'); }

  private state!: DartsState;
  private phase: Phase = 'idle';
  private boardC = { x: 0, y: 0, r: 0 }; // screen centre + radius px of the scoring area (doubleOuterR)
  private pxPerMm = 1;
  private aim = { x: 0, y: -103 }; // mm, start on T20
  private aimVel = 0;
  private sway = { x: 0, y: 0 };
  private crosshair!: Phaser.GameObjects.Container;
  private timingMeter!: Meter;
  private timingT = 0;
  private timingPos = 0.5;
  private dragLast: { x: number; y: number } | null = null;
  private keys: Record<string, Phaser.Input.Keyboard.Key[]> = {};
  private throwPressed = false;
  private handDart!: Phaser.GameObjects.Image;
  private handHome = { x: 0, y: 0 };
  private stuckDarts: Phaser.GameObjects.GameObject[] = [];
  private chalk: Phaser.GameObjects.Text[] = [];
  private chalkTurn!: Phaser.GameObjects.Text;
  private turnTotalText!: Phaser.GameObjects.Text;
  private dartIcons: Phaser.GameObjects.Image[] = [];
  private checkoutText!: Phaser.GameObjects.Text;
  private hitLabel!: Phaser.GameObjects.Text;
  private aiHint!: Phaser.GameObjects.Text;
  private opponent!: CharacterSprite;
  private aiTimer?: Phaser.Time.TimerEvent;
  private hint = '';
  private aiTween?: Phaser.Tweens.Tween;

  create(): void {
    this.setupShell({ music: 'basement' });
    const W = this.W, H = this.H, P = this.portrait;
    this.state = createGame(DEFAULT_DARTS_RULES, 0);
    this.phase = 'idle';
    this.stuckDarts = [];
    this.chalk = [];
    this.dartIcons = [];
    this.aim = { x: 0, y: -103 };
    // Board placement
    const r = P ? 300 : 250;
    this.boardC = { x: W / 2, y: P ? this.hudBottom + 60 + r : this.hudBottom + 30 + r, r };
    this.pxPerMm = r / BOARD.doubleOuterR;
    this.paintRoom();
    this.paintBoard();
    // Opponent waiting
    const oppSlot: 0 | 1 = 1;
    this.opponent = new CharacterSprite(this, P ? 150 : 230, P ? this.boardC.y + r + 260 : H - 190, this.players[oppSlot].character, P ? 0.9 : 1.05);
    this.opponent.setDepth(60).idle().setFacing(1);
    this.opponentLabel();
    // Chalkboards (on the cabinet doors)
    this.buildChalkboards();
    // Crosshair
    this.crosshair = this.buildCrosshair().setDepth(300);
    // Hand dart
    const hx = P ? W - 150 : W - 420;
    const hy = P ? H - 420 : H - 290;
    this.handHome = { x: hx, y: hy };
    this.handDart = this.add.image(hx, hy, 'dart').setOrigin(0.5, 0).setScale(P ? 2.0 : 2.2).setAngle(-35).setDepth(400);
    this.buildControls();
    this.buildKeys();
    this.hitLabel = this.add.text(0, 0, '').setVisible(false);
    this.refreshHud();
    this.setTurn(0);
    this.beginAfterHowTo(() => this.startTurn(true));
  }

  // ---------- Painting ----------
  private paintRoom(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const key = `darts-room-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const floorY = P ? H - 360 : H - 200;
      const railY = floorY - (P ? 330 : 300);
      paintRoomHD(ctx, { W, H, P, floorY, railY, boardX: this.boardC.x, boardY: this.boardC.y, boardR: this.boardC.r });
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
  }

  private paintBoard(): void {
    const W = this.W, H = this.H;
    const { x: cx, y: cy, r } = this.boardC;
    const key = `darts-board-${W}x${H}`;
    const pad = Math.round(r * (this.portrait ? 1.12 : 1.25));
    const doorW = Math.round(r * (this.portrait ? 0.56 : 0.78));
    const cabW = pad * 2 + 20;
    const totalW = cabW + doorW * 2;
    const cabH = pad * 2 + 20;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(totalW, cabH + 40);
      const ox = doorW + cabW / 2; // board centre in canvas
      const oy = cabH / 2 + 20;
      paintCabinetHD(ctx, { totalW, cabH, doorW, cabW, ox, oy, r });
      this.textures.addCanvas(key, canvas);
    }
    const img = this.add.image(0, 0, key).setDepth(10);
    const ox = doorW + cabW / 2;
    const oy = cabH / 2 + 20;
    img.setPosition(cx - ox + img.width / 2, cy - oy + img.height / 2);
    // remember door chalkboard rects (screen space)
    this.doorRects = [
      new Phaser.Geom.Rectangle(cx - ox + 24, cy - oy + 44, doorW - 28, cabH - 60),
      new Phaser.Geom.Rectangle(cx - ox + totalW - doorW + 14, cy - oy + 44, doorW - 28, cabH - 60),
    ];
  }
  private doorRects: Phaser.Geom.Rectangle[] = [];

  private buildChalkboards(): void {
    const chalkFont = { fontFamily: '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive, sans-serif' };
    this.doorRects.forEach((rect, slot) => {
      this.add.text(rect.centerX, rect.y + 16, this.name(slot as 0 | 1).toUpperCase(), textStyle(this.portrait ? 22 : 26, '#eeeeee', { ...chalkFont })).setOrigin(0.5, 0).setDepth(20);
      this.add.rectangle(rect.centerX, rect.y + 52, rect.width - 30, 2, 0xdddddd, 0.7).setDepth(20);
      const t = this.add.text(rect.centerX, rect.y + 64, '', textStyle(this.portrait ? 22 : 26, '#f0f0f0', { ...chalkFont, align: 'center', lineSpacing: 2 })).setOrigin(0.5, 0).setDepth(20);
      this.chalk.push(t);
    });
    this.chalkTurn = this.add.text(0, 0, '', textStyle(10)).setVisible(false);
  }

  private buildCrosshair(): Phaser.GameObjects.Container {
    const c = this.add.container(this.boardC.x, this.boardC.y);
    const g = this.add.graphics();
    g.lineStyle(4, 0x4ff0ff, 0.95);
    g.strokeCircle(0, 0, 26);
    g.lineStyle(3, 0x4ff0ff, 0.9);
    g.beginPath(); g.moveTo(-46, 0); g.lineTo(-14, 0); g.moveTo(14, 0); g.lineTo(46, 0); g.moveTo(0, -46); g.lineTo(0, -14); g.moveTo(0, 14); g.lineTo(0, 46); g.strokePath();
    g.fillStyle(0x4ff0ff, 1);
    g.fillCircle(0, 0, 3.5);
    const t = this.add.text(0, -58, 'AIM', displayStyle(18, '#4ff0ff', { strokeThickness: 3 })).setOrigin(0.5);
    c.add([g, t]);
    return c;
  }

  private buildControls(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const panel = (x: number, y: number, w: number, h: number) => {
      const g = this.add.graphics().setDepth(900);
      g.fillStyle(0x0d1f10, 0.82);
      g.fillRoundedRect(x, y, w, h, 16);
      g.lineStyle(3, THEME.accent, 0.85);
      g.strokeRoundedRect(x, y, w, h, 16);
      return g;
    };
    // Darts left panel (above the bottom row in portrait, top-right under the P2 panel in landscape)
    const dlW = 250, dlH = 96;
    const dlX = P ? W / 2 - dlW / 2 : W - 20 - dlW;
    const dlY = P ? H - 440 : 150;
    panel(dlX, dlY, dlW, dlH);
    this.add.text(dlX + dlW / 2, dlY + 10, 'DARTS LEFT', displayStyle(18, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    for (let i = 0; i < 3; i++) {
      const d = this.add.image(dlX + dlW / 2 - 56 + i * 56, dlY + 62, 'dart').setScale(0.6).setAngle(-40).setDepth(901);
      this.dartIcons.push(d);
    }
    panel(dlX, dlY + dlH + 10, dlW, 50);
    this.turnTotalText = this.add.text(dlX + dlW / 2, dlY + dlH + 35, 'This turn: 0', displayStyle(22, '#ffffff', { strokeThickness: 0 })).setOrigin(0.5).setDepth(901);
    // Aim hint (bottom-left)
    const ahW = P ? 220 : 300, ahH = 120;
    const rowY = P ? H - 250 : H - 150;
    panel(30, rowY, ahW, ahH);
    this.add.text(30 + ahW / 2, rowY + 12, 'AIM', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.add.text(30 + ahW / 2, rowY + 46, this.useTouch ? 'Drag on the board' : 'WASD / Arrows', textStyle(P ? 20 : 22, '#ffffff')).setOrigin(0.5, 0).setDepth(901);
    this.add.text(30 + ahW / 2, rowY + 80, 'Throw when the bar is centred', textStyle(P ? 15 : 17, THEME.textDim)).setOrigin(0.5, 0).setDepth(901);
    // Timing bar (centre)
    const tbX = P ? 270 : 360, tbW = P ? 520 : W - 720 - 360;
    panel(tbX, rowY, tbW, ahH);
    this.add.text(tbX + tbW / 2, rowY + 12, 'RELEASE TIMING', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.timingMeter = new Meter(this, tbX + 24, rowY + 50, tbW - 48, 26, {
      depth: 901, bg: 0x2a2a2a, fg: 0x000000,
      bands: [
        { from: 0.25, to: 0.75, color: 0x4b6b2a },
        { from: 0.38, to: 0.62, color: 0x8bc34a },
        { from: 0.46, to: 0.54, color: 0xf5c518 },
      ],
    });
    this.timingMeter.set(0, 0.5);
    this.checkoutText = this.add.text(tbX + tbW / 2, rowY + 92, 'FINISH ON A DOUBLE', displayStyle(18, '#ffe082', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    // Throw button (bottom-right)
    const bw = P ? 240 : 300;
    const btn = makeButton(this, W - 30 - bw / 2, rowY + ahH / 2, 'THROW', () => { /* handled on pointerdown */ }, { width: bw, height: 110, fontSize: 44, depth: 900 });
    btn.list.forEach((o) => { if (o instanceof Phaser.GameObjects.Zone) { o.off('pointerup'); o.on('pointerdown', () => { Audio.unlock(); this.throwPressed = true; }); } });
    this.add.text(W - 30 - bw / 2, rowY + ahH + 14, this.useTouch ? 'tap' : 'SPACE / F  •  P2: ENTER / ,', textStyle(16, '#fff3c4')).setOrigin(0.5, 0).setDepth(901);
    this.aiHint = this.add.text(0, 0, '').setVisible(false);
    // Drag to aim over the board area
    const boardZone = new Phaser.Geom.Rectangle(this.boardC.x - this.boardC.r * 1.6, this.boardC.y - this.boardC.r * 1.4, this.boardC.r * 3.2, this.boardC.r * 2.9);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (boardZone.contains(p.x, p.y)) this.dragLast = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragLast || !p.isDown || !this.humanTurn() || this.phase !== 'aim') return;
      const dx = (p.x - this.dragLast.x) / this.pxPerMm * DARTS_CONFIG.dragSensitivity;
      const dy = (p.y - this.dragLast.y) / this.pxPerMm * DARTS_CONFIG.dragSensitivity;
      this.aim.x += dx;
      this.aim.y += dy;
      this.aimVel = Math.min(1, Math.hypot(dx, dy) / 6);
      this.dragLast = { x: p.x, y: p.y };
      this.clampAim();
    });
    const end = () => { this.dragLast = null; };
    this.input.on('pointerup', end);
    this.input.on('pointerupoutside', end);
  }

  private buildKeys(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const map: Record<string, number[]> = { left: [K.A, K.LEFT], right: [K.D, K.RIGHT], up: [K.W, K.UP], down: [K.S, K.DOWN] };
    for (const [name, codes] of Object.entries(map)) this.keys[name] = codes.map((c) => kb.addKey(c, false, false));
    kb.on('keydown', (e: KeyboardEvent) => {
      if ([' ', 'f', 'F', 'Enter', ','].includes(e.key)) this.throwPressed = true;
    });
  }

  private clampAim(): void {
    const d = Math.hypot(this.aim.x, this.aim.y);
    if (d > DARTS_CONFIG.aimLimitMm) {
      this.aim.x *= DARTS_CONFIG.aimLimitMm / d;
      this.aim.y *= DARTS_CONFIG.aimLimitMm / d;
    }
  }

  private humanTurn(): boolean { return !this.isAI(this.state.turn); }

  private opponentLabel(): void {
    // opponent sprite always shows the player who is NOT throwing
  }

  // ---------- Turn flow ----------
  private startTurn(first = false): void {
    if (this.finished) return;
    const t = this.state.turn;
    this.setTurn(t);
    this.phase = 'aim';
    this.aim = { x: 0, y: -103 };
    this.hint = '';
    this.refreshHud();
    // swap the waiting opponent sprite to the player not throwing
    const waiting = t === 0 ? 1 : 0;
    if (this.opponent.character.id !== this.players[waiting].character.id) {
      const { x, y } = this.opponent;
      const sc = this.opponent.charScale;
      this.opponent.destroy();
      this.opponent = new CharacterSprite(this, x, y, this.players[waiting].character, sc);
      this.opponent.setDepth(60).idle().setFacing(1);
    }
    this.handDart.setVisible(true).setPosition(this.handHome.x, this.handHome.y).setScale(this.portrait ? 2.0 : 2.2).setAngle(-35).setAlpha(1);
    if (!first) this.announce(`${this.name(t).toUpperCase()} TO THROW`, { size: this.portrait ? 48 : 60, y: this.boardC.y, hold: 900 });
    if (this.isAI(t)) this.scheduleAI();
  }

  private scheduleAI(): void {
    const left = dartsLeft(this.state);
    const target = aiTarget(this.state.scores[this.state.turn], left);
    const tp = targetPoint(target);
    this.hint = `${this.name(this.state.turn)} aims at ${targetLabel(target)}`;
    this.refreshHud();
    this.aiTween?.stop();
    this.aiTween = this.tweens.add({ targets: this.aim, x: tp.x, y: tp.y, duration: 700, ease: 'Sine.InOut' });
    this.aiTimer = this.time.delayedCall(1250, () => {
      if (this.phase !== 'aim' || this.finished) return;
      const sd = DARTS_CONFIG.aiScatterMm[this.ai <= 0.25 ? 0 : this.ai < 0.75 ? 1 : 2];
      this.throwDart(tp.x + gaussian(sd), tp.y + gaussian(sd));
    });
  }

  private throwDart(mmX: number, mmY: number): void {
    if (this.phase !== 'aim') return;
    this.phase = 'throwing';
    const hit = scoreAt(mmX, mmY);
    const tx = this.boardC.x + mmX * this.pxPerMm;
    const ty = this.boardC.y + mmY * this.pxPerMm;
    Audio.sfx('throw');
    const hd = this.handDart;
    const sx = hd.x, sy = hd.y, ss = hd.scale;
    const dur = 420;
    const start = this.time.now;
    const ev = this.time.addEvent({
      delay: 16, loop: true, callback: () => {
        const p = Math.min(1, (this.time.now - start) / dur);
        const e = p * p;
        hd.x = sx + (tx - sx) * e;
        hd.y = sy + (ty - sy) * e - Math.sin(p * Math.PI) * 90;
        hd.setScale(ss + (1.0 - ss) * p);
        hd.setAngle(-35 + 55 * p);
        if (p >= 1) {
          ev.remove();
          this.landDart(tx, ty, hit);
        }
      },
    });
  }

  private landDart(tx: number, ty: number, hit: Hit): void {
    this.handDart.setVisible(false);
    Audio.sfx('dart');
    impact(this, tx, ty, hit.multiplier === 3 ? 0xf5c518 : 0xffffff, 8, 320, 5);
    const shadow = this.add.image(tx + 5, ty + 7, 'dart').setOrigin(0.5, 0).setScale(1.0, 0.9).setAngle(26).setTint(0x000000).setAlpha(0.45).setDepth(310);
    const contact = this.add.circle(tx, ty, 5, 0x000000, 0.4).setDepth(311);
    const stuck = this.add.image(tx, ty, 'dart').setOrigin(0.5, 0).setScale(1.0).setAngle(20).setDepth(320);
    this.stuckDarts.push(shadow, contact, stuck);
    const before = this.state;
    // label
    const lbl = hit.points === 0 ? 'MISSED THE BOARD' : hit.multiplier === 3 ? `${hit.label}!` : hit.label === 'BULLSEYE' ? 'BULLSEYE!' : hit.label;
    const big = hit.multiplier === 3 || hit.isBull;
    this.hint = `${this.name(before.turn)} hits ${lbl}`;
    const fl = this.add.text(tx, ty - 30, lbl, displayStyle(big ? 40 : 30, big ? '#f5c518' : '#ffffff')).setOrigin(0.5).setDepth(360);
    this.tweens.add({ targets: fl, y: ty - 110, alpha: 0, duration: 1100, ease: 'Quad.Out', onComplete: () => fl.destroy() });
    this.state = applyDart(this.state, hit, DEFAULT_DARTS_RULES);
    this.refreshHud();
    if (this.state.lastEvent === 'win') {
      this.phase = 'done';
      this.announce('GAME SHOT!', { color: '#f5c518', size: this.portrait ? 72 : 90, y: this.boardC.y });
      confetti(this, this.boardC.x, this.boardC.y, 70);
      Audio.sfx('cheer');
      this.react(this.state.winner!, 'cheer', this.handHome.x - 150, this.handHome.y - 40);
      const w = this.state.winner!;
      const other = w === 0 ? 1 : 0;
      const dartsUsed = this.state.history[w].length * 3 - (3 - this.state.dartsThrown);
      this.time.delayedCall(800, () => this.finishMatch({
        winnerSlot: w,
        summary: `${this.name(w)} checked out in ${dartsUsed} darts; ${this.name(other)} had ${this.state.scores[other]} left`,
        scores: w === 0 ? ['0 left', `${this.state.scores[1]} left`] : [`${this.state.scores[0]} left`, '0 left'],
      }));
      return;
    }
    if (this.state.lastEvent === 'bust') {
      this.phase = 'between';
      Audio.sfx('bust');
      this.announce('BUST!', { color: '#ef5350', size: this.portrait ? 64 : 80, y: this.boardC.y, sub: `back to ${before.turnStart}` });
      this.react(before.turn, 'groan', this.handHome.x - 150, this.handHome.y - 40);
      this.time.delayedCall(1700, () => this.nextTurn());
      return;
    }
    if (this.state.lastEvent === 'turnEnd') {
      this.phase = 'between';
      const total = before.turnHits.reduce((a, h) => a + h.points, 0) + hit.points;
      if (total >= 100) { Audio.sfx('cheer'); this.announce(total >= 140 ? `${total}!` : 'TON!', { color: '#f5c518', size: 64, y: this.boardC.y, hold: 800 }); }
      this.time.delayedCall(1200, () => this.nextTurn());
      return;
    }
    // next dart, same player
    this.phase = 'aim';
    this.handDart.setVisible(true).setPosition(this.handHome.x, this.handHome.y).setScale(this.portrait ? 2.0 : 2.2).setAngle(-35);
    if (this.isAI(this.state.turn)) this.scheduleAI();
  }

  private nextTurn(): void {
    if (this.finished) return;
    this.stuckDarts.forEach((d) => d.destroy());
    this.stuckDarts = [];
    this.startTurn();
  }

  private refreshHud(): void {
    const s = this.state;
    for (const slot of [0, 1] as const) {
      this.setScore(slot, `${s.scores[slot]}`);
      const lines = s.history[slot].map((v) => String(v));
      if (slot === s.turn && s.winner === null) lines.push(`${s.scores[slot]} ◄`);
      const max = this.portrait ? 9 : 10;
      this.chalk[slot]?.setText(lines.slice(-max).join('\n'));
    }
    const left = dartsLeft(s);
    this.dartIcons.forEach((d, i) => d.setAlpha(i < left ? 1 : 0.25).setTint(i < left ? 0xffffff : 0x888888));
    this.turnTotalText.setText(`This turn: ${turnTotal(s)}`);
    const co = s.winner === null ? checkouts(s.scores[s.turn], left) : null;
    if (co) this.checkoutText.setText(`CHECKOUT: ${co[0]}${co.length > 1 ? '   (or ' + co.slice(1, 3).join(', ') + ')' : ''}`).setColor('#8bc34a');
    else if (s.scores[s.turn] <= 170 && s.winner === null) this.checkoutText.setText('No finish with these darts — set up a double').setColor('#ffe082');
    else this.checkoutText.setText('FINISH ON A DOUBLE').setColor('#ffe082');
    this.setSub(this.hint ? this.hint : `${this.name(s.turn)} throwing  •  ${left} dart${left === 1 ? '' : 's'} left  •  double out`);
  }

  // ---------- Per frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished) return;
    const dt = Math.min(0.05, dtMs / 1000);
    // keyboard aim
    if (this.phase === 'aim' && this.humanTurn()) {
      let dx = 0, dy = 0;
      const kd = (n: string) => this.keys[n]?.some((k) => k.isDown) ?? false;
      if (kd('left')) dx -= 1;
      if (kd('right')) dx += 1;
      if (kd('up')) dy -= 1;
      if (kd('down')) dy += 1;
      if (dx || dy) {
        this.aim.x += dx * DARTS_CONFIG.aimSpeed * dt;
        this.aim.y += dy * DARTS_CONFIG.aimSpeed * dt;
        this.aimVel = 1;
        this.clampAim();
      }
    }
    this.aimVel = Math.max(0, this.aimVel - dt * 2.5);
    // sway
    this.timingT += dt;
    const amp = DARTS_CONFIG.swayMm + DARTS_CONFIG.swayMoveMm * this.aimVel;
    this.sway.x = Math.sin(this.timingT * 1.9) * amp * 0.8 + Math.sin(this.timingT * 3.1 + 1.2) * amp * 0.3;
    this.sway.y = Math.sin(this.timingT * 2.4 + 0.7) * amp * 0.7 + Math.cos(this.timingT * 1.3) * amp * 0.3;
    const cx = this.boardC.x + (this.aim.x + this.sway.x) * this.pxPerMm;
    const cy = this.boardC.y + (this.aim.y + this.sway.y) * this.pxPerMm;
    this.crosshair.setPosition(cx, cy).setVisible(this.phase === 'aim' || this.phase === 'throwing');
    // timing marker ping-pong
    this.timingPos = 0.5 + 0.5 * Math.sin(this.timingT * DARTS_CONFIG.timingSpeed);
    this.timingMeter.set(0, this.timingPos);
    // throw
    if (this.throwPressed) {
      this.throwPressed = false;
      if (this.phase === 'aim' && this.humanTurn()) {
        const err = Math.abs(this.timingPos - 0.5) * 2;
        const sd = DARTS_CONFIG.baseScatterMm + err * err * DARTS_CONFIG.timingErrorMm;
        this.throwDart(this.aim.x + this.sway.x + gaussian(sd), this.aim.y + this.sway.y + gaussian(sd));
      }
    }
  }
}
