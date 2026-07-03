import { FOG_UNSEEN } from '../core/fog';
import { TERRAIN_LAND } from '../core/mapgen';
import { tileIndex } from '../core/grid';
import { NEUTRAL } from '../core/state';
import type { PlayerView } from '../core/view';
import type { Camera } from './camera';

export interface MinimapLayout {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function minimapLayout(
  world: { width: number; height: number },
  canvasW: number,
  canvasH: number,
): MinimapLayout {
  const scale = Math.min(canvasW / world.width, canvasH / world.height);
  return {
    scale,
    offsetX: (canvasW - world.width * scale) / 2,
    offsetY: (canvasH - world.height * scale) / 2,
  };
}

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  view: PlayerView,
  cam: Camera,
  viewW: number,
  viewH: number,
  canvasW: number,
  canvasH: number,
): void {
  const { scale, offsetX, offsetY } = minimapLayout(view, canvasW, canvasH);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const cell = Math.ceil(scale);
  for (let y = 0; y < view.height; y++) {
    for (let x = 0; x < view.width; x++) {
      const i = tileIndex(x, y, view.width);
      if (view.fog[i] === FOG_UNSEEN) continue;
      ctx.fillStyle = view.terrain[i] === TERRAIN_LAND ? '#888' : '#fff';
      ctx.fillRect(offsetX + x * scale, offsetY + y * scale, cell, cell);
    }
  }

  // Known cities: yours solid black, enemy black with white core, neutral small.
  for (const city of view.cities) {
    const cx = offsetX + (city.x + 0.5) * scale;
    const cy = offsetY + (city.y + 0.5) * scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
    ctx.fillStyle = '#000';
    if (city.owner === NEUTRAL) {
      ctx.fillRect(cx - 1, cy - 1, 2, 2);
    } else if (city.owner === view.you) {
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
    } else {
      ctx.fillRect(cx - 2, cy - 2, 4, 4);
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
    }
  }

  const rx = offsetX + (cam.x / cam.tileSize) * scale;
  const ry = offsetY + (cam.y / cam.tileSize) * scale;
  const rw = (viewW / cam.tileSize) * scale;
  const rh = (viewH / cam.tileSize) * scale;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, rw, rh);
}

/** Convert a click on the minimap canvas to world tile coordinates. */
export function minimapToTile(
  world: { width: number; height: number },
  canvasW: number,
  canvasH: number,
  clickX: number,
  clickY: number,
): { x: number; y: number } {
  const { scale, offsetX, offsetY } = minimapLayout(world, canvasW, canvasH);
  return {
    x: Math.min(world.width - 1, Math.max(0, Math.floor((clickX - offsetX) / scale))),
    y: Math.min(world.height - 1, Math.max(0, Math.floor((clickY - offsetY) / scale))),
  };
}
