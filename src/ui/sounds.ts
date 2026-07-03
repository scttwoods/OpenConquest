/** Tiny synthesized 1-bit-era sound effects. No samples, no assets. */

let audio: AudioContext | null = null;
let muted = false;

try {
  muted = localStorage.getItem('openconquest.muted') === '1';
} catch {
  /* ignore */
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem('openconquest.muted', muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

function ctx(): AudioContext | null {
  if (muted) return null;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

function blip(
  freq: number,
  duration: number,
  type: OscillatorType = 'square',
  volume = 0.06,
  when = 0,
): void {
  const ac = ctx();
  if (ac === null) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ac.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + when + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start(ac.currentTime + when);
  osc.stop(ac.currentTime + when + duration);
}

export function playBattleWon(): void {
  blip(440, 0.08);
  blip(660, 0.1, 'square', 0.06, 0.08);
}

export function playBattleLost(): void {
  blip(220, 0.12);
  blip(150, 0.18, 'square', 0.06, 0.1);
}

export function playCapture(): void {
  blip(523, 0.09);
  blip(659, 0.09, 'square', 0.06, 0.09);
  blip(784, 0.14, 'square', 0.06, 0.18);
}

export function playVictory(): void {
  [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.18, 'square', 0.07, i * 0.16));
}

export function playDefeat(): void {
  [392, 330, 262, 196].forEach((f, i) => blip(f, 0.2, 'square', 0.07, i * 0.18));
}

export function playChat(): void {
  blip(880, 0.05, 'sine', 0.05);
}
