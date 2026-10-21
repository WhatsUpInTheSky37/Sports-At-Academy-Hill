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
  camZ: 7.5,
  camH: 2.7,
  /** Seconds before an AI offence snaps. */
  aiSnapDelay: 1.3,
  /** Seconds the play result stays on screen. */
  deadBallPause: 1700,
  /** Touch grace after an interception (new defenders cannot touch the returner instantly). */
  interceptGrace: 0.7,
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

type Phase = 'pre' | 'live' | 'dead' | 'done';

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
  private qbThrowRequested = false;
  private aiQbDecision = 0;
  private fieldG!: Phaser.GameObjects.Graphics;
  private cueG!: Phaser.GameObjects.Graphics;
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
    const W = this.W, H = this.H, P = this.portrait;
    this.fieldTop = this.hudBottom - 30;
    this.fieldBottom = P ? H - 300 : H - 150;
    const horizon = this.fieldTop + (this.fieldBottom - this.fieldTop) * 0.3;
    this.proj = new Projector({ camZ: FOOTBALL_VISUAL.camZ, camH: FOOTBALL_VISUAL.camH, horizonY: horizon, focal: P ? 1150 : 1050, cx: W / 2 });
    this.paintBackground();
    this.fieldG = this.add.graphics().setDepth(2);
    this.cueG = this.add.graphics().setDepth(40);
    this.ballShadow = this.add.image(0, 0, 'shadow').setDepth(20).setVisible(false);
    this.ballImg = this.add.image(0, 0, 'football').setDepth(600).setVisible(false);
    this.state = createFootball(this.cfg, 0);
    this.dir = attackDir(this.state.offense);
    this.buildAthletes();
    this.buildUi();
    this.ctrl[0] = this.makeControls(0, { labels: { a: 'SNAP / PASS', b: 'SWITCH' } });
    if (this.match.mode === 'local') this.ctrl[1] = this.makeControls(1, { labels: { a: 'SNAP / PASS', b: 'SWITCH' } });
    this.refreshHud();
    this.beginAfterHowTo(() => this.setupFormation());
  }

  // ---------- Setup ----------
  private buildAthletes(): void {
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
    this.meterLabel = this.add.text(W / 2 - mw / 2, my - 34, 'PASS POWER', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0).setDepth(901);
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
    this.targetLabel = this.add.text(0, 0, 'PASS TARGET', displayStyle(18, '#4ff0ff', { strokeThickness: 3 })).setOrigin(0.5, 1).setDepth(650).setVisible(false);
    // Hint panel bottom-left (keyboard only; touch buttons carry their own labels)
    if (touch) return;
    const hw = P ? 300 : 320;
    const hx = 30, hy = P ? H - 150 : H - 118;
    const hint = this.add.graphics().setDepth(900);
    hint.fillStyle(0x0d1f10, 0.8);
    hint.fillRoundedRect(hx, hy, hw, 96, 16);
    hint.lineStyle(3, THEME.accent, 0.8);
    hint.strokeRoundedRect(hx, hy, hw, 96, 16);
    this.add.text(hx + hw / 2, hy + 12, 'MOVE', displayStyle(20, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0).setDepth(901);
    this.add.text(hx + hw / 2, hy + 44, this.match.mode === 'local' ? 'P1 WASD + F/G  •  P2 arrows + , .' : 'WASD  •  F snap/pass  •  G switch', textStyle(19, '#ffffff')).setOrigin(0.5, 0).setDepth(901);
  }

  private paintBackground(): void {
    const W = this.W, H = this.H;
    const key = `football-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const pr = this.proj;
      const horizon = pr.cam.horizonY;
      const r = rng(41);
      paintSkyHD(ctx, W, H, horizon + 2, { sunX: W * 0.22, sunY: horizon * 0.26, seed: 23 });
      // The neighbourhood beyond the back fence: a hazy tree line, then rooftops and houses in front of it.
      const far = pr.scaleAt(70);
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 44; i++) woods.push({ x: -110 + i * 5.2 + r() * 3, z: 88 + r() * 50, s: 8 + r() * 7, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = pr.project(t.x, 0, t.z);
        const haze = Math.min(0.78, 0.3 + (t.z - 80) / 80);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.25 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      const houses: { x: number; z: number; w: number; seed: number }[] = [];
      for (let i = 0; i < 9; i++) houses.push({ x: -62 + i * 15.5 + (r() - 0.5) * 3, z: 74 + r() * 8, w: 11 + r() * 4, seed: 300 + i });
      houses.sort((a, b) => b.z - a.z).forEach((hs, i) => {
        const p = pr.project(hs.x, 0, hs.z);
        const sc = p.scale;
        const haze = Math.min(0.5, 0.18 + (hs.z - 74) / 40);
        paintHouseHD(ctx, p.sx - (hs.w / 2) * sc, p.sy - 6.2 * sc, hs.w * sc, 6.2 * sc, { siding: ['#efe6cf', '#d9e4f0', '#e6d2c0', '#d3e3cf', '#f1dede'][i % 5], roof: ['#5a4238', '#3f3a44', '#6a4a3a'][i % 3], haze, seed: hs.seed, garage: i % 3 === 1 });
        // a yard tree or two in front of each house
        if (r() > 0.4) paintTreeHD(ctx, p.sx + (r() - 0.5) * hs.w * 0.9 * sc, p.sy + 0.4 * sc, (5 + r() * 3) * sc, hs.seed + 7, { haze: haze * 0.6 });
      });
      paintHaze(ctx, W, horizon, 100);
      // the grassy field itself (static texture; the yard lines are drawn per frame on top)
      paintLawnHD(ctx, pr, { x0: -40, x1: 40, z0: -6, z1: 66 }, { seed: 13, base: '#5a9838', stripeWidth: 4.6, tuftDensity: 0.55 });
      // worn dirt where the kids play down the middle of the field
      for (let i = 0; i < 26; i++) {
        const wx = (r() - 0.5) * 8, wz = 2 + r() * 50;
        const p = pr.project(wx, 0, wz);
        if (!p.visible) continue;
        const rad = (1.2 + r() * 2.2) * p.scale;
        const pg = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, rad);
        pg.addColorStop(0, 'rgba(150,120,70,0.32)');
        pg.addColorStop(0.6, 'rgba(130,110,60,0.14)');
        pg.addColorStop(1, 'rgba(130,110,60,0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.ellipse(p.sx, p.sy, rad, rad * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      }
      // back fence along the far end of the field, with a gate and a shed behind it
      const fenceP = pr.project(0, 0, 66);
      const fh = Math.max(16, 1.9 * fenceP.scale);
      paintFenceHD(ctx, -10, W + 10, fenceP.sy, fh, 17);
      // framing trees close to the camera at the left and right edges
      paintTreeHD(ctx, -30, horizon + 70, 360, 91);
      paintTreeHD(ctx, W + 30, horizon + 60, 340, 92);
      paintPineHD(ctx, 60, horizon + 120, 230, 93);
      paintVignette(ctx, W, H, 0.22);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key).setDepth(0);
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
    this.setStatus(humanOff ? `${this.name(s.offense)}: press SNAP to start the play` : `${this.name(s.offense)} has the ball — get ready!`);
    this.prompt.setText(humanOff ? 'SNAP, then run or hold PASS to charge a throw to your teammate' : 'Touch the ball carrier to stop the play');
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
    this.setStatus(!this.isAI(off) ? 'Run, or hold PASS to charge a throw' : 'Defend! Touch the ball carrier');
    this.prompt.setText(this.state.returning ? '' : 'One forward pass per play, from behind the line');
  }

  private throwPass(qb: Athlete, target: Athlete, power: number, errorYards = 0): void {
    if (this.passUsed) return;
    const lead = 1.5 + power * this.cfg.passMaxLead;
    const lp = leadPoint(target, lead, this.cfg);
    if (errorYards > 0) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.abs(gauss(errorYards));
      lp.x = clampX(lp.x + Math.cos(a) * e, this.cfg);
      lp.y += Math.sin(a) * e;
    }
    this.pass = makePass({ x: qb.x, y: qb.y }, lp, this.cfg);
    this.passTarget = target;
    this.passUsed = true;
    this.holder = null;
    this.charging = false;
    this.meter.setVisible(false);
    this.meterLabel.setVisible(false);
    qb.sprite.setAnim(qb.away ? ['back-throw0', 'back-throw1'] : ['throw0', 'throw1'], 8, false);
    Audio.sfx('throw');
    this.setStatus('Pass is in the air!');
  }

  private endPlayWith(outcome: Parameters<typeof endPlay>[1]): void {
    if (this.phase !== 'live') return;
    this.phase = 'dead';
    const prevOffense = this.state.offense;
    const prevScores = [...this.state.scores];
    this.state = endPlay(this.state, outcome, this.cfg);
    this.charging = false;
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
      if (who !== prevOffense && outcome.type !== 'safety' && !this.state.returning) { /* pick-six already announced */ }
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
    // humans may move a little pre-snap (receiver can line up); keep behind the line
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

  private updateLive(dt: number): void {
    this.playT += dt;
    if (this.graceT > 0) this.graceT -= dt;
    const s = this.state;
    const off = s.offense;
    const d = this.dir;
    const defenders = this.athletes.filter((a) => a.team !== off);
    const offense = this.athletes.filter((a) => a.team === off);
    const human = (a: Athlete): 0 | 1 | null => (this.controlled[0] === a ? 0 : this.controlled[1] === a ? 1 : null);
    const aiSpeed = this.cfg.playerSpeed * (this.cfg.aiSpeedMin + this.ai * (this.cfg.aiSpeedMax - this.cfg.aiSpeedMin));

    // --- input: switching ---
    for (const slot of [0, 1] as const) {
      const c = this.ctrl[slot];
      if (c && c.justDown('b')) this.switchControlled(slot);
    }

    // --- offence ---
    for (const a of offense) {
      const h = human(a);
      if (h !== null) {
        const ax = this.axisFor(h);
        moveByInput(a, ax.x, ax.y, this.cfg.playerSpeed, dt);
        const c = this.ctrl[h]!;
        if (this.holder === a) {
          // QB / carrier with the ball
          const canPass = !this.passUsed && !s.returning && canForwardPass(off, a.y, s.lineOfScrimmage);
          if (c.justDown('a')) {
            if (canPass) { this.charging = true; this.chargeT = 0; this.meter.setVisible(true); this.meterLabel.setVisible(true); }
            else if (!this.passUsed && !s.returning) { this.notice('Past the line — run it!'); }
          }
          if (this.charging) {
            this.chargeT += dt;
            const p = Math.min(1, this.chargeT / this.cfg.chargeTime);
            this.meter.set(p);
            if (!canPass) { this.charging = false; this.meter.setVisible(false); this.meterLabel.setVisible(false); this.notice('Crossed the line — pass is off!'); }
            else if (c.justReleased('a') || !c.isDown('a')) {
              const mate = offense.find((o) => o !== a)!;
              this.throwPass(a, mate, p);
            }
          }
        } else if (this.holder && this.holder.team === off && c.justDown('a')) {
          // human controls the receiver: ask the AI QB to throw now
          this.qbThrowRequested = true;
        }
      } else if (this.holder === a) {
        this.aiCarrier(a, offense, defenders, aiSpeed, dt);
      } else if (this.pass && this.passTarget === a) {
        moveToward(a, this.pass.to.x, this.pass.to.y, aiSpeed * 1.05, dt);
      } else if (this.holder && this.holder.team === off) {
        this.aiReceiver(a, defenders, aiSpeed, dt);
      } else {
        // ball in the air to the other guy, or returned: drift toward the ball
        moveToward(a, this.ball.x, this.ball.y, aiSpeed * 0.8, dt);
      }
    }

    // --- defence ---
    for (const a of defenders) {
      const h = human(a);
      if (h !== null) {
        const ax = this.axisFor(h);
        moveByInput(a, ax.x, ax.y, this.cfg.playerSpeed, dt);
      } else {
        this.aiDefender(a, defenders, offense, aiSpeed, dt);
      }
    }

    // --- ball ---
    if (this.holder) {
      this.ball.x = this.holder.x; this.ball.y = this.holder.y; this.ball.z = 1;
      const carrier = this.holder;
      // touchdown
      if (crossedGoal(off, carrier.y, this.cfg)) return this.endPlayWith({ type: 'touchdown' });
      // out of bounds
      const backLine = off === 0 ? -this.cfg.endZone : this.cfg.fieldLength + this.cfg.endZone;
      if (outOfBoundsX(carrier.x, this.cfg) || (off === 0 ? carrier.y < backLine : carrier.y > backLine)) {
        carrier.x = clampX(carrier.x, this.cfg);
        return this.endPlayWith({ type: 'outOfBounds', spot: carrier.y });
      }
      // touch
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
      // interception check first for defenders near the ball
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
        // landed: forgiving catch if the receiver is close, else incomplete
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
    // the human on the intercepting team now controls the returner
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
    // seek open space: downfield and away from the nearest defender
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
        const power = Math.min(1, 0.25 + spd / this.cfg.playerSpeed * 0.5 + this.ai * 0.15);
        this.qbThrowRequested = false;
        this.throwPass(a, mate, power, err);
        return;
      }
      if (rushDist < 2.4 && this.playT > 0.4) {
        // scramble sideways/back away from the rusher
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
    // running with the ball: head for the goal, steer away from defenders, stay in bounds
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
      // nearest defender to the landing point goes for the ball
      const lp = this.pass.to;
      const nearest = defenders.reduce((b, dd) => (dist(dd, lp) < dist(b, lp) ? dd : b), defenders[0]);
      if (nearest === a) { moveToward(a, lp.x, lp.y, speed * react, dt); return; }
    }
    const carrier = this.holder;
    if (carrier && (this.passUsed || this.state.returning || a.role === 'rush')) {
      // pursue: aim for where the carrier will be
      const lead = 0.25 + this.ai * 0.2;
      moveToward(a, carrier.x + carrier.vx * lead, carrier.y + carrier.vy * lead, speed * react, dt);
      return;
    }
    // cover the receiver: stay goal-side and a step off
    const wr = offense.find((o) => o !== carrier) ?? offense[1];
    const tx = wr.x + wr.vx * (0.1 + this.ai * 0.15);
    const ty = wr.y + d * (1.6 - this.ai * 0.6);
    moveToward(a, tx, ty, speed * react, dt, 0.3);
  }

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
    const near = 0.6 - this.proj.cam.camZ + 0.6; // world z threshold so that depth stays > 0.6
    if (a.wz < near && b.wz < near) return;
    if (a.wz < near) { const t = (near - a.wz) / (b.wz - a.wz); a = { wx: a.wx + (b.wx - a.wx) * t, wz: near }; }
    if (b.wz < near) { const t = (near - b.wz) / (a.wz - b.wz); b = { wx: b.wx + (a.wx - b.wx) * t, wz: near }; }
    if (!chalk) {
      const pa = this.proj.project(a.wx, 0, a.wz);
      const pb = this.proj.project(b.wx, 0, b.wz);
      g.beginPath(); g.moveTo(pa.sx, pa.sy); g.lineTo(pb.sx, pb.sy); g.strokePath();
      return;
    }
    // deterministic wobble keyed on the segment's world position so the lines do not shimmer between frames
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
    // ground polygon with near clipping by dropping points behind the camera (coarse but fine for bands)
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

  private drawField(): void {
    const g = this.fieldG;
    g.clear();
    const L = this.cfg.fieldLength, E = this.cfg.endZone, hw = this.cfg.width / 2;
    // mowing bands
    for (let y = -E; y < L + E; y += 5) {
      if (((y + E) / 5) % 2 === 0) continue;
      g.fillStyle(0xffffdd, 0.07);
      this.quad(g, [[-hw - 6, y], [hw + 6, y], [hw + 6, y + 5], [-hw - 6, y + 5]]);
    }
    // end zone tints
    g.fillStyle(this.players[0].character.accent, 0.11);
    this.quad(g, [[-hw, -E], [hw, -E], [hw, 0], [-hw, 0]]);
    g.fillStyle(this.players[1].character.accent, 0.11);
    this.quad(g, [[-hw, L], [hw, L], [hw, L + E], [-hw, L + E]]);
    // line of scrimmage shading
    g.fillStyle(0xf5c518, 0.1);
    const los = this.state.lineOfScrimmage;
    this.quad(g, [[-hw, los - 0.25], [hw, los - 0.25], [hw, los + 0.25], [-hw, los + 0.25]]);
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
    // cones at the goal lines and end lines: shaded body, lit side, white band, square base and a cast shadow
    for (const [x, y] of [[-hw, 0], [hw, 0], [-hw, L], [hw, L], [-hw, -E], [hw, -E], [-hw, L + E], [hw, L + E]] as [number, number][]) {
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
      g.fillStyle(0xffb070, 0.9);
      g.fillTriangle(p.sx - s * 0.4, p.sy - s * 0.1, p.sx - s * 0.12, p.sy - s * 0.1, p.sx - s * 0.02, p.sy - s * 1.45);
      g.fillStyle(0xffffff, 0.85);
      g.fillRect(p.sx - s * 0.32, p.sy - s * 0.95, s * 0.64, s * 0.2);
      g.fillStyle(0xd9d9d9, 0.85);
      g.fillRect(p.sx + s * 0.05, p.sy - s * 0.95, s * 0.27, s * 0.2);
    }
    // yard numbers every 10
    for (let y = 10; y < L; y += 10) {
      const p = this.screen(-hw + 2.5, y);
      if (!p.visible || p.scale < 6) continue;
      g.lineStyle(2, 0xffffff, 0.5);
    }
  }

  private fitSprite(cs: CharacterSprite, s: number): void {
    cs.sprite.setScale(s);
    cs.sprite.y = -96 * s;
    cs.shadow.setScale(1.1 * s, 0.9 * s);
  }

  private drawAthletes(): void {
    const controlledSet = new Set(this.controlled.filter(Boolean) as Athlete[]);
    for (const a of this.athletes) {
      const p = this.screen(a.x, a.y);
      const depthZ = this.world(a.x, a.y).wz + this.proj.cam.camZ;
      if (!p.visible) { a.sprite.setVisible(false); continue; }
      a.sprite.setVisible(true);
      a.sprite.setPosition(p.sx, p.sy);
      this.fitSprite(a.sprite, p.scale * 1.9 / 220);
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
      // controlled ring + pass target ring
      if (controlledSet.has(a)) {
        this.cueRing(p.sx, p.sy, p.scale * 1.15, 0xf5c518, 0.9);
      }
    }
  }

  private ringG!: Phaser.GameObjects.Graphics;
  private cueRing(sx: number, sy: number, r: number, color: number, alpha: number): void {
    if (!this.ringG) this.ringG = this.add.graphics().setDepth(30);
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
    if (this.ringG) this.ringG.clear();
    this.targetLabel.setVisible(false);
    if (this.phase === 'done') return;
    const off = this.state.offense;
    const offense = this.athletes.filter((a) => a.team === off);
    const controlledSet = new Set(this.controlled.filter(Boolean) as Athlete[]);
    // re-draw controlled rings (cleared above)
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
    // pass target ring + arc preview while charging (human QB)
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
        const lp = leadPoint(mate, 1.5 + power * this.cfg.passMaxLead, this.cfg);
        const pf = makePass({ x: qb.x, y: qb.y }, lp, this.cfg);
        g.lineStyle(4, 0x4ff0ff, 0.8);
        let prevPt: ReturnType<Projector['project']> | null = null;
        for (let i = 0; i <= 18; i++) {
          pf.t = (i / 18) * pf.duration;
          const pos = passPosition(pf);
          const sp = this.screen(pos.x, pos.y, pos.z);
          if (prevPt && sp.visible && prevPt.visible && i % 2 === 0) { g.beginPath(); g.moveTo(prevPt.sx, prevPt.sy); g.lineTo(sp.sx, sp.sy); g.strokePath(); }
          prevPt = sp;
        }
        const lpS = this.screen(lp.x, lp.y);
        if (lpS.visible) this.cueRing(lpS.sx, lpS.sy, lpS.scale * 0.8, 0x4ff0ff, 0.6);
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
    // attack direction arrow
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
