import Phaser from 'phaser';
import { GAME_H, GAME_W, THEME } from '../core/constants';
import { buildCharacterTextures } from '../art/characters';
import { buildEquipmentTextures } from '../art/equipment';
import { displayStyle } from '../core/ui';
import { syncOrientation } from '../core/layout';

export class BootScene extends Phaser.Scene {
  constructor() { super('BootScene'); }
  preload(): void {
    // Optional logo: drop the Sports at Academy Hill logo at public/logo.png and the title screen uses it.
    this.load.image('logo', 'logo.png');
    this.load.on('loaderror', () => { /* logo missing: the menu draws its own title */ });
    this.add.text(GAME_W / 2, GAME_H / 2, 'Warming up...', displayStyle(40, THEME.text)).setOrigin(0.5);
  }
  create(): void {
    syncOrientation(this);
    buildCharacterTextures(this);
    buildEquipmentTextures(this);
    this.scene.start('MenuScene');
  }
}
