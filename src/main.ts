import { createRng, seedFromString } from './core/rng';
import { createGame } from './core/state';
import { deserializeGame, type SaveData } from './core/save';
import {
  DIFFICULTIES,
  UNIT_SPECS,
  UNIT_TYPES,
  type DifficultyKey,
  type MapSizeKey,
} from './core/rules';
import { createLocalSession, AUTOSAVE_KEY } from './session/local';
import { createRemoteSession, savedPvpGame } from './session/remote';
import type { Session } from './session/session';
import { createGameScreen, type GameScreen } from './ui/gameScreen';
import { isMuted, toggleMute } from './ui/sounds';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const statusLine = document.getElementById('status-line') as HTMLParagraphElement;
const titleScreen = document.getElementById('title-screen') as HTMLDivElement;
const dialogLayer = document.getElementById('dialog-layer') as HTMLDivElement;
const pvpDialog = document.getElementById('pvp-dialog') as HTMLDivElement;
const pvpStatus = document.getElementById('pvp-status') as HTMLParagraphElement;
const helpDialog = document.getElementById('help-dialog') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const minimapWindow = document.getElementById('minimap-window') as HTMLDivElement;
const chatWindow = document.getElementById('chat-window') as HTMLDivElement;
const seedInput = document.getElementById('input-seed') as HTMLInputElement;
const joinCodeInput = document.getElementById('input-join-code') as HTMLInputElement;
const btnContinue = document.getElementById('btn-continue') as HTMLButtonElement;
const btnPvpResume = document.getElementById('btn-pvp-resume') as HTMLButtonElement;
const btnMute = document.getElementById('btn-mute') as HTMLButtonElement;

let screen: GameScreen | null = null;

function setStatus(text: string): void {
  statusLine.textContent = text;
}

/** Title-screen backdrop: speckled ocean, replaced by the map in-game. */
function drawBackground(): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#2e6db4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tile = 8 * dpr;
  const rng = createRng(1984);
  ctx.fillStyle = '#5b93cf';
  for (let y = 0; y < canvas.height; y += tile) {
    for (let x = 0; x < canvas.width; x += tile) {
      if (rng.chance(0.1)) ctx.fillRect(x, y, 2 * dpr, dpr);
    }
  }
}

function randomSeedString(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => letters[v % letters.length]).join('');
}

function enterGame(session: Session, opponentLabel: string, showChat: boolean): void {
  titleScreen.classList.add('hidden');
  dialogLayer.classList.add('hidden');
  pvpDialog.classList.add('hidden');
  hud.classList.remove('hidden');
  minimapWindow.classList.remove('hidden');
  chatWindow.classList.toggle('hidden', !showChat);
  // The Chat toggle only appears in PvP games (where chat exists).
  document.getElementById('btn-chat')?.classList.toggle('hidden', !showChat);
  updateMuteLabel();

  screen = createGameScreen(session, (p) => (p === session.you ? 'You' : opponentLabel), {
    onExit: backToMenu,
  });
}

function backToMenu(): void {
  screen?.dispose();
  screen = null;
  hud.classList.add('hidden');
  minimapWindow.classList.add('hidden');
  chatWindow.classList.add('hidden');
  document.getElementById('unit-panel')?.classList.add('hidden');
  titleScreen.classList.remove('hidden');
  refreshContinueButtons();
  drawBackground();
}

// ---------- vs Computer ----------

function startNewLocalGame(): void {
  const seedString = seedInput.value.trim() || randomSeedString();
  const sizeInput = document.querySelector<HTMLInputElement>('input[name="map-size"]:checked');
  const sizeKey = (sizeInput?.value ?? 'medium') as MapSizeKey;
  const diffInput = document.querySelector<HTMLInputElement>('input[name="difficulty"]:checked');
  const diffKey = (diffInput?.value ?? 'normal') as DifficultyKey;
  // The player (0) always builds at normal speed; the computer (1) is handicapped.
  const state = createGame(seedFromString(seedString), sizeKey, [1, DIFFICULTIES[diffKey].aiRate]);
  enterGame(createLocalSession(state), `Computer (${DIFFICULTIES[diffKey].label})`, false);
}

function continueLocalGame(): void {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw === null) return;
    const state = deserializeGame(JSON.parse(raw) as SaveData);
    enterGame(createLocalSession(state), 'Computer', false);
  } catch {
    setStatus('Could not load the saved game.');
    localStorage.removeItem(AUTOSAVE_KEY);
    refreshContinueButtons();
  }
}

// ---------- Online PvP ----------

function startPvp(mode: 'create' | 'join' | 'resume'): void {
  pvpStatus.textContent = 'Connecting…';
  let session;
  if (mode === 'create') {
    const sizeInput = document.querySelector<HTMLInputElement>(
      'input[name="pvp-map-size"]:checked',
    );
    const sizeKey = (sizeInput?.value ?? 'medium') as MapSizeKey;
    session = createRemoteSession({ mode: 'create', sizeKey });
  } else if (mode === 'join') {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      pvpStatus.textContent = 'Enter the 6-character game code.';
      return;
    }
    session = createRemoteSession({ mode: 'join', code });
  } else {
    const saved = savedPvpGame();
    if (saved === null) return;
    session = createRemoteSession({ mode: 'resume', credentials: saved });
  }

  let entered = false;
  session.onSeat((credentials) => {
    if (!entered) {
      entered = true;
      enterGame(session, 'Opponent', true);
      // Pin the game code at the top of the chat so it can be shared anytime.
      const chatLog = document.getElementById('chat-log');
      if (chatLog !== null) {
        const line = document.createElement('div');
        line.id = 'chat-code-line';
        line.textContent = `— Game code: ${credentials.code} —`;
        chatLog.appendChild(line);
      }
    }
  });
  session.onError((message) => {
    if (!entered) pvpStatus.textContent = message;
  });
  // If nothing happens (server down), report it.
  setTimeout(() => {
    if (!entered && !pvpDialog.classList.contains('hidden')) {
      pvpStatus.textContent = 'No response from server. Try again.';
    }
  }, 6000);
}

function refreshContinueButtons(): void {
  let hasLocal = false;
  try {
    hasLocal = localStorage.getItem(AUTOSAVE_KEY) !== null;
  } catch {
    /* ignore */
  }
  btnContinue.classList.toggle('hidden', !hasLocal);
  btnPvpResume.classList.toggle('hidden', savedPvpGame() === null);
}

// ---------- Help ----------

function buildHelpTable(): void {
  const table = document.getElementById('help-units') as HTMLTableElement;
  const header =
    '<tr><th>Unit</th><th>Key</th><th>Moves</th><th>Hits</th><th>Build</th><th>Notes</th></tr>';
  const notes: Record<string, string> = {
    army: 'Captures cities; rides Transports',
    fighter: `Fuel ${UNIT_SPECS.fighter.fuel} (range ~${Math.floor((UNIT_SPECS.fighter.fuel ?? 0) / 2)}); lands at cities/Carriers`,
    transport: 'Carries 6 Armies',
    destroyer: 'Fast, sturdy escort; spots subs',
    submarine: 'Stealthy; hits ships for 2',
    cruiser: 'Tough warship',
    carrier: 'Hosts 8 Fighters at sea',
    battleship: 'The heavyweight',
  };
  table.innerHTML =
    header +
    UNIT_TYPES.map((t) => {
      const s = UNIT_SPECS[t];
      return `<tr><td>${s.name}</td><td>${s.letter}</td><td>${s.moves}</td><td>${s.hits}</td><td>${s.buildTime}</td><td>${notes[t] ?? ''}</td></tr>`;
    }).join('');
}

function updateMuteLabel(): void {
  btnMute.textContent = isMuted() ? 'Sound: Off' : 'Sound: On';
}

// ---------- Wiring ----------

document.getElementById('btn-vs-computer')?.addEventListener('click', () => {
  seedInput.value = '';
  dialogLayer.classList.remove('hidden');
  seedInput.focus();
});
document.getElementById('btn-start-game')?.addEventListener('click', startNewLocalGame);
document
  .getElementById('btn-cancel-game')
  ?.addEventListener('click', () => dialogLayer.classList.add('hidden'));
seedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startNewLocalGame();
});
btnContinue.addEventListener('click', continueLocalGame);

document.getElementById('btn-pvp')?.addEventListener('click', () => {
  pvpStatus.textContent = ' ';
  refreshContinueButtons();
  pvpDialog.classList.remove('hidden');
});
document.getElementById('btn-pvp-create')?.addEventListener('click', () => startPvp('create'));
document.getElementById('btn-pvp-join')?.addEventListener('click', () => startPvp('join'));
btnPvpResume.addEventListener('click', () => startPvp('resume'));
document.getElementById('btn-pvp-cancel')?.addEventListener('click', () => {
  pvpDialog.classList.add('hidden');
});
joinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startPvp('join');
  e.stopPropagation();
});

document
  .getElementById('btn-help')
  ?.addEventListener('click', () => helpDialog.classList.remove('hidden'));
document
  .getElementById('btn-close-help')
  ?.addEventListener('click', () => helpDialog.classList.add('hidden'));

document.getElementById('btn-menu')?.addEventListener('click', () => {
  if (confirm('Leave the game? (vs-Computer games autosave; PvP games stay on the server.)')) {
    backToMenu();
  }
});
btnMute.addEventListener('click', () => {
  toggleMute();
  updateMuteLabel();
});

// Map window show/hide.
document.getElementById('btn-map')?.addEventListener('click', () => {
  minimapWindow.classList.toggle('hidden');
});
document.getElementById('btn-minimap-close')?.addEventListener('click', () => {
  minimapWindow.classList.add('hidden');
});

// Chat window show/hide (PvP only).
document.getElementById('btn-chat')?.addEventListener('click', () => {
  chatWindow.classList.toggle('hidden');
});
document.getElementById('btn-chat-close')?.addEventListener('click', () => {
  chatWindow.classList.add('hidden');
});

window.addEventListener('resize', () => {
  if (screen === null) drawBackground();
});

// PvP resume shortcut: if the last PvP game is still live, surface it.
buildHelpTable();
refreshContinueButtons();
updateMuteLabel();
drawBackground();
setStatus(' ');
