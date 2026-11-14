import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ACCESS_ISSUER: string;
  ACCESS_AUDIENCE: string;
  ALLOWED_EMAIL: string;
  DEV_AUTH_BYPASS?: string;
}
type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  track_number: number | null;
  mime: string;
  size: number;
  audio_key: string;
  art_key: string | null;
  art_mime: string | null;
  created_at: string;
  deleted_at: string | null;
  idempotency_key: string | null;
};
const MAX_AUDIO = 25 * 1024 * 1024;
const MAX_BODY = 31 * 1024 * 1024;
const MAX_ART = 5 * 1024 * 1024;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const err = (message: string, status = 400) => json({ error: message }, status);
const iso = () => new Date().toISOString();
const validId = (s: unknown): s is string =>
  typeof s === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
const field = (v: FormDataEntryValue | null, max: number, fallback = "") =>
  typeof v === "string" ? v.trim().slice(0, max) : fallback;
const expose = (t: Track) => ({
  id: t.id,
  title: t.title,
  artist: t.artist,
  album: t.album,
  duration: t.duration,
  trackNumber: t.track_number,
  mime: t.mime,
  size: t.size,
  createdAt: t.created_at,
  hasArt: !!t.art_key,
});
const issuerKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function authorized(request: Request, env: Env): Promise<boolean> {
  const url = new URL(request.url);
  if (
    env.DEV_AUTH_BYPASS === "true" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return true;
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUDIENCE || !env.ALLOWED_EMAIL)
    return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  try {
    const issuer = env.ACCESS_ISSUER.replace(/\/$/, "");
    if (!issuer.startsWith("https://")) return false;
    let keys = issuerKeys.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      issuerKeys.set(issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience: env.ACCESS_AUDIENCE,
      algorithms: ["RS256"],
      requiredClaims: ["exp"],
    });
    return (
      typeof payload.email === "string" &&
      payload.email.toLowerCase() === env.ALLOWED_EMAIL.trim().toLowerCase()
    );
  } catch {
    return false;
  }
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
export function sniffAudio(bytes: Uint8Array): string | null {
  const a = (s: string, off = 0) =>
    [...s].every((c, i) => bytes[off + i] === c.charCodeAt(0));
  if (
    a("ID3") ||
    (bytes[0] === 0xff &&
      (bytes[1] & 0xe0) === 0xe0 &&
      (bytes[1] & 0x18) !== 0x08 &&
      (bytes[1] & 0x06) !== 0)
  )
    return "audio/mpeg";
  if (a("fLaC")) return "audio/flac";
  if (a("OggS")) return "audio/ogg";
  if (a("RIFF") && a("WAVE", 8)) return "audio/wav";
  if (a("ftyp", 4)) return "audio/mp4";
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "audio/webm";
  return null;
}
function sniffArt(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v))
    return "image/png";
  if (
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
export function parseRange(
  header: string,
  size: number,
): { offset: number; length: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2]) || size <= 0) return null;
  let start: number, end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : size - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= size ||
      end < start
    )
      return null;
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}
async function track(db: D1Database, id: string): Promise<Track | null> {
  return db
    .prepare("SELECT * FROM tracks WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<Track>();
}
async function cleanup(env: Env, t: Track) {
  try {
    await env.BUCKET.delete([t.audio_key, ...(t.art_key ? [t.art_key] : [])]);
    await env.DB.prepare(
      "DELETE FROM tracks WHERE id = ? AND deleted_at IS NOT NULL",
    )
      .bind(t.id)
      .run();
  } catch {
    /* tombstone remains for retry */
  }
}
async function retryCleanup(env: Env) {
  const rows = await env.DB.prepare(
    "SELECT * FROM tracks WHERE deleted_at IS NOT NULL LIMIT 10",
  ).all<Track>();
  await Promise.all(rows.results.map((t) => cleanup(env, t)));
}
async function bodyJson(request: Request): Promise<any> {
  if (
    Number(request.headers.get("Content-Length") || 0) > 256 * 1024 ||
    !request.body
  )
    return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 256 * 1024) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
async function api(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!(await authorized(request, env))) return err("Unauthorized", 401);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
    !sameOrigin(request)
  )
    return err("Invalid origin", 403);
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  ctx.waitUntil(retryCleanup(env).catch(() => {}));
  if (path === "/api/tracks" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT * FROM tracks WHERE deleted_at IS NULL ORDER BY created_at DESC",
    ).all<Track>();
    return json({ tracks: rows.results.map(expose) });
  }
  if (path === "/api/tracks" && method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > MAX_BODY) return err("Upload too large", 413);
    if (!request.body) return err("Invalid upload");
    let total = 0,
      tooLarge = false;
    const capped = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_BODY) {
            tooLarge = true;
            controller.error(new Error("Upload too large"));
          } else controller.enqueue(chunk);
        },
      }),
    );
    let form: FormData;
    try {
      form = await new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: capped,
      }).formData();
    } catch {
      return tooLarge ? err("Upload too large", 413) : err("Invalid upload");
    }
    const audio = form.get("audio"),
      art = form.get("art");
    if (!(audio instanceof File) || !audio.size)
      return err("Audio file required");
    if (audio.size > MAX_AUDIO || (art instanceof File && art.size > MAX_ART))
      return err("Upload too large", 413);
    const mime = sniffAudio(
      new Uint8Array(await audio.slice(0, 16).arrayBuffer()),
    );
    if (!mime) return err("Unsupported audio format", 415);
    const artMime =
      art instanceof File && art.size
        ? sniffArt(new Uint8Array(await art.slice(0, 16).arrayBuffer()))
        : null;
    if (art instanceof File && art.size && !artMime)
      return err("Unsupported artwork format", 415);
    const title = field(form.get("title"), 200),
      artist =
        field(form.get("artist"), 200, "Unknown artist") || "Unknown artist",
      album = field(form.get("album"), 200),
      duration = Number(form.get("duration") || 0);
    const rawNumber = field(form.get("trackNumber"), 10),
      trackNumber = rawNumber ? Number(rawNumber) : null;
    const idem = field(form.get("idempotencyKey"), 128);
    if (
      !title ||
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 86400 ||
      (trackNumber !== null &&
        (!Number.isInteger(trackNumber) ||
          trackNumber < 1 ||
          trackNumber > 9999)) ||
      (idem && !validId(idem))
    )
      return err("Invalid metadata");
    if (idem) {
      const existing = await env.DB.prepare(
        "SELECT * FROM tracks WHERE idempotency_key = ? AND deleted_at IS NULL",
      )
        .bind(idem)
        .first<Track>();
      if (existing) return json({ track: expose(existing) }, 200);
    }
    const id = crypto.randomUUID(),
      audioKey = `audio/${id}`,
      artKey = artMime ? `art/${id}` : null,
      created = iso();
    try {
      await env.BUCKET.put(audioKey, audio.stream(), {
        httpMetadata: { contentType: mime },
      });
      if (artKey && art instanceof File)
        await env.BUCKET.put(artKey, art.stream(), {
          httpMetadata: { contentType: artMime! },
        });
      await env.DB.prepare(
        "INSERT INTO tracks (id,title,artist,album,duration,track_number,mime,size,audio_key,art_key,art_mime,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          id,
          title,
          artist,
          album,
          duration,
          trackNumber,
          mime,
          audio.size,
          audioKey,
          artKey,
          artMime,
          created,
          idem || null,
        )
        .run();
    } catch (e) {
      await env.BUCKET.delete([audioKey, ...(artKey ? [artKey] : [])]).catch(
        () => {},
      );
      if (idem) {
        const existing = await env.DB.prepare(
          "SELECT * FROM tracks WHERE idempotency_key = ? AND deleted_at IS NULL",
        )
          .bind(idem)
          .first<Track>();
        if (existing) return json({ track: expose(existing) });
      }
      throw e;
    }
    return json({ track: expose((await track(env.DB, id))!) }, 201);
  }
  const tm = /^\/api\/tracks\/([^/]+)(?:\/(audio|art))?$/.exec(path);
  if (tm && validId(tm[1])) {
    const t = await track(env.DB, tm[1]);
    if (!t) return err("Track not found", 404);
    if (!tm[2] && method === "PATCH") {
      const b = await bodyJson(request);
      if (!b || typeof b !== "object" || Array.isArray(b))
        return err("Invalid metadata");
      const title =
        b.title === undefined
          ? t.title
          : typeof b.title === "string"
            ? b.title.trim()
            : "";
      const artist =
        b.artist === undefined
          ? t.artist
          : typeof b.artist === "string"
            ? b.artist.trim()
            : "";
      const album =
        b.album === undefined
          ? t.album
          : typeof b.album === "string"
            ? b.album.trim()
            : null;
      const duration = b.duration === undefined ? t.duration : b.duration;
      const trackNumber =
        b.trackNumber === undefined ? t.track_number : b.trackNumber;
      if (
        !title ||
        title.length > 200 ||
        !artist ||
        artist.length > 200 ||
        album === null ||
        album.length > 200 ||
        typeof duration !== "number" ||
        !Number.isFinite(duration) ||
        duration < 0 ||
        duration > 86400 ||
        (trackNumber !== null &&
          (!Number.isInteger(trackNumber) ||
            trackNumber < 1 ||
            trackNumber > 9999))
      )
        return err("Invalid metadata");
      await env.DB.prepare(
        "UPDATE tracks SET title=?, artist=?, album=?, duration=?, track_number=? WHERE id=? AND deleted_at IS NULL",
      )
        .bind(title, artist, album, duration, trackNumber, t.id)
        .run();
      return json({ track: expose((await track(env.DB, t.id))!) });
    }
    if (!tm[2] && method === "DELETE") {
      await env.DB.prepare("UPDATE tracks SET deleted_at = ? WHERE id = ?")
        .bind(iso(), t.id)
        .run();
      ctx.waitUntil(cleanup(env, t));
      return json({ ok: true });
    }
    if (tm[2] && (method === "GET" || method === "HEAD")) {
      const isAudio = tm[2] === "audio",
        key = isAudio ? t.audio_key : t.art_key;
      if (!key) return err("Artwork not found", 404);
      const rangeHeader = isAudio ? request.headers.get("Range") : null;
      const range = rangeHeader ? parseRange(rangeHeader, t.size) : null;
      if (rangeHeader && !range)
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${t.size}`,
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
        });
      const object = await env.BUCKET.get(key, range ? { range } : undefined);
      if (!object) return err("File not found", 404);
      const headers = new Headers({
        "Content-Type": isAudio ? t.mime : t.art_mime!,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      if (isAudio) headers.set("Accept-Ranges", "bytes");
      headers.set("Content-Length", String(range ? range.length : object.size));
      if (range)
        headers.set(
          "Content-Range",
          `bytes ${range.offset}-${range.offset + range.length - 1}/${t.size}`,
        );
      return new Response(method === "HEAD" ? null : object.body, {
        status: range ? 206 : 200,
        headers,
      });
    }
  }
  if (path === "/api/playlists" && method === "GET") {
    const p = await env.DB.prepare(
      "SELECT * FROM playlists ORDER BY created_at DESC",
    ).all<any>();
    const links = await env.DB.prepare(
      "SELECT pt.playlist_id, pt.track_id FROM playlist_tracks pt JOIN tracks t ON t.id=pt.track_id WHERE t.deleted_at IS NULL ORDER BY pt.position",
    ).all<any>();
    return json({
      playlists: p.results.map((x) => ({
        id: x.id,
        name: x.name,
        createdAt: x.created_at,
        updatedAt: x.updated_at,
        trackIds: links.results
          .filter((y) => y.playlist_id === x.id)
          .map((y) => y.track_id),
      })),
    });
  }
  if (path === "/api/playlists" && method === "POST") {
    const b = await bodyJson(request),
      name = typeof b?.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 100) return err("Invalid playlist name");
    const id = crypto.randomUUID(),
      now = iso();
    await env.DB.prepare("INSERT INTO playlists VALUES (?,?,?,?)")
      .bind(id, name, now, now)
      .run();
    return json(
      { playlist: { id, name, createdAt: now, updatedAt: now, trackIds: [] } },
      201,
    );
  }
  const pm = /^\/api\/playlists\/([^/]+)(?:\/(tracks))?$/.exec(path);
  if (pm && validId(pm[1])) {
    const p = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?")
      .bind(pm[1])
      .first<any>();
    if (!p) return err("Playlist not found", 404);
    if (!pm[2] && method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM playlist_tracks WHERE playlist_id = ?",
        ).bind(p.id),
        env.DB.prepare("DELETE FROM playlists WHERE id = ?").bind(p.id),
      ]);
      return json({ ok: true });
    }
    if (!pm[2] && method === "PATCH") {
      const b = await bodyJson(request),
        name = typeof b?.name === "string" ? b.name.trim() : "";
      if (!name || name.length > 100) return err("Invalid playlist name");
      const now = iso();
      await env.DB.prepare(
        "UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?",
      )
        .bind(name, now, p.id)
        .run();
      return json({ ok: true });
    }
    if (pm[2] && method === "PUT") {
      const b = await bodyJson(request),
        ids = b?.trackIds;
      if (
        !Array.isArray(ids) ||
        ids.length > 1000 ||
        !ids.every(validId) ||
        new Set(ids).size !== ids.length
      )
        return err("Invalid track list");
      const encoded = JSON.stringify(ids);
      const count = await env.DB.prepare(
        "SELECT COUNT(*) AS count FROM tracks WHERE deleted_at IS NULL AND id IN (SELECT value FROM json_each(?))",
      )
        .bind(encoded)
        .first<{ count: number }>();
      if (count?.count !== ids.length) return err("Track not found", 404);
      await env.DB.batch([
        env.DB.prepare(
          "DELETE FROM playlist_tracks WHERE playlist_id = ?",
        ).bind(p.id),
        env.DB.prepare(
          "INSERT INTO playlist_tracks (playlist_id,track_id,position) SELECT ?, t.id, CAST(j.key AS INTEGER) FROM json_each(?) j JOIN tracks t ON t.id=j.value AND t.deleted_at IS NULL",
        ).bind(p.id, encoded),
        env.DB.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").bind(
          iso(),
          p.id,
        ),
      ]);
      return json({ ok: true });
    }
  }
  if (path === "/api/history" && method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT h.id, h.track_id, h.played_at FROM history h JOIN tracks t ON t.id=h.track_id WHERE t.deleted_at IS NULL ORDER BY h.played_at DESC LIMIT 500",
    ).all<any>();
    return json({
      events: rows.results.map((x) => ({
        id: x.id,
        trackId: x.track_id,
        playedAt: x.played_at,
      })),
    });
  }
  if (path === "/api/history" && method === "POST") {
    const b = await bodyJson(request),
      events = b?.events;
    if (!Array.isArray(events) || events.length > 500)
      return err("Invalid events");
    for (const e of events)
      if (
        !validId(e?.id) ||
        !validId(e?.trackId) ||
        typeof e.playedAt !== "string" ||
        !Number.isFinite(Date.parse(e.playedAt))
      )
        return err("Invalid event");
    if (events.length) {
      const normalized = events.map((e: any) => ({
        id: e.id,
        trackId: e.trackId,
        playedAt: new Date(e.playedAt).toISOString(),
      }));
      await env.DB.prepare(
        "INSERT OR IGNORE INTO history (id,track_id,played_at) SELECT json_extract(j.value,'$.id'),t.id,json_extract(j.value,'$.playedAt') FROM json_each(?) j JOIN tracks t ON t.id=json_extract(j.value,'$.trackId') AND t.deleted_at IS NULL",
      )
        .bind(JSON.stringify(normalized))
        .run();
    }
    return json({ ok: true });
  }
  if (path === "/api/history" && method === "DELETE") {
    await env.DB.prepare("DELETE FROM history").run();
    return json({ ok: true });
  }
  return err("Not found", 404);
}
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, ctx);
      } catch {
        return err("Internal server error", 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
