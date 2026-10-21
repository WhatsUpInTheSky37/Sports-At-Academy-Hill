/**
 * Pseudo-3D pinhole projector shared by the perspective scenes.
 * World: x = lateral (metres, +right), y = height (metres, up), z = depth (metres, away from camera).
 * Screen: sx/sy in logical pixels. The camera sits at (0, camH, -camZ) looking down +z.
 */
export interface CameraSpec {
  /** Distance the camera sits behind world z = 0. */
  camZ: number;
  /** Camera height above the ground. */
  camH: number;
  /** Screen y of the horizon (vanishing line). */
  horizonY: number;
  /** Focal length in pixels. */
  focal: number;
  /** Screen x of the vanishing point. */
  cx: number;
  /** Optional lateral camera offset (metres). */
  camX?: number;
}

export interface Projected { sx: number; sy: number; scale: number; visible: boolean; }

export class Projector {
  constructor(public cam: CameraSpec) {}

  project(x: number, y: number, z: number): Projected {
    const d = z + this.cam.camZ;
    if (d <= 0.05) return { sx: this.cam.cx, sy: this.cam.horizonY, scale: 0, visible: false };
    const scale = this.cam.focal / d;
    return {
      sx: this.cam.cx + (x - (this.cam.camX ?? 0)) * scale,
      sy: this.cam.horizonY + (this.cam.camH - y) * scale,
      scale,
      visible: true,
    };
  }

  /** Inverse projection for a point on the ground plane (y = 0). */
  unprojectGround(sx: number, sy: number): { x: number; z: number } | null {
    const dy = sy - this.cam.horizonY;
    if (dy <= 0.5) return null;
    const scale = dy / this.cam.camH;
    const d = this.cam.focal / scale;
    const z = d - this.cam.camZ;
    const x = (sx - this.cam.cx) / scale + (this.cam.camX ?? 0);
    return { x, z };
  }

  /** Pixels per metre at depth z. */
  scaleAt(z: number): number {
    return this.cam.focal / Math.max(0.05, z + this.cam.camZ);
  }
}
