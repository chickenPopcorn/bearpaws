import type { Song } from "./song";
import type { Mode } from "./engine";
import { DEFAULT_PIANO_SOUND, normalizePianoSound } from "./pianoSound";
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
  speed: 0.75,
  left: true,
  right: true,
  tolerance: 0.22,
  reference: true,
  names: true,
  selected: "cadence-ode-to-joy-v1",
  ambience: DEFAULT_PIANO_SOUND.ambience,
};
export function read<T>(key: string, fallback: T): T {
  try {
    return (
      JSON.parse(localStorage.getItem(`cadence:${key}`) || "null") ?? fallback
    );
  } catch {
    return fallback;
  }
}
export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(`cadence:${key}`, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function settings(): Settings {
  const saved = read<Partial<Settings>>("settings", {}),
    s = { ...defaults, ...(saved && typeof saved === "object" ? saved : {}) };
  const sound = normalizePianoSound({
    ambience: s.ambience,
  });
  return {
    mode: ["listen", "wait", "rhythm"].includes(s.mode) ? s.mode : "wait",
    speed: Number.isFinite(s.speed)
      ? Math.max(0.25, Math.min(1.5, s.speed))
      : 0.75,
    tolerance: Number.isFinite(s.tolerance)
      ? Math.max(0.08, Math.min(0.35, s.tolerance))
      : 0.22,
    left: !!s.left || !s.right,
    right: !!s.right,
    reference: !!s.reference,
    names: !!s.names,
    selected: typeof s.selected === "string" ? s.selected : defaults.selected,
    ambience: sound.ambience,
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
export async function library(): Promise<Song[]> {
  const store = await db();
  return new Promise((resolve, reject) => {
    const tx = store.transaction("songs");
    const request = tx.objectStore("songs").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => store.close();
  });
}
export async function saveSong(song: Song) {
  const store = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = store.transaction("songs", "readwrite");
    tx.objectStore("songs").put(song);
    tx.oncomplete = () => {
      store.close();
      resolve();
    };
    tx.onerror = () => {
      store.close();
      reject(tx.error);
    };
  });
}
export async function deleteSong(id: string) {
  const store = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = store.transaction("songs", "readwrite");
    tx.objectStore("songs").delete(id);
    tx.oncomplete = () => {
      store.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
