import { FOG_REMEMBERED, FOG_UNSEEN } from '../core/fog';
import { TERRAIN_SEA } from '../core/mapgen';
import { inBounds, tileIndex } from '../core/grid';
import { NEUTRAL } from '../core/state';
import type { UnitType } from '../core/rules';
import type { PlayerView, ViewUnit } from '../core/view';
import type { Camera } from './camera';

/**
 * Color-era palette in the spirit of Strategic Conquest 2 (System 7):
 * blue ocean, green land, blue vs red forces, gray neutral cities.
 * All art is drawn fresh — silhouette symbols, not copied sprites.
 */
export const PALETTE = {
  sea: '#2e6db4',
  seaSpeckle: '#5b93cf',
  land: '#58a24c',
  landSpeckle: '#4c8f42',
  coast: '#20431c',
  fogRemembered: 'rgba(0, 0, 30, 0.32)',
  you: '#1d50d8',
  enemy: '#cf2222',
  neutral: '#8e8e8e',
  white: '#ffffff',
  outline: '#000000',
  selection: '#ffe11a',
} as const;

let seaPattern: CanvasPattern | null = null;
let landPattern: CanvasPattern | null = null;

function makePattern(ctx: CanvasRenderingContext2D, base: string, speckle: string): CanvasPattern {
  const tile = document.createElement('canvas');
  tile.width = 8;
  tile.height = 8;
  const g = tile.getContext('2d');
  if (g === null) throw new Error('2d context unavailable');
  g.fillStyle = base;
  g.fillRect(0, 0, 8, 8);
  g.fillStyle = speckle;
  g.fillRect(1, 1, 2, 1);
  g.fillRect(5, 5, 2, 1);
  g.fillRect(3, 6, 1, 1);
  const pattern = ctx.createPattern(tile, 'repeat');
  if (pattern === null) throw new Error('createPattern failed');
  return pattern;
}

function ownerColor(owner: number, you: number): string {
  if (owner === NEUTRAL) return PALETTE.neutral;
  return owner === you ? PALETTE.you : PALETTE.enemy;
}

/** Little building cluster — the SC2-style city icon, tinted by owner. */
function drawCity(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
  owner: number,
  you: number,
): void {
  const m = Math.max(1, Math.round(ts * 0.1));
  const w = ts - 2 * m;
  const color = ownerColor(owner, you);

  ctx.fillStyle = color;
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = Math.max(1, ts / 16);

  // Three towers of differing heights.
  const base = py + m + w;
  const towerW = w / 3;
  const heights = [0.55, 0.95, 0.72];
  for (let i = 0; i < 3; i++) {
    const th = w * (heights[i] ?? 0.7);
    ctx.fillRect(px + m + i * towerW, base - th, towerW, th);
    ctx.strokeRect(px + m + i * towerW + 0.5, base - th + 0.5, towerW - 1, th - 1);
  }
  // Windows.
  if (ts >= 14) {
    ctx.fillStyle = PALETTE.white;
    for (let i = 0; i < 3; i++) {
      const th = w * (heights[i] ?? 0.7);
      const cx = px + m + i * towerW + towerW / 2;
      ctx.fillRect(cx - 1, base - th + w * 0.15, 2, 2);
      if (th > w * 0.6) ctx.fillRect(cx - 1, base - th + w * 0.42, 2, 2);
    }
  }
}

/** White silhouette symbols on an owner-colored chip — plane, hulls, tank. */
function drawSymbol(
  ctx: CanvasRenderingContext2D,
  type: UnitType,
  cx: number,
  cy: number,
  s: number,
): void {
  ctx.fillStyle = PALETTE.white;
  ctx.beginPath();
  switch (type) {
    case 'army': // tank silhouette
      ctx.fillRect(cx - s * 0.55, cy + s * 0.05, s * 1.1, s * 0.38); // hull/tracks
      ctx.fillRect(cx - s * 0.22, cy - s * 0.3, s * 0.44, s * 0.34); // turret
      ctx.fillRect(cx + s * 0.2, cy - s * 0.22, s * 0.42, s * 0.12); // barrel
      return;
    case 'fighter': // swept-wing jet, nose right
      ctx.moveTo(cx + s * 0.65, cy);
      ctx.lineTo(cx - s * 0.15, cy - s * 0.22);
      ctx.lineTo(cx - s * 0.25, cy - s * 0.6);
      ctx.lineTo(cx - s * 0.45, cy - s * 0.12);
      ctx.lineTo(cx - s * 0.65, cy - s * 0.3);
      ctx.lineTo(cx - s * 0.55, cy);
      ctx.lineTo(cx - s * 0.65, cy + s * 0.3);
      ctx.lineTo(cx - s * 0.45, cy + s * 0.12);
      ctx.lineTo(cx - s * 0.25, cy + s * 0.6);
      ctx.lineTo(cx - s * 0.15, cy + s * 0.22);
      ctx.closePath();
      ctx.fill();
      return;
    case 'transport': // hull with cargo box
      hull(ctx, cx, cy, s);
      ctx.fillRect(cx - s * 0.3, cy - s * 0.38, s * 0.6, s * 0.34);
      return;
    case 'destroyer': // slim hull, one small stack
      hull(ctx, cx, cy, s);
      ctx.fillRect(cx - s * 0.12, cy - s * 0.42, s * 0.24, s * 0.38);
      return;
    case 'submarine': // surfaced pill with sail
      ctx.ellipse(cx, cy + s * 0.1, s * 0.62, s * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - s * 0.12, cy - s * 0.34, s * 0.24, s * 0.34);
      return;
    case 'cruiser': // hull, two turrets
      hull(ctx, cx, cy, s);
      ctx.fillRect(cx - s * 0.42, cy - s * 0.32, s * 0.24, s * 0.28);
      ctx.fillRect(cx + s * 0.18, cy - s * 0.32, s * 0.24, s * 0.28);
      return;
    case 'carrier': // flat-top deck with island
      ctx.fillRect(cx - s * 0.68, cy - s * 0.16, s * 1.36, s * 0.22);
      ctx.moveTo(cx - s * 0.6, cy + s * 0.06);
      ctx.lineTo(cx + s * 0.6, cy + s * 0.06);
      ctx.lineTo(cx + s * 0.42, cy + s * 0.42);
      ctx.lineTo(cx - s * 0.42, cy + s * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx + s * 0.28, cy - s * 0.4, s * 0.2, s * 0.24);
      return;
    case 'battleship': // hull, three turrets, mast
      hull(ctx, cx, cy, s);
      ctx.fillRect(cx - s * 0.5, cy - s * 0.3, s * 0.22, s * 0.26);
      ctx.fillRect(cx - s * 0.11, cy - s * 0.3, s * 0.22, s * 0.26);
      ctx.fillRect(cx + s * 0.28, cy - s * 0.3, s * 0.22, s * 0.26);
      ctx.fillRect(cx - s * 0.03, cy - s * 0.52, s * 0.06, s * 0.24);
      return;
  }
}

function hull(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.moveTo(cx - s * 0.65, cy + s * 0.02);
  ctx.lineTo(cx + s * 0.65, cy + s * 0.02);
  ctx.lineTo(cx + s * 0.45, cy + s * 0.4);
  ctx.lineTo(cx - s * 0.45, cy + s * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawUnit(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
  unit: ViewUnit,
  you: number,
  selected: boolean,
  awaitingOrders = false,
): void {
  const margin = Math.max(1, Math.round(ts * 0.12));
  const size = ts - 2 * margin;

  ctx.fillStyle = ownerColor(unit.owner, you);
  roundedRect(ctx, px + margin, py + margin, size, size, Math.max(2, ts * 0.14));
  ctx.fill();
  ctx.strokeStyle = PALETTE.outline;
  ctx.lineWidth = Math.max(1, Math.round(ts / 16));
  ctx.stroke();

  if (ts >= 12) {
    drawSymbol(ctx, unit.type, px + ts / 2, py + ts / 2, size * 0.42);
  }

  // Status badge (bottom-left) so you can tell at a glance what each of your
  // pieces is doing: Z sleeping, → en route, P patrolling; a gold dot means
  // the piece is awake and still awaiting orders this turn.
  if (unit.owner === you && ts >= 12) {
    const glyph =
      unit.mode === 'sentry'
        ? 'Z'
        : unit.mode === 'moveto'
          ? '→'
          : unit.mode === 'patrol'
            ? 'P'
            : null;
    if (glyph !== null) {
      const chip = Math.max(7, Math.round(ts * 0.38));
      ctx.fillStyle = PALETTE.white;
      ctx.fillRect(px, py + ts - chip, chip, chip);
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + ts - chip + 0.5, chip - 1, chip - 1);
      ctx.fillStyle = PALETTE.outline;
      ctx.font = `bold ${chip - 2}px "Courier New", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, px + chip / 2, py + ts - chip / 2 + 1);
    } else if (awaitingOrders) {
      const r = Math.max(2.5, ts * 0.12);
      ctx.fillStyle = PALETTE.selection;
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px + r + 2, py + ts - r - 2, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  if (unit.cargoCount > 0 && ts >= 14) {
    const chip = Math.max(7, Math.round(ts * 0.38));
    ctx.fillStyle = PALETTE.white;
    ctx.fillRect(px + ts - chip, py + ts - chip, chip, chip);
    ctx.strokeRect(px + ts - chip + 0.5, py + ts - chip + 0.5, chip - 1, chip - 1);
    ctx.fillStyle = PALETTE.outline;
    ctx.font = `bold ${chip - 2}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(unit.cargoCount), px + ts - chip / 2, py + ts - chip / 2 + 1);
  }

  if (selected) {
    ctx.strokeStyle = PALETTE.selection;
    ctx.lineWidth = Math.max(2, ts / 10);
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(px + 1, py + 1, ts - 2, ts - 2);
    ctx.setLineDash([]);
  }
}

/** Draw a dashed poly-line through a sequence of tile centers. */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  ts: number,
  screenX: (x: number) => number,
  screenY: (y: number) => number,
  points: { x: number; y: number }[],
  closed: boolean,
): void {
  if (points.length < 2) return;
  const cx = (p: { x: number; y: number }): number => screenX(p.x) + ts / 2;
  const cy = (p: { x: number; y: number }): number => screenY(p.y) + ts / 2;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx(points[0]!), cy(points[0]!));
    for (let i = 1; i < points.length; i++) ctx.lineTo(cx(points[i]!), cy(points[i]!));
    if (closed) ctx.lineTo(cx(points[0]!), cy(points[0]!));
    ctx.stroke();
  };
  // White under-stroke then black dashes, so the route reads on any terrain.
  ctx.setLineDash([]);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  trace();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  trace();
  ctx.setLineDash([]);
  // Waypoint pips.
  for (const p of points) {
    const px = cx(p);
    const py = cy(p);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - 3, py - 3, 6, 6);
    ctx.fillStyle = '#000';
    ctx.fillRect(px - 2, py - 2, 4, 4);
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
  patrolDraft: { x: number; y: number }[] | null = null,
  draftAnchor: { x: number; y: number } | null = null,
): void {
  const ts = cam.tileSize;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, viewW, viewH);

  seaPattern ??= makePattern(ctx, PALETTE.sea, PALETTE.seaSpeckle);
  landPattern ??= makePattern(ctx, PALETTE.land, PALETTE.landSpeckle);

  const x0 = Math.max(0, Math.floor(cam.x / ts));
  const y0 = Math.max(0, Math.floor(cam.y / ts));
  const x1 = Math.min(view.width - 1, Math.ceil((cam.x + viewW) / ts));
  const y1 = Math.min(view.height - 1, Math.ceil((cam.y + viewH) / ts));
  const edge = Math.max(1, Math.round(ts / 9));

  const screenX = (x: number): number => Math.round(x * ts - cam.x);
  const screenY = (y: number): number => Math.round(y * ts - cam.y);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = tileIndex(x, y, view.width);
      if (view.fog[i] === FOG_UNSEEN) continue;
      const px = screenX(x);
      const py = screenY(y);

      if (view.terrain[i] === TERRAIN_SEA) {
        ctx.fillStyle = seaPattern;
        ctx.fillRect(px, py, ts, ts);
      } else {
        ctx.fillStyle = landPattern;
        ctx.fillRect(px, py, ts, ts);
        ctx.fillStyle = PALETTE.coast;
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

  // Dim what is remembered but not currently visible (stale intel) — done
  // before units/paths so those stay crisp on top.
  ctx.fillStyle = PALETTE.fogRemembered;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (view.fog[tileIndex(x, y, view.width)] === FOG_REMEMBERED) {
        ctx.fillRect(screenX(x), screenY(y), ts, ts);
      }
    }
  }

  // Planned-path lines: for every unit of yours with a standing move order,
  // draw a line from the unit to its destination. The selected unit's path is
  // bold and yellow; others are faint.
  const center = (n: number, screen: (v: number) => number): number => screen(n) + ts / 2;
  for (const unit of view.units) {
    if (unit.owner !== view.you || unit.dest === null || unit.aboard !== null) continue;
    const fromX = center(unit.x, screenX);
    const fromY = center(unit.y, screenY);
    const toX = center(unit.dest.x, screenX);
    const toY = center(unit.dest.y, screenY);
    const isSel = unit.id === selectedUnitId;

    // Dark halo underneath for contrast on any terrain.
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = (isSel ? 4 : 3) + 2;
    ctx.setLineDash(isSel ? [] : [ts * 0.3, ts * 0.25]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    ctx.strokeStyle = isSel ? PALETTE.selection : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = isSel ? 3 : 2;
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Destination pin.
    const r = Math.max(3, ts * 0.18);
    ctx.fillStyle = isSel ? PALETTE.selection : 'rgba(255,255,255,0.85)';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(toX, toY, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // How many surface units share each tile (for the stack badge).
  const stackCounts = new Map<number, number>();
  for (const unit of view.units) {
    if (unit.aboard !== null) continue;
    const key = tileIndex(unit.x, unit.y, view.width);
    stackCounts.set(key, (stackCounts.get(key) ?? 0) + 1);
  }

  // Own units draw last so yours are always visible on contested tiles.
  // Units that have finished acting this turn (no moves left, or on sentry /
  // committed to a move order) are dimmed; the selected unit never dims.
  const sorted = [...view.units].sort(
    (a, b) => Number(a.owner === view.you) - Number(b.owner === view.you),
  );
  const yourTurn = view.currentPlayer === view.you && view.winner === null;
  for (const unit of sorted) {
    if (unit.aboard !== null) continue;
    if (unit.x < x0 || unit.x > x1 || unit.y < y0 || unit.y > y1) continue;
    const isSel = unit.id === selectedUnitId;
    const ready = unit.movesLeft > 0 && unit.mode === 'awake';
    const done = unit.owner === view.you && !isSel && !ready;
    ctx.globalAlpha = done ? 0.5 : 1;
    drawUnit(ctx, screenX(unit.x), screenY(unit.y), ts, unit, view.you, isSel, yourTurn && ready);
    ctx.globalAlpha = 1;
  }

  // City marker: a little roof pip in the top-right corner, drawn on top of
  // units so you can always tell a city sits under a garrison.
  for (const city of view.cities) {
    if (city.x < x0 || city.x > x1 || city.y < y0 || city.y > y1) continue;
    if ((stackCounts.get(tileIndex(city.x, city.y, view.width)) ?? 0) === 0) continue;
    drawCityPip(ctx, screenX(city.x), screenY(city.y), ts, city.owner, view.you);
  }

  // Stack count badge (top-left): how many units share a tile.
  for (const [key, count] of stackCounts) {
    if (count < 2 || ts < 11) continue;
    const cx = key % view.width;
    const cy = Math.floor(key / view.width);
    if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
    const px = screenX(cx);
    const py = screenY(cy);
    const badge = Math.max(9, Math.round(ts * 0.42));
    ctx.fillStyle = PALETTE.selection;
    ctx.fillRect(px, py, badge, badge);
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, badge - 1, badge - 1);
    ctx.fillStyle = PALETTE.outline;
    ctx.font = `bold ${badge - 3}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${count}`, px + badge / 2, py + badge / 2 + 1);
  }

  // Patrol routes: every patrolling unit shows its loop faintly so patrols are
  // legible at a glance; the selected unit's loop draws at full strength.
  const selected =
    selectedUnitId === null ? undefined : view.units.find((u) => u.id === selectedUnitId);
  for (const unit of view.units) {
    if (unit.owner !== view.you || unit.patrolRoute === null || unit.aboard !== null) continue;
    if (unit.id === selectedUnitId) continue; // drawn solid below
    ctx.globalAlpha = 0.35;
    drawRoute(ctx, ts, screenX, screenY, unit.patrolRoute, true);
    ctx.globalAlpha = 1;
  }
  if (selected !== undefined && selected.patrolRoute !== null && patrolDraft === null) {
    drawRoute(ctx, ts, screenX, screenY, selected.patrolRoute, true);
  }
  if (patrolDraft !== null && draftAnchor !== null) {
    drawRoute(ctx, ts, screenX, screenY, [draftAnchor, ...patrolDraft], patrolDraft.length >= 2);
  }

  // Off-map surround + edge frame: everything beyond the world bounds is filled
  // a flat grey (distinct from black fog), with a grey border ON the boundary,
  // so you can always tell where the map ends — even zoomed in with the edge
  // near the top or bottom of the screen.
  const worldLeft = -cam.x;
  const worldTop = -cam.y;
  const worldRight = view.width * ts - cam.x;
  const worldBottom = view.height * ts - cam.y;
  ctx.fillStyle = '#4c525a';
  if (worldTop > 0) ctx.fillRect(0, 0, viewW, worldTop); // above the map
  if (worldBottom < viewH) ctx.fillRect(0, worldBottom, viewW, viewH - worldBottom); // below
  if (worldLeft > 0) ctx.fillRect(0, 0, worldLeft, viewH); // left
  if (worldRight < viewW) ctx.fillRect(worldRight, 0, viewW - worldRight, viewH); // right
  ctx.strokeStyle = '#9aa1ab';
  ctx.lineWidth = 4;
  ctx.strokeRect(worldLeft, worldTop, view.width * ts, view.height * ts);
}

/** Small roof-shaped city marker in a tile's top-right corner. */
function drawCityPip(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ts: number,
  owner: number,
  you: number,
): void {
  const size = Math.max(6, ts * 0.34);
  const x = px + ts - size - 1;
  const y = py + 1;
  ctx.fillStyle = PALETTE.outline;
  ctx.fillRect(x - 1, y - 1, size + 2, size + 2);
  ctx.fillStyle = owner === NEUTRAL ? PALETTE.neutral : owner === you ? PALETTE.you : PALETTE.enemy;
  ctx.fillRect(x, y + size * 0.42, size, size * 0.58); // house body
  ctx.beginPath(); // roof
  ctx.moveTo(x - 0.5, y + size * 0.5);
  ctx.lineTo(x + size / 2, y);
  ctx.lineTo(x + size + 0.5, y + size * 0.5);
  ctx.closePath();
  ctx.fill();
}
