import { chebyshev } from '../core/grid';
import { UNIT_SPECS, UNIT_TYPES, type UnitType } from '../core/rules';
import type { GameEvent } from '../core/state';
import type { PlayerView, ViewUnit } from '../core/view';
import type { Session } from '../session/session';
import { createCamera, centerOn, clampCamera, zoomAt, type Camera } from './camera';
import { renderGame } from './renderer';
import { minimapToTile, renderMinimap } from './minimap';
import {
  playBattleLost,
  playBattleWon,
  playCapture,
  playChat,
  playDefeat,
  playVictory,
} from './sounds';

const KEY_PAN_STEP = 48;

export interface GameScreen {
  dispose(): void;
}

export interface GameScreenCallbacks {
  onExit(): void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id}`);
  return node as T;
}

function eventText(event: GameEvent, you: number): string {
  const name = (t: UnitType): string => UNIT_SPECS[t].name;
  switch (event.kind) {
    case 'battle': {
      const attackerWon = event.winner === 'attacker';
      const yourAttack = event.attackerOwner === you;
      const winnerName = attackerWon ? name(event.attacker) : name(event.defender);
      const loserName = attackerWon ? name(event.defender) : name(event.attacker);
      const youWon = (attackerWon && yourAttack) || (!attackerWon && !yourAttack);
      return youWon
        ? `Your ${winnerName} destroyed an enemy ${loserName}.`
        : `Your ${loserName} was destroyed by an enemy ${winnerName}.`;
    }
    case 'capture':
      return event.by === you ? 'City captured!' : 'The enemy captured a city.';
    case 'captureFailed':
      return event.by === you ? 'Assault failed — your Army was lost.' : 'An enemy assault failed.';
    case 'crash':
      return event.owner === you
        ? 'Your Fighter ran out of fuel and crashed.'
        : 'An enemy Fighter crashed.';
    case 'produced':
      return `${name(event.unit)} completed.`;
    case 'victory':
      return event.winner === you ? 'VICTORY!' : 'Defeat.';
  }
}

/**
 * The in-game screen. Renders PlayerViews from a Session and turns clicks
 * and keys into Commands. Used identically for vs-AI and online PvP.
 */
export function createGameScreen(
  session: Session,
  labelForPlayer: (p: number) => string,
  callbacks: GameScreenCallbacks,
): GameScreen {
  const canvas = el<HTMLCanvasElement>('game-canvas');
  const minimapCanvas = el<HTMLCanvasElement>('minimap');
  const hudText = el<HTMLSpanElement>('hud-text');
  const btnEndTurn = el<HTMLButtonElement>('btn-end-turn');
  const btnNextUnit = el<HTMLButtonElement>('btn-next-unit');
  const btnAuto = el<HTMLButtonElement>('btn-auto');
  const unitPanel = el<HTMLDivElement>('unit-panel');
  const unitPanelText = el<HTMLSpanElement>('unit-panel-text');
  const toasts = el<HTMLDivElement>('toasts');
  const productionDialog = el<HTMLDivElement>('production-dialog');
  const productionTitle = el<HTMLSpanElement>('production-title');
  const productionList = el<HTMLDivElement>('production-list');
  const stackDialog = el<HTMLDivElement>('stack-dialog');
  const stackTitle = el<HTMLSpanElement>('stack-title');
  const stackList = el<HTMLDivElement>('stack-list');
  const victoryOverlay = el<HTMLDivElement>('victory-overlay');
  const victoryText = el<HTMLHeadingElement>('victory-text');

  const abort = new AbortController();
  const { signal } = abort;
  const cam: Camera = createCamera();
  let view: PlayerView | null = null;
  let selectedId: number | null = null;
  let raf = 0;
  let centeredOnce = false;

  // Auto-advance: when it's your turn and nothing needs input (no awake units
  // with moves, every city building something), end the turn automatically so
  // build-up turns fly by. Persisted setting, default on.
  const AUTO_KEY = 'openconquest.autoAdvance';
  let autoAdvance = true;
  try {
    autoAdvance = (localStorage.getItem(AUTO_KEY) ?? '1') === '1';
  } catch {
    /* ignore */
  }
  let autoTimer: ReturnType<typeof setTimeout> | null = null;
  let autoRun = 0;

  const viewSize = (): { w: number; h: number } => ({
    w: canvas.clientWidth,
    h: canvas.clientHeight,
  });

  function selectedUnit(): ViewUnit | undefined {
    if (view === null || selectedId === null) return undefined;
    return view.units.find((u) => u.id === selectedId);
  }

  function myTurn(): boolean {
    return view !== null && view.currentPlayer === view.you && view.winner === null;
  }

  function draw(): void {
    if (view === null) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = viewSize();
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    clampCamera(cam, view, w, h);
    renderGame(ctx, view, cam, w, h, selectedId);
    const mctx = minimapCanvas.getContext('2d');
    if (mctx !== null) {
      renderMinimap(mctx, view, cam, w, h, minimapCanvas.width, minimapCanvas.height);
    }
    updateHud();
  }

  function requestRender(): void {
    if (raf === 0) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    }
  }

  function updateHud(): void {
    if (view === null) return;
    const turnLabel = myTurn() ? 'Your turn' : `${labelForPlayer(view.currentPlayer)}…`;
    const cityCount = view.cities.filter((c) => c.owner === view!.you).length;
    hudText.textContent = `Turn ${view.turn} · ${turnLabel} · ${cityCount} cities`;
    btnEndTurn.disabled = !myTurn();
    btnNextUnit.disabled = !myTurn();
    btnAuto.textContent = `Auto: ${autoAdvance ? 'On' : 'Off'}`;

    const unit = selectedUnit();
    if (unit === undefined) {
      unitPanel.classList.add('hidden');
    } else {
      unitPanel.classList.remove('hidden');
      const s = UNIT_SPECS[unit.type];
      const bits = [
        `${s.name}`,
        `moves ${unit.movesLeft}/${s.moves}`,
        `hits ${unit.hits}/${s.hits}`,
      ];
      if (unit.type === 'fighter') bits.push(`fuel ${unit.fuel}`);
      if (unit.cargoCount > 0) bits.push(`cargo ${unit.cargoCount}`);
      if (unit.aboard !== null) bits.push('aboard transport');
      unitPanelText.textContent = bits.join(' · ');
    }
  }

  function toast(text: string): void {
    const node = document.createElement('div');
    node.className = 'toast';
    node.textContent = text;
    toasts.appendChild(node);
    setTimeout(() => node.remove(), 5000);
  }

  function handleEvents(events: GameEvent[]): void {
    if (view === null) return;
    for (const event of events) {
      toast(eventText(event, view.you));
      if (event.kind === 'battle') {
        const attackerWon = event.winner === 'attacker';
        const youWon =
          (attackerWon && event.attackerOwner === view.you) ||
          (!attackerWon && event.defenderOwner === view.you);
        if (youWon) playBattleWon();
        else playBattleLost();
      } else if (event.kind === 'capture' && event.by === view.you) {
        playCapture();
      } else if (event.kind === 'victory') {
        if (event.winner === view.you) playVictory();
        else playDefeat();
      }
    }
  }

  function showVictory(): void {
    if (view === null || view.winner === null) return;
    victoryText.textContent = view.winner === view.you ? 'Victory!' : 'Defeat';
    victoryOverlay.classList.remove('hidden');
  }

  /** Own units that still want orders this turn. */
  function actionable(): ViewUnit[] {
    if (view === null) return [];
    return view.units.filter(
      (u) => u.owner === view!.you && u.movesLeft > 0 && u.mode === 'awake' && u.aboard === null,
    );
  }

  /** True when this turn needs no input: no awake units, all cities building. */
  function nothingToDo(): boolean {
    if (view === null || view.winner !== null) return false;
    return actionable().length === 0 && view.yourCities.every((c) => c.production !== null);
  }

  function maybeAutoAdvance(): void {
    if (!autoAdvance || !myTurn() || !nothingToDo()) {
      autoRun = 0;
      return;
    }
    if (autoRun >= 500 || autoTimer !== null) return; // runaway guard
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (autoAdvance && myTurn() && nothingToDo()) {
        autoRun++;
        session.send({ type: 'endTurn' });
      }
    }, 150);
  }

  function selectNextUnit(): void {
    const units = actionable();
    if (units.length === 0) {
      selectedId = null;
      requestRender();
      return;
    }
    const index = units.findIndex((u) => u.id === selectedId);
    const next = units[(index + 1) % units.length];
    if (next !== undefined) {
      selectedId = next.id;
      const { w, h } = viewSize();
      if (view !== null) centerOn(cam, view, w, h, next.x, next.y);
    }
    requestRender();
  }

  // ---------- Production dialog ----------
  let productionCityId: number | null = null;

  /**
   * Touch fires a synthetic click ~300ms after pointerup. When a tap opens a
   * dialog, that ghost click lands on whatever is now under the finger (e.g. a
   * production button), triggering it by accident. Swallow the next click.
   */
  function swallowNextClick(): void {
    const kill = (e: Event): void => {
      e.stopPropagation();
      e.preventDefault();
      window.removeEventListener('click', kill, true);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => window.removeEventListener('click', kill, true), 700);
    window.addEventListener('click', kill, true);
  }

  function openProduction(cityId: number): void {
    if (view === null) return;
    const city = view.yourCities.find((c) => c.id === cityId);
    if (city === undefined) return;
    swallowNextClick();
    productionCityId = cityId;
    productionTitle.textContent = city.coastal ? 'City (port)' : 'City (inland)';
    productionList.innerHTML = '';
    for (const type of UNIT_TYPES) {
      const s = UNIT_SPECS[type];
      if (s.domain === 'sea' && !city.coastal) continue;
      const button = document.createElement('button');
      const current = city.production?.type === type;
      const progress = current
        ? ` — ${city.production?.progress ?? 0}/${s.buildTime}`
        : ` — ${s.buildTime} turns`;
      button.textContent = `${s.name}${progress}${current ? ' ◀' : ''}`;
      button.addEventListener('click', () => {
        if (productionCityId !== null) {
          session.send({ type: 'setProduction', cityId: productionCityId, unit: type });
        }
        productionDialog.classList.add('hidden');
      });
      productionList.appendChild(button);
    }
    productionDialog.classList.remove('hidden');
  }

  // ---------- Stacked-units panel ----------

  function unitStatusLine(u: ViewUnit): string {
    const s = UNIT_SPECS[u.type];
    const bits = [`moves ${u.movesLeft}/${s.moves}`, `hits ${u.hits}/${s.hits}`];
    if (u.type === 'fighter') bits.push(`fuel ${u.fuel}`);
    if (u.cargoCount > 0) bits.push(`carrying ${u.cargoCount}`);
    if (u.aboard !== null) bits.push('aboard');
    if (u.mode === 'sentry') bits.push('sentry');
    else if (u.mode === 'moveto') bits.push('moving');
    else if (u.movesLeft === 0) bits.push('done');
    return bits.join(' · ');
  }

  /** Expanded view of every one of your units sharing a tile. */
  function openStack(units: ViewUnit[]): void {
    if (units.length === 0) return;
    swallowNextClick();
    stackTitle.textContent = `${units.length} Units Here`;
    stackList.innerHTML = '';
    for (const u of units) {
      const spec = UNIT_SPECS[u.type];
      const row = document.createElement('button');
      row.className = 'stack-row' + (u.id === selectedId ? ' selected' : '');
      row.type = 'button';

      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.style.background = u.owner === view!.you ? '#1d50d8' : '#cf2222';
      glyph.textContent = spec.letter;

      const info = document.createElement('span');
      info.className = 'info';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = spec.name;
      const status = document.createElement('div');
      status.className = 'status';
      status.textContent = unitStatusLine(u);
      info.append(name, status);

      const actions = document.createElement('span');
      actions.className = 'row-actions';
      if (myTurn() && u.aboard === null && u.movesLeft > 0) {
        const sentry = document.createElement('button');
        sentry.type = 'button';
        sentry.textContent = 'Sentry';
        sentry.addEventListener('click', (e) => {
          e.stopPropagation();
          session.send({ type: 'order', unitId: u.id, order: 'sentry' });
          stackDialog.classList.add('hidden');
        });
        const skip = document.createElement('button');
        skip.type = 'button';
        skip.textContent = 'Skip';
        skip.addEventListener('click', (e) => {
          e.stopPropagation();
          session.send({ type: 'order', unitId: u.id, order: 'skip' });
          stackDialog.classList.add('hidden');
        });
        actions.append(sentry, skip);
      }

      row.append(glyph, info, actions);
      row.addEventListener('click', () => {
        selectedId = u.id;
        stackDialog.classList.add('hidden');
        const { w, h } = viewSize();
        if (view !== null) centerOn(cam, view, w, h, u.x, u.y);
        requestRender();
      });
      stackList.appendChild(row);
    }
    stackDialog.classList.remove('hidden');
  }

  /** Select a single unit, or open the stack panel when several share a tile. */
  function selectOrStack(units: ViewUnit[]): void {
    if (units.length === 1) {
      selectedId = (units[0] as ViewUnit).id;
      requestRender();
    } else if (units.length > 1) {
      openStack(units);
    }
  }

  // ---------- Pointer input: one finger pans/taps, two fingers pinch-zoom ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let dragMoved = false;
  let lastX = 0;
  let lastY = 0;
  let pinchDistance = 0;

  function tileFromPointer(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor((cam.x + (e.clientX - rect.left)) / cam.tileSize),
      y: Math.floor((cam.y + (e.clientY - rect.top)) / cam.tileSize),
    };
  }

  /** Can the selected unit board this friendly transport/carrier? */
  function canBoard(sel: ViewUnit, target: ViewUnit): boolean {
    const cap = UNIT_SPECS[target.type].capacity;
    return cap !== undefined && cap.type === sel.type && target.cargoCount < cap.count;
  }

  function handleClick(e: PointerEvent): void {
    if (view === null) return;
    const tile = tileFromPointer(e);
    if (tile.x < 0 || tile.y < 0 || tile.x >= view.width || tile.y >= view.height) return;

    // Your own units on the tapped tile, selectable in a stable order.
    const surfaceHere = view.units.filter(
      (u) => u.owner === view!.you && u.aboard === null && u.x === tile.x && u.y === tile.y,
    );
    const cargoHere = view.units.filter(
      (u) =>
        u.owner === view!.you &&
        u.aboard !== null &&
        u.x === tile.x &&
        u.y === tile.y &&
        u.movesLeft > 0,
    );
    const selectableHere = [...surfaceHere, ...cargoHere];
    const cityHere = view.yourCities.find((c) => c.x === tile.x && c.y === tile.y);
    const sel = selectedUnit();

    // 1) Tapping the selected unit's own tile. Several units here → open the
    //    stack panel to inspect/switch. A lone selected unit → deselect (or
    //    open the city menu if it sits on one).
    if (sel !== undefined && sel.x === tile.x && sel.y === tile.y) {
      if (selectableHere.length > 1) {
        openStack(selectableHere);
      } else if (cityHere !== undefined) {
        selectedId = null;
        openProduction(cityHere.id);
      } else {
        selectedId = null;
        requestRender();
      }
      return;
    }

    // 2) A unit is selected and it's your turn: act on the tapped tile.
    if (sel !== undefined && myTurn()) {
      const boardTarget = selectableHere.find((u) => canBoard(sel, u));
      // Adjacent tap = a direct action: attack, move, or board a neighbor.
      if (
        chebyshev(sel.x, sel.y, tile.x, tile.y) === 1 &&
        (selectableHere.length === 0 || boardTarget !== undefined)
      ) {
        session.send({ type: 'move', unitId: sel.id, to: tile });
        return;
      }
      // Tapping your own unit(s) selects/inspects instead of moving onto them.
      // (This is the fix: selecting a new army no longer marches the old one.)
      if (selectableHere.length > 0) {
        selectOrStack(selectableHere);
        return;
      }
      // Empty distant tile = a standing move order; keep the unit selected so
      // its planned path stays visible and can be retargeted.
      if (sel.aboard === null) {
        session.send({ type: 'order', unitId: sel.id, order: { moveTo: tile } });
        return;
      }
    }

    // 3) Nothing actionable selected: select a unit here (or the stack panel
    //    for several), or open a city.
    if (selectableHere.length > 0) {
      selectOrStack(selectableHere);
      return;
    }
    if (cityHere !== undefined) {
      openProduction(cityHere.id);
      return;
    }
    selectedId = null;
    requestRender();
  }

  function pinchState(): { distance: number; midX: number; midY: number } {
    const [a, b] = [...pointers.values()];
    if (a === undefined || b === undefined) return { distance: 0, midX: 0, midY: 0 };
    return {
      distance: Math.hypot(a.x - b.x, a.y - b.y),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers reject capture mid-gesture; panning still works without it.
      }
      if (pointers.size === 1) {
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (pointers.size === 2) {
        dragMoved = true; // a pinch is never a tap
        pinchDistance = pinchState().distance;
      }
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size === 2 && view !== null) {
        // Pinch: step the zoom when the spread changes enough.
        const { distance, midX, midY } = pinchState();
        if (pinchDistance > 0) {
          const ratio = distance / pinchDistance;
          if (ratio > 1.25 || ratio < 0.8) {
            const rect = canvas.getBoundingClientRect();
            const { w, h } = viewSize();
            zoomAt(cam, view, w, h, ratio > 1 ? 1 : -1, midX - rect.left, midY - rect.top);
            pinchDistance = distance;
            requestRender();
          }
        }
        return;
      }

      if (pointers.size === 1) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 6) dragMoved = true;
        if (dragMoved) {
          cam.x -= dx;
          cam.y -= dy;
          lastX = e.clientX;
          lastY = e.clientY;
          requestRender();
        }
      }
    },
    { signal },
  );
  canvas.addEventListener(
    'pointerup',
    (e) => {
      const wasPinching = pointers.size >= 2;
      pointers.delete(e.pointerId);
      if (pointers.size === 0 && !dragMoved && !wasPinching) handleClick(e);
      if (pointers.size === 1) {
        // Pinch ended with one finger down: continue as a pan from here.
        const rest = [...pointers.values()][0];
        if (rest !== undefined) {
          lastX = rest.x;
          lastY = rest.y;
        }
      }
    },
    { signal },
  );
  canvas.addEventListener('pointercancel', (e) => pointers.delete(e.pointerId), { signal });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (view === null) return;
      const rect = canvas.getBoundingClientRect();
      const { w, h } = viewSize();
      zoomAt(cam, view, w, h, e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
      requestRender();
    },
    { signal, passive: false },
  );

  // ---------- Keyboard ----------
  window.addEventListener(
    'keydown',
    (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const pan: Record<string, [number, number]> = {
        ArrowLeft: [-KEY_PAN_STEP, 0],
        ArrowRight: [KEY_PAN_STEP, 0],
        ArrowUp: [0, -KEY_PAN_STEP],
        ArrowDown: [0, KEY_PAN_STEP],
      };
      const step = pan[e.key];
      if (step !== undefined) {
        e.preventDefault();
        cam.x += step[0];
        cam.y += step[1];
        requestRender();
        return;
      }
      const unit = selectedUnit();
      switch (e.key) {
        case 'n':
          selectNextUnit();
          break;
        case ' ':
          e.preventDefault();
          if (unit !== undefined && myTurn()) {
            session.send({ type: 'order', unitId: unit.id, order: 'skip' });
            selectNextUnit();
          }
          break;
        case 's':
          if (unit !== undefined && myTurn()) {
            session.send({ type: 'order', unitId: unit.id, order: 'sentry' });
            selectNextUnit();
          }
          break;
        case 'Enter':
          if (myTurn() && !productionDialog.classList.contains('hidden')) return;
          if (myTurn()) session.send({ type: 'endTurn' });
          break;
        case 'Escape':
          selectedId = null;
          productionDialog.classList.add('hidden');
          stackDialog.classList.add('hidden');
          requestRender();
          break;
      }
    },
    { signal },
  );

  // ---------- Minimap ----------
  const jumpTo = (e: PointerEvent): void => {
    if (view === null) return;
    const rect = minimapCanvas.getBoundingClientRect();
    const tile = minimapToTile(
      view,
      minimapCanvas.width,
      minimapCanvas.height,
      ((e.clientX - rect.left) / rect.width) * minimapCanvas.width,
      ((e.clientY - rect.top) / rect.height) * minimapCanvas.height,
    );
    const { w, h } = viewSize();
    centerOn(cam, view, w, h, tile.x, tile.y);
    requestRender();
  };
  let minimapDown = false;
  minimapCanvas.addEventListener(
    'pointerdown',
    (e) => {
      minimapDown = true;
      minimapCanvas.setPointerCapture(e.pointerId);
      jumpTo(e);
    },
    { signal },
  );
  minimapCanvas.addEventListener('pointermove', (e) => minimapDown && jumpTo(e), { signal });
  minimapCanvas.addEventListener('pointerup', () => (minimapDown = false), { signal });

  // ---------- Buttons ----------
  btnEndTurn.addEventListener(
    'click',
    () => {
      if (myTurn()) session.send({ type: 'endTurn' });
    },
    { signal },
  );
  btnNextUnit.addEventListener('click', selectNextUnit, { signal });
  btnAuto.addEventListener(
    'click',
    () => {
      autoAdvance = !autoAdvance;
      try {
        localStorage.setItem(AUTO_KEY, autoAdvance ? '1' : '0');
      } catch {
        /* ignore */
      }
      toast(
        autoAdvance ? 'Auto-advance on: turns with nothing to do skip ahead.' : 'Auto-advance off.',
      );
      updateHud();
      maybeAutoAdvance();
    },
    { signal },
  );
  el<HTMLButtonElement>('btn-close-production').addEventListener(
    'click',
    () => productionDialog.classList.add('hidden'),
    { signal },
  );
  el<HTMLButtonElement>('btn-close-stack').addEventListener(
    'click',
    () => stackDialog.classList.add('hidden'),
    { signal },
  );
  el<HTMLButtonElement>('btn-victory-menu').addEventListener(
    'click',
    () => {
      victoryOverlay.classList.add('hidden');
      callbacks.onExit();
    },
    { signal },
  );

  window.addEventListener('resize', requestRender, { signal });

  // ---------- Session wiring ----------
  session.onView((next) => {
    const hadView = view !== null;
    view = next;
    if (!centeredOnce) {
      centeredOnce = true;
      const home = next.yourCities[0] ?? next.cities.find((c) => c.owner === next.you);
      if (home !== undefined) {
        const { w, h } = viewSize();
        centerOn(cam, next, w, h, home.x, home.y);
      }
    }
    if (selectedId !== null && next.units.every((u) => u.id !== selectedId)) {
      selectedId = null;
    }
    handleEvents(next.events);
    if (next.winner !== null) showVictory();
    void hadView;
    requestRender();
    maybeAutoAdvance();
  });
  session.onError((message) => toast(message));
  session.onChat((from, text) => {
    playChat();
    appendChat(from, text);
  });

  // ---------- Chat (PvP) ----------
  const chatWindow = el<HTMLDivElement>('chat-window');
  const chatLog = el<HTMLDivElement>('chat-log');
  const chatInput = el<HTMLInputElement>('chat-input');

  function appendChat(from: string, text: string): void {
    const line = document.createElement('div');
    line.textContent = `${from}: ${text}`;
    chatLog.appendChild(line);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  chatInput.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter' && chatInput.value.trim() !== '') {
        session.sendChat(chatInput.value.trim());
        appendChat('You', chatInput.value.trim());
        chatInput.value = '';
      }
      e.stopPropagation();
    },
    { signal },
  );

  session.requestView();

  // Test/debug handle: lets integration tests find tiles on screen.
  (globalThis as Record<string, unknown>).__ocDebug = {
    camera: cam,
    getView: () => view,
    getSelected: () => selectedId,
  };

  return {
    dispose(): void {
      abort.abort();
      if (raf !== 0) cancelAnimationFrame(raf);
      if (autoTimer !== null) clearTimeout(autoTimer);
      session.dispose();
      unitPanel.classList.add('hidden');
      productionDialog.classList.add('hidden');
      stackDialog.classList.add('hidden');
      victoryOverlay.classList.add('hidden');
      chatWindow.classList.add('hidden');
      toasts.innerHTML = '';
      chatLog.innerHTML = '';
    },
  };
}
