import type { GameState, PlayerId } from '../core/state';
import { createCamera, centerOn, clampCamera, zoomAt, type Camera } from './camera';
import { renderGame } from './renderer';
import { minimapToTile, renderMinimap } from './minimap';

const KEY_PAN_STEP = 48;

export interface GameScreen {
  dispose(): void;
}

/**
 * Owns the main canvas + minimap for one running game: rendering, pan (drag,
 * arrows, minimap), and zoom (wheel). Renders on demand, not every frame.
 */
export function createGameScreen(
  canvas: HTMLCanvasElement,
  minimapCanvas: HTMLCanvasElement,
  state: GameState,
  player: PlayerId,
): GameScreen {
  const abort = new AbortController();
  const { signal } = abort;
  const cam: Camera = createCamera();
  let raf = 0;

  const view = (): { w: number; h: number } => ({
    w: canvas.clientWidth,
    h: canvas.clientHeight,
  });

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = view();
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    clampCamera(cam, state.world, w, h);
    renderGame(ctx, state, player, cam, w, h);

    const mctx = minimapCanvas.getContext('2d');
    if (mctx !== null) {
      renderMinimap(mctx, state, player, cam, w, h, minimapCanvas.width, minimapCanvas.height);
    }
  }

  function requestRender(): void {
    if (raf === 0) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    }
  }

  // --- Main canvas: drag to pan, wheel to zoom ---
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener(
    'pointerdown',
    (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    },
    { signal },
  );
  canvas.addEventListener(
    'pointermove',
    (e) => {
      if (!dragging) return;
      cam.x -= e.clientX - lastX;
      cam.y -= e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      requestRender();
    },
    { signal },
  );
  canvas.addEventListener('pointerup', () => (dragging = false), { signal });
  canvas.addEventListener('pointercancel', () => (dragging = false), { signal });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const { w, h } = view();
      zoomAt(
        cam,
        state.world,
        w,
        h,
        e.deltaY < 0 ? 1 : -1,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      requestRender();
    },
    { signal, passive: false },
  );

  // --- Keyboard panning ---
  window.addEventListener(
    'keydown',
    (e) => {
      const steps: Record<string, [number, number]> = {
        ArrowLeft: [-KEY_PAN_STEP, 0],
        ArrowRight: [KEY_PAN_STEP, 0],
        ArrowUp: [0, -KEY_PAN_STEP],
        ArrowDown: [0, KEY_PAN_STEP],
      };
      const step = steps[e.key];
      if (step === undefined) return;
      e.preventDefault();
      cam.x += step[0];
      cam.y += step[1];
      requestRender();
    },
    { signal },
  );

  // --- Minimap: click/drag to jump ---
  const jumpTo = (e: PointerEvent): void => {
    const rect = minimapCanvas.getBoundingClientRect();
    const tile = minimapToTile(
      state.world,
      minimapCanvas.width,
      minimapCanvas.height,
      ((e.clientX - rect.left) / rect.width) * minimapCanvas.width,
      ((e.clientY - rect.top) / rect.height) * minimapCanvas.height,
    );
    const { w, h } = view();
    centerOn(cam, state.world, w, h, tile.x, tile.y);
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
  minimapCanvas.addEventListener(
    'pointermove',
    (e) => {
      if (minimapDown) jumpTo(e);
    },
    { signal },
  );
  minimapCanvas.addEventListener('pointerup', () => (minimapDown = false), { signal });

  window.addEventListener('resize', requestRender, { signal });

  // Open centered on your starting city.
  const startCity = state.world.cities[state.world.starts[player]];
  if (startCity !== undefined) {
    const { w, h } = view();
    centerOn(cam, state.world, w, h, startCity.x, startCity.y);
  }
  requestRender();

  return {
    dispose(): void {
      abort.abort();
      if (raf !== 0) cancelAnimationFrame(raf);
    },
  };
}
