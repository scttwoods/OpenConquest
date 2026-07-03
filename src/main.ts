import { createRng } from './core/rng';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const statusLine = document.getElementById('status-line') as HTMLParagraphElement;

function setStatus(text: string): void {
  statusLine.textContent = text;
}

/**
 * Phase 0 placeholder: fill the canvas with a dithered "sea" checkerboard so we
 * can see the render surface working. Replaced by the real map renderer in
 * Phase 1.
 */
function drawBackground(): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tile = 8 * dpr;
  const rng = createRng(1984);
  ctx.fillStyle = '#000';
  for (let y = 0; y < canvas.height; y += tile) {
    for (let x = 0; x < canvas.width; x += tile) {
      // Sparse speckle pattern — evokes the classic 1-bit ocean dither.
      if (rng.chance(0.06)) {
        ctx.fillRect(x, y, dpr, dpr);
      }
    }
  }
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

document.getElementById('btn-vs-computer')?.addEventListener('click', () => {
  setStatus('vs Computer — coming in Phase 2.');
});
document.getElementById('btn-pvp')?.addEventListener('click', () => {
  setStatus('Online PvP — coming in Phase 5.');
});
document.getElementById('btn-conn-test')?.addEventListener('click', testConnection);

window.addEventListener('resize', drawBackground);
drawBackground();
