import { api, extension, readLocal, writeLocal, type Track } from "./model";
import { validateTheme, light, code } from "./themes";
export function validateBackup(b: any) {
  if (
    !b ||
    b.format !== "still-backup" ||
    b.version !== 1 ||
    !Array.isArray(b.tracks) ||
    b.tracks.length > 10000
  )
    throw Error("Unsupported Still backup");
  const id = (s: any) => typeof s === "string" && /^[\w-]{1,128}$/.test(s);
  const string = (s: any, n = 200) => typeof s === "string" && s.length <= n;
  if (
    b.tracks.some(
      (t: any) =>
        !id(t.id) ||
        !string(t.title) ||
        !t.title ||
        !string(t.artist) ||
        !string(t.album) ||
        !Number.isSafeInteger(t.size) ||
        t.size < 1 ||
        t.size > 4 * 1024 ** 3 ||
        !Number.isFinite(t.duration) ||
        t.duration < 0 ||
        t.duration > 86400 ||
        ![
          "audio/mpeg",
          "audio/mp4",
          "audio/wav",
          "audio/flac",
          "audio/ogg",
          "audio/webm",
        ].includes(t.mime),
    )
  )
    throw Error("Invalid track in backup");
  const ids = new Set(b.tracks.map((t: any) => t.id));
  if (ids.size !== b.tracks.length) throw Error("Duplicate track IDs");
  for (const t of b.tracks) {
    const tags = JSON.parse(t.tags || "[]");
    if (
      !Array.isArray(tags) ||
      tags.length > 30 ||
      tags.some((s: any) => !string(s, 40))
    )
      throw Error("Invalid backup tags");
  }
  for (const key of ["playlists", "links", "history", "smart"])
    if (!Array.isArray(b[key]) || b[key].length > 100000)
      throw Error("Invalid backup collections");
  if (
    b.playlists.some((p: any) => !id(p.id) || !string(p.name, 100) || !p.name)
  )
    throw Error("Invalid playlist");
  const playlistIds = new Set(b.playlists.map((p: any) => p.id));
  if (
    b.links.some(
      (l: any) =>
        !playlistIds.has(l.playlist_id) ||
        !ids.has(l.track_id) ||
        !Number.isInteger(l.position) ||
        l.position < 0,
    )
  )
    throw Error("Invalid playlist membership");
  for (const p of b.playlists) {
    const links = b.links.filter((l: any) => l.playlist_id === p.id);
    if (
      links.length > 1000 ||
      new Set(links.map((l: any) => l.track_id)).size !== links.length
    )
      throw Error("Invalid playlist track count");
  }
  if (
    b.history.some(
      (h: any) =>
        !id(h.id) ||
        !ids.has(h.track_id) ||
        typeof h.played_at !== "string" ||
        !Number.isFinite(Date.parse(h.played_at)),
    )
  )
    throw Error("Invalid listening history");
  for (const s of b.smart) {
    const r = JSON.parse(s.rules);
    if (
      !id(s.id) ||
      !string(s.name, 100) ||
      !s.name ||
      !["all", "favorites", "recent", "unplayed"].includes(r.kind) ||
      !string(r.tag, 40) ||
      !Number.isInteger(r.days) ||
      r.days < 1 ||
      r.days > 3650
    )
      throw Error("Invalid smart playlist");
  }
  if (b.themes) {
    if (!Array.isArray(b.themes.custom) || b.themes.custom.length > 100)
      throw Error("Invalid themes");
    b.themes.custom.forEach(validateTheme);
  }
  if (
    b.queue &&
    (!Array.isArray(b.queue.ids) ||
      b.queue.ids.length > 1000 ||
      !b.queue.ids.every((i: any) => ids.has(i)) ||
      !Number.isFinite(b.queue.position) ||
      b.queue.position < 0 ||
      b.queue.position > 86400 ||
      (b.queue.current && !ids.has(b.queue.current)))
  )
    throw Error("Invalid saved queue");
  return b;
}
export async function restoreBackup(
  b: any,
  files: File[],
  tracks: Track[],
  upload: (f: File, details: any) => Promise<string | undefined>,
) {
  validateBackup(b);
  tracks = (await api("/tracks")).tracks;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(b)),
  );
  const key = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  const storageKey = "still-restore:" + key;
  const restoreKey = async (id: string) => {
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(key + ":" + id),
    );
    return Array.from(new Uint8Array(hash), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
  };
  const mapping = readLocal<Record<string, string>>(storageKey, {});
  for (const t of b.tracks) {
    if (tracks.some((x) => x.id === (mapping[t.id] || t.id)))
      mapping[t.id] = mapping[t.id] || t.id;
    else if (!files.some((f) => f.name === `${t.id}.${extension(t.mime)}`))
      throw Error(`Missing audio for ${t.title}. Select all backup media.`);
  }
  for (const t of b.tracks) {
    let id = mapping[t.id];
    if (!tracks.some((x) => x.id === id)) {
      const f = files.find((f) => f.name === `${t.id}.${extension(t.mime)}`)!;
      id = (await upload(f, {
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        trackNumber: t.track_number,
        replayGain: t.replay_gain,
        restoreIdentity: key + "_" + t.id,
      }))!;
      if (!id) throw Error("Audio restore interrupted");
      mapping[t.id] = id;
      writeLocal(storageKey, mapping);
    }
    await api(`/tracks/${id}`, "PATCH", {
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      trackNumber: t.track_number,
    });
    await api(`/tracks/${id}/preferences`, "PATCH", {
      favorite: !!t.favorite,
      tags: JSON.parse(t.tags || "[]"),
    });
    const cover = files.find((f) => f.name === t.id + ".cover");
    if (cover) {
      const r = await fetch(`/api/tracks/${id}/art`, {
        method: "PUT",
        body: cover,
      });
      if (!r.ok) throw Error("Artwork restore failed");
    }
  }
  for (const p of b.playlists) {
    const created = await api("/playlists", "POST", {
      name: p.name,
      restoreKey: await restoreKey(p.id),
    });
    await api(`/playlists/${created.playlist.id}/tracks`, "PUT", {
      trackIds: b.links
        .filter((l: any) => l.playlist_id === p.id)
        .sort((a: any, z: any) => a.position - z.position)
        .map((l: any) => mapping[l.track_id]),
    });
  }
  const h = b.history.map((h: any) => ({
    id: h.id,
    trackId: mapping[h.track_id],
    playedAt: h.played_at,
  }));
  for (let i = 0; i < h.length; i += 500)
    await api("/history", "POST", { events: h.slice(i, i + 500) });
  for (const s of b.smart)
    await api("/smart-playlists", "POST", {
      name: s.name,
      rules: JSON.parse(s.rules),
      restoreKey: await restoreKey(s.id),
    });
  return {
    custom: (b.themes?.custom || [])
      .map(validateTheme)
      .filter((t: any) => ![light.id, code.id].includes(t.id)),
    themeId: b.themes?.selected || "system",
    queue: (b.queue?.ids || []).map((id: string) => mapping[id]),
    current: mapping[b.queue?.current] || null,
    position: b.queue?.position || 0,
  };
}
