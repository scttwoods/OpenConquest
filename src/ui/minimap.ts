import { FOG_UNSEEN } from '../core/fog';
import { TERRAIN_LAND } from '../core/mapgen';
import { tileIndex } from '../core/grid';
import { NEUTRAL } from '../core/state';
import type { PlayerView } from '../core/view';
import type { Camera } from './camera';
import { PALETTE } from './renderer';

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
      ctx.fillStyle = view.terrain[i] === TERRAIN_LAND ? PALETTE.land : PALETTE.sea;
      ctx.fillRect(offsetX + x * scale, offsetY + y * scale, cell, cell);
    }
  }

  // Known cities as owner-colored dots with a white halo.
  for (const city of view.cities) {
    const cx = offsetX + (city.x + 0.5) * scale;
    const cy = offsetY + (city.y + 0.5) * scale;
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
    ctx.fillStyle =
      city.owner === NEUTRAL
        ? PALETTE.neutral
        : city.owner === view.you
          ? PALETTE.you
          : PALETTE.enemy;
    ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  }

  const rx = offsetX + (cam.x / cam.tileSize) * scale;
  const ry = offsetY + (cam.y / cam.tileSize) * scale;
  const rw = (viewW / cam.tileSize) * scale;
  const rh = (viewH / cam.tileSize) * scale;
  ctx.strokeStyle = PALETTE.selection;
  ctx.lineWidth = 2;
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
