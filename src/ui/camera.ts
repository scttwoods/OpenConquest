import type { World } from '../core/mapgen';

/** Viewport onto the world. x/y are the top-left corner in world pixels. */
export interface Camera {
  x: number;
  y: number;
  /** Pixels per tile — the zoom level. */
  tileSize: number;
}

export const ZOOM_LEVELS = [6, 8, 12, 16, 24, 32] as const;
export const DEFAULT_TILE_SIZE = 16;

export function createCamera(): Camera {
  return { x: 0, y: 0, tileSize: DEFAULT_TILE_SIZE };
}

/** Keep the viewport inside the world (centering when the world is smaller). */
export function clampCamera(cam: Camera, world: World, viewW: number, viewH: number): void {
  const worldW = world.width * cam.tileSize;
  const worldH = world.height * cam.tileSize;
  cam.x = worldW <= viewW ? (worldW - viewW) / 2 : Math.min(Math.max(cam.x, 0), worldW - viewW);
  cam.y = worldH <= viewH ? (worldH - viewH) / 2 : Math.min(Math.max(cam.y, 0), worldH - viewH);
}

export function centerOn(
  cam: Camera,
  world: World,
  viewW: number,
  viewH: number,
  tileX: number,
  tileY: number,
): void {
  cam.x = (tileX + 0.5) * cam.tileSize - viewW / 2;
  cam.y = (tileY + 0.5) * cam.tileSize - viewH / 2;
  clampCamera(cam, world, viewW, viewH);
}

/** Zoom one step in (+1) or out (-1), keeping the pixel under the cursor fixed. */
export function zoomAt(
  cam: Camera,
  world: World,
  viewW: number,
  viewH: number,
  direction: 1 | -1,
  cursorX: number,
  cursorY: number,
): void {
  const i = ZOOM_LEVELS.indexOf(cam.tileSize as (typeof ZOOM_LEVELS)[number]);
  const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, i + direction))];
  if (next === undefined || next === cam.tileSize) return;

  const worldX = (cam.x + cursorX) / cam.tileSize;
  const worldY = (cam.y + cursorY) / cam.tileSize;
  cam.tileSize = next;
  cam.x = worldX * next - cursorX;
  cam.y = worldY * next - cursorY;
  clampCamera(cam, world, viewW, viewH);
}
