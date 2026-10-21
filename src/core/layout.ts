import Phaser from 'phaser';
import { GAME_H, GAME_W, LANDSCAPE, PORTRAIT, setLogicalSize } from './constants';

/** Which logical size matches the device right now. */
export function desiredSize(): { w: number; h: number } {
  const portrait = window.innerHeight > window.innerWidth;
  return portrait ? PORTRAIT : LANDSCAPE;
}

/**
 * Call at the top of every top-level scene's create(). If the device orientation changed since the
 * last scene, the canvas is resized to the matching logical size before the scene lays itself out.
 */
export function syncOrientation(scene: Phaser.Scene): void {
  const d = desiredSize();
  if (d.w !== GAME_W || d.h !== GAME_H) {
    setLogicalSize(d.w, d.h);
    scene.scale.resize(d.w, d.h);
    scene.cameras.main.setSize(d.w, d.h);
  }
}

/** Convenience bundle for layout maths. */
export function layout(): { W: number; H: number; P: boolean; cx: number; cy: number } {
  return { W: GAME_W, H: GAME_H, P: GAME_H > GAME_W, cx: GAME_W / 2, cy: GAME_H / 2 };
}

/**
 * Menu-type scenes restart themselves when the orientation flips while they are showing.
 * Game scenes keep their state and pick the new orientation up on their next start.
 */
export function watchOrientation(scene: Phaser.Scene): void {
  const handler = () => {
    const d = desiredSize();
    if (d.w !== GAME_W && scene.scene.isActive()) scene.scene.restart(scene.scene.settings.data);
  };
  window.addEventListener('resize', handler);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('resize', handler));
}
