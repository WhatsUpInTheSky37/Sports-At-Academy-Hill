import Phaser from 'phaser';
import { GAME_H, GAME_W, THEME } from './constants';
import { Storage } from './storage';

export type Button = 'a' | 'b' | 'c' | 'd';

export interface ControlsOptions {
  /** Show on-screen touch controls for this player (single player / touch devices). */
  touch?: boolean;
  /** Labels for the touch buttons; omit a button to hide it. */
  labels?: Partial<Record<Button, string>>;
  /** Hide the virtual joystick (for games that only need buttons). */
  noJoystick?: boolean;
  /** Button colors. */
  colors?: Partial<Record<Button, number>>;
  /** Screen area (logical px) where a touch starts the joystick; default: left half, lower 60%. */
  joyArea?: { x: number; y: number; w: number; h: number };
}

const KEYMAPS: Record<0 | 1, { up: number[]; down: number[]; left: number[]; right: number[]; a: number[]; b: number[]; c: number[]; d: number[] }> = {
  0: {
    up: [Phaser.Input.Keyboard.KeyCodes.W],
    down: [Phaser.Input.Keyboard.KeyCodes.S],
    left: [Phaser.Input.Keyboard.KeyCodes.A],
    right: [Phaser.Input.Keyboard.KeyCodes.D],
    a: [Phaser.Input.Keyboard.KeyCodes.F, Phaser.Input.Keyboard.KeyCodes.SPACE],
    b: [Phaser.Input.Keyboard.KeyCodes.G],
    c: [Phaser.Input.Keyboard.KeyCodes.H],
    d: [Phaser.Input.Keyboard.KeyCodes.J],
  },
  1: {
    up: [Phaser.Input.Keyboard.KeyCodes.UP],
    down: [Phaser.Input.Keyboard.KeyCodes.DOWN],
    left: [Phaser.Input.Keyboard.KeyCodes.LEFT],
    right: [Phaser.Input.Keyboard.KeyCodes.RIGHT],
    a: [Phaser.Input.Keyboard.KeyCodes.COMMA, Phaser.Input.Keyboard.KeyCodes.ENTER, Phaser.Input.Keyboard.KeyCodes.NUMPAD_ONE],
    b: [Phaser.Input.Keyboard.KeyCodes.PERIOD, Phaser.Input.Keyboard.KeyCodes.NUMPAD_TWO],
    c: [Phaser.Input.Keyboard.KeyCodes.FORWARD_SLASH, Phaser.Input.Keyboard.KeyCodes.NUMPAD_THREE],
    d: [Phaser.Input.Keyboard.KeyCodes.QUOTES, Phaser.Input.Keyboard.KeyCodes.NUMPAD_FOUR],
  },
};

export function touchEnabled(scene: Phaser.Scene): boolean {
  const pref = Storage.settings.touch;
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  return scene.sys.game.device.input.touch;
}

/**
 * Unified per-player controls: keyboard (two separate layouts) plus optional on-screen
 * joystick and buttons. Call nothing per frame; state updates automatically before each scene update.
 */
export class Controls {
  readonly axis = { x: 0, y: 0 };
  private keys: Record<string, Phaser.Input.Keyboard.Key[]> = {};
  private touchDown: Record<Button, boolean> = { a: false, b: false, c: false, d: false };
  private down: Record<Button, boolean> = { a: false, b: false, c: false, d: false };
  private prevDown: Record<Button, boolean> = { a: false, b: false, c: false, d: false };
  private justFlags: Record<Button, boolean> = { a: false, b: false, c: false, d: false };
  private releasedFlags: Record<Button, boolean> = { a: false, b: false, c: false, d: false };
  private joyBase?: Phaser.GameObjects.Arc;
  private joyKnob?: Phaser.GameObjects.Arc;
  private joyPointer: Phaser.Input.Pointer | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private touchAxis = { x: 0, y: 0 };
  private container?: Phaser.GameObjects.Container;
  private destroyed = false;

  constructor(private scene: Phaser.Scene, readonly slot: 0 | 1, private opts: ControlsOptions = {}) {
    const km = KEYMAPS[slot];
    const kb = scene.input.keyboard;
    if (kb) {
      for (const name of Object.keys(km) as (keyof typeof km)[]) {
        this.keys[name] = km[name].map((code) => kb.addKey(code, false, false));
      }
    }
    if (opts.touch) this.buildTouch();
    scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.refresh, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  private keyDown(name: string): boolean {
    const ks = this.keys[name];
    return !!ks && ks.some((k) => k.isDown);
  }

  private refresh(): void {
    if (this.destroyed) return;
    let x = 0;
    let y = 0;
    if (this.keyDown('left')) x -= 1;
    if (this.keyDown('right')) x += 1;
    if (this.keyDown('up')) y -= 1;
    if (this.keyDown('down')) y += 1;
    if (x === 0 && y === 0) {
      x = this.touchAxis.x;
      y = this.touchAxis.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.axis.x = x;
    this.axis.y = y;
    for (const b of ['a', 'b', 'c', 'd'] as Button[]) {
      this.prevDown[b] = this.down[b];
      this.down[b] = this.keyDown(b) || this.touchDown[b];
      this.justFlags[b] = this.down[b] && !this.prevDown[b];
      this.releasedFlags[b] = !this.down[b] && this.prevDown[b];
    }
  }

  isDown(b: Button): boolean { return this.down[b]; }
  justDown(b: Button): boolean { return this.justFlags[b]; }
  justReleased(b: Button): boolean { return this.releasedFlags[b]; }
  get moving(): boolean { return this.axis.x !== 0 || this.axis.y !== 0; }

  /** Programmatic press (used by on-screen buttons built elsewhere, e.g. a big SWING button). */
  setTouchButton(b: Button, isDown: boolean): void { this.touchDown[b] = isDown; }

  setVisible(v: boolean): void { this.container?.setVisible(v); }

  private buildTouch(): void {
    const scene = this.scene;
    scene.input.addPointer(3);
    const c = scene.add.container(0, 0).setDepth(10000).setScrollFactor(0);
    this.container = c;
    const labels = this.opts.labels ?? { a: 'A', b: 'B', c: 'C' };
    const colors = this.opts.colors ?? {};
    const defaults: Record<Button, number> = { a: 0xf5c518, b: 0x4fc3f7, c: 0xef5350, d: 0x8bc34a };
    // Buttons: bottom-right cluster.
    const buttons = (['a', 'b', 'c', 'd'] as Button[]).filter((b) => labels[b] !== undefined);
    const positions: Record<number, { x: number; y: number }[]> = {
      1: [{ x: GAME_W - 150, y: GAME_H - 190 }],
      2: [{ x: GAME_W - 130, y: GAME_H - 290 }, { x: GAME_W - 300, y: GAME_H - 150 }],
      3: [{ x: GAME_W - 130, y: GAME_H - 330 }, { x: GAME_W - 280, y: GAME_H - 190 }, { x: GAME_W - 130, y: GAME_H - 120 }],
      // diamond: a top, b left, c right, d bottom
      4: [{ x: GAME_W - 240, y: GAME_H - 380 }, { x: GAME_W - 390, y: GAME_H - 235 }, { x: GAME_W - 100, y: GAME_H - 235 }, { x: GAME_W - 240, y: GAME_H - 100 }],
    };
    buttons.forEach((b, i) => {
      const p = positions[buttons.length][i];
      const r = 82;
      const col = colors[b] ?? defaults[b];
      const ring = scene.add.circle(p.x, p.y, r + 6, 0x000000, 0.25);
      const circle = scene.add.circle(p.x, p.y, r, col, 0.75).setStrokeStyle(4, 0xffffff, 0.8);
      const txt = scene.add.text(p.x, p.y, labels[b] ?? '', { fontFamily: THEME.fontDisplay, fontSize: buttons.length >= 4 ? '26px' : '30px', color: '#1a1a1a', align: 'center' }).setOrigin(0.5);
      circle.setInteractive(new Phaser.Geom.Circle(r, r, r + 20), Phaser.Geom.Circle.Contains);
      circle.on('pointerdown', () => { this.touchDown[b] = true; circle.setAlpha(1); circle.setScale(0.92); });
      const up = () => { this.touchDown[b] = false; circle.setAlpha(0.75); circle.setScale(1); };
      circle.on('pointerup', up);
      circle.on('pointerout', up);
      circle.on('pointerupoutside', up);
      c.add([ring, circle, txt]);
    });
    if (!this.opts.noJoystick) {
      const baseX = 190;
      const baseY = GAME_H - 230;
      this.joyBase = scene.add.circle(baseX, baseY, 120, 0x000000, 0.25).setStrokeStyle(4, 0xffffff, 0.5);
      this.joyKnob = scene.add.circle(baseX, baseY, 58, 0xffffff, 0.75);
      c.add([this.joyBase, this.joyKnob]);
      this.joyOrigin = { x: baseX, y: baseY };
      scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (this.joyPointer || !this.inJoyArea(p.x, p.y)) return;
        this.joyPointer = p;
        this.joyOrigin = { x: p.x, y: p.y };
        this.joyBase?.setPosition(p.x, p.y);
        this.joyKnob?.setPosition(p.x, p.y);
        this.joyBase?.setAlpha(1);
      });
      scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (p !== this.joyPointer) return;
        this.updateJoystick(p);
      });
      const release = (p: Phaser.Input.Pointer) => {
        if (p !== this.joyPointer) return;
        this.joyPointer = null;
        this.touchAxis.x = 0;
        this.touchAxis.y = 0;
        this.joyKnob?.setPosition(this.joyOrigin.x, this.joyOrigin.y);
      };
      scene.input.on('pointerup', release);
      scene.input.on('pointerupoutside', release);
    }
  }

  /** True when a touch at (x, y) should start the joystick rather than count as a tap on the game. */
  inJoyArea(x: number, y: number): boolean {
    const a = this.opts.joyArea;
    if (!a) return x <= GAME_W * 0.5 && y >= GAME_H * 0.4;
    return x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h;
  }

  private updateJoystick(p: Phaser.Input.Pointer): void {
    const dx = p.x - this.joyOrigin.x;
    const dy = p.y - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    const max = 110;
    const k = len > max ? max / len : 1;
    const kx = dx * k;
    const ky = dy * k;
    this.joyKnob?.setPosition(this.joyOrigin.x + kx, this.joyOrigin.y + ky);
    const dead = 14;
    if (len < dead) {
      this.touchAxis.x = 0;
      this.touchAxis.y = 0;
    } else {
      this.touchAxis.x = kx / max;
      this.touchAxis.y = ky / max;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.refresh, this);
    this.container?.destroy();
  }
}
