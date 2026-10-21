import Phaser from 'phaser';
import { GAME_H, GAME_W, GAME_ORDER, GAMES, THEME, isPortrait, type GameId } from '../core/constants';
import { makeButton, displayStyle, textStyle, makeIconButton } from '../core/ui';
import { Audio } from '../core/audio';
import { Storage } from '../core/storage';
import { CHARACTERS } from '../core/characters';
import { CharacterSprite } from '../art/characters';
import { createCanvas, paintGrass, paintSky, paintTreeSide } from '../art/environment';
import { syncOrientation, watchOrientation } from '../core/layout';

export class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  create(): void {
    syncOrientation(this);
    watchOrientation(this);
    Audio.setMusicStyle('outdoor');
    const W = GAME_W, H = GAME_H, P = isPortrait();
    this.buildBackground();
    const hasLogo = this.textures.exists('logo');
    const logoH = P ? 380 : 300;
    if (hasLogo) {
      const logo = this.add.image(W / 2, P ? 230 : 170, 'logo');
      const s = Math.min((P ? W - 120 : 640) / logo.width, logoH / logo.height);
      logo.setScale(s);
    } else {
      this.add.text(W / 2, P ? 70 : 30, 'SPORTS AT', displayStyle(P ? 54 : 48, '#fff3c4')).setOrigin(0.5, 0);
      this.add.text(W / 2, P ? 130 : 84, 'ACADEMY HILL', displayStyle(P ? 96 : 88, '#f5c518', { strokeThickness: 10 })).setOrigin(0.5, 0);
      this.add.text(W / 2, P ? 250 : 190, 'Seven homemade sports. Best friends. One afternoon.', textStyle(26, '#fff3c4', { fontStyle: 'italic' })).setOrigin(0.5, 0);
    }
    const askY = P ? 440 : 330;
    this.add.text(W / 2, askY, 'What game do you want to play?', displayStyle(P ? 40 : 40, '#ffffff')).setOrigin(0.5, 0);

    const s = Storage.settings;
    const p2id = s.p2 === s.p1 ? (s.p1 === 'vinnie' ? 'will' : 'vinnie') : s.p2;
    const p1 = new CharacterSprite(this, P ? 110 : 150, P ? 420 : 330, CHARACTERS[s.p1], P ? 0.8 : 1);
    p1.idle().setFacing(1);
    const p2 = new CharacterSprite(this, W - (P ? 110 : 150), P ? 420 : 330, CHARACTERS[p2id], P ? 0.8 : 1);
    p2.idle().setFacing(-1);

    // Game grid
    const cols = P ? 2 : 4;
    const cardW = P ? 480 : 420;
    const cardH = 100;
    const gapX = P ? 40 : 40;
    const rowH = P ? 190 : 185;
    const gridW = cols * cardW + (cols - 1) * gapX;
    const startX = W / 2 - gridW / 2 + cardW / 2;
    const startY = P ? 580 : 460;
    const items: (GameId | 'champ')[] = [...GAME_ORDER, 'champ'];
    items.forEach((id, i) => {
      const x = startX + (i % cols) * (cardW + gapX);
      const y = startY + Math.floor(i / cols) * rowH;
      if (id === 'champ') {
        makeButton(this, x, y, 'CHAMPIONSHIP', () => this.scene.start('SetupScene', { championship: true }), { width: cardW, height: cardH, fontSize: 32, color: 0xf5c518 });
        this.add.text(x, y + 58, 'All seven events in order', textStyle(21, '#fff3c4')).setOrigin(0.5, 0);
      } else {
        const info = GAMES[id];
        makeButton(this, x, y, info.short.toUpperCase(), () => this.scene.start('SetupScene', { gameId: id }), { width: cardW, height: cardH, fontSize: 32, color: info.accent, textColor: '#ffffff' });
        this.add.text(x, y + 58, info.blurb, textStyle(20, '#fff3c4', { align: 'center', wordWrap: { width: cardW - 10 } })).setOrigin(0.5, 0);
      }
    });
    const rows = Math.ceil(items.length / cols);
    const by = startY + rows * rowH + (P ? 20 : -10);
    makeButton(this, W / 2 - 230, by, 'SETTINGS', () => this.scene.start('SettingsScene'), { width: 420, height: 86, fontSize: 30, color: THEME.accent2 });
    makeButton(this, W / 2 + 230, by, 'RECORDS', () => this.scene.start('RecordsScene'), { width: 420, height: 86, fontSize: 30, color: 0x4fc3f7 });
    const r = Storage.records;
    this.add.text(W / 2, by + 60, `Matches played: ${r.matchesPlayed}   •   Sound ${s.soundOn ? 'on' : 'off'}, music ${s.musicOn ? 'on' : 'off'}`, textStyle(22, '#fff3c4')).setOrigin(0.5, 0);
    this.add.text(W / 2, H - 20, 'Plays in portrait or landscape. Local two-player wrestling, hockey and football need a keyboard.', textStyle(20, '#fff3c4', { align: 'center', wordWrap: { width: W - 100 } })).setOrigin(0.5, 1);
    makeIconButton(this, W - 60, H - 70, s.musicOn ? '♪' : '✕', () => {
      Storage.updateSettings({ musicOn: !Storage.settings.musicOn });
      Audio.applySettings();
      this.scene.restart();
    }, { radius: 36 });
    makeIconButton(this, 60, H - 70, '⛶', () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen();
    }, { radius: 36 });
    this.input.once('pointerdown', () => Audio.unlock());
  }

  private buildBackground(): void {
    const W = GAME_W, H = GAME_H;
    const key = `menu-bg-${W}x${H}`;
    if (!this.textures.exists(key)) {
      const { canvas, ctx } = createCanvas(W, H);
      const horizon = Math.round(H * 0.42);
      paintSky(ctx, W, H, horizon);
      paintGrass(ctx, 0, horizon - 20, W, H - horizon + 20, 7, '#4f8f36');
      const n = Math.ceil(W / 125);
      for (let i = 0; i < n; i++) paintTreeSide(ctx, 60 + i * 125, horizon + 20, 110 + (i % 3) * 20, 30 + i);
      const g = ctx.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, 'rgba(20,48,26,0.25)');
      g.addColorStop(1, 'rgba(20,48,26,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon, W, H - horizon);
      this.textures.addCanvas(key, canvas);
    }
    this.add.image(W / 2, H / 2, key);
  }
}

/** Shared backdrop for secondary menus. */
export function menuBackdrop(scene: Phaser.Scene): void {
  const W = GAME_W, H = GAME_H;
  scene.add.rectangle(W / 2, H / 2, W, H, THEME.bg);
  const key = `menu-bg-${W}x${H}`;
  if (scene.textures.exists(key)) scene.add.image(W / 2, H / 2, key).setAlpha(0.35);
}
