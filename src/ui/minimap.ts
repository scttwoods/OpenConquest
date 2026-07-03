import type { GameState, PlayerId } from '../core/state';
import { FOG_UNSEEN, FOG_VISIBLE, OWNER_UNKNOWN } from '../core/fog';
import { TERRAIN_LAND } from '../core/mapgen';
import { tileIndex } from '../core/grid';
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
  state: GameState,
  player: PlayerId,
  cam: Camera,
  viewW: number,
  viewH: number,
  canvasW: number,
  canvasH: number,
): void {
  const { world } = state;
  const fog = state.fogs[player];
  const { scale, offsetX, offsetY } = minimapLayout(world, canvasW, canvasH);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasW, canvasH);

  const cell = Math.ceil(scale);
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const i = tileIndex(x, y, world.width);
      if (fog.state[i] === FOG_UNSEEN) continue;
      ctx.fillStyle = world.terrain[i] === TERRAIN_LAND ? '#888' : '#fff';
      ctx.fillRect(offsetX + x * scale, offsetY + y * scale, cell, cell);
    }
  }

  // Known cities as dots: white halo + black core so they read on any terrain.
  for (const city of world.cities) {
    const i = tileIndex(city.x, city.y, world.width);
    const fogState = fog.state[i];
    if (fogState === FOG_UNSEEN) continue;
    const owner =
      fogState === FOG_VISIBLE
        ? (state.cityOwners[city.id] as number)
        : (fog.cityOwner[city.id] as number);
    if (owner === OWNER_UNKNOWN) continue;
    const cx = offsetX + (city.x + 0.5) * scale;
    const cy = offsetY + (city.y + 0.5) * scale;
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.fillStyle = '#000';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  }

  // Viewport rectangle.
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
