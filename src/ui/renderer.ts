import type { GameState, PlayerId } from '../core/state';
import { NEUTRAL } from '../core/state';
import { FOG_UNSEEN, FOG_VISIBLE, OWNER_UNKNOWN } from '../core/fog';
import { TERRAIN_SEA } from '../core/mapgen';
import { inBounds, tileIndex } from '../core/grid';
import type { Camera } from './camera';

let seaPattern: CanvasPattern | null = null;

/** Sparse diagonal speckle — the classic 1-bit ocean dither. */
function getSeaPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (seaPattern === null) {
    const tile = document.createElement('canvas');
    tile.width = 4;
    tile.height = 4;
    const g = tile.getContext('2d');
    if (g === null) throw new Error('2d context unavailable');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 4, 4);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 1, 1);
    g.fillRect(2, 2, 1, 1);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern === null) throw new Error('createPattern failed');
    seaPattern = pattern;
  }
  return seaPattern;
}

function drawCity(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
  owner: number,
): void {
  const margin = Math.max(1, Math.round(ts * 0.15));
  const size = ts - 2 * margin;

  if (owner === NEUTRAL) {
    // Neutral: hollow square with a small block inside.
    ctx.fillStyle = '#000';
    ctx.fillRect(px + margin, py + margin, size, size);
    ctx.fillStyle = '#fff';
    const inset = Math.max(1, Math.round(ts / 10));
    ctx.fillRect(px + margin + inset, py + margin + inset, size - 2 * inset, size - 2 * inset);
    ctx.fillStyle = '#000';
    const dot = Math.max(1, Math.round(size * 0.3));
    ctx.fillRect(px + ts / 2 - dot / 2, py + ts / 2 - dot / 2, dot, dot);
    return;
  }

  // Owned: solid black square with a white marker — dot for you, X for the enemy.
  ctx.fillStyle = '#000';
  ctx.fillRect(px + margin, py + margin, size, size);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  if (owner === 0) {
    const dot = Math.max(1, Math.round(size * 0.35));
    ctx.fillRect(px + ts / 2 - dot / 2, py + ts / 2 - dot / 2, dot, dot);
  } else {
    const a = margin + Math.max(1, Math.round(size * 0.25));
    const b = ts - a;
    ctx.lineWidth = Math.max(1, ts / 12);
    ctx.beginPath();
    ctx.moveTo(px + a, py + a);
    ctx.lineTo(px + b, py + b);
    ctx.moveTo(px + b, py + a);
    ctx.lineTo(px + a, py + b);
    ctx.stroke();
  }
}

/** Render the world as seen by `player`, honoring their fog of war. */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  player: PlayerId,
  cam: Camera,
  viewW: number,
  viewH: number,
): void {
  const { world } = state;
  const fog = state.fogs[player];
  const ts = cam.tileSize;

  // Unseen tiles are simply never painted over the black base.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, viewW, viewH);

  const x0 = Math.max(0, Math.floor(cam.x / ts));
  const y0 = Math.max(0, Math.floor(cam.y / ts));
  const x1 = Math.min(world.width - 1, Math.ceil((cam.x + viewW) / ts));
  const y1 = Math.min(world.height - 1, Math.ceil((cam.y + viewH) / ts));

  const edge = Math.max(1, Math.round(ts / 10));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = tileIndex(x, y, world.width);
      const fogState = fog.state[i];
      if (fogState === FOG_UNSEEN) continue;

      const px = Math.round(x * ts - cam.x);
      const py = Math.round(y * ts - cam.y);

      if (world.terrain[i] === TERRAIN_SEA) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(px, py, ts, ts);
        ctx.fillStyle = getSeaPattern(ctx);
        ctx.fillRect(px, py, ts, ts);
      } else {
        ctx.fillStyle = '#fff';
        ctx.fillRect(px, py, ts, ts);
        // Coastline: black edge wherever land meets sea (or the map border).
        ctx.fillStyle = '#000';
        const seaAt = (nx: number, ny: number): boolean =>
          !inBounds(nx, ny, world.width, world.height) ||
          world.terrain[tileIndex(nx, ny, world.width)] === TERRAIN_SEA;
        if (seaAt(x, y - 1)) ctx.fillRect(px, py, ts, edge);
        if (seaAt(x, y + 1)) ctx.fillRect(px, py + ts - edge, ts, edge);
        if (seaAt(x - 1, y)) ctx.fillRect(px, py, edge, ts);
        if (seaAt(x + 1, y)) ctx.fillRect(px + ts - edge, py, edge, ts);
      }

      const cityId = world.cityAt[i] as number;
      if (cityId >= 0) {
        const owner =
          fogState === FOG_VISIBLE
            ? (state.cityOwners[cityId] as number)
            : (fog.cityOwner[cityId] as number);
        if (owner !== OWNER_UNKNOWN) {
          drawCity(ctx, px, py, ts, owner);
        }
      }
    }
  }
}
