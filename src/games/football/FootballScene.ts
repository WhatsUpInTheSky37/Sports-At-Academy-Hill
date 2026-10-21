import Phaser from 'phaser';
import { BaseGameScene } from '../../core/BaseGameScene';
import { THEME } from '../../core/constants';
import { Projector } from '../../core/projection';
import { Audio } from '../../core/audio';
import { Meter, displayStyle, textStyle, confetti, impact } from '../../core/ui';
import type { Controls } from '../../core/input';
import { CHARACTER_IDS, CHARACTERS, type Character } from '../../core/characters';
import { CharacterSprite, type PoseName } from '../../art/characters';
import { createCanvas, paintHaze, paintLawnHD, paintPineHD, paintSkyHD, paintTreeHD, paintVignette, rng } from '../../art/environment';
import { paintFenceHD, paintHouseHD } from './art';
import {
  FOOTBALL_CONFIG, attackDir, canForwardPass, clampX, createFootball, crossedGoal, describeYard, endPlay, interception,
  ordinal, other, outOfBoundsX, yardsToGoal, type FootballState, type Team,
} from './rules';
import { canCatch, dist, isTouch, leadPoint, makePass, moveByInput, moveToward, passPosition, routeWaypoints, type PassFlight, type RouteName, type Vec } from './sim';

/** Visual tuning for the football scene. */
export const FOOTBALL_VISUAL = {
  /** Camera behind and above the quarterback. */
  camZ: 9.5,
  camH: 4.0,
  /** Seconds before an AI offence snaps. */
  aiSnapDelay: 1.3,
  /** Seconds the play result stays on screen. */
  deadBallPause: 1700,
  /** Touch grace after an interception (new defenders cannot touch the returner instantly). */
  interceptGrace: 0.7,
  /** A pointer that moves more than this (logical px) is a swipe, not a press. */
  swipePx: 40,
  /** Swipe speed (px/s) that counts as a full-power throw. */
  swipeFullSpeed: 2600,
  /** The backdrop is rasterised at this multiple of the logical size. */
  superSample: 2,
};

interface Athlete {
  team: Team;
  idx: 0 | 1;
  x: number; y: number; vx: number; vy: number;
  sprite: CharacterSprite;
  character: Character;
  route: Vec[];
  routeIdx: number;
  routeName: RouteName;
  away: boolean;
  flip: 1 | -1;
  /** 'cover' | 'rush' for defenders during a play. */
  role: 'cover' | 'rush';
}

interface Gesture { id: number; x0: number; y0: number; t0: number; x: number; y: number; moved: boolean; }

type Phase = 'pre' | 'live' | 'dead' | 'done';

/** Polyline strokes for the yard numbers, in a 1 x 1 box (x right, y down = toward the camera). */
const DIGITS: Record<string, [number, number][][]> = {
  '0': [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
  '1': [[[0.5, 0], [0.5, 1]]],
  '2': [[[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 1], [1, 1]]],
  '3': [[[0, 0], [1, 0], [1, 1], [0, 1]], [[0, 0.5], [1, 0.5]]],
  '4': [[[0, 0], [0, 0.5], [1, 0.5]], [[1, 0], [1, 1]]],
};

export class FootballScene extends BaseGameScene {
  readonly gameId = 'football' as const;
  constructor() { super('FootballScene'); }

  private cfg = FOOTBALL_CONFIG;
  private state!: FootballState;
  private phase: Phase = 'pre';
  private proj!: Projector;
  private athletes: Athlete[] = [];
  private ball = { x: 0, y: 0, z: 0 };
  private holder: Athlete | null = null;
  private pass: PassFlight | null = null;
  private passTarget: Athlete | null = null;
  private passUsed = false;
  private controlled: [Athlete | null, Athlete | null] = [null, null];
  private ctrl: [Controls | null, Controls | null] = [null, null];
  private camY = 0;
  private camXw = 0;
  private dir: 1 | -1 = 1;
  private playT = 0;
  private preT = 0;
  private graceT = 0;
  private charging = false;
  private chargeT = 0;
  private gesture: Gesture | null = null;
  private qbThrowRequested = false;
  private aiQbDecision = 0;
  private fieldG!: Phaser.GameObjects.Graphics;
  private cueG!: Phaser.GameObjects.Graphics;
  private ringG!: Phaser.GameObjects.Graphics;
  private miniG!: Phaser.GameObjects.Graphics;
  private miniRect = new Phaser.Geom.Rectangle(0, 0, 100, 240);
  private ballImg!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private meter!: Meter;
  private meterLabel!: Phaser.GameObjects.Text;
  private targetLabel!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private fieldTop = 0;
  private fieldBottom = 0;
  private sideSwitch = 1;
  private noticeT = 0;

  create(): void {
    this.setupShell({ music: 'outdoor' });
    // the scene instance is reused on rematch: reset everything create() does not assign
    this.phase = 'pre'; this.holder = null; this.pass = null; this.passTarget = null; this.controlled = [null, null]; this.ctrl = [null, null];
    this.charging = false; this.gesture = null; this.sideSwitch = 1; this.noticeT = 0;
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 30;
    this.fieldBottom = P ? H - 300 : H - 150;
    const horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * (P ? 0.26 : 0.3);
    this.proj = new Projector({ camZ: FOOTBALL_VISUAL.camZ, camH: FOOTBALL_VISUAL.camH, horizonY: horizon, focal: P ? 1150 : 1050, cx: W / 2 });
    this.paintBackground();
    this.fieldG = this.add.graphics().setDepth(2);
    this.ringG = this.add.graphics().setDepth(30);
    this.cueG = this.add.graphics().setDepth(40);
    this.ballShadow = this.add.image(0, 0, 'shadow').setDepth(20).setVisible(false);
    this.ballImg = this.add.image(0, 0, 'football').setDepth(600).setVisible(false);
    this.state = createFootball(this.cfg, 0);
    this.dir = attackDir(this.state.offense);
    this.buildAthletes();
    this.buildUi();
    const joyArea = P ? { x: 0, y: H * 0.6, w: W * 0.5, h: H * 0.4 } : { x: 0, y: H * 0.5, w: W * 0.38, h: H * 0.5 };
    this.ctrl[0] = this.makeControls(0, { labels: { b: 'SWITCH' }, joyArea });
    if (this.match.mode === 'local') this.ctrl[1] = this.makeControls(1, { labels: { b: 'SWITCH' }, touch: false });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.refreshHud();
    this.beginAfterHowTo(() => this.setupFormation());
  }

  // ---------- Setup ----------
  private buildAthletes(): void {
    // the scene instance is reused on rematch: never keep last match's (destroyed) sprites
    this.athletes = [];
    const taken = new Set([this.players[0].character.id, this.players[1].character.id]);
    const spare = CHARACTER_IDS.filter((id) => !taken.has(id));
    const chars: Character[][] = [
      [this.players[0].character, CHARACTERS[spare[0]]],
      [this.players[1].character, CHARACTERS[spare[1]]],
    ];
    for (const team of [0, 1] as Team[]) {
      for (const idx of [0, 1] as (0 | 1)[]) {
        const ch = chars[team][idx];
        const sprite = new CharacterSprite(this, 0, 0, ch, 1);
        sprite.setDepth(100);
        this.athletes.push({ team, idx, x: 0, y: 0, vx: 0, vy: 0, sprite, character: ch, route: [], routeIdx: 0, routeName: 'go', away: true, flip: 1, role: idx === 0 ? 'rush' : 'cover' });
      }
    }
  }

  private buildUi(): void {
    const W = this.W, H = this.H, P = this.portrait;
    const touch = this.useTouch;
    const mw = P ? W - 80 : 620;
    const my = P ? (touch ? H - 430 : H - 150) : H - 70;
    const panel = this.add.graphics().setDepth(900);
    panel.fillStyle(0x0d1f10, 0.8);
    panel.fillRoundedRect(W / 2 - mw / 2 - 20, my - 48, mw + 40, 96, 16);
    panel.lineStyle(3, THEME.accent, 0.8);
    panel.strokeRoundedRect(W / 2 - mw / 2 - 20, my - 48, mw + 40, 96, 16);
    this.meterLabel = this.add.text(W / 2 - mw / 2, my - 34, 'THROW POWER', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0).setDepth(901);
    this.meter = new Meter(this, W / 2 - mw / 2, my - 4, mw, 24, { depth: 901, bg: 0x2a2a2a, fg: 0xf5c518 });
    this.meter.set(0);
    this.prompt = this.add.text(W / 2, my + 30, '', textStyle(20, '#fff3c4')).setOrigin(0.5).setDepth(901);
    // Minimap
    const mmW = P ? 90 : 104;
    const mmH = Math.round(mmW * 2.4);
    const mmX = W - 20 - mmW;
    const mmY = P ? this.hudBottom - 20 : 140;
    this.miniRect = new Phaser.Geom.Rectangle(mmX, mmY, mmW, mmH);
    this.miniG = this.add.graphics().setDepth(9100);
    this.targetLabel = this.add.text(0, 0, 'YOUR RECEIVER', displayStyle(18, '#4ff0ff', { strokeThickness: 3 })).setOrigin(0.5, 1).setDepth(650).setVisible(false);
    // Hint panel bottom-left (keyboard only; touch players get the stick and prompts)
    if (touch) return;
    const hw = P ? 300 : 360;
    const hx = 30, hy = P ? H - 150 : H - 118;
    const hint = this.add.graphics().setDepth(900);
    hint.fillStyle(0x0d1f10, 0.8);
    hint.fillRoundedRect(hx, hy, hw, 96, 16);
    hint.lineStyle(3, THEME.accent, 0.8);
    hint.strokeRoundedRect(hx, hy, hw, 96, 16);
    this.add.text(hx + hw / 2, hy + 10, 'CONTROLS', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.add.text(hx + hw / 2, hy + 38, this.match.mode === 'local' ? 'P1 WASD + F/G  •  P2 arrows + , .\nor press-hold on the field to throw there' : 'WASD move  •  F hike / hold to throw  •  G switch\nor press-hold / swipe on the field to throw there', textStyle(16, '#ffffff', { align: 'center' })).setOrigin(0.5, 0).setDepth(901);
  }

  /** Sky, the neighbourhood beyond the back fence, and the grass. Painted at 2x for crisp detail. */
  private paintBackground(): void {
    const W = this.W, H = this.H;
    const SS = FOOTBALL_VISUAL.superSample;
    const key = `football-bg-${W}x${H}@${SS}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W * SS, H * SS);
      ctx.scale(SS, SS);
      const pr = this.proj;
      const horizon = pr.cam.horizonY;
      const r = rng(41);
      paintSkyHD(ctx, W, H, horizon + 2, { sunX: W * 0.22, sunY: horizon * 0.26, seed: 23 });
      // the big woods on the far side of the neighbourhood, hazy
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 48; i++) woods.push({ x: -120 + i * 5.2 + r() * 3, z: 80 + r() * 40, s: 9 + r() * 7, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = pr.project(t.x, 0, t.z);
        const haze = Math.min(0.75, 0.3 + (t.z - 78) / 70);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.25 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      // the row of houses whose backyards meet the field
      const houses: { x: number; z: number; w: number; seed: number }[] = [];
      for (let i = 0; i < 9; i++) houses.push({ x: -58 + i * 14.5 + (r() - 0.5) * 2.5, z: 62 + r() * 6, w: 11.5 + r() * 3.5, seed: 300 + i });
      houses.sort((a, b) => b.z - a.z).forEach((hs, i) => {
        const p = pr.project(hs.x, 0, hs.z);
        const sc = p.scale;
        const haze = Math.min(0.4, 0.12 + (hs.z - 62) / 40);
        paintHouseHD(ctx, p.sx - (hs.w / 2) * sc, p.sy - 6.6 * sc, hs.w * sc, 6.6 * sc, { siding: ['#efe6cf', '#d9e4f0', '#e6d2c0', '#d3e3cf', '#f1dede'][i % 5], roof: ['#5a4238', '#3f3a44', '#6a4a3a'][i % 3], haze, seed: hs.seed, garage: i % 3 === 1 });
        if (r() > 0.35) paintTreeHD(ctx, p.sx + (r() - 0.5) * hs.w * 0.9 * sc, p.sy + 0.4 * sc, (5 + r() * 3) * sc, hs.seed + 7, { haze: haze * 0.6 });
      });
      paintHaze(ctx, W, horizon, 90);
      // the grassy field itself (static texture; the chalk is drawn per frame on top)
      paintLawnHD(ctx, pr, { x0: -44, x1: 44, z0: -8, z1: 60 }, { seed: 13, base: '#5a9838', stripeWidth: 5, tuftDensity: 1.4 });
      // worn dirt down the middle where the kids play most
      for (let i = 0; i < 30; i++) {
        const wx = (r() - 0.5) * 9, wz = 2 + r() * 48;
        const p = pr.project(wx, 0, wz);
        if (!p.visible) continue;
        const rad = (1.2 + r() * 2.2) * p.scale;
        const pg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
        pg.addColorStop(0, 'rgba(150,120,70,0.3)');
        pg.addColorStop(0.6, 'rgba(130,110,60,0.13)');
        pg.addColorStop(1, 'rgba(130,110,60,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy, rad, rad * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      }
      // back fence along the far end of the field
      const fenceP = pr.project(0, 0, 56);
      const fh = Math.max(18, 2.0 * fenceP.scale);
      paintFenceHD(ctx, -10, W + 10, fenceP.sy, fh, 17);
      // a few trees along the far fence line
      for (let x = -40; x <= 40; x += 11) {
        const p = pr.project(x + (r() - 0.5) * 3, 0, 57 + r() * 2);
        if (r() > 0.5) paintTreeHD(ctx, p.sx, p.sy, (6 + r() * 4) * p.scale, 700 + x, { haze: 0.1 });
        else paintPineHD(ctx, p.sx, p.sy, (7 + r() * 3) * p.scale, 700 + x, { haze: 0.1 });
      }
      // framing trees close to the camera at the left and right edges
      paintTreeHD(ctx, -30, horizon + 90, 420, 91);
      paintTreeHD(ctx, W + 30, horizon + 80, 400, 92);
      paintPineHD(ctx, 70, horizon + 150, 260, 93);
      paintVignette(ctx, W, H, 0.2);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0).setScale(1 / SS);
  }

  // ---------- Formation / play flow ----------
  private setupFormation(): void {
    if (this.finished) return;
    const s = this.state;
    this.phase = 'pre';
    this.preT = 0;
    this.dir = attackDir(s.offense);
    const L = s.lineOfScrimmage;
    const d = this.dir;
    this.sideSwitch = -this.sideSwitch;
    const side = this.sideSwitch;
    const off = this.athletes.filter((a) => a.team === s.offense);
    const def = this.athletes.filter((a) => a.team !== s.offense);
    const qb = off[0];
    const wr = off[1];
    this.place(qb, 0, L - 2.2 * d);
    this.place(wr, 7 * side, L - 0.6 * d);
    this.place(def[0], 7 * side, L + 4 * d);
    def[0].role = 'cover';
    this.place(def[1], -2 * side, L + 2.6 * d);
    def[1].role = 'rush';
    // the offence faces downfield (away from the camera); the defence faces the offence (toward it)
    for (const a of off) { a.away = true; a.flip = 1; }
    for (const a of def) { a.away = false; a.flip = 1; }
    // route for the receiver
    const routes: RouteName[] = ['go', 'slant', 'out', 'curl', 'post', 'drag'];
    wr.routeName = routes[Math.floor(Math.random() * routes.length)];
    wr.route = routeWaypoints(wr.routeName, { x: wr.x, y: wr.y }, d, this.cfg);
    wr.routeIdx = 0;
    // controlled athletes: humans control their own character (idx 0) by default; on defence the rusher
    for (const slot of [0, 1] as const) {
      if (this.isAI(slot)) { this.controlled[slot] = null; continue; }
      const team = slot as Team;
      if (team === s.offense) this.controlled[slot] = qb;
      else this.controlled[slot] = def[1];
    }
    this.holder = qb;
    this.pass = null;
    this.passTarget = null;
    this.passUsed = false;
    this.charging = false;
    this.chargeT = 0;
    this.gesture = null;
    this.qbThrowRequested = false;
    this.aiQbDecision = 1.6 - this.ai * 0.8 + Math.random() * 0.5;
    this.ball = { x: qb.x, y: qb.y, z: 1 };
    this.camY = qb.y - 1.4 * d;
    this.camXw = 0;
    this.meter.set(0);
    this.meter.setVisible(false);
    this.meterLabel.setVisible(false);
    this.refreshHud();
    const humanOff = !this.isAI(s.offense);
    const touch = this.useTouch;
    this.setStatus(humanOff ? `${this.name(s.offense)}: ${touch ? 'tap the field to HIKE' : 'press F to HIKE (or tap the field)'}` : `${this.name(s.offense)} has the ball — get ready!`);
    this.prompt.setText(humanOff
      ? (touch ? 'After the hike: press-hold or swipe on the field to throw there' : 'After the hike: hold F to throw to your receiver, or press-hold on the field')
      : (touch ? 'Stick moves your defender • tap the field to switch' : 'Touch the ball carrier to stop the play • G switches'));
  }

  private place(a: Athlete, x: number, y: number): void {
    a.x = clampX(x, this.cfg); a.y = y; a.vx = 0; a.vy = 0;
  }

  private snap(): void {
    if (this.phase !== 'pre') return;
    this.phase = 'live';
    this.playT = 0;
    this.graceT = 0;
    Audio.sfx('click');
    const off = this.state.offense;
    const touch = this.useTouch;
    this.setStatus(!this.isAI(off) ? (touch ? 'Run with the stick, or press-hold / swipe where to throw' : 'Run, or hold F / press-hold on the field to throw') : 'Defend! Touch the ball carrier');
    this.prompt.setText(this.state.returning ? '' : 'One forward pass per play, from behind the line');
  }

  /** Throw to a spot on the field with a given power (0..1). The teammate becomes the intended receiver. */
  private throwPassTo(qb: Athlete, spot: Vec, power: number): void {
    if (this.passUsed) return;
    const mate = this.athletes.find((a) => a.team === qb.team && a !== qb)!;
    const to = { x: clampX(spot.x, this.cfg), y: Math.max(-this.cfg.endZone + 0.5, Math.min(this.cfg.fieldLength + this.cfg.endZone - 0.5, spot.y)) };
    this.pass = makePass({ x: qb.x, y: qb.y }, to, this.cfg, power);
    this.passTarget = mate;
    this.passUsed = true;
    this.holder = null;
    this.charging = false;
    this.meter.setVisible(false);
    this.meterLabel.setVisible(false);
    qb.sprite.setAnim(qb.away ? ['back-throw0', 'back-throw1'] : ['throw0', 'throw1'], 8, false);
    Audio.sfx('throw');
    this.setStatus(power > 0.7 ? 'Bullet pass!' : power > 0.35 ? 'Pass is in the air!' : 'Lob pass...');
  }

  /** Throw toward the receiver's lead point (keyboard / CPU), with optional aim error in yards. */
  private throwToReceiver(qb: Athlete, target: Athlete, power: number, errorYards = 0): void {
    const lead = 1.5 + power * this.cfg.passMaxLead;
    const lp = leadPoint(target, lead, this.cfg);
    if (errorYards > 0) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.abs(gauss(errorYards));
      lp.x = clampX(lp.x + Math.cos(a) * e, this.cfg);
      lp.y += Math.sin(a) * e;
    }
    this.throwPassTo(qb, lp, power);
  }

  private endPlayWith(outcome: Parameters<typeof endPlay>[1]): void {
    if (this.phase !== 'live') return;
    this.phase = 'dead';
    const prevOffense = this.state.offense;
    const prevScores = [...this.state.scores];
    this.state = endPlay(this.state, outcome, this.cfg);
    this.charging = false;
    this.gesture = null;
    this.meter.setVisible(false);
    this.meterLabel.setVisible(false);
    this.targetLabel.setVisible(false);
    Audio.sfx('whistle');
    const ev = this.state.lastEvent;
    this.setStatus(ev);
    const scored = this.state.scores[0] !== prevScores[0] || this.state.scores[1] !== prevScores[1];
    if (scored) {
      const who: Team = this.state.scores[0] !== prevScores[0] ? 0 : 1;
      const sp = this.holder ?? this.athletes.find((a) => a.team === who)!;
      this.announce(ev, { color: '#f5c518', size: this.portrait ? 70 : 90, y: this.fieldTop + 200 });
      confetti(this, this.W / 2, this.fieldTop + 200, 60);
      this.react(who, 'cheer', sp.sprite.x, sp.sprite.y - 120);
      Audio.sfx('cheer');
    } else {
      this.announce(ev, { size: this.portrait ? 40 : 52, y: this.fieldTop + 180, hold: 1100 });
      if (this.state.offense !== prevOffense && !this.state.returning) Audio.sfx('groan');
    }
    this.refreshHud();
    this.time.delayedCall(FOOTBALL_VISUAL.deadBallPause, () => {
      if (this.state.winner !== null) return this.endMatch();
      this.setupFormation();
    });
  }

  private endMatch(): void {
    this.phase = 'done';
    const w = this.state.winner!;
    const s = this.state.scores;
    this.finishMatch({
      winnerSlot: w,
      summary: `${this.name(w)}'s team wins ${s[w]} - ${s[other(w)]}`,
      scores: [`${s[0]} pts`, `${s[1]} pts`],
    });
  }

  private refreshHud(): void {
    const s = this.state;
    this.setScore(0, String(s.scores[0]));
    this.setScore(1, String(s.scores[1]));
    this.setTurn(s.offense);
    const ytg = Math.round(yardsToGoal(s.offense, s.lineOfScrimmage, this.cfg));
    const downTxt = s.returning ? 'RETURN' : `${ordinal(s.down)} DOWN / ${this.cfg.downs}`;
    this.setSub(`${this.name(s.offense).toUpperCase()} BALL  •  ${downTxt}  •  ${describeYard(s.offense, s.lineOfScrimmage, this.cfg)}  •  ${ytg} to go`);
  }

  // ---------- Pointer gestures: tap to hike, press-hold / swipe to throw, tap to switch on defence ----------
  private onField(x: number, y: number): boolean {
    if (y < this.fieldTop || y > this.fieldBottom + (this.portrait ? 120 : 60)) return false;
    if (this.useTouch && this.ctrl[0]?.inJoyArea(x, y)) return false;
    // keep clear of the touch buttons (bottom-right cluster)
    if (this.useTouch && x > this.W - 260 && y > this.H - 300) return false;
    return true;
  }

  /** The human slot whose turn the pointer belongs to: the offence's human if any, else the defence's. */
  private pointerSlot(): 0 | 1 | null {
    const off = this.state.offense;
    if (!this.isAI(off)) return off as 0 | 1;
    const def = other(off);
    if (!this.isAI(def)) return def as 0 | 1;
    return null;
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.finished || !this.onField(p.x, p.y)) return;
    const slot = this.pointerSlot();
    if (slot === null) return;
    Audio.unlock();
    const off = this.state.offense;
    if (this.phase === 'pre') {
      if ((slot as Team) === off) { this.snap(); this.gesture = null; }
      return;
    }
    if (this.phase !== 'live') return;
    this.gesture = { id: p.id, x0: p.x, y0: p.y, t0: this.time.now, x: p.x, y: p.y, moved: false };
    const a = this.controlled[slot];
    if (a && this.holder === a && (a.team as Team) === off && !this.passUsed && !this.state.returning) {
      if (canForwardPass(off, a.y, this.state.lineOfScrimmage)) {
        this.charging = true; this.chargeT = 0;
        this.meter.setVisible(true); this.meterLabel.setVisible(true);
      } else {
        this.notice('Past the line — run it!');
        this.gesture = null;
      }
    }
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const g = this.gesture;
    if (!g || g.id !== p.id) return;
    g.x = p.x; g.y = p.y;
    if (Math.hypot(p.x - g.x0, p.y - g.y0) > FOOTBALL_VISUAL.swipePx) g.moved = true;
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    const g = this.gesture;
    if (!g || g.id !== p.id) return;
    this.gesture = null;
    g.x = p.x; g.y = p.y;
    const slot = this.pointerSlot();
    if (slot === null || this.phase !== 'live') { this.charging = false; return; }
    const a = this.controlled[slot];
    const off = this.state.offense;
    if (this.charging && a && this.holder === a) {
      // throw to the spot under the finger; power from the hold time, or from the swipe speed
      const hold = Math.min(1, this.chargeT / this.cfg.chargeTime);
      const dt = Math.max(0.03, (this.time.now - g.t0) / 1000);
      const swipeLen = Math.hypot(g.x - g.x0, g.y - g.y0);
      const swipe = g.moved ? Math.min(1, (swipeLen / dt - 300) / FOOTBALL_VISUAL.swipeFullSpeed) : 0;
      const power = Math.max(0.12, hold, swipe);
      const spot = this.screenToField(g.x, g.y);
      this.charging = false;
      if (!canForwardPass(off, a.y, this.state.lineOfScrimmage)) { this.notice('Crossed the line — pass is off!'); this.meter.setVisible(false); this.meterLabel.setVisible(false); return; }
      this.throwPassTo(a, spot, power);
      return;
    }
    this.charging = false;
    // defence: a short tap switches to the defender nearest the ball
    if (a && (a.team as Team) !== off && !g.moved && this.time.now - g.t0 < 350) this.switchToNearest(slot);
  }

  /** Screen point -> field coordinates on the ground (far taps clamp to a long throw downfield). */
  private screenToField(sx: number, sy: number): Vec {
    const u = this.proj.unprojectGround(sx, sy);
    const cam = this.proj.cam;
    let wx: number, wz: number;
    if (!u) {
      // above the horizon: throw as far as the field allows in that direction
      const scale = cam.focal / 60;
      wx = (sx - cam.cx) / scale;
      wz = 60 - cam.camZ;
    } else { wx = u.x; wz = Math.min(u.z, 60); }
    return { x: (wx + this.camXw) * this.dir, y: wz * this.dir + this.camY };
  }

  // ---------- Per frame ----------
  update(_t: number, dtMs: number): void {
    if (!this.started || this.finished) return;
    const dt = Math.min(0.05, dtMs / 1000);
    if (this.phase === 'pre') this.updatePre(dt);
    else if (this.phase === 'live') this.updateLive(dt);
    this.updateCamera(dt);
    this.drawField();
    this.drawAthletes();
    this.drawBall();
    this.drawCues();
    this.drawMinimap();
    if (this.noticeT > 0) this.noticeT -= dt;
  }

  private axisFor(slot: 0 | 1): { x: number; y: number } {
    const c = this.ctrl[slot];
    if (!c) return { x: 0, y: 0 };
    // screen-relative: up = toward the end zone the offence attacks
    return { x: c.axis.x * this.dir, y: -c.axis.y * this.dir };
  }

  private updatePre(dt: number): void {
    this.preT += dt;
    const off = this.state.offense;
    for (const slot of [0, 1] as const) {
      const c = this.ctrl[slot];
      const a = this.controlled[slot];
      if (!c || !a) continue;
      if (c.justDown('b')) this.switchControlled(slot);
      if (a.team === off && c.justDown('a')) { this.snap(); return; }
    }
    if (this.isAI(off) && this.preT > FOOTBALL_VISUAL.aiSnapDelay) this.snap();
    for (const a of this.athletes) { a.vx = 0; a.vy = 0; }
  }

  private switchControlled(slot: 0 | 1): void {
    const cur = this.controlled[slot];
    if (!cur) return;
    const mate = this.athletes.find((a) => a.team === cur.team && a !== cur)!;
    this.controlled[slot] = mate;
    Audio.sfx('tick');
  }

  private switchToNearest(slot: 0 | 1): void {
    const cur = this.controlled[slot];
    if (!cur) return;
    const team = cur.team;
    const target = this.holder ? { x: this.holder.x, y: this.holder.y } : this.pass ? this.pass.to : this.ball;
    const best = this.athletes.filter((a) => a.team === team).reduce((b, a) => (dist(a, target) < dist(b, target) ? a : b));
    if (best !== cur) { this.controlled[slot] = best; Audio.sfx('tick'); }
  }

  private updateLive(dt: number): void {
    this.playT += dt;
    if (this.graceT > 0) this.graceT -= dt;
    const s = this.state;
    const off = s.offense;
    const defenders = this.athletes.filter((a) => a.team !== off);
    const offense = this.athletes.filter((a) => a.team === off);
    const human = (a: Athlete): 0 | 1 | null => (this.controlled[0] === a ? 0 : this.controlled[1] === a ? 1 : null);
    const aiSpeed = this.cfg.playerSpeed * (this.cfg.aiSpeedMin + this.ai * (this.cfg.aiSpeedMax - this.cfg.aiSpeedMin));

    // --- input: switching ---
    for (const slot of [0, 1] as const) {
      const c = this.ctrl[slot];
      if (c && c.justDown('b')) this.switchControlled(slot);
    }
    // the Mississippi count, shown while the offence still has time to throw
    if (!this.passUsed && !s.returning && this.holder && this.holder.team === off && !this.isAI(off) && this.playT < this.rushDelay() && this.noticeT <= 0) {
      const n = Math.min(3, Math.floor(this.playT) + 1);
      this.setStatus(`${n} Mississippi…  (throw before the rush!)`);
    } else if (!this.passUsed && !s.returning && this.holder && this.holder.team === off && !this.isAI(off) && this.noticeT <= 0 && this.playT >= this.rushDelay() && this.playT < this.rushDelay() + 0.05) {
      this.setStatus('RUSH IS ON!');
    }
    // --- pointer charge (press-hold on the field) ---
    if (this.charging && this.gesture) {
      this.chargeT += dt;
      this.meter.set(Math.min(1, this.chargeT / this.cfg.chargeTime));
    }

    // --- offence ---
    for (const a of offense) {
      const h = human(a);
      if (h !== null) {
        const ax = this.axisFor(h);
        moveByInput(a, ax.x, ax.y, this.cfg.playerSpeed, dt);
        const c = this.ctrl[h]!;
        if (this.holder === a) {
          const canPass = !this.passUsed && !s.returning && canForwardPass(off, a.y, s.lineOfScrimmage);
          // keyboard: hold the button to charge, release to throw to the receiver
          if (!this.gesture && c.justDown('a')) {
            if (canPass) { this.charging = true; this.chargeT = 0; this.meter.setVisible(true); this.meterLabel.setVisible(true); }
            else if (!this.passUsed && !s.returning) { this.notice('Past the line — run it!'); }
          }
          if (this.charging && !this.gesture) {
            this.chargeT += dt;
            const p = Math.min(1, this.chargeT / this.cfg.chargeTime);
            this.meter.set(p);
            if (!canPass) { this.charging = false; this.meter.setVisible(false); this.meterLabel.setVisible(false); this.notice('Crossed the line — pass is off!'); }
            else if (c.justReleased('a') || !c.isDown('a')) {
              const mate = offense.find((o) => o !== a)!;
              this.throwToReceiver(a, mate, p);
            }
          } else if (this.charging && this.gesture && !canPass) {
            this.charging = false; this.gesture = null; this.meter.setVisible(false); this.meterLabel.setVisible(false); this.notice('Crossed the line — pass is off!');
          }
        } else if (this.holder && this.holder.team === off && c.justDown('a')) {
          // human controls the receiver: ask the AI QB to throw now
          this.qbThrowRequested = true;
        }
      } else if (this.holder === a) {
        this.aiCarrier(a, offense, defenders, aiSpeed, dt);
      } else if (this.pass && this.passTarget === a) {
        moveToward(a, this.pass.to.x, this.pass.to.y, aiSpeed * 1.08, dt);
      } else if (this.holder && this.holder.team === off) {
        this.aiReceiver(a, defenders, aiSpeed, dt);
      } else {
        moveToward(a, this.ball.x, this.ball.y, aiSpeed * 0.8, dt);
      }
    }

    // --- defence ---
    for (const a of defenders) {
      const h = human(a);
      if (h !== null) {
        const ax = this.axisFor(h);
        moveByInput(a, ax.x, ax.y, this.cfg.playerSpeed, dt);
        if (!this.passUsed && !s.returning && this.playT < this.rushDelay()) {
          // no crossing the line until the count is over
          const limit = s.lineOfScrimmage + this.dir * 0.8;
          if (this.dir === 1 ? a.y < limit : a.y > limit) a.y = limit;
        }
      } else {
        this.aiDefender(a, defenders, offense, aiSpeed, dt);
      }
    }

    // --- ball ---
    if (this.holder) {
      this.ball.x = this.holder.x; this.ball.y = this.holder.y; this.ball.z = 1;
      const carrier = this.holder;
      if (crossedGoal(off, carrier.y, this.cfg)) return this.endPlayWith({ type: 'touchdown' });
      const backLine = off === 0 ? -this.cfg.endZone : this.cfg.fieldLength + this.cfg.endZone;
      if (outOfBoundsX(carrier.x, this.cfg) || (off === 0 ? carrier.y < backLine : carrier.y > backLine)) {
        carrier.x = clampX(carrier.x, this.cfg);
        return this.endPlayWith({ type: 'outOfBounds', spot: carrier.y });
      }
      if (this.graceT <= 0) {
        for (const dfd of defenders) {
          if (isTouch(carrier, dfd, this.cfg)) {
            impact(this, carrier.sprite.x, carrier.sprite.y - 40, 0xffffff, 10, 700, 8);
            Audio.sfx('tackle');
            dfd.sprite.setAnim(dfd.away ? ['back-push', 'back-push'] : ['push', 'push'], 4, false);
            return this.endPlayWith({ type: 'tackled', spot: carrier.y });
          }
        }
      }
    } else if (this.pass) {
      this.pass.t += dt;
      const pos = passPosition(this.pass);
      this.ball = pos;
      const target = this.passTarget!;
      for (const dfd of defenders) {
        const h = human(dfd);
        const radius = this.cfg.interceptRadius * (h !== null ? 1.15 : 0.65 + this.ai * 0.55);
        if (canCatch(pos, dfd, radius, 2.4)) {
          this.intercept(dfd);
          return;
        }
      }
      if (canCatch(pos, target, this.cfg.catchRadius, 2.4) && this.pass.t > 0.25) {
        this.holder = target;
        this.pass = null;
        this.graceT = 0;
        Audio.sfx('catch');
        impact(this, target.sprite.x, target.sprite.y - 60, 0x4ff0ff, 8, 700, 6);
        this.setStatus('CAUGHT! Run!');
        this.targetLabel.setVisible(false);
        return;
      }
      if (this.pass.t >= this.pass.duration) {
        if (dist(pos, target) <= this.cfg.catchRadius * 1.15) {
          this.holder = target;
          this.pass = null;
          Audio.sfx('catch');
          this.setStatus('CAUGHT! Run!');
          return;
        }
        this.pass = null;
        this.ball.z = 0;
        Audio.sfx('thud');
        return this.endPlayWith({ type: 'incomplete' });
      }
    }
  }

  private intercept(dfd: Athlete): void {
    this.pass = null;
    this.passTarget = null;
    this.holder = dfd;
    this.state = interception(this.state);
    this.dir = attackDir(this.state.offense);
    this.graceT = FOOTBALL_VISUAL.interceptGrace;
    this.passUsed = true;
    Audio.sfx('catch');
    Audio.sfx('whistle');
    this.announce('INTERCEPTION!', { color: '#4ff0ff', size: this.portrait ? 56 : 72, y: this.fieldTop + 180, hold: 900 });
    this.react(dfd.team, 'taunt', dfd.sprite.x, dfd.sprite.y - 120);
    for (const slot of [0, 1] as const) {
      if (!this.isAI(slot) && (slot as Team) === dfd.team) this.controlled[slot] = dfd;
    }
    this.refreshHud();
    this.setStatus('Picked off! Return it!');
  }

  // ---------- AI ----------
  private aiReceiver(a: Athlete, defenders: Athlete[], speed: number, dt: number): void {
    if (a.routeIdx < a.route.length) {
      const wp = a.route[a.routeIdx];
      const rem = moveToward(a, wp.x, wp.y, speed, dt, 0.4);
      if (rem <= 0.4) a.routeIdx += 1;
      return;
    }
    const near = defenders.reduce((b, dd) => (dist(dd, a) < dist(b, a) ? dd : b), defenders[0]);
    let tx = a.x + (a.x - near.x) * 0.6;
    let ty = a.y + this.dir * 2.5 + (a.y - near.y) * 0.4;
    const half = this.cfg.width / 2 - 1.5;
    tx = Math.max(-half, Math.min(half, tx));
    const goal = this.dir === 1 ? this.cfg.fieldLength + 4 : -4;
    ty = this.dir === 1 ? Math.min(ty, goal) : Math.max(ty, goal);
    moveToward(a, tx, ty, speed * 0.85, dt, 0.3);
  }

  private aiCarrier(a: Athlete, offense: Athlete[], defenders: Athlete[], speed: number, dt: number): void {
    const s = this.state;
    const isQb = !this.passUsed && !s.returning && canForwardPass(s.offense, a.y, s.lineOfScrimmage);
    const mate = offense.find((o) => o !== a)!;
    const nearDef = defenders.reduce((b, dd) => (dist(dd, a) < dist(b, a) ? dd : b), defenders[0]);
    const rushDist = dist(nearDef, a);
    if (isQb) {
      const open = Math.min(...defenders.map((dd) => dist(dd, mate)));
      const humanMate = this.controlled.some((c) => c === mate);
      const wantThrow = this.qbThrowRequested || (this.playT > this.aiQbDecision && (open > 2.6 - this.ai * 0.9 || this.playT > this.aiQbDecision + 1.6));
      if (wantThrow && this.playT > 0.45) {
        const err = humanMate ? 0.6 : 1.4 - this.ai * 1.1;
        const spd = Math.hypot(mate.vx, mate.vy);
        const power = Math.min(1, 0.3 + spd / this.cfg.playerSpeed * 0.45 + this.ai * 0.2);
        this.qbThrowRequested = false;
        this.throwToReceiver(a, mate, power, err);
        return;
      }
      if (rushDist < 2.4 && this.playT > 0.4) {
        const ax = a.x - nearDef.x;
        const tx = clampX(a.x + Math.sign(ax || 1) * 3, this.cfg);
        moveToward(a, tx, a.y - this.dir * 0.8, speed, dt);
      } else if (this.playT < 0.7) {
        moveToward(a, a.x, s.lineOfScrimmage - this.dir * 4, speed * 0.7, dt);
      } else {
        a.vx = 0; a.vy = 0;
      }
      return;
    }
    let sx = 0;
    let sy = this.dir;
    for (const dd of defenders) {
      const dx = a.x - dd.x; const dy = a.y - dd.y;
      const dd2 = Math.max(0.5, dx * dx + dy * dy);
      if (dd2 < 36) { sx += (dx / dd2) * 6; sy += (dy / dd2) * 3; }
    }
    const half = this.cfg.width / 2;
    if (a.x > half - 2.5) sx -= 1.2;
    if (a.x < -half + 2.5) sx += 1.2;
    sy += this.dir * 0.8;
    moveByInput(a, sx, sy, speed, dt);
  }

  private aiDefender(a: Athlete, defenders: Athlete[], offense: Athlete[], speed: number, dt: number): void {
    const d = this.dir;
    const react = 0.75 + this.ai * 0.3;
    if (this.pass) {
      const lp = this.pass.to;
      const nearest = defenders.reduce((b, dd) => (dist(dd, lp) < dist(b, lp) ? dd : b), defenders[0]);
      if (nearest === a) { moveToward(a, lp.x, lp.y, speed * react, dt); return; }
    }
    const carrier = this.holder;
    if (carrier && a.role === 'rush' && !this.passUsed && !this.state.returning && this.playT < this.rushDelay()) {
      // counting Mississippis: shuffle along the line, do not cross it yet
      moveToward(a, carrier.x + (a.x - carrier.x) * 0.3, this.state.lineOfScrimmage + d * 1.2, speed * 0.6, dt, 0.3);
      return;
    }
    if (carrier && (this.passUsed || this.state.returning || a.role === 'rush')) {
      const lead = 0.25 + this.ai * 0.2;
      moveToward(a, carrier.x + carrier.vx * lead, carrier.y + carrier.vy * lead, speed * react, dt);
      return;
    }
    const wr = offense.find((o) => o !== carrier) ?? offense[1];
    const tx = wr.x + wr.vx * (0.1 + this.ai * 0.15);
    const ty = wr.y + d * (1.6 - this.ai * 0.6);
    moveToward(a, tx, ty, speed * react, dt, 0.3);
  }

  /** Seconds the rusher must wait before crossing the line (easier CPUs count slower). */
  private rushDelay(): number { return this.cfg.rushCount + (1 - this.ai) * 0.8; }

  private notice(text: string): void {
    if (this.noticeT > 0) return;
    this.noticeT = 1.2;
    this.setStatus(text);
    Audio.sfx('back');
  }

  // ---------- Rendering ----------
  private updateCamera(dt: number): void {
    const focusY = this.ball.y;
    const k = Math.min(1, dt * 4);
    this.camY += (focusY - 1.4 * this.dir - this.camY) * k;
    const half = this.cfg.width / 2;
    const targetX = Math.max(-half * 0.8, Math.min(half * 0.8, this.ball.x)) * this.dir * 0.85;
    this.camXw += (targetX - this.camXw) * k;
  }

  private world(x: number, y: number): { wx: number; wz: number } {
    return { wx: x * this.dir - this.camXw, wz: (y - this.camY) * this.dir };
  }

  private screen(x: number, y: number, h = 0): ReturnType<Projector['project']> {
    const w = this.world(x, y);
    return this.proj.project(w.wx, h, w.wz);
  }

  /** Clip a ground segment to the near plane and draw it as a hand-pushed chalk line (slightly wavy, uneven). */
  private segment(g: Phaser.GameObjects.Graphics, ax: number, ay: number, bx: number, by: number, chalk = true): void {
    let a = this.world(ax, ay);
    let b = this.world(bx, by);
    const near = 1.2 - this.proj.cam.camZ;
    if (a.wz < near && b.wz < near) return;
    if (a.wz < near) { const t = (near - a.wz) / (b.wz - a.wz); a = { wx: a.wx + (b.wx - a.wx) * t, wz: near }; }
    if (b.wz < near) { const t = (near - b.wz) / (a.wz - b.wz); b = { wx: b.wx + (a.wx - b.wx) * t, wz: near }; }
    if (!chalk) {
      const pa = this.proj.project(a.wx, 0, a.wz);
      const pb = this.proj.project(b.wx, 0, b.wz);
      g.beginPath(); g.moveTo(pa.sx, pa.sy); g.lineTo(pb.sx, pb.sy); g.strokePath();
      return;
    }
    const steps = 10;
    let seed = Math.round((ax + ay * 7 + bx * 13 + by * 17) * 10) & 0x7fffffff;
    const nx = -(b.wz - a.wz), nz = b.wx - a.wx;
    const nl = Math.hypot(nx, nz) || 1;
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const wob = ((seed / 0x7fffffff) - 0.5) * 0.16 * (i === 0 || i === steps ? 0.3 : 1);
      const wx = a.wx + (b.wx - a.wx) * t + (nx / nl) * wob;
      const wz = a.wz + (b.wz - a.wz) * t + (nz / nl) * wob;
      const p = this.proj.project(wx, 0, Math.max(near, wz));
      if (i === 0) g.moveTo(p.sx, p.sy); else g.lineTo(p.sx, p.sy);
    }
    g.strokePath();
  }

  private quad(g: Phaser.GameObjects.Graphics, pts: [number, number][]): void {
    const near = 1.2 - this.proj.cam.camZ;
    const ws = pts.map(([x, y]) => this.world(x, y));
    if (ws.every((w) => w.wz < near)) return;
    const clipped = ws.map((w) => (w.wz < near ? { wx: w.wx, wz: near } : w));
    const ps = clipped.map((w) => this.proj.project(w.wx, 0, w.wz));
    g.beginPath();
    g.moveTo(ps[0].sx, ps[0].sy);
    for (let i = 1; i < ps.length; i++) g.lineTo(ps[i].sx, ps[i].sy);
    g.closePath();
    g.fillPath();
  }

  /** Chalk yard number (two digits) centred at (x, y), `h` yards tall, readable from behind the offence. */
  private number(g: Phaser.GameObjects.Graphics, text: string, x: number, y: number, h: number): void {
    const w = h * 0.55, gap = h * 0.18;
    const total = text.length * w + (text.length - 1) * gap;
    let x0 = x - total / 2;
    for (const ch of text) {
      const strokes = DIGITS[ch];
      if (strokes) {
        for (const poly of strokes) {
          for (let i = 1; i < poly.length; i++) {
            const [ax, ay] = poly[i - 1], [bx, by] = poly[i];
            // y down in the glyph = toward the camera = against the attack direction
            this.segment(g, x0 + ax * w, y + (0.5 - ay) * h * this.dir, x0 + bx * w, y + (0.5 - by) * h * this.dir, false);
          }
        }
      }
      x0 += w + gap;
    }
  }

  private drawField(): void {
    const g = this.fieldG;
    g.clear();
    const L = this.cfg.fieldLength, E = this.cfg.endZone, hw = this.cfg.width / 2;
    // mowing bands every 5 yards
    for (let y = -E; y < L + E; y += 5) {
      if (((y + E) / 5) % 2 === 0) continue;
      g.fillStyle(0xffffdd, 0.07);
      this.quad(g, [[-hw - 8, y], [hw + 8, y], [hw + 8, y + 5], [-hw - 8, y + 5]]);
    }
    // end zones: team tint with diagonal chalk hatching
    g.fillStyle(this.players[0].character.accent, 0.13);
    this.quad(g, [[-hw, -E], [hw, -E], [hw, 0], [-hw, 0]]);
    g.fillStyle(this.players[1].character.accent, 0.13);
    this.quad(g, [[-hw, L], [hw, L], [hw, L + E], [-hw, L + E]]);
    g.lineStyle(2, 0xffffff, 0.22);
    for (let k = -hw - E; k < hw; k += 4) {
      // diagonal from (k, endLine) to (k + E, goalLine), clipped to the sidelines
      const t0 = Math.max(0, (-hw - k) / E), t1 = Math.min(1, (hw - k) / E);
      if (t0 >= t1) continue;
      this.segment(g, k + E * t0, -E + E * t0, k + E * t1, -E + E * t1, false);
      this.segment(g, k + E * t0, L + E - E * t0, k + E * t1, L + E - E * t1, false);
    }
    // line of scrimmage shading
    g.fillStyle(0xf5c518, 0.1);
    const los = this.state.lineOfScrimmage;
    this.quad(g, [[-hw, los - 0.25], [hw, los - 0.25], [hw, los + 0.25], [-hw, los + 0.25]]);
    // hash marks every yard (straight ticks) on two inner hash lines
    g.lineStyle(2, 0xffffff, 0.5);
    for (const hx of [-hw + 6, hw - 6]) {
      for (let y = 1; y < L; y++) {
        if (y % 5 === 0) continue;
        this.segment(g, hx - 0.35, y, hx + 0.35, y, false);
      }
    }
    // yard lines (hand-pushed chalk: a soft wide pass under a crisp one)
    g.lineStyle(7, 0xffffff, 0.18);
    for (let y = 5; y < L; y += 5) this.segment(g, -hw, y, hw, y);
    g.lineStyle(3, 0xffffff, 0.8);
    for (let y = 5; y < L; y += 5) this.segment(g, -hw, y, hw, y);
    g.lineStyle(9, 0xffffff, 0.2);
    this.segment(g, -hw, 0, hw, 0);
    this.segment(g, -hw, L, hw, L);
    g.lineStyle(5, 0xffffff, 0.95);
    this.segment(g, -hw, 0, hw, 0);
    this.segment(g, -hw, L, hw, L);
    this.segment(g, -hw, -E, hw, -E);
    this.segment(g, -hw, L + E, hw, L + E);
    this.segment(g, -hw, -E, -hw, L + E);
    this.segment(g, hw, -E, hw, L + E);
    g.lineStyle(4, 0xf5c518, 0.9);
    this.segment(g, -hw, los, hw, los);
    // yard numbers along both sidelines, every 10 yards
    g.lineStyle(3, 0xffffff, 0.75);
    for (let y = 10; y < L; y += 10) {
      const label = String(Math.min(y, L - y));
      this.number(g, label, -hw + 3.4, y, 2.2);
      this.number(g, label, hw - 3.4, y, 2.2);
    }
    // pylons at the goal lines, cones at the end lines
    for (const [x, y] of [[-hw, 0], [hw, 0], [-hw, L], [hw, L]] as [number, number][]) {
      const p = this.screen(x, y);
      const top = this.screen(x, y, 1.2);
      if (!p.visible || p.scale <= 0) continue;
      const w = Math.max(3, p.scale * 0.35);
      g.fillStyle(0x000000, 0.28);
      g.fillEllipse(p.sx + w * 0.6, p.sy + 1, w * 2.2, w * 0.6);
      g.fillStyle(0xe8601c, 1);
      g.fillRect(p.sx - w / 2, top.sy, w, p.sy - top.sy);
      g.fillStyle(0xffa060, 0.9);
      g.fillRect(p.sx - w / 2, top.sy, w * 0.35, p.sy - top.sy);
    }
    for (const [x, y] of [[-hw, -E], [hw, -E], [-hw, L + E], [hw, L + E]] as [number, number][]) {
      const p = this.screen(x, y);
      if (!p.visible || p.scale <= 0) continue;
      const s = p.scale * 0.45;
      if (s < 2) continue;
      g.fillStyle(0x000000, 0.28);
      g.fillEllipse(p.sx + s * 0.5, p.sy + s * 0.05, s * 1.6, s * 0.4);
      g.fillStyle(0x1f1f1f, 1);
      g.fillRect(p.sx - s * 0.7, p.sy - s * 0.1, s * 1.4, s * 0.2);
      g.fillStyle(0xd85f12, 1);
      g.fillTriangle(p.sx - s * 0.58, p.sy, p.sx + s * 0.58, p.sy, p.sx, p.sy - s * 1.6);
      g.fillStyle(0xff8a2e, 1);
      g.fillTriangle(p.sx - s * 0.58, p.sy, p.sx + s * 0.08, p.sy, p.sx, p.sy - s * 1.6);
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(p.sx - s * 0.32, p.sy - s * 0.95, s * 0.64, s * 0.2);
    }
  }

  private drawAthletes(): void {
    const controlledSet = new Set(this.controlled.filter(Boolean) as Athlete[]);
    for (const a of this.athletes) {
      const p = this.screen(a.x, a.y);
      const depthZ = this.world(a.x, a.y).wz + this.proj.cam.camZ;
      if (!p.visible) { a.sprite.setVisible(false); continue; }
      a.sprite.setVisible(true);
      a.sprite.setPosition(p.sx, p.sy);
      a.sprite.rescale(p.scale * 1.9 / 220);
      a.sprite.setDepth(100 + Math.max(0, 400 - depthZ * 4));
      const sp = Math.hypot(a.vx, a.vy);
      const sy = a.vy * this.dir; // positive = moving away from the camera
      const sx = a.vx * this.dir;
      if (sp > 0.5) {
        a.away = sy > -0.3;
        if (Math.abs(sx) > 0.4) a.flip = sx < 0 ? -1 : 1;
      }
      a.sprite.setFacing(a.flip);
      const holdingBall = this.holder === a;
      const frames: PoseName[] = sp > 0.5
        ? (a.away ? ['back-run0', 'back-run1', 'back-run2', 'back-run3'] : ['run0', 'run1', 'run2', 'run3'])
        : holdingBall && this.phase === 'live' && this.charging ? (a.away ? ['back-throw0'] : ['throw0'])
        : (a.away ? ['back-idle0', 'back-idle1'] : ['idle0', 'idle1']);
      if (!(a.sprite.sprite.frame.name.includes('throw') && !this.charging && this.pass)) a.sprite.setAnim(frames, sp > 0.5 ? 9 : 2, true);
      void controlledSet;
    }
  }

  private cueRing(sx: number, sy: number, r: number, color: number, alpha: number): void {
    this.ringG.lineStyle(Math.max(2, r * 0.08), color, alpha);
    this.ringG.strokeEllipse(sx, sy, r * 2, r * 0.7);
  }

  private drawBall(): void {
    const b = this.ball;
    const held = this.holder;
    if (this.phase === 'pre' && !held) { this.ballImg.setVisible(false); this.ballShadow.setVisible(false); return; }
    if (held) {
      const p = this.screen(held.x, held.y, 0);
      const s = p.scale * 1.9 / 220;
      const f = held.sprite.facingDir;
      this.ballImg.setVisible(p.visible).setPosition(p.sx + 36 * s * f, p.sy - 95 * s).setScale(s * 0.75).setAngle(-30 * f).setDepth(held.sprite.depth + 1);
      this.ballShadow.setVisible(false);
      return;
    }
    const p = this.screen(b.x, b.y, b.z);
    const g = this.screen(b.x, b.y, 0);
    if (!p.visible) { this.ballImg.setVisible(false); this.ballShadow.setVisible(false); return; }
    const depthZ = this.world(b.x, b.y).wz + this.proj.cam.camZ;
    const s = p.scale * 0.016;
    this.ballImg.setVisible(true).setPosition(p.sx, p.sy).setScale(Math.max(0.22, s)).setDepth(100 + Math.max(0, 400 - depthZ * 4) + 2);
    if (this.pass) {
      const ang = Phaser.Math.RadToDeg(Math.atan2((this.pass.to.y - this.pass.from.y) * -this.dir, (this.pass.to.x - this.pass.from.x) * this.dir));
      this.ballImg.setAngle(ang * 0.5);
    }
    this.ballShadow.setVisible(true).setPosition(g.sx, g.sy).setScale(Math.max(0.25, s * 3), Math.max(0.12, s * 1.5)).setAlpha(0.5).setDepth(20);
  }

  private drawCues(): void {
    const g = this.cueG;
    g.clear();
    this.ringG.clear();
    this.targetLabel.setVisible(false);
    if (this.phase === 'done') return;
    const off = this.state.offense;
    const offense = this.athletes.filter((a) => a.team === off);
    const controlledSet = new Set(this.controlled.filter(Boolean) as Athlete[]);
    for (const a of controlledSet) {
      const p = this.screen(a.x, a.y);
      if (p.visible) this.cueRing(p.sx, p.sy, p.scale * 1.15, 0xf5c518, 0.9);
    }
    // route arrow for the AI receiver on a human-controlled offence (pre-snap and early in the play)
    const humanOffense = !this.isAI(off);
    const wr = offense.find((a) => a !== this.holder && !controlledSet.has(a));
    if (humanOffense && wr && (this.phase === 'pre' || (this.phase === 'live' && this.playT < 2.2 && !this.passUsed)) && wr.route.length) {
      g.lineStyle(5, 0xf5c518, 0.8);
      let prev: Vec = { x: wr.x, y: wr.y };
      for (let i = wr.routeIdx; i < wr.route.length; i++) {
        this.segment(g, prev.x, prev.y, wr.route[i].x, wr.route[i].y);
        prev = wr.route[i];
      }
      const end = this.screen(prev.x, prev.y);
      if (end.visible && end.scale > 0) {
        g.fillStyle(0xf5c518, 0.9);
        const s = Math.max(6, end.scale * 0.5);
        g.fillTriangle(end.sx - s, end.sy + s * 0.4, end.sx + s, end.sy + s * 0.4, end.sx, end.sy - s);
      }
    }
    // tap-to-hike hint over the ball pre-snap
    if (this.phase === 'pre' && humanOffense && this.holder) {
      const p = this.screen(this.holder.x, this.holder.y);
      if (p.visible) {
        const pulse = 0.5 + 0.3 * Math.sin(this.time.now / 160);
        this.cueRing(p.sx, p.sy, p.scale * 1.6, 0x4ff0ff, pulse);
      }
    }
    // receiver ring + throw preview while charging (human QB)
    if (this.phase === 'live' && this.holder && controlledSet.has(this.holder) && !this.passUsed && !this.state.returning) {
      const qb = this.holder;
      const mate = offense.find((a) => a !== qb)!;
      const p = this.screen(mate.x, mate.y);
      if (p.visible) {
        this.cueRing(p.sx, p.sy, p.scale * 1.0, 0x4ff0ff, 0.85);
        this.targetLabel.setVisible(true).setPosition(p.sx, p.sy - p.scale * 1.9 / 220 * 230);
      }
      if (this.charging) {
        const power = Math.min(1, this.chargeT / this.cfg.chargeTime);
        const target = this.gesture ? this.screenToField(this.gesture.x, this.gesture.y) : leadPoint(mate, 1.5 + power * this.cfg.passMaxLead, this.cfg);
        const pf = makePass({ x: qb.x, y: qb.y }, target, this.cfg, power);
        g.lineStyle(4, 0x4ff0ff, 0.8);
        let prevPt: ReturnType<Projector['project']> | null = null;
        for (let i = 0; i <= 18; i++) {
          pf.t = (i / 18) * pf.duration;
          const pos = passPosition(pf);
          const sp = this.screen(pos.x, pos.y, pos.z);
          if (prevPt && sp.visible && prevPt.visible && i % 2 === 0) { g.beginPath(); g.moveTo(prevPt.sx, prevPt.sy); g.lineTo(sp.sx, sp.sy); g.strokePath(); }
          prevPt = sp;
        }
        const lpS = this.screen(target.x, target.y);
        if (lpS.visible) this.cueRing(lpS.sx, lpS.sy, lpS.scale * 0.8, 0x4ff0ff, 0.6);
        // power ring under the finger
        if (this.gesture) {
          const r = 34 + power * 46;
          g.lineStyle(6, 0xf5c518, 0.9);
          g.beginPath(); g.arc(this.gesture.x, this.gesture.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.03, power), false); g.strokePath();
          g.lineStyle(2, 0xffffff, 0.5);
          g.strokeCircle(this.gesture.x, this.gesture.y, 80);
        }
      }
    }
    // in-flight landing marker
    if (this.pass) {
      const lpS = this.screen(this.pass.to.x, this.pass.to.y);
      if (lpS.visible) this.cueRing(lpS.sx, lpS.sy, lpS.scale * 0.8, 0xffffff, 0.5);
    }
  }

  private drawMinimap(): void {
    const g = this.miniG;
    g.clear();
    const r = this.miniRect;
    const L = this.cfg.fieldLength, E = this.cfg.endZone, hw = this.cfg.width / 2;
    const total = L + 2 * E;
    g.fillStyle(0x0d1f10, 0.8);
    g.fillRoundedRect(r.x - 8, r.y - 8, r.width + 16, r.height + 16, 10);
    g.lineStyle(3, THEME.accent, 0.8);
    g.strokeRoundedRect(r.x - 8, r.y - 8, r.width + 16, r.height + 16, 10);
    const mx = (x: number) => r.x + ((x + hw) / (2 * hw)) * r.width;
    const my = (y: number) => r.y + r.height - ((y + E) / total) * r.height;
    g.fillStyle(0x4f8a34, 1);
    g.fillRect(r.x, r.y, r.width, r.height);
    g.fillStyle(this.players[0].character.accent, 0.5);
    g.fillRect(r.x, my(0), r.width, my(-E) - my(0));
    g.fillStyle(this.players[1].character.accent, 0.5);
    g.fillRect(r.x, my(L + E), r.width, my(L) - my(L + E));
    g.lineStyle(1, 0xffffff, 0.5);
    for (let y = 0; y <= L; y += 10) { g.beginPath(); g.moveTo(r.x, my(y)); g.lineTo(r.x + r.width, my(y)); g.strokePath(); }
    g.lineStyle(2, 0xf5c518, 1);
    const los = my(this.state.lineOfScrimmage);
    g.beginPath(); g.moveTo(r.x, los); g.lineTo(r.x + r.width, los); g.strokePath();
    for (const a of this.athletes) {
      g.fillStyle(this.players[a.team].character.accent, 1);
      g.fillCircle(mx(a.x), my(a.y), 5);
      g.lineStyle(1, 0x000000, 0.6);
      g.strokeCircle(mx(a.x), my(a.y), 5);
    }
    g.fillStyle(0xffffff, 1);
    g.fillCircle(mx(this.ball.x), my(this.ball.y), 3);
    g.fillStyle(0xffffff, 0.9);
    const ay = r.y + r.height / 2;
    const d = this.dir;
    g.fillTriangle(r.x + r.width + 10, ay - 10 * d, r.x + r.width + 10, ay + 10 * d, r.x + r.width + 2, ay);
  }
}

function gauss(sd: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v) * sd;
}
