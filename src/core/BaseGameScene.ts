import Phaser from 'phaser';
import { GAME_H, GAME_W, GAMES, THEME, isPortrait, type GameId } from './constants';
import { Controls, touchEnabled, type ControlsOptions } from './input';
import type { MatchConfig, MatchResult, PlayerInfo } from './match';
import { recordResult, aiLevel } from './match';
import { Storage } from './storage';
import { Audio } from './audio';
import { announce, bubble, displayStyle, makeButton, makeIconButton } from './ui';
import { buildCharacterTextures, purgeCharacterSheets } from '../art/characters';
import { buildEquipmentTextures } from '../art/equipment';
import { pick } from './characters';
import { syncOrientation } from './layout';

export interface GameSceneData { match: MatchConfig; }

/**
 * Shared shell for every game scene: match config, pause/help buttons, scoreboard panels,
 * controls factory, result handoff, and small presentation helpers. Lays out for both orientations.
 */
export abstract class BaseGameScene extends Phaser.Scene {
  abstract readonly gameId: GameId;
  match!: MatchConfig;
  protected hud!: Phaser.GameObjects.Container;
  protected finished = false;
  protected started = false;
  /** Screen y where the top HUD ends; scenes place their playfield below this. */
  protected hudBottom = 150;
  private pauseKey?: Phaser.Input.Keyboard.Key;
  private nameTexts: Phaser.GameObjects.Text[] = [];
  private scoreTexts: Phaser.GameObjects.Text[] = [];
  private turnMarkers: Phaser.GameObjects.Graphics[] = [];
  private panelRects: Phaser.Geom.Rectangle[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private scoreboardSub!: Phaser.GameObjects.Text;
  /** Whose turn the scene last announced (turn-based games), for CPU-turn fast-forwarding. */
  private turnSlot: 0 | 1 | null = null;
  /** Fast-forward the CPU's turns in this match (starts from the setting; the button toggles it). */
  private ffWanted = true;
  private ffButton: (Phaser.GameObjects.Container & { setLabel: (s: string) => void }) | null = null;
  private ffOn = false;
  /** How many sim steps a fast-forwarded frame runs. */
  static readonly FAST_FORWARD = 6;

  constructor(key: string) {
    super(key);
    // Wrap the subclass's update so a fast-forwarded frame steps the game several times: the CPU's
    // turn in derby, HORSE, pool or darts flies by instead of being watched.
    const tick = this.update as (t: number, d: number) => void;
    if (typeof tick === 'function') {
      this.update = (t: number, d: number) => {
        const n = this.fastFactor();
        this.applySpeed(n);
        for (let i = 0; i < n; i++) tick.call(this, t + i * d, d);
      };
    }
  }

  /** Turn-based games where a person has nothing to do during the CPU's turn. */
  private canFastForward(): boolean {
    const info = GAMES[this.gameId];
    return info.turnBased && this.gameId !== 'hockey' && this.match.mode === 'single';
  }

  private fastFactor(): number {
    if (!this.started || this.finished || !this.ffWanted || !this.canFastForward()) return 1;
    return this.turnSlot !== null && this.isAI(this.turnSlot) ? BaseGameScene.FAST_FORWARD : 1;
  }

  private applySpeed(n: number): void {
    const on = n > 1;
    if (on === this.ffOn) return;
    this.ffOn = on;
    this.time.timeScale = n;
    this.tweens.timeScale = n;
    Audio.quiet = on;
  }

  private refreshFastForwardButton(): void {
    const b = this.ffButton;
    if (!b) return;
    const show = this.canFastForward() && !this.finished && this.turnSlot !== null && this.isAI(this.turnSlot);
    b.setVisible(show);
    if (show) b.setLabel(this.ffWanted ? '⏩ CPU TURN  •  tap to watch' : '⏩ SKIP CPU TURN');
  }

  init(data: GameSceneData): void {
    this.match = data.match;
    this.finished = false;
    this.started = false;
    this.nameTexts = [];
    this.scoreTexts = [];
    this.turnMarkers = [];
    this.panelRects = [];
  }

  get players(): [PlayerInfo, PlayerInfo] { return this.match.players; }
  get useTouch(): boolean { return touchEnabled(this); }
  /** 0 (easy) .. 1 (hard). */
  get ai(): number { return aiLevel(this.match.difficulty); }
  get W(): number { return GAME_W; }
  get H(): number { return GAME_H; }
  get portrait(): boolean { return isPortrait(); }
  isAI(slot: 0 | 1): boolean { return this.players[slot].isAI; }
  name(slot: 0 | 1): string { return this.players[slot].character.name; }
  /** Rectangle of a player's HUD panel (for placing extra per-player info). */
  panelRect(slot: 0 | 1): Phaser.Geom.Rectangle { return this.panelRects[slot]; }

  /** Subclasses call this at the start of create(). */
  protected setupShell(opts: { music?: 'outdoor' | 'basement' } = {}): void {
    syncOrientation(this);
    // backdrops and pose sheets are big canvases; drop the ones this match does not need so memory never piles up
    purgeBackdrops(this, `${this.gameId}-bg`);
    purgeCharacterSheets(this, [this.players[0].character.id, this.players[1].character.id]);
    buildCharacterTextures(this);
    buildEquipmentTextures(this);
    Audio.setMusicStyle(opts.music ?? 'outdoor');
    this.hud = this.add.container(0, 0).setDepth(9000);
    const info = GAMES[this.gameId];
    const W = this.W;
    const P = this.portrait;
    const plateW = P ? Math.min(W - 60, 620) : 600;
    const plateX = W / 2 - plateW / 2;
    const plate = this.add.graphics();
    plate.fillStyle(0x0d1f10, 0.85);
    plate.fillRoundedRect(plateX, 14, plateW, 74, 18);
    plate.lineStyle(4, THEME.accent, 0.95);
    plate.strokeRoundedRect(plateX, 14, plateW, 74, 18);
    this.hud.add(plate);
    this.hud.add(this.add.text(W / 2, 28, 'ACADEMY HILL', displayStyle(20, '#fff3c4', { strokeThickness: 0 })).setOrigin(0.5, 0));
    this.hud.add(this.add.text(W / 2, 50, info.title.toUpperCase(), displayStyle(P ? 24 : 26, '#f5c518', { strokeThickness: 0 })).setOrigin(0.5, 0));
    const panelW = P ? Math.min(460, (W - 60) / 2) : 440;
    const panelY = P ? 104 : 14;
    for (const slot of [0, 1] as const) {
      const p = this.players[slot];
      const px = slot === 0 ? (P ? 20 : 20) : W - 20 - panelW;
      const g = this.add.graphics();
      g.fillStyle(0x0d1f10, 0.85);
      g.fillRoundedRect(px, panelY, panelW, 112, 18);
      g.lineStyle(4, THEME.accent, 0.95);
      g.strokeRoundedRect(px, panelY, panelW, 112, 18);
      this.hud.add(g);
      this.panelRects.push(new Phaser.Geom.Rectangle(px, panelY, panelW, 112));
      const portrait = this.add.image(px + 62, panelY + 56, `portrait-${p.character.id}`).setScale(0.36);
      const ring = this.add.circle(px + 62, panelY + 56, 44).setStrokeStyle(5, p.character.accent);
      const marker = this.add.graphics();
      marker.fillStyle(THEME.accent, 1);
      marker.fillTriangle(px + 48, panelY + 114, px + 76, panelY + 114, px + 62, panelY + 132);
      marker.setVisible(false);
      const nm = this.add.text(px + 120, panelY + 16, p.character.name.toUpperCase() + (p.isAI ? ' (CPU)' : ''), displayStyle(24, THEME.text, { strokeThickness: 0 })).setOrigin(0, 0);
      const sc = this.add.text(px + 120, panelY + 48, '0', displayStyle(36, '#f5c518', { strokeThickness: 0 })).setOrigin(0, 0);
      this.hud.add([ring, portrait, marker, nm, sc]);
      this.nameTexts.push(nm);
      this.scoreTexts.push(sc);
      this.turnMarkers.push(marker);
    }
    const subY = P ? 236 : 94;
    const subW = P ? Math.min(W - 60, 560) : 520;
    const sub = this.add.graphics();
    sub.fillStyle(0x0d1f10, 0.8);
    sub.fillRoundedRect(W / 2 - subW / 2, subY, subW, 44, 12);
    sub.lineStyle(3, THEME.accent, 0.8);
    sub.strokeRoundedRect(W / 2 - subW / 2, subY, subW, 44, 12);
    this.hud.add(sub);
    this.scoreboardSub = this.add.text(W / 2, subY + 22, '', displayStyle(22, '#ffffff', { strokeThickness: 0, align: 'center' })).setOrigin(0.5);
    this.hud.add(this.scoreboardSub);
    this.statusText = this.add.text(W / 2, subY + 60, '', displayStyle(30, '#ffffff', { align: 'center' })).setOrigin(0.5, 0);
    // CPU-turn fast-forward (turn-based games vs the CPU): shown while the CPU is up
    this.ffWanted = Storage.settings.cpuTurns !== 'watch';
    this.turnSlot = null; this.ffOn = false;
    this.ffButton = makeButton(this, W - 30 - 170, this.hudBottom + 2, '⏩ SKIP CPU TURN', () => { this.ffWanted = !this.ffWanted; this.refreshFastForwardButton(); if (this.fastFactor() === 1) this.applySpeed(1); }, { width: 340, height: 50, fontSize: 19, color: 0x37474f, textColor: '#ffffff' });
    this.ffButton.setDepth(9300).setVisible(false);
    this.hud.add(this.ffButton);
    this.hud.add(this.statusText);
    this.hudBottom = subY + 100;
    // help / pause buttons flank the title plate
    const bx = plateW / 2 + 46;
    this.hud.add(makeIconButton(this, W / 2 - bx, 50, '?', () => this.showHelp(), { radius: 32 }));
    this.hud.add(makeIconButton(this, W / 2 + bx, 50, 'II', () => this.pauseGame(), { radius: 32 }));
    // Exit: always available, one tap plus a confirm so a stray touch can't lose a match.
    this.hud.add(makeIconButton(this, W / 2 + bx + 76, 50, '✕', () => this.exitGame(), { radius: 32, color: 0x7a1f1f }));
    this.pauseKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.pauseKey?.on('down', () => this.pauseGame());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.pauseKey?.destroy();
    });
  }

  /** Show the How-to-Play card first if this game hasn't been seen, then call start. */
  protected beginAfterHowTo(start: () => void): void {
    const seen = Storage.settings.seenHowTo[this.gameId];
    const go = () => {
      if (this.started) return;
      this.started = true;
      start();
    };
    if (!seen) {
      Storage.markHowToSeen(this.gameId);
      this.showHelp(go);
    } else {
      go();
    }
  }

  protected showHelp(onClose?: () => void): void {
    if (this.scene.isActive('HowToScene')) return;
    this.scene.launch('HowToScene', { gameId: this.gameId, parent: this.scene.key, mode: this.match.mode, onClose });
    this.scene.bringToTop('HowToScene');
    this.scene.pause();
  }

  /** Ask, then leave the match and return to the main menu. */
  protected exitGame(): void {
    if (this.scene.isActive('ConfirmExitScene') || this.scene.isActive('ResultScene')) return;
    if (this.scene.isActive('PauseScene')) this.scene.stop('PauseScene');
    if (this.scene.isActive('HowToScene')) this.scene.stop('HowToScene');
    this.scene.launch('ConfirmExitScene', { parent: this.scene.key });
    this.scene.bringToTop('ConfirmExitScene');
    this.scene.pause();
  }

  protected pauseGame(): void {
    if (this.finished || this.scene.isActive('PauseScene') || this.scene.isActive('HowToScene') || this.scene.isActive('ResultScene')) return;
    this.scene.launch('PauseScene', { parent: this.scene.key, match: this.match });
    this.scene.bringToTop('PauseScene');
    this.scene.pause();
  }

  /** Create controls for a slot; touch is shown for a human slot in single player or whenever touch mode is on. */
  protected makeControls(slot: 0 | 1, opts: ControlsOptions = {}): Controls {
    const touch = opts.touch ?? (this.useTouch && !this.isAI(slot) && (this.match.mode === 'single' || slot === 0));
    return new Controls(this, slot, { ...opts, touch });
  }

  setScore(slot: 0 | 1, text: string): void { this.scoreTexts[slot]?.setText(text); }
  setStatus(text: string): void { this.statusText?.setText(text); }
  setSub(text: string): void { this.scoreboardSub?.setText(text); }
  setTurn(slot: 0 | 1 | null): void {
    this.turnMarkers.forEach((m, i) => m.setVisible(slot === i));
    this.nameTexts.forEach((t, i) => t.setColor(slot === i ? '#f5c518' : THEME.text));
    this.turnSlot = slot;
    this.refreshFastForwardButton();
    if (this.fastFactor() === 1) this.applySpeed(1);
  }

  announce(text: string, opts: Parameters<typeof announce>[2] = {}): void { announce(this, text, opts); }

  /** Friendly competitive reaction from a character at a screen position. */
  react(slot: 0 | 1, kind: 'cheer' | 'groan' | 'taunt', x: number, y: number): void {
    const ch = this.players[slot].character;
    const line = kind === 'cheer' ? pick(ch.cheers) : kind === 'groan' ? pick(ch.groans) : pick(ch.taunts);
    bubble(this, x, y, line, { flip: slot === 1 });
    if (kind === 'cheer') Audio.sfx('cheer');
    if (kind === 'groan') Audio.sfx('groan');
  }

  /** End the match: record it and hand off to the result overlay. */
  protected finishMatch(result: MatchResult): void {
    if (this.finished) return;
    this.finished = true;
    this.applySpeed(1);
    this.refreshFastForwardButton();
    recordResult(this.match, result);
    Audio.sfx('win');
    this.time.delayedCall(900, () => {
      this.scene.launch('ResultScene', { parent: this.scene.key, match: this.match, result });
      this.scene.bringToTop('ResultScene');
      this.scene.pause();
    });
  }

  /** Overlay scenes call this to restart the current game with the same match config. */
  restartMatch(): void {
    this.scene.restart({ match: this.match });
  }
}

/** Remove cached backdrop textures (keys containing "-bg-"), optionally keeping one game's. */
export function purgeBackdrops(scene: Phaser.Scene, keepPrefix?: string): void {
  for (const key of scene.textures.getTextureKeys()) {
    if (!key.includes('-bg-')) continue;
    if (keepPrefix && key.startsWith(keepPrefix)) continue;
    scene.textures.remove(key);
  }
}
