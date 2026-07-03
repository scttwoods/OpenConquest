import fs from 'node:fs';
import path from 'node:path';
import type { SaveData } from '../src/core/save';

/**
 * Room persistence: one JSON file per game under DATA_DIR/rooms.
 * On Fly with a volume mounted at /data this survives deploys; otherwise
 * ./data lives only as long as the machine's disk (fine for dev).
 */
const DATA_DIR =
  process.env.DATA_DIR ?? (fs.existsSync('/data') ? '/data' : path.resolve('./data'));
const ROOMS_DIR = path.join(DATA_DIR, 'rooms');

/** Idle games are dropped after 30 days. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredRoom {
  code: string;
  tokens: [string, string | null];
  game: SaveData;
  chat: { from: 0 | 1; text: string }[];
}

export function saveRoom(room: StoredRoom): void {
  try {
    fs.mkdirSync(ROOMS_DIR, { recursive: true });
    const file = path.join(ROOMS_DIR, `${room.code}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(room));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.error('saveRoom failed:', err);
  }
}

export function deleteRoom(code: string): void {
  try {
    fs.unlinkSync(path.join(ROOMS_DIR, `${code}.json`));
  } catch {
    /* already gone */
  }
}

export function loadRooms(): StoredRoom[] {
  const rooms: StoredRoom[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(ROOMS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return rooms;
  }
  const now = Date.now();
  for (const file of files) {
    const full = path.join(ROOMS_DIR, file);
    try {
      if (now - fs.statSync(full).mtimeMs > MAX_AGE_MS) {
        fs.unlinkSync(full);
        continue;
      }
      rooms.push(JSON.parse(fs.readFileSync(full, 'utf8')) as StoredRoom);
    } catch (err) {
      console.error(`skipping corrupt room file ${file}:`, err);
    }
  }
  return rooms;
}
