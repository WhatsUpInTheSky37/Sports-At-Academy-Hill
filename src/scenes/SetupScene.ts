import Phaser from 'phaser';
import { DIFFICULTIES, GAME_H, GAME_W, GAMES, THEME, isPortrait, type Difficulty, type GameId, type Mode } from '../core/constants';
import { CHARACTER_IDS, CHARACTERS, displayName, type CharacterId } from '../core/characters';
import { FOOTBALL_FORMATS, formatLabel, hasAllTimeQb, normalizeSetup, teamSize, type FootballFormat } from '../games/football/teams';
import { Storage } from '../core/storage';
import { makeButton, displayStyle, textStyle, makeIconButton, makePanel } from '../core/ui';
import { buildMatch } from '../core/match';
import { createChampionship } from '../core/championship';
import { CharacterSprite } from '../art/characters';
import { Audio } from '../core/audio';
import { syncOrientation, watchOrientation } from '../core/layout';
import { menuBackdrop } from './MenuScene';

interface SetupData { gameId?: GameId; championship?: boolean; }

/** Match setup: mode, difficulty, and who plays as whom. */
export class SetupScene extends Phaser.Scene {
  private mode!: Mode;
  private difficulty!: Difficulty;
  private p1!: CharacterId;
  private p2!: CharacterId;
  private setup!: SetupData;
  // football: format and the rosters being picked (captain first)
  private fmt: FootballFormat = '2v2';
  private teams: [CharacterId[], CharacterId[]] = [[], []];
  private qb: CharacterId | null = null;
  private dynamic: Phaser.GameObjects.GameObject[] = [];

  constructor() { super('SetupScene'); }

  create(data: SetupData): void {
    syncOrientation(this);
    watchOrientation(this);
    this.setup = data;
    this.dynamic = [];
    const s = Storage.settings;
    this.mode = s.mode;
    this.difficulty = s.difficulty;
    this.p1 = s.p1;
    this.p2 = s.p2 === s.p1 ? (s.p1 === 'vinnie' ? 'will' : 'vinnie') : s.p2;
    this.fmt = FOOTBALL_FORMATS.includes(s.footballFormat) ? s.footballFormat : '2v2';
    this.teams = [[...(s.footballTeams?.[0] ?? [])], [...(s.footballTeams?.[1] ?? [])]];
    this.qb = s.footballQb ?? null;
    const W = GAME_W;
    menuBackdrop(this);
    const title = data.championship ? 'ACADEMY HILL CHAMPIONSHIP' : GAMES[data.gameId!].title.toUpperCase();
    this.add.text(W / 2, 30, title, displayStyle(isPortrait() ? 40 : 48, '#f5c518', { align: 'center', wordWrap: { width: W - 200 } })).setOrigin(0.5, 0);
    this.add.text(W / 2, isPortrait() ? 110 : 96, data.championship ? 'Seven events in order, ending with darts. Four wins clinches it, but every event is played.' : GAMES[data.gameId!].blurb, textStyle(24, THEME.textDim, { align: 'center', wordWrap: { width: W - 240 } })).setOrigin(0.5, 0);
    makeIconButton(this, 60, 60, '<', () => this.scene.start('MenuScene'), { radius: 40 });
    this.render();
  }

  private render(): void {
    this.dynamic.forEach((o) => o.destroy());
    this.dynamic = [];
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => { this.dynamic.push(o); return o; };
    const W = GAME_W, H = GAME_H, P = isPortrait();
    const sel = (on: boolean) => ({ color: on ? THEME.accent : THEME.panelLight, textColor: on ? '#1a1a1a' : '#ffffff' });
    // Left column (landscape) / top block (portrait): mode + difficulty
    const colW = P ? W - 60 : 820;
    const leftX = P ? W / 2 : 30 + colW / 2;
    let y = P ? 170 : 170;
    add(makePanel(this, leftX, y + 70, colW, 140));
    add(this.add.text(leftX, y + 12, 'MODE', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
    add(makeButton(this, leftX - colW / 4, y + 85, '1 PLAYER vs CPU', () => { this.mode = 'single'; this.render(); }, { width: colW / 2 - 40, height: 80, fontSize: 26, ...sel(this.mode === 'single') }));
    add(makeButton(this, leftX + colW / 4, y + 85, '2 PLAYERS (LOCAL)', () => { this.mode = 'local'; this.render(); }, { width: colW / 2 - 40, height: 80, fontSize: 26, ...sel(this.mode === 'local') }));
    y += 160;
    add(makePanel(this, leftX, y + 70, colW, 140, { color: this.mode === 'single' ? THEME.panel : 0x4a2a10 }));
    if (this.mode === 'single') {
      add(this.add.text(leftX, y + 12, 'CPU DIFFICULTY', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
      DIFFICULTIES.forEach((d, i) => {
        add(makeButton(this, leftX + (i - 1) * (colW / 3), y + 85, d.toUpperCase(), () => { this.difficulty = d; this.render(); }, { width: colW / 3 - 30, height: 80, fontSize: 28, ...sel(this.difficulty === d) }));
      });
    } else {
      const game = this.setup.gameId ? GAMES[this.setup.gameId] : null;
      const sim = this.setup.championship || (game && !game.turnBased);
      const msg = sim
        ? 'KEYBOARD REQUIRED: wrestling, hockey and football are played at the same time. P1 uses WASD + F/G/H, P2 uses arrows + , . /'
        : 'Pass-and-play: players alternate turns on the same device. Touch or keyboard both work.';
      add(this.add.text(leftX, y + 70, msg, textStyle(22, '#ffe082', { align: 'center', wordWrap: { width: colW - 60 } })).setOrigin(0.5));
    }
    const football = this.setup.gameId === 'football' && !this.setup.championship;
    if (football) {
      // format row: 2 on 2 / 3 on 3 / 3 on 3 with an all-time QB (1 player only)
      y += 160;
      add(makePanel(this, leftX, y + 70, colW, 140));
      add(this.add.text(leftX, y + 12, 'FORMAT', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
      if (this.mode === 'local' && this.fmt === '3v3qb') this.fmt = '3v3';
      FOOTBALL_FORMATS.forEach((f, i) => {
        const locked = f === '3v3qb' && this.mode === 'local';
        const label = locked ? 'ALL-TIME QB\n(1 PLAYER ONLY)' : formatLabel(f).replace(' ALL-TIME QB', '\nALL-TIME QB');
        add(makeButton(this, leftX + (i - 1) * (colW / 3), y + 85, label, () => { if (locked) return; this.fmt = f; this.render(); }, { width: colW / 3 - 30, height: 80, fontSize: locked ? 18 : 22, ...sel(this.fmt === f), ...(locked ? { color: 0x3a3a3a, textColor: '#9a9a9a' } : {}) }));
      });
    }
    // Characters block
    const cx = P ? W / 2 : 30 + colW + 20 + (W - colW - 80) / 2;
    const cw = P ? W - 60 : W - colW - 80;
    const cy = P ? y + 170 : 170;
    const ch = P ? 760 : 700;
    add(makePanel(this, cx, cy + ch / 2, cw, ch));
    if (football) this.renderTeams(add, cx, cy, cw, ch);
    else this.renderPlayers(add, cx, cy, cw, ch);
    // Start
    const by = P ? H - 130 : H - 100;
    add(makeButton(this, P ? W / 2 : leftX, by, this.setup.championship ? 'START CHAMPIONSHIP' : 'PLAY!', () => this.start(), { width: P ? 600 : colW - 100, height: 110, fontSize: 42 }));
    add(this.add.text(P ? W / 2 : leftX, by - 90, 'How to Play is shown before your first match and from the ? button during play.', textStyle(20, THEME.textDim, { align: 'center', wordWrap: { width: P ? W - 80 : colW - 60 } })).setOrigin(0.5, 0));
  }

  /** The classic "who is playing" picker: one kid per side, all seven to choose from. */
  private renderPlayers(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, cx: number, cy: number, cw: number, ch: number): void {
    void ch;
    add(this.add.text(cx, cy + 12, 'WHO IS PLAYING?', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
    for (const slot of [0, 1] as const) {
      const sx = cx + (slot === 0 ? -cw / 4 : cw / 4);
      const label = slot === 0 ? 'PLAYER 1' : this.mode === 'single' ? 'CPU OPPONENT' : 'PLAYER 2';
      add(this.add.text(sx, cy + 50, label, displayStyle(26, '#ffffff')).setOrigin(0.5, 0));
      const id = slot === 0 ? this.p1 : this.p2;
      const sprite = add(new CharacterSprite(this, sx, cy + 290, CHARACTERS[id], 0.95));
      sprite.idle().setFacing(slot === 0 ? 1 : -1);
      add(this.add.text(sx, cy + 300, displayName(CHARACTERS[id]), displayStyle(30, '#f5c518')).setOrigin(0.5, 0));
      const other = slot === 0 ? this.p2 : this.p1;
      this.portraitGrid(add, sx, cy + 400, Math.min(110, (cw / 2 - 40) / 4), 44,
        (cid) => ({ on: cid === id, taken: cid === other }),
        (cid) => { Audio.sfx('click'); if (slot === 0) this.p1 = cid; else this.p2 = cid; this.render(); });
    }
    add(this.add.text(cx, cy + 610, 'All seven kids play every sport. Pick any two.', textStyle(22, THEME.textDim, { align: 'center', wordWrap: { width: cw - 40 } })).setOrigin(0.5, 0));
  }

  /** Football: pick each team's kids (captain first) and, with an all-time QB, who throws for both. */
  private renderTeams(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, cx: number, cy: number, cw: number, ch: number): void {
    const size = teamSize(this.fmt);
    const qbMode = hasAllTimeQb(this.fmt) && this.mode === 'single';
    const cols = qbMode ? 3 : 2;
    const colW = cw / cols;
    add(this.add.text(cx, cy + 12, 'PICK THE TEAMS', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
    const inTeam = (cid: CharacterId): -1 | 0 | 1 => (this.teams[0].includes(cid) ? 0 : this.teams[1].includes(cid) ? 1 : -1);
    for (let col = 0; col < cols; col++) {
      const sx = cx - cw / 2 + colW * (col + 0.5);
      const isQb = qbMode && col === 2;
      const team = col as 0 | 1;
      const label = isQb ? 'ALL-TIME QB (YOU)' : col === 0 ? (this.mode === 'single' ? 'YOUR TEAM' : 'PLAYER 1 TEAM') : (this.mode === 'single' ? 'CPU TEAM' : 'PLAYER 2 TEAM');
      add(this.add.text(sx, cy + 50, label, displayStyle(cols === 3 ? 22 : 26, '#ffffff')).setOrigin(0.5, 0));
      // the picks so far
      const picks = isQb ? (this.qb ? [this.qb] : []) : this.teams[team].slice(0, size);
      const want = isQb ? 1 : size;
      const pr = 34, pSpacing = 84;
      for (let i = 0; i < want; i++) {
        const bx = sx - ((want - 1) * pSpacing) / 2 + i * pSpacing;
        const by = cy + 125;
        const cid = picks[i];
        add(this.add.circle(bx, by, pr + 3, 0x000000, 0.35));
        add(this.add.circle(bx, by, pr, cid ? THEME.accent : THEME.panelLight, 1).setStrokeStyle(3, cid ? CHARACTERS[cid].accent : 0x777777));
        if (cid) {
          add(this.add.image(bx, by, `portrait-${cid}`).setScale(0.33 * pr / 46));
          add(this.add.text(bx, by + pr + 6, i === 0 && !isQb ? `${CHARACTERS[cid].name} ${CHARACTERS[cid].last} (C)` : `${CHARACTERS[cid].name} ${CHARACTERS[cid].last}`, textStyle(15, '#ffffff')).setOrigin(0.5, 0));
        } else {
          add(this.add.text(bx, by, '?', displayStyle(30, '#9a9a9a', { strokeThickness: 0 })).setOrigin(0.5));
        }
      }
      add(this.add.text(sx, cy + 190, isQb ? (this.qb ? 'throws for both teams' : 'pick a quarterback') : `${picks.length} / ${size} picked${picks.length < size ? ' (empty spots get filled)' : ''}`, textStyle(16, THEME.textDim)).setOrigin(0.5, 0));
      // the seven kids
      const spacing = Math.min(96, (colW - 24) / 4);
      const radius = Math.min(42, spacing * 0.44);
      this.portraitGrid(add, sx, cy + 262, spacing, radius,
        (cid) => {
          const t = inTeam(cid);
          if (isQb) return { on: this.qb === cid, taken: t !== -1 };
          return { on: t === team, taken: t === (team === 0 ? 1 : 0) || (qbMode && this.qb === cid) };
        },
        (cid) => {
          Audio.sfx('click');
          if (isQb) { this.qb = this.qb === cid ? null : cid; this.render(); return; }
          const list = this.teams[team];
          const at = list.indexOf(cid);
          if (at >= 0) list.splice(at, 1);
          else if (list.length >= size) list[size - 1] = cid;
          else list.push(cid);
          this.render();
        });
    }
    add(this.add.text(cx, cy + ch - 62, 'Will F, Vinnie G, Bryan B, Ben L, Dan R, Jimmy "Boner" K and Billy D are all up for grabs. The first pick is the captain. Tap a kid again to drop them.', textStyle(18, THEME.textDim, { align: 'center', wordWrap: { width: cw - 40 } })).setOrigin(0.5, 0));
  }

  /** Seven portraits in two rows (4 + 3) centred on sx. */
  private portraitGrid(add: <T extends Phaser.GameObjects.GameObject>(o: T) => T, sx: number, top: number, spacing: number, radius: number, state: (cid: CharacterId) => { on: boolean; taken: boolean }, choose: (cid: CharacterId) => void): void {
    CHARACTER_IDS.forEach((cid, i) => {
      const row = i < 4 ? 0 : 1;
      const col = i < 4 ? i : i - 4;
      const n = row === 0 ? 4 : 3;
      const bx = sx - ((n - 1) * spacing) / 2 + col * spacing;
      const by = top + row * (radius * 2 + 34);
      const { on, taken } = state(cid);
      const ring = add(this.add.circle(bx, by, radius, on ? THEME.accent : THEME.panelLight, 1).setStrokeStyle(on ? 4 : 3, on ? 0xffffff : CHARACTERS[cid].accent));
      const img = add(this.add.image(bx, by, `portrait-${cid}`).setScale(0.33 * radius / 46).setAlpha(taken ? 0.3 : 1));
      add(this.add.text(bx, by + radius + 4, `${CHARACTERS[cid].name} ${CHARACTERS[cid].last}`, textStyle(Math.round(radius * 0.36), taken ? THEME.textDim : '#ffffff')).setOrigin(0.5, 0));
      const pick = () => { if (taken) return; choose(cid); };
      ring.setInteractive({ useHandCursor: true }).on('pointerup', pick);
      img.setInteractive({ useHandCursor: true }).on('pointerup', pick);
    });
  }

  private start(): void {
    Storage.updateSettings({ mode: this.mode, difficulty: this.difficulty, p1: this.p1, p2: this.p2 });
    Audio.unlock();
    if (this.setup.championship) {
      const state = createChampionship();
      const match = buildMatch('derby', { mode: this.mode, difficulty: this.difficulty, p1: this.p1, p2: this.p2, championship: state });
      this.scene.start('ChampionshipScene', { state, match });
      return;
    }
    if (this.setup.gameId === 'football') {
      const fmt = this.mode === 'local' && this.fmt === '3v3qb' ? '3v3' : this.fmt;
      const fs = normalizeSetup(fmt, this.teams, this.qb);
      Storage.updateSettings({ footballFormat: this.fmt, footballTeams: fs.rosters, footballQb: fs.qb, p1: fs.rosters[0][0], p2: fs.rosters[1][0] });
      const match = buildMatch('football', { mode: this.mode, difficulty: this.difficulty, p1: fs.rosters[0][0], p2: fs.rosters[1][0], football: fs });
      this.scene.start(GAMES.football.sceneKey, { match });
      return;
    }
    const match = buildMatch(this.setup.gameId!, { mode: this.mode, difficulty: this.difficulty, p1: this.p1, p2: this.p2 });
    this.scene.start(GAMES[this.setup.gameId!].sceneKey, { match });
  }
}
