import Phaser from 'phaser';
import { GAME_H, GAME_ORDER, GAME_W, GAMES, THEME, isPortrait } from '../core/constants';
import { CHARACTER_IDS, CHARACTERS } from '../core/characters';
import { Storage } from '../core/storage';
import { displayStyle, textStyle, makeIconButton, makePanel } from '../core/ui';
import { syncOrientation, watchOrientation } from '../core/layout';
import { menuBackdrop } from './MenuScene';

export class RecordsScene extends Phaser.Scene {
  constructor() { super('RecordsScene'); }
  create(): void {
    syncOrientation(this);
    watchOrientation(this);
    menuBackdrop(this);
    const W = GAME_W, H = GAME_H, P = isPortrait();
    this.add.text(W / 2, 30, 'RECORDS', displayStyle(52, '#f5c518')).setOrigin(0.5, 0);
    makeIconButton(this, 60, 60, '<', () => this.scene.start('MenuScene'), { radius: 40 });
    const r = Storage.records;
    const pw = Math.min(W - 60, 1500);
    const left = W / 2 - pw / 2;
    makePanel(this, W / 2, H / 2 + 40, pw, H - 180);
    const colX = [left + 30, ...CHARACTER_IDS.map((_, i) => left + pw * (0.26 + i * 0.118))];
    const top = 150;
    this.add.text(colX[0], top + 20, 'Game', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0.5);
    CHARACTER_IDS.forEach((id, i) => {
      this.add.image(colX[i + 1], top + 10, `portrait-${id}`).setScale(P ? 0.19 : 0.225);
      this.add.text(colX[i + 1], top + 40, `${CHARACTERS[id].name} ${CHARACTERS[id].last}`, textStyle(P ? 15 : 18, THEME.textDim)).setOrigin(0.5, 0);
    });
    const rowH = P ? 80 : 62;
    GAME_ORDER.forEach((gid, row) => {
      const y = top + 110 + row * rowH;
      this.add.text(colX[0], y, GAMES[gid].short, textStyle(P ? 20 : 24, '#ffffff')).setOrigin(0, 0.5);
      CHARACTER_IDS.forEach((cid, i) => {
        const wl = r.games[gid]?.[cid];
        this.add.text(colX[i + 1], y, wl ? `${wl.wins}-${wl.losses}` : '–', textStyle(P ? 20 : 24, wl ? '#ffffff' : THEME.textDim)).setOrigin(0.5);
      });
      this.add.rectangle(W / 2, y + rowH / 2, pw - 80, 2, 0xffffff, 0.12);
    });
    let y = top + 110 + 7 * rowH + 10;
    this.add.text(colX[0], y, 'Championships', displayStyle(24, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0.5);
    CHARACTER_IDS.forEach((cid, i) => this.add.text(colX[i + 1], y, String(r.championships[cid] ?? 0), displayStyle(28, '#ffffff')).setOrigin(0.5));
    y += 70;
    this.add.text(W / 2, y, 'YOU vs THE CPU', displayStyle(26, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0);
    (['easy', 'normal', 'hard'] as const).forEach((d, i) => {
      const t = r.vsAI[d];
      this.add.text(W / 2 + (i - 1) * 260, y + 44, `${d.toUpperCase()}: ${t.wins} W - ${t.losses} L`, textStyle(24, '#ffffff', { align: 'center' })).setOrigin(0.5, 0);
    });
    this.add.text(W / 2, y + 90, `Total matches played: ${r.matchesPlayed}`, textStyle(22, THEME.textDim)).setOrigin(0.5, 0);
  }
}
