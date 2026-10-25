import Phaser from 'phaser';
import { GAME_W, THEME, isPortrait } from '../core/constants';
import { Storage } from '../core/storage';
import { Audio } from '../core/audio';
import { makeButton, displayStyle, textStyle, makeIconButton, makePanel } from '../core/ui';
import { syncOrientation, watchOrientation } from '../core/layout';
import { menuBackdrop } from './MenuScene';

export class SettingsScene extends Phaser.Scene {
  constructor() { super('SettingsScene'); }
  create(): void {
    syncOrientation(this);
    watchOrientation(this);
    menuBackdrop(this);
    this.add.text(GAME_W / 2, 30, 'SETTINGS', displayStyle(52, '#f5c518')).setOrigin(0.5, 0);
    makeIconButton(this, 60, 60, '<', () => this.scene.start('MenuScene'), { radius: 40 });
    this.render();
  }
  private render(): void {
    this.children.list.filter((o) => o.getData('dyn')).forEach((o) => o.destroy());
    const s = Storage.settings;
    const W = GAME_W, P = isPortrait();
    const dyn = <T extends Phaser.GameObjects.GameObject>(o: T): T => { o.setData('dyn', true); return o; };
    const pw = Math.min(W - 60, 1400);
    const left = W / 2 - pw / 2;
    let y = 150;
    const row = (label: string, value: string, onMinus: () => void, onPlus: () => void, onToggle?: () => void) => {
      dyn(makePanel(this, W / 2, y, pw, 120));
      dyn(this.add.text(left + 30, y - 38, label, displayStyle(28, '#ffffff', { strokeThickness: 0 })).setOrigin(0, 0));
      dyn(this.add.text(left + 30, y + 4, value, textStyle(24, THEME.textDim)).setOrigin(0, 0));
      let bx = left + pw - 80;
      dyn(makeButton(this, bx, y, '+', onPlus, { width: 110, height: 80, fontSize: 40 })); bx -= 125;
      dyn(makeButton(this, bx, y, '−', onMinus, { width: 110, height: 80, fontSize: 40 })); bx -= 150;
      if (onToggle) dyn(makeButton(this, bx, y, 'TOGGLE', onToggle, { width: 180, height: 80, fontSize: 24, color: THEME.accent2 }));
      y += 140;
    };
    const vol = (v: number, d: number) => Phaser.Math.Clamp(Math.round((v + d) * 10) / 10, 0, 1);
    row('Sound effects', `${s.soundOn ? 'On' : 'Off'}  •  volume ${Math.round(s.soundVolume * 100)}%`,
      () => { Storage.updateSettings({ soundVolume: vol(s.soundVolume, -0.1) }); Audio.applySettings(); this.render(); },
      () => { Storage.updateSettings({ soundVolume: vol(s.soundVolume, 0.1) }); Audio.applySettings(); this.render(); },
      () => { Storage.updateSettings({ soundOn: !s.soundOn }); Audio.applySettings(); this.render(); });
    row('Music', `${s.musicOn ? 'On' : 'Off'}  •  volume ${Math.round(s.musicVolume * 100)}%`,
      () => { Storage.updateSettings({ musicVolume: vol(s.musicVolume, -0.1) }); Audio.applySettings(); this.render(); },
      () => { Storage.updateSettings({ musicVolume: vol(s.musicVolume, 0.1) }); Audio.applySettings(); this.render(); },
      () => { Storage.updateSettings({ musicOn: !s.musicOn }); Audio.applySettings(); this.render(); });
    const touchOpts: Array<'auto' | 'on' | 'off'> = ['auto', 'on', 'off'];
    const cycle = (d: number) => { const i = touchOpts.indexOf(s.touch); Storage.updateSettings({ touch: touchOpts[(i + d + 3) % 3] }); this.render(); };
    row('On-screen touch controls', `${s.touch.toUpperCase()}  (auto = shown on touch screens)`, () => cycle(-1), () => cycle(1));
    const hm = s.derbyHitMode === 'tap' ? 'TAP HIT  (tap the ball as it arrives)' : 'CLASSIC  (aim reticle + SWING button)';
    const toggleHit = () => { Storage.updateSettings({ derbyHitMode: s.derbyHitMode === 'tap' ? 'classic' : 'tap' }); this.render(); };
    row('Home Run Derby batting', hm, toggleHit, toggleHit);
    const ct = s.cpuTurns === 'skip' ? 'FAST-FORWARD  (a button in the game lets you watch)' : 'WATCH  (a button in the game skips ahead)';
    const toggleCpu = () => { Storage.updateSettings({ cpuTurns: s.cpuTurns === 'skip' ? 'watch' : 'skip' }); this.render(); };
    row('CPU turns in derby, HORSE, pool and darts', ct, toggleCpu, toggleCpu);
    const diffs = ['easy', 'normal', 'hard'] as const;
    const cd = (d: number) => { const i = diffs.indexOf(s.difficulty); Storage.updateSettings({ difficulty: diffs[(i + d + 3) % 3] }); this.render(); };
    row('Default CPU difficulty', s.difficulty.toUpperCase(), () => cd(-1), () => cd(1));
    const bw = P ? pw : 640;
    dyn(makeButton(this, P ? W / 2 : W / 2 - 340, y + 20, 'SHOW HOW-TO-PLAY CARDS AGAIN', () => { Storage.updateSettings({ seenHowTo: {} }); this.render(); }, { width: bw, height: 90, fontSize: 26, color: 0x4fc3f7 }));
    dyn(makeButton(this, P ? W / 2 : W / 2 + 340, y + 20 + (P ? 110 : 0), 'RESET WIN / LOSS RECORDS', () => { Storage.resetRecords(); this.render(); }, { width: bw, height: 90, fontSize: 26, color: 0xef5350, textColor: '#ffffff' }));
    dyn(this.add.text(W / 2, y + 100 + (P ? 110 : 0), 'Settings and records are saved in this browser (localStorage).', textStyle(22, THEME.textDim)).setOrigin(0.5, 0));
  }
}
