import { FOG_UNSEEN } from '../core/fog';
import { TERRAIN_SEA } from '../core/mapgen';
import { inBounds, tileIndex } from '../core/grid';
import { UNIT_SPECS } from '../core/rules';
import { NEUTRAL } from '../core/state';
import type { PlayerView, ViewUnit } from '../core/view';
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
  you: number,
): void {
  const margin = Math.max(1, Math.round(ts * 0.12));
  const size = ts - 2 * margin;
  ctx.fillStyle = '#000';
  ctx.fillRect(px + margin, py + margin, size, size);

  if (owner === NEUTRAL) {
    ctx.fillStyle = '#fff';
    const inset = Math.max(1, Math.round(ts / 10));
    ctx.fillRect(px + margin + inset, py + margin + inset, size - 2 * inset, size - 2 * inset);
    ctx.fillStyle = '#000';
    const dot = Math.max(1, Math.round(size * 0.3));
    ctx.fillRect(px + ts / 2 - dot / 2, py + ts / 2 - dot / 2, dot, dot);
    return;
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  if (owner === you) {
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

function drawUnit(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
  unit: ViewUnit,
  you: number,
  selected: boolean,
): void {
  const mine = unit.owner === you;
  const margin = Math.max(1, Math.round(ts * 0.18));
  const size = ts - 2 * margin;

  ctx.fillStyle = mine ? '#000' : '#fff';
  ctx.fillRect(px + margin, py + margin, size, size);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, Math.round(ts / 14));
  ctx.strokeRect(px + margin + 0.5, py + margin + 0.5, size - 1, size - 1);

  if (ts >= 10) {
    ctx.fillStyle = mine ? '#fff' : '#000';
    ctx.font = `bold ${Math.round(ts * 0.55)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(UNIT_SPECS[unit.type].letter, px + ts / 2, py + ts / 2 + 1);
  }

  if (unit.cargoCount > 0 && ts >= 12) {
    const chip = Math.max(6, Math.round(ts * 0.4));
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + ts - chip, py + ts - chip, chip, chip);
    ctx.strokeRect(px + ts - chip + 0.5, py + ts - chip + 0.5, chip - 1, chip - 1);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${chip - 2}px "Courier New", monospace`;
    ctx.fillText(String(unit.cargoCount), px + ts - chip / 2, py + ts - chip / 2 + 1);
  }

  if (selected) {
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(px + 1.5, py + 1.5, ts - 3, ts - 3);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#fff';
    ctx.setLineDash([3, 2]);
    ctx.lineDashOffset = 3;
    ctx.strokeRect(px + 1.5, py + 1.5, ts - 3, ts - 3);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
}

/** Render a player's fogged view of the world. */
export function renderGame(
  ctx: CanvasRenderingContext2D,
  view: PlayerView,
  cam: Camera,
  viewW: number,
  viewH: number,
  selectedUnitId: number | null,
): void {
  const ts = cam.tileSize;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, viewW, viewH);

  const x0 = Math.max(0, Math.floor(cam.x / ts));
  const y0 = Math.max(0, Math.floor(cam.y / ts));
  const x1 = Math.min(view.width - 1, Math.ceil((cam.x + viewW) / ts));
  const y1 = Math.min(view.height - 1, Math.ceil((cam.y + viewH) / ts));
  const edge = Math.max(1, Math.round(ts / 10));

  const screenX = (x: number): number => Math.round(x * ts - cam.x);
  const screenY = (y: number): number => Math.round(y * ts - cam.y);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = tileIndex(x, y, view.width);
      if (view.fog[i] === FOG_UNSEEN) continue;
      const px = screenX(x);
      const py = screenY(y);

      ctx.fillStyle = '#fff';
      ctx.fillRect(px, py, ts, ts);
      if (view.terrain[i] === TERRAIN_SEA) {
        ctx.fillStyle = getSeaPattern(ctx);
        ctx.fillRect(px, py, ts, ts);
      } else {
        ctx.fillStyle = '#000';
        const seaAt = (nx: number, ny: number): boolean =>
          !inBounds(nx, ny, view.width, view.height) ||
          view.terrain[tileIndex(nx, ny, view.width)] === TERRAIN_SEA;
        if (seaAt(x, y - 1)) ctx.fillRect(px, py, ts, edge);
        if (seaAt(x, y + 1)) ctx.fillRect(px, py + ts - edge, ts, edge);
        if (seaAt(x - 1, y)) ctx.fillRect(px, py, edge, ts);
        if (seaAt(x + 1, y)) ctx.fillRect(px + ts - edge, py, edge, ts);
      }
    }
  }

  for (const city of view.cities) {
    if (city.x < x0 || city.x > x1 || city.y < y0 || city.y > y1) continue;
    drawCity(ctx, screenX(city.x), screenY(city.y), ts, city.owner, view.you);
  }

  // Own units draw last so yours are always visible on contested tiles.
  const sorted = [...view.units].sort(
    (a, b) => Number(a.owner === view.you) - Number(b.owner === view.you),
  );
  for (const unit of sorted) {
    if (unit.aboard !== null) continue;
    if (unit.x < x0 || unit.x > x1 || unit.y < y0 || unit.y > y1) continue;
    drawUnit(ctx, screenX(unit.x), screenY(unit.y), ts, unit, view.you, unit.id === selectedUnitId);
  }

  // Destination marker for the selected unit's standing order.
  const selected = view.units.find((u) => u.id === selectedUnitId);
  if (selected !== undefined && selected.dest !== null) {
    const px = screenX(selected.dest.x);
    const py = screenY(selected.dest.y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 3, py + 3);
    ctx.lineTo(px + ts - 3, py + ts - 3);
    ctx.moveTo(px + ts - 3, py + 3);
    ctx.lineTo(px + 3, py + ts - 3);
    ctx.stroke();
  }
}
