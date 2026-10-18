import type { Song } from "./song";
import { SPEED_PERCENT, type Mode } from "./engine";
import {
  DEFAULT_PIANO_SOUND,
  normalizePianoSound,
  type PianoVoices,
} from "./pianoSound";
export interface Settings {
  mode: Mode;
  speed: number;
  left: boolean;
  right: boolean;
  tolerance: number;
  reference: boolean;
  names: boolean;
  selected: string;
  ambience: number;
  /** The optional Accurate-Salamander voices that play. */
  pianoVoices: PianoVoices;
}
export interface Progress {
  position: number;
  best: number;
  attempts: number;
  updated: string;
  assignments: Record<number, string>;
  loopEnabled: boolean;
  loop: [number, number] | null;
}
export const defaults: Settings = {
  mode: "wait",
  speed: 1,
  left: true,
  right: true,
  tolerance: 0.22,
  reference: true,
  names: true,
  selected: "cadence-ode-to-joy-v1",
  ambience: DEFAULT_PIANO_SOUND.ambience,
  pianoVoices: { ...DEFAULT_PIANO_SOUND.voices },
};
const storageKey = (key: string) => `cadence:${key}`;
export function read<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(storageKey(key)) || "null") ?? fallback
    );
  } catch {
    return fallback;
  }
}
export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
/** Throws when browser storage is blocked. */
export function removeProgress(id: string) {
  localStorage.removeItem(storageKey(`progress:${id}`));
}
export function settings(): Settings {
  const saved = read<Partial<Settings>>("settings", {}),
    s = { ...defaults, ...(saved && typeof saved === "object" ? saved : {}) };
  const sound = normalizePianoSound({
    ambience: s.ambience,
    voices: s.pianoVoices,
  });
  return {
    mode: ["listen", "wait", "rhythm"].includes(s.mode) ? s.mode : "wait",
    // Older saves used 5% steps; snap them onto the slider's steps.
    speed: Number.isFinite(s.speed)
      ? (Math.round(
          Math.max(
            SPEED_PERCENT.min,
            Math.min(SPEED_PERCENT.max, s.speed * 100),
          ) / SPEED_PERCENT.step,
        ) *
          SPEED_PERCENT.step) /
        100
      : defaults.speed,
    tolerance: Number.isFinite(s.tolerance)
      ? Math.max(0.08, Math.min(0.35, s.tolerance))
      : 0.22,
    left: !!s.left,
    right: !!s.right,
    reference: !!s.reference,
    names: !!s.names,
    selected: typeof s.selected === "string" ? s.selected : defaults.selected,
    ambience: sound.ambience,
    pianoVoices: sound.voices,
  };
}
export function progress(id: string, duration: number): Progress {
  const raw = read<Partial<Progress>>(`progress:${id}`, {}),
    p = raw && typeof raw === "object" ? raw : {};
  const loop = p.loop;
  return {
    position: Number.isFinite(p.position)
      ? Math.max(0, Math.min(duration, p.position!))
      : 0,
    best: Number.isFinite(p.best) ? Math.max(0, Math.min(100, p.best!)) : 0,
    attempts: Number.isFinite(p.attempts)
      ? Math.max(0, Math.floor(p.attempts!))
      : 0,
    updated: typeof p.updated === "string" ? p.updated : "",
    assignments:
      p.assignments && typeof p.assignments === "object" ? p.assignments : {},
    loopEnabled: typeof p.loopEnabled === "boolean" ? p.loopEnabled : true,
    loop:
      Array.isArray(loop) &&
      loop.length === 2 &&
      loop.every(Number.isFinite) &&
      loop[0] >= 0 &&
      loop[1] <= duration &&
      loop[1] > loop[0] + 0.1
        ? loop
        : null,
  };
}
export async function songId(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// IndexedDB holds normalized songs; no file upload, analytics, or network requests.
const db = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cadence-library", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("songs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
/**
 * Settle on the transaction, not the request: a commit can still fail after a
 * successful request (for example, a full disk), and only fires `abort`.
 */
async function transact<T>(
  mode: IDBTransactionMode,
  run: (songs: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = database.transaction("songs", mode);
      const request = run(tx.objectStore("songs"));
      tx.oncomplete = () => {
        database.close();
        resolve(request.result);
      };
      // Request errors bubble to the transaction and then abort it.
      tx.onabort = () => {
        database.close();
        reject(
          tx.error ?? new DOMException("Transaction aborted", "AbortError"),
        );
      };
    } catch (error) {
      database.close();
      reject(error);
    }
  });
}
export function library(): Promise<Song[]> {
  return transact("readonly", (songs) => songs.getAll());
}
export async function saveSong(song: Song) {
  await transact("readwrite", (songs) => songs.put(song));
}
export async function deleteSong(id: string) {
  await transact("readwrite", (songs) => songs.delete(id));
}
