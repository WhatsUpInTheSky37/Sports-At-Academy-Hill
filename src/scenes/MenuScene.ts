import Phaser from 'phaser';
import { GAME_H, GAME_W, GAME_ORDER, GAMES, THEME, isPortrait, type GameId } from '../core/constants';
import { makeButton, displayStyle, textStyle, makeIconButton } from '../core/ui';
import { Audio } from '../core/audio';
import { purgeBackdrops } from '../core/BaseGameScene';
import { purgeCharacterSheets } from '../art/characters';
import { Storage } from '../core/storage';
import { CHARACTERS } from '../core/characters';
import { CharacterSprite } from '../art/characters';
import { createCanvas, paintCypress, paintHaze, paintLawnHD, paintPineHD, paintSkyHD, paintTreeHD, paintVignette, rng } from '../art/environment';
import { Projector } from '../core/projection';
import { syncOrientation, watchOrientation } from '../core/layout';

export class MenuScene extends Phaser.Scene {
  constructor() { super('MenuScene'); }

  create(): void {
    syncOrientation(this);
    watchOrientation(this);
    purgeBackdrops(this);
    purgeCharacterSheets(this, [Storage.settings.p1, Storage.settings.p2]);
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
      this.add.text(W / 2, P ? 250 : 190, 'Seven homemade sports. Best friends. One afternoon.', displayStyle(26, '#fff3c4', { fontStyle: 'italic', strokeThickness: 4 })).setOrigin(0.5, 0);
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
    const bw = P ? 300 : 360;
    makeButton(this, W / 2 - (bw + 20), by, 'SETTINGS', () => this.scene.start('SettingsScene'), { width: bw, height: 86, fontSize: P ? 24 : 28, color: THEME.accent2 });
    makeButton(this, W / 2, by, 'RECORDS', () => this.scene.start('RecordsScene'), { width: bw, height: 86, fontSize: P ? 24 : 28, color: 0x4fc3f7 });
    makeButton(this, W / 2 + (bw + 20), by, 'HIGH SCORES', () => this.scene.start('HighScoresScene'), { width: bw, height: 86, fontSize: P ? 24 : 28, color: 0xf5c518 });
    const r = Storage.records;
    this.add.text(W / 2, by + 60, `Matches played: ${r.matchesPlayed}   •   Sound ${s.soundOn ? 'on' : 'off'}`, displayStyle(22, '#fff3c4', { strokeThickness: 3 })).setOrigin(0.5, 0);
    this.add.text(W / 2, H - 20, 'Plays in portrait or landscape. Local two-player wrestling, hockey and football need a keyboard.', textStyle(20, '#fff3c4', { align: 'center', wordWrap: { width: W - 100 } })).setOrigin(0.5, 1);
    makeIconButton(this, W - 60, H - 70, s.soundOn ? '🔊' : '🔇', () => {
      Storage.updateSettings({ soundOn: !Storage.settings.soundOn });
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
      const horizon = Math.round(H * 0.4);
      const pr = new Projector({ camZ: 6, camH: 2.2, horizonY: horizon, focal: W > H ? 1150 : 1250, cx: W / 2 });
      const r = rng(33);
      paintSkyHD(ctx, W, H, horizon + 2, { sunX: W * 0.7, sunY: horizon * 0.3 });
      const woods: { x: number; z: number; s: number; seed: number }[] = [];
      for (let i = 0; i < 40; i++) woods.push({ x: -90 + i * 4.6 + r() * 3, z: 52 + r() * 40, s: 7 + r() * 6, seed: 100 + i });
      woods.sort((a, b) => b.z - a.z).forEach((t) => {
        const p = pr.project(t.x, 0, t.z);
        const haze = Math.min(0.8, 0.3 + (t.z - 40) / 70);
        if (t.seed % 3 === 0) paintPineHD(ctx, p.sx, p.sy, t.s * 1.3 * p.scale, t.seed, { haze });
        else paintTreeHD(ctx, p.sx, p.sy, t.s * p.scale, t.seed, { haze });
      });
      paintHaze(ctx, W, horizon, 110);
      paintLawnHD(ctx, pr, { x0: -60, x1: 60, z0: -6, z1: 46 }, { seed: 4, base: '#5a9a3a', stripeWidth: 3.4 });
      const trees: { x: number; z: number; h: number; seed: number }[] = [];
      for (let x = -46; x <= 46; x += 2.1) trees.push({ x: x + (r() - 0.5) * 0.5, z: 40 + r() * 0.8, h: 1.7 * (0.9 + r() * 0.35), seed: 300 + Math.round(x * 3) });
      trees.map((t) => ({ ...t, z: t.z + 2, h: t.h * 1.3, seed: t.seed + 1000 })).concat(trees).sort((a, b) => b.z - a.z).forEach((t) => {
        const p = pr.project(t.x, 0, t.z);
        const haze = Math.max(0, Math.min(0.45, (t.z - 20) / 90));
        if (t.seed % 7 === 0) paintPineHD(ctx, p.sx, p.sy, t.h * p.scale * 1.1, t.seed, { haze });
        else paintCypress(ctx, p.sx, p.sy, t.h * p.scale, t.seed, { haze });
      });
      // darken the lower two thirds so the menu cards stay readable
      const g = ctx.createLinearGradient(0, horizon, 0, H);
      g.addColorStop(0, 'rgba(20,48,26,0.15)');
      g.addColorStop(1, 'rgba(20,48,26,0.8)');
      ctx.fillStyle = g;
      ctx.fillRect(0, horizon, W, H - horizon);
      paintVignette(ctx, W, H, 0.3);
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
