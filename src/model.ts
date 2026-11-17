import { openDB } from "idb";
export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  trackNumber: number | null;
  mime: string;
  size: number;
  hasArt: boolean;
  createdAt: string;
  favorite: boolean;
  tags: string[];
  replayGain: number | null;
};
export type Playlist = { id: string; name: string; trackIds: string[] };
export const db = openDB("still-offline", 1, {
  upgrade(d) {
    d.createObjectStore("downloads", { keyPath: "id" });
    d.createObjectStore("data");
    d.createObjectStore("outbox", { keyPath: "id" });
  },
});
export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let message = `Request failed (${r.status})`;
    try {
      message = ((await r.json()) as any).error || message;
    } catch {}
    throw Object.assign(Error(message), { status: r.status });
  }
  if (r.headers.get("content-type")?.includes("application/json"))
    return r.json() as Promise<any>;
  throw Error("Sign in again to reach your private library");
}
export const formatTime = (n = 0) => {
  if (!Number.isFinite(n)) return "0:00";
  const h = Math.floor(n / 3600),
    m = Math.floor((n % 3600) / 60),
    s = String(Math.floor(n % 60)).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
export function saveFile(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function saveJSON(name: string, value: unknown) {
  saveFile(
    name,
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
}
export const extension = (mime: string) =>
  ({
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/flac": "flac",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
  })[mime] || "audio";
export function readLocal<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
