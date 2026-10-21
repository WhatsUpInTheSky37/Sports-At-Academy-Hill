import Phaser from 'phaser';
import { DIFFICULTIES, GAME_H, GAME_W, GAMES, THEME, isPortrait, type Difficulty, type GameId, type Mode } from '../core/constants';
import { CHARACTER_IDS, CHARACTERS, type CharacterId } from '../core/characters';
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
    // Characters block
    const cx = P ? W / 2 : 30 + colW + 20 + (W - colW - 80) / 2;
    const cw = P ? W - 60 : W - colW - 80;
    const cy = P ? y + 170 : 170;
    const ch = P ? 760 : 700;
    add(makePanel(this, cx, cy + ch / 2, cw, ch));
    add(this.add.text(cx, cy + 12, 'WHO IS PLAYING?', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
    for (const slot of [0, 1] as const) {
      const sx = cx + (slot === 0 ? -cw / 4 : cw / 4);
      const label = slot === 0 ? 'PLAYER 1' : this.mode === 'single' ? 'CPU OPPONENT' : 'PLAYER 2';
      add(this.add.text(sx, cy + 50, label, displayStyle(26, '#ffffff')).setOrigin(0.5, 0));
      const id = slot === 0 ? this.p1 : this.p2;
      const sprite = add(new CharacterSprite(this, sx, cy + 330, CHARACTERS[id], 1.05));
      sprite.idle().setFacing(slot === 0 ? 1 : -1);
      add(this.add.text(sx, cy + 345, CHARACTERS[id].name, displayStyle(36, '#f5c518')).setOrigin(0.5, 0));
      const spacing = Math.min(110, (cw / 2 - 40) / 4);
      CHARACTER_IDS.forEach((cid, i) => {
        const bx = sx - spacing * 1.5 + i * spacing;
        const by = cy + 450;
        const on = cid === id;
        const other = slot === 0 ? this.p2 : this.p1;
        const taken = cid === other;
        const ring = add(this.add.circle(bx, by, 46, on ? THEME.accent : THEME.panelLight, 1).setStrokeStyle(4, on ? 0xffffff : CHARACTERS[cid].accent));
        const img = add(this.add.image(bx, by, `portrait-${cid}`).setScale(0.66).setAlpha(taken ? 0.3 : 1));
        add(this.add.text(bx, by + 52, CHARACTERS[cid].name, textStyle(18, taken ? THEME.textDim : '#ffffff')).setOrigin(0.5, 0));
        const choose = () => { if (taken) return; Audio.sfx('click'); if (slot === 0) this.p1 = cid; else this.p2 = cid; this.render(); };
        ring.setInteractive({ useHandCursor: true }).on('pointerup', choose);
        img.setInteractive({ useHandCursor: true }).on('pointerup', choose);
      });
    }
    add(this.add.text(cx, cy + 560, 'Will, Vinnie, Bryan and Ben all play every sport. Pick any two.', textStyle(22, THEME.textDim, { align: 'center', wordWrap: { width: cw - 40 } })).setOrigin(0.5, 0));
    // Start
    const by = P ? H - 130 : H - 100;
    add(makeButton(this, P ? W / 2 : leftX, by, this.setup.championship ? 'START CHAMPIONSHIP' : 'PLAY!', () => this.start(), { width: P ? 600 : colW - 100, height: 110, fontSize: 42 }));
    add(this.add.text(P ? W / 2 : leftX, by - 90, 'How to Play is shown before your first match and from the ? button during play.', textStyle(20, THEME.textDim, { align: 'center', wordWrap: { width: P ? W - 80 : colW - 60 } })).setOrigin(0.5, 0));
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
    const match = buildMatch(this.setup.gameId!, { mode: this.mode, difficulty: this.difficulty, p1: this.p1, p2: this.p2 });
    this.scene.start(GAMES[this.setup.gameId!].sceneKey, { match });
  }
}
