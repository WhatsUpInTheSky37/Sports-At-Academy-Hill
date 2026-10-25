import Phaser from 'phaser';
import { GAME_H, GAME_W, THEME } from './constants';
import { Audio } from './audio';

export interface ButtonOptions {
  width?: number;
  height?: number;
  color?: number;
  textColor?: string;
  fontSize?: number;
  icon?: string;
  depth?: number;
  sound?: boolean;
  radius?: number;
  disabled?: boolean;
}

export function hexToCss(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

export function textStyle(size: number, color = THEME.text, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: THEME.font, fontSize: `${size}px`, color, ...extra };
}

export function displayStyle(size: number, color = THEME.text, extra: Phaser.Types.GameObjects.Text.TextStyle = {}): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: THEME.fontDisplay, fontSize: `${size}px`, color, stroke: '#0d1f10', strokeThickness: Math.max(2, Math.round(size / 9)), ...extra };
}

/** A large, touch-friendly rounded button. Returns the container; use .setPosition etc. */
export function makeButton(scene: Phaser.Scene, x: number, y: number, label: string, onClick: () => void, opts: ButtonOptions = {}): Phaser.GameObjects.Container & { setLabel: (s: string) => void; setEnabled: (b: boolean) => void } {
  const w = opts.width ?? 420;
  const h = opts.height ?? 96;
  const color = opts.color ?? THEME.accent;
  const radius = opts.radius ?? 22;
  const c = scene.add.container(x, y) as Phaser.GameObjects.Container & { setLabel: (s: string) => void; setEnabled: (b: boolean) => void };
  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.3);
  shadow.fillRoundedRect(-w / 2 + 4, -h / 2 + 8, w, h, radius);
  const g = scene.add.graphics();
  const draw = (fill: number, pressed = false) => {
    g.clear();
    g.fillStyle(fill, 1);
    g.fillRoundedRect(-w / 2, -h / 2 + (pressed ? 4 : 0), w, h, radius);
    g.lineStyle(4, 0xffffff, 0.35);
    g.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2 + (pressed ? 4 : 0), w - 4, h - 4, radius - 2);
    g.fillStyle(0xffffff, 0.14);
    g.fillRoundedRect(-w / 2 + 6, -h / 2 + 6 + (pressed ? 4 : 0), w - 12, h / 2 - 8, { tl: radius - 4, tr: radius - 4, bl: 4, br: 4 });
  };
  draw(color);
  const t = scene.add.text(0, 0, label, displayStyle(opts.fontSize ?? 34, opts.textColor ?? '#1a1a1a', { strokeThickness: 0 })).setOrigin(0.5);
  c.add([shadow, g, t]);
  if (opts.depth !== undefined) c.setDepth(opts.depth);
  const zone = scene.add.zone(0, 0, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true });
  c.add(zone);
  let enabled = !opts.disabled;
  const applyEnabled = () => { c.setAlpha(enabled ? 1 : 0.45); };
  applyEnabled();
  zone.on('pointerdown', () => { if (!enabled) return; draw(Phaser.Display.Color.ValueToColor(color).darken(12).color, true); });
  const release = () => { draw(color); };
  zone.on('pointerout', release);
  zone.on('pointerupoutside', release);
  zone.on('pointerup', () => {
    if (!enabled) return;
    draw(color);
    Audio.unlock();
    if (opts.sound !== false) Audio.sfx('click');
    onClick();
  });
  c.setLabel = (s: string) => { t.setText(s); };
  c.setEnabled = (b: boolean) => { enabled = b; applyEnabled(); };
  return c;
}

/** Rounded translucent panel. */
export function makePanel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, opts: { color?: number; alpha?: number; radius?: number; stroke?: number } = {}): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(opts.color ?? THEME.panel, opts.alpha ?? 0.92);
  g.fillRoundedRect(x - w / 2, y - h / 2, w, h, opts.radius ?? 28);
  g.lineStyle(4, opts.stroke ?? THEME.accent, 0.8);
  g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, opts.radius ?? 28);
  return g;
}

/** Full-screen dim layer that swallows clicks. */
export function makeDim(scene: Phaser.Scene, alpha = 0.6): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x000000, alpha).setInteractive();
}

/** Small circular icon button (pause, help, back). */
export function makeIconButton(scene: Phaser.Scene, x: number, y: number, glyph: string, onClick: () => void, opts: { radius?: number; color?: number; depth?: number } = {}): Phaser.GameObjects.Container {
  const r = opts.radius ?? 46;
  const c = scene.add.container(x, y);
  const bg = scene.add.circle(0, 0, r, opts.color ?? THEME.panel, 0.9).setStrokeStyle(4, 0xffffff, 0.6);
  const t = scene.add.text(0, 0, glyph, displayStyle(Math.round(r * 0.9), THEME.text, { strokeThickness: 0 })).setOrigin(0.5);
  c.add([bg, t]);
  if (opts.depth !== undefined) c.setDepth(opts.depth);
  bg.setInteractive(new Phaser.Geom.Circle(0, 0, r + 14), Phaser.Geom.Circle.Contains, true);
  (bg.input as Phaser.Types.Input.InteractiveObject).cursor = 'pointer';
  bg.on('pointerdown', () => bg.setScale(0.9));
  bg.on('pointerup', () => { bg.setScale(1); Audio.unlock(); Audio.sfx('click'); onClick(); });
  bg.on('pointerout', () => bg.setScale(1));
  return c;
}

/** Big animated centre announcement; auto-destroys. */
export function announce(scene: Phaser.Scene, text: string, opts: { color?: string; size?: number; y?: number; hold?: number; depth?: number; sub?: string } = {}): void {
  const y = opts.y ?? GAME_H * 0.42;
  const t = scene.add.text(GAME_W / 2, y, text, displayStyle(opts.size ?? 96, opts.color ?? '#fff3c4', { align: 'center' })).setOrigin(0.5).setDepth(opts.depth ?? 5000).setScale(0.3).setAlpha(0);
  const items: Phaser.GameObjects.GameObject[] = [t];
  if (opts.sub) {
    const s = scene.add.text(GAME_W / 2, y + (opts.size ?? 96) * 0.8, opts.sub, displayStyle(40, '#ffffff')).setOrigin(0.5).setDepth(opts.depth ?? 5000).setAlpha(0);
    items.push(s);
    scene.tweens.add({ targets: s, alpha: 1, delay: 150, duration: 200 });
    scene.tweens.add({ targets: s, alpha: 0, delay: (opts.hold ?? 1200) + 200, duration: 300, onComplete: () => s.destroy() });
  }
  scene.tweens.add({ targets: t, scale: 1, alpha: 1, duration: 260, ease: 'Back.Out' });
  scene.tweens.add({ targets: t, alpha: 0, y: y - 60, delay: opts.hold ?? 1200, duration: 350, onComplete: () => t.destroy() });
}

/** Speech bubble near a point; auto-destroys. */
export function bubble(scene: Phaser.Scene, x: number, y: number, text: string, opts: { depth?: number; hold?: number; flip?: boolean } = {}): void {
  const pad = 18;
  const t = scene.add.text(0, 0, text, textStyle(30, '#222222', { fontStyle: 'bold', align: 'center', wordWrap: { width: 360 } })).setOrigin(0.5);
  const w = t.width + pad * 2;
  const h = t.height + pad * 2;
  const g = scene.add.graphics();
  g.fillStyle(0xffffff, 0.96);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 18);
  g.fillTriangle(-16, h / 2 - 2, 16, h / 2 - 2, opts.flip ? -34 : 34, h / 2 + 22);
  g.lineStyle(3, 0x333333, 0.5);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, 18);
  const cx = Phaser.Math.Clamp(x, w / 2 + 10, GAME_W - w / 2 - 10);
  const c = scene.add.container(cx, y - h / 2 - 30, [g, t]).setDepth(opts.depth ?? 4000).setScale(0).setAlpha(0);
  scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 200, ease: 'Back.Out' });
  scene.tweens.add({ targets: c, alpha: 0, delay: opts.hold ?? 1600, duration: 250, onComplete: () => c.destroy() });
}

/** Quick confetti burst using tweened rectangles. */
export function confetti(scene: Phaser.Scene, x: number, y: number, count = 60, depth = 6000): void {
  const colors = [0xf5c518, 0xff8a2a, 0x4fc3f7, 0x8bc34a, 0xef5350, 0xffffff, 0xba68c8];
  for (let i = 0; i < count; i++) {
    const r = scene.add.rectangle(x, y, 14 + Math.random() * 10, 8 + Math.random() * 8, colors[i % colors.length]).setDepth(depth).setAngle(Math.random() * 360);
    const ang = Math.random() * Math.PI * 2;
    const sp = 300 + Math.random() * 500;
    scene.tweens.add({
      targets: r,
      x: x + Math.cos(ang) * sp,
      y: y + Math.sin(ang) * sp * 0.6 + 500,
      angle: r.angle + (Math.random() - 0.5) * 720,
      alpha: 0,
      duration: 1400 + Math.random() * 700,
      ease: 'Quad.Out',
      onComplete: () => r.destroy(),
    });
  }
}

/** Sparkle/impact burst at a point. */
export function impact(scene: Phaser.Scene, x: number, y: number, color = 0xffffff, count = 10, depth = 3000, size = 10): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const d = scene.add.circle(x, y, size * (0.5 + Math.random() * 0.6), color).setDepth(depth);
    scene.tweens.add({ targets: d, x: x + Math.cos(a) * (40 + Math.random() * 60), y: y + Math.sin(a) * (40 + Math.random() * 60), alpha: 0, scale: 0.2, duration: 320 + Math.random() * 200, onComplete: () => d.destroy() });
  }
}

export function shake(scene: Phaser.Scene, intensity = 0.006, duration = 180): void {
  scene.cameras.main.shake(duration, intensity);
}

/** Simple wrapped multi-line text block inside a panel. */
export function makeTextBlock(scene: Phaser.Scene, x: number, y: number, width: number, lines: string[], size = 30, color = THEME.text): Phaser.GameObjects.Text {
  return scene.add.text(x, y, lines.map((l) => '• ' + l).join('\n\n'), textStyle(size, color, { wordWrap: { width }, lineSpacing: 6 })).setOrigin(0.5, 0);
}

/** Horizontal meter bar graphic helper. */
export class Meter {
  readonly g: Phaser.GameObjects.Graphics;
  constructor(scene: Phaser.Scene, public x: number, public y: number, public w: number, public h: number, private opts: { bg?: number; fg?: number; depth?: number; bands?: { from: number; to: number; color: number }[]; vertical?: boolean } = {}) {
    this.g = scene.add.graphics().setDepth(opts.depth ?? 100);
    this.set(0);
  }
  set(v: number, marker?: number): void {
    const g = this.g;
    g.clear();
    const { x, y, w, h } = this;
    g.fillStyle(0x000000, 0.55);
    g.fillRoundedRect(x - 4, y - 4, w + 8, h + 8, 10);
    g.fillStyle(this.opts.bg ?? 0x333333, 1);
    g.fillRoundedRect(x, y, w, h, 8);
    for (const b of this.opts.bands ?? []) {
      g.fillStyle(b.color, 0.9);
      if (this.opts.vertical) g.fillRect(x, y + h - b.to * h, w, (b.to - b.from) * h);
      else g.fillRect(x + b.from * w, y, (b.to - b.from) * w, h);
    }
    g.fillStyle(this.opts.fg ?? 0xf5c518, 1);
    const v2 = Phaser.Math.Clamp(v, 0, 1);
    if (this.opts.vertical) g.fillRoundedRect(x, y + h - v2 * h, w, v2 * h, 8);
    else g.fillRoundedRect(x, y, v2 * w, h, 8);
    if (marker !== undefined) {
      g.fillStyle(0xffffff, 1);
      if (this.opts.vertical) g.fillRect(x - 6, y + h - marker * h - 3, w + 12, 6);
      else g.fillRect(x + marker * w - 3, y - 6, 6, h + 12);
    }
  }
  setVisible(v: boolean): void { this.g.setVisible(v); }
  destroy(): void { this.g.destroy(); }
}
