import { parseBlob } from "music-metadata";
import { api, db, readLocal, writeLocal, type Track } from "./model";
const PART = 8 * 1024 ** 2;
const fingerprints = new WeakMap<File, string>();
async function identity(file: File, signal: AbortSignal) {
  if (fingerprints.has(file)) return fingerprints.get(file)!;
  const digests = [];
  for (let i = 0; i < file.size; i += PART) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await file.slice(i, i + PART).arrayBuffer(),
    );
    digests.push(...new Uint8Array(hash));
  }
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(digests));
  const key = Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  fingerprints.set(file, key);
  return key;
}
export type Transfer = {
  id: string;
  name: string;
  kind: "upload" | "download";
  progress: number;
  status: string;
  error?: string;
};
export type UploadDetails = {
  title: string;
  artist: string;
  album: string;
  duration: number;
  trackNumber: number | null;
  replayGain: number | null;
};
export async function uploadFile(
  file: File,
  signal: AbortSignal,
  update: (progress: number, status: string) => void,
  overrides?: UploadDetails & { restoreIdentity?: string },
): Promise<string> {
  if (!file.size || file.size > 4 * 1024 ** 3)
    throw Error("Choose audio up to 4 GiB");
  update(0, "Checking file identity");
  const fingerprint =
    (await identity(file, signal)) +
    (overrides?.restoreIdentity ? ":" + overrides.restoreIdentity : "");
  const sessions = readLocal<Record<string, string>>(
    "still-upload-sessions",
    {},
  );
  let id = sessions[fingerprint] || crypto.randomUUID();
  sessions[fingerprint] = id;
  writeLocal("still-upload-sessions", sessions);
  update(0, "Reading metadata");
  let common: any = {},
    format: any = {};
  try {
    const result = await parseBlob(file);
    common = result.common;
    format = result.format;
  } catch {}
  const metadata = overrides || {
    title: common.title || file.name.replace(/\.[^.]+$/, ""),
    artist: common.artist || "Unknown artist",
    album: common.album || "",
    duration: Number.isFinite(format.duration) ? format.duration : 0,
    trackNumber: common.track?.no || null,
    replayGain: common.replaygain_track_gain?.dB ?? null,
  };
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  let session;
  try {
    session = await api("/uploads", "POST", {
      id,
      size: file.size,
      ...metadata,
    });
  } catch (e: any) {
    if (e.status !== 410) throw e;
    id = crypto.randomUUID();
    sessions[fingerprint] = id;
    writeLocal("still-upload-sessions", sessions);
    session = await api("/uploads", "POST", {
      id,
      size: file.size,
      ...metadata,
    });
  }
  if (
    !session.track_id &&
    Date.parse(session.created_at) < Date.now() - 6 * 86400000
  ) {
    await api("/uploads/" + id, "DELETE");
    session = await api("/uploads", "POST", {
      id,
      size: file.size,
      ...metadata,
    });
  }
  if (!session.track_id) {
    const parts = JSON.parse(session.parts || "{}");
    for (let i = 0; i < Math.ceil(file.size / PART); i++) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      if (!parts[String(i + 1)]) {
        const r = await fetch(`/api/uploads/${id}/parts/${i + 1}`, {
          method: "PUT",
          body: file.slice(i * PART, Math.min(file.size, (i + 1) * PART)),
          signal,
        });
        if (!r.ok)
          throw Error(((await r.json()) as any).error || "Part upload failed");
      }
      update(
        Math.round((Math.min(file.size, (i + 1) * PART) / file.size) * 95),
        "Uploading — safe to retry",
      );
    }
    update(96, "Finalizing");
    await api("/uploads/" + id + "/complete", "POST");
  }
  if (common.picture?.[0]?.data.length <= 5 * 1024 ** 2) {
    try {
      const r = await fetch(`/api/tracks/${id}/art`, {
        method: "PUT",
        body: new Blob([common.picture[0].data], {
          type: common.picture[0].format,
        }),
        signal,
      });
      if (!r.ok) update(99, "Audio saved; artwork could not be saved");
    } catch {}
  }
  writeLocal("still-upload-sessions", sessions);
  update(100, "Complete");
  return id;
}
export async function downloadTrack(
  track: Track,
  signal: AbortSignal,
  update: (progress: number, status: string) => void,
) {
  const d = await db;
  const count = Math.ceil(track.size / PART);
  const partialKey = "partial:" + track.id;
  let saved = (await d.get("data", partialKey)) as
    { size: number; chunks: Blob[] } | undefined;
  if (saved?.size !== track.size) saved = { size: track.size, chunks: [] };
  for (let i = saved.chunks.length; i < count; i++) {
    const start = i * PART,
      end = Math.min(track.size - 1, start + PART - 1);
    update(Math.round((start / track.size) * 100), "Downloading");
    const r = await fetch(`/api/tracks/${track.id}/audio`, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });
    if (
      r.status !== 206 ||
      r.headers.get("Content-Range") !==
        `bytes ${start}-${end}/${track.size}` ||
      !r.headers.get("Content-Type")?.startsWith("audio/")
    )
      throw Error(
        "Download interrupted or sign-in expired. Reauthenticate and retry.",
      );
    const blob = await r.blob();
    if (blob.size !== end - start + 1)
      throw Error("Incomplete download. Retry to resume.");
    saved.chunks.push(blob);
    await d.put("data", saved, partialKey);
  }
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  let art: Blob | undefined;
  if (track.hasArt) {
    try {
      const r = await fetch(`/api/tracks/${track.id}/art`, { signal });
      if (r.ok && r.headers.get("content-type")?.startsWith("image/"))
        art = await r.blob();
    } catch {}
  }
  const tx = d.transaction(["downloads", "data"], "readwrite");
  await tx
    .objectStore("downloads")
    .put({
      id: track.id,
      track,
      audio: new Blob(saved.chunks, { type: track.mime }),
      art,
    });
  await tx.objectStore("data").delete(partialKey);
  await tx.done;
  update(100, "Complete");
}
