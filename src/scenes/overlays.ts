import Phaser from 'phaser';
import { GAME_H, GAME_W, GAMES, THEME, isPortrait, type GameId, type Mode } from '../core/constants';
import { makeButton, makeDim, makePanel, displayStyle, textStyle, confetti } from '../core/ui';
import type { MatchConfig, MatchResult } from '../core/match';
import { Storage } from '../core/storage';
import { Audio } from '../core/audio';
import { recordEventResult } from '../core/championship';
import { CharacterSprite } from '../art/characters';
import type { BaseGameScene } from '../core/BaseGameScene';

interface HowToData { gameId: GameId; parent: string; mode: Mode; onClose?: () => void; }

export class HowToScene extends Phaser.Scene {
  constructor() { super('HowToScene'); }
  create(data: HowToData): void {
    const info = GAMES[data.gameId];
    const W = GAME_W, H = GAME_H, P = isPortrait();
    makeDim(this, 0.75);
    const pw = P ? W - 60 : 1500;
    const ph = P ? H - 120 : 980;
    makePanel(this, W / 2, H / 2, pw, ph);
    const top = H / 2 - ph / 2;
    const left = W / 2 - pw / 2;
    this.add.text(W / 2, top + 24, 'HOW TO PLAY', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0);
    this.add.text(W / 2, top + 54, info.title, displayStyle(P ? 40 : 44, THEME.text)).setOrigin(0.5, 0);
    this.add.text(W / 2, top + 106, info.venue, textStyle(24, THEME.textDim, { fontStyle: 'italic' })).setOrigin(0.5, 0);
    const controls: string[] = ['CONTROLS'];
    const useTouch = this.sys.game.device.input.touch && Storage.settings.touch !== 'off';
    if (data.mode === 'local') {
      controls.push('Player 1 (keyboard):', ...info.keyboardP1.map((l) => '  ' + l));
      controls.push('Player 2 (keyboard):', ...info.keyboardP2.map((l) => '  ' + l));
      if (!info.turnBased) controls.push('', 'Two-player for this game needs a physical keyboard; both players share it.');
    } else {
      controls.push('Keyboard:', ...info.keyboardP1.map((l) => '  ' + l));
      if (useTouch || Storage.settings.touch === 'on') controls.push('Touch:', ...info.touch.map((l) => '  ' + l));
    }
    const rulesText = info.howTo.map((l) => '• ' + l).join('\n');
    if (P) {
      const r = this.add.text(left + 30, top + 150, rulesText, textStyle(24, THEME.text, { wordWrap: { width: pw - 60 }, lineSpacing: 6 })).setOrigin(0, 0);
      this.add.text(left + 30, top + 160 + r.height, controls.join('\n'), textStyle(22, '#ffe082', { wordWrap: { width: pw - 60 }, lineSpacing: 4 })).setOrigin(0, 0);
    } else {
      this.add.text(left + 40, top + 150, rulesText, textStyle(25, THEME.text, { wordWrap: { width: 880 }, lineSpacing: 8 })).setOrigin(0, 0);
      this.add.text(left + 960, top + 150, controls.join('\n'), textStyle(24, '#ffe082', { wordWrap: { width: 500 }, lineSpacing: 6 })).setOrigin(0, 0);
    }
    makeButton(this, W / 2, top + ph - 66, "LET'S PLAY", () => this.close(data), { width: 420, height: 92, fontSize: 36 });
    this.input.keyboard?.once('keydown-SPACE', () => this.close(data));
    this.input.keyboard?.once('keydown-ENTER', () => this.close(data));
  }
  private close(data: HowToData): void {
    this.scene.stop();
    this.scene.resume(data.parent);
    data.onClose?.();
  }
}

interface PauseData { parent: string; match: MatchConfig; }

export class PauseScene extends Phaser.Scene {
  constructor() { super('PauseScene'); }
  create(data: PauseData): void {
    const W = GAME_W, H = GAME_H, P = isPortrait();
    makeDim(this, 0.7);
    const pw = P ? W - 80 : 1100;
    const ph = P ? 900 : 760;
    makePanel(this, W / 2, H / 2, pw, ph);
    const top = H / 2 - ph / 2;
    this.add.text(W / 2, top + 30, 'PAUSED', displayStyle(56, '#f5c518')).setOrigin(0.5, 0);
    this.add.text(W / 2, top + 100, GAMES[data.match.gameId].title, textStyle(26, THEME.textDim)).setOrigin(0.5, 0);
    const resume = () => { this.scene.stop(); this.scene.resume(data.parent); };
    const bw = P ? pw - 80 : 460;
    const pos = (i: number): [number, number] => P ? [W / 2, top + 180 + i * 108] : [W / 2 + (i % 2 === 0 ? -260 : 260), top + 200 + Math.floor(i / 2) * 120];
    let p = pos(0); makeButton(this, p[0], p[1], 'RESUME', resume, { width: bw, height: 90, fontSize: 34 });
    p = pos(1); makeButton(this, p[0], p[1], 'RESTART MATCH', () => {
      const parent = this.scene.get(data.parent) as BaseGameScene;
      this.scene.stop();
      parent.restartMatch();
    }, { width: bw, height: 90, fontSize: 30, color: THEME.accent2 });
    p = pos(2); makeButton(this, p[0], p[1], 'HOW TO PLAY', () => {
      this.scene.stop();
      this.scene.launch('HowToScene', { gameId: data.match.gameId, parent: data.parent, mode: data.match.mode });
      this.scene.bringToTop('HowToScene');
    }, { width: bw, height: 90, fontSize: 30, color: 0x4fc3f7 });
    p = pos(3); makeButton(this, p[0], p[1], 'MAIN MENU', () => {
      this.scene.stop(data.parent);
      this.scene.stop();
      this.scene.start('MenuScene');
    }, { width: bw, height: 90, fontSize: 30, color: 0xef5350, textColor: '#ffffff' });
    const s = Storage.settings;
    p = pos(4);
    const sound = makeButton(this, p[0], p[1], `SOUND: ${s.soundOn ? 'ON' : 'OFF'}`, () => {
      const v = !Storage.settings.soundOn;
      Storage.updateSettings({ soundOn: v });
      Audio.applySettings();
      sound.setLabel(`SOUND: ${v ? 'ON' : 'OFF'}`);
    }, { width: bw, height: 84, fontSize: 28, color: 0x8bc34a });
    p = pos(5);
    const music = makeButton(this, p[0], p[1], `MUSIC: ${s.musicOn ? 'ON' : 'OFF'}`, () => {
      const v = !Storage.settings.musicOn;
      Storage.updateSettings({ musicOn: v });
      Audio.applySettings();
      music.setLabel(`MUSIC: ${v ? 'ON' : 'OFF'}`);
    }, { width: bw, height: 84, fontSize: 28, color: 0x8bc34a });
    const info = GAMES[data.match.gameId];
    const ctrl = data.match.mode === 'local'
      ? `P1: ${info.keyboardP1.join(' • ')}\nP2: ${info.keyboardP2.join(' • ')}`
      : `${info.keyboardP1.join(' • ')}\nTouch: ${info.touch.join(' • ')}`;
    this.add.text(W / 2, top + ph - 110, ctrl, textStyle(22, THEME.textDim, { align: 'center', wordWrap: { width: pw - 80 } })).setOrigin(0.5, 0);
    this.input.keyboard?.on('keydown-ESC', resume);
    this.input.keyboard?.on('keydown-P', resume);
  }
}

interface ResultData { parent: string; match: MatchConfig; result: MatchResult; }

export class ResultScene extends Phaser.Scene {
  constructor() { super('ResultScene'); }
  create(data: ResultData): void {
    const { match, result } = data;
    const W = GAME_W, H = GAME_H, P = isPortrait();
    const winner = match.players[result.winnerSlot];
    const loser = match.players[result.winnerSlot === 0 ? 1 : 0];
    makeDim(this, 0.72);
    const pw = P ? W - 80 : 1300;
    const ph = P ? 1100 : 860;
    makePanel(this, W / 2, H / 2, pw, ph);
    const top = H / 2 - ph / 2;
    this.add.text(W / 2, top + 26, match.championship ? 'EVENT RESULT' : 'FINAL', displayStyle(26, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0);
    this.add.text(W / 2, top + 60, `${winner.character.name.toUpperCase()} WINS!`, displayStyle(P ? 56 : 64, '#ffffff')).setOrigin(0.5, 0);
    this.add.text(W / 2, top + 140, GAMES[match.gameId].title, textStyle(26, THEME.textDim)).setOrigin(0.5, 0);
    const dx = P ? 230 : 230;
    const cy = top + 470;
    const w = new CharacterSprite(this, W / 2 - dx, cy, winner.character, 1.15);
    w.cheer();
    const l = new CharacterSprite(this, W / 2 + dx, cy, loser.character, 1.0);
    l.sad();
    this.add.text(W / 2 - dx, cy + 20, winner.character.name, displayStyle(32, '#f5c518')).setOrigin(0.5, 0);
    this.add.text(W / 2 + dx, cy + 20, loser.character.name, displayStyle(32, THEME.textDim)).setOrigin(0.5, 0);
    this.add.text(W / 2 - dx, cy + 60, result.scores[result.winnerSlot], displayStyle(42, '#ffffff')).setOrigin(0.5, 0);
    this.add.text(W / 2 + dx, cy + 60, result.scores[result.winnerSlot === 0 ? 1 : 0], displayStyle(42, '#ffffff')).setOrigin(0.5, 0);
    this.add.text(W / 2, top + 300, result.summary, textStyle(28, THEME.text, { align: 'center', wordWrap: { width: 400 } })).setOrigin(0.5, 0);
    confetti(this, W / 2 - dx, cy - 90, 70);
    this.time.delayedCall(400, () => confetti(this, W / 2, top + 250, 50));
    const by = top + ph - 110;
    const bx1 = P ? W / 2 : W / 2 - 240;
    const bx2 = P ? W / 2 : W / 2 + 240;
    const by1 = P ? by - 110 : by;
    if (match.championship) {
      const next = recordEventResult(match.championship, result.winnerSlot);
      this.add.text(W / 2, cy + 130, `Championship: ${match.players[0].character.name} ${next.points[0]} - ${next.points[1]} ${match.players[1].character.name}`, displayStyle(28, '#f5c518')).setOrigin(0.5, 0);
      makeButton(this, bx1, by1, 'CONTINUE CHAMPIONSHIP', () => {
        this.scene.stop(data.parent);
        this.scene.stop();
        this.scene.start('ChampionshipScene', { state: next, match });
      }, { width: 440, height: 96, fontSize: 28 });
    } else {
      makeButton(this, bx1, by1, 'REMATCH', () => {
        const parent = this.scene.get(data.parent) as BaseGameScene;
        this.scene.stop();
        parent.restartMatch();
      }, { width: 440, height: 96, fontSize: 36 });
    }
    makeButton(this, bx2, by, 'MAIN MENU', () => {
      this.scene.stop(data.parent);
      this.scene.stop();
      this.scene.start('MenuScene');
    }, { width: 440, height: 96, fontSize: 32, color: THEME.accent2 });
  }
}
