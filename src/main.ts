import { createRng } from './core/rng';
import { seedFromString } from './core/rng';
import { createGame } from './core/state';
import type { MapSizeKey } from './core/rules';
import { createGameScreen, type GameScreen } from './ui/gameScreen';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const minimapCanvas = document.getElementById('minimap') as HTMLCanvasElement;
const statusLine = document.getElementById('status-line') as HTMLParagraphElement;
const titleScreen = document.getElementById('title-screen') as HTMLDivElement;
const dialogLayer = document.getElementById('dialog-layer') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const hudText = document.getElementById('hud-text') as HTMLSpanElement;
const minimapWindow = document.getElementById('minimap-window') as HTMLDivElement;
const seedInput = document.getElementById('input-seed') as HTMLInputElement;

let screen: GameScreen | null = null;

function setStatus(text: string): void {
  statusLine.textContent = text;
}

/** Title-screen backdrop: dithered speckle, replaced by the map in-game. */
function drawBackground(): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tile = 8 * dpr;
  const rng = createRng(1984);
  ctx.fillStyle = '#000';
  for (let y = 0; y < canvas.height; y += tile) {
    for (let x = 0; x < canvas.width; x += tile) {
      if (rng.chance(0.06)) {
        ctx.fillRect(x, y, dpr, dpr);
      }
    }
  }
}

function onTitleResize(): void {
  if (screen === null) drawBackground();
}

/** Round-trip a message through the server's /ws echo endpoint. */
function testConnection(): void {
  setStatus('Connecting…');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const timeout = setTimeout(() => {
    ws.close();
    setStatus('Connection test failed: timed out.');
  }, 5000);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'echo', payload: 'hello from the client' }));
  });
  ws.addEventListener('message', (event) => {
    clearTimeout(timeout);
    setStatus(`Server replied: ${String(event.data)}`);
    ws.close();
  });
  ws.addEventListener('error', () => {
    clearTimeout(timeout);
    setStatus('Connection test failed: could not reach server.');
  });
}

function randomSeedString(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => letters[v % letters.length]).join('');
}

function startNewGame(): void {
  const seedString = seedInput.value.trim() || randomSeedString();
  const sizeInput = document.querySelector<HTMLInputElement>('input[name="map-size"]:checked');
  const sizeKey = (sizeInput?.value ?? 'medium') as MapSizeKey;

  const state = createGame(seedFromString(seedString), sizeKey);

  dialogLayer.classList.add('hidden');
  titleScreen.classList.add('hidden');
  hud.classList.remove('hidden');
  minimapWindow.classList.remove('hidden');
  hudText.textContent =
    `Seed: ${seedString} · ${state.world.width}×${state.world.height} · ` +
    `${state.world.cities.length} cities · Turn ${state.turn}`;

  screen = createGameScreen(canvas, minimapCanvas, state, 0);
}

function backToMenu(): void {
  screen?.dispose();
  screen = null;
  hud.classList.add('hidden');
  minimapWindow.classList.add('hidden');
  titleScreen.classList.remove('hidden');
  drawBackground();
}

document.getElementById('btn-vs-computer')?.addEventListener('click', () => {
  seedInput.value = '';
  dialogLayer.classList.remove('hidden');
  seedInput.focus();
});
document.getElementById('btn-pvp')?.addEventListener('click', () => {
  setStatus('Online PvP — coming in Phase 5.');
});
document.getElementById('btn-conn-test')?.addEventListener('click', testConnection);
document.getElementById('btn-start-game')?.addEventListener('click', startNewGame);
document.getElementById('btn-cancel-game')?.addEventListener('click', () => {
  dialogLayer.classList.add('hidden');
});
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startNewGame();
});
document.getElementById('btn-menu')?.addEventListener('click', backToMenu);

window.addEventListener('resize', onTitleResize);
drawBackground();
