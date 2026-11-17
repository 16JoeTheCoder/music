export async function bounded(request: Request, limit: number) {
  if (
    !request.body ||
    Number(request.headers.get("content-length") || 0) > limit
  )
    throw Object.assign(new Error("Request exceeds limit"), { status: 413 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    size += r.value.length;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error("Request exceeds limit"), { status: 413 });
    }
    chunks.push(r.value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  return data;
}
const response = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const text = (v: unknown, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const idOK = (v: unknown): v is string =>
  typeof v === "string" && /^[\w-]{1,128}$/.test(v);
export async function features(
  request: Request,
  env: { DB: D1Database; BUCKET: R2Bucket },
  sniff: (b: Uint8Array) => string | null,
): Promise<Response | null> {
  const url = new URL(request.url),
    p = url.pathname,
    m = request.method;
  try {
    const garbage = await env.DB.prepare(
      "SELECT object_key FROM object_cleanup LIMIT 3",
    ).all<{ object_key: string }>();
    for (const item of garbage.results) {
      await env.BUCKET.delete(item.object_key);
      await env.DB.prepare("DELETE FROM object_cleanup WHERE object_key=?")
        .bind(item.object_key)
        .run();
    }
  } catch {}
  const fail = (s: string, status = 400) => response({ error: s }, status);
  const body = async () => {
    try {
      const b = JSON.parse(
        new TextDecoder().decode(await bounded(request, 256 * 1024)),
      );
      if (!b || typeof b !== "object" || Array.isArray(b))
        throw Error("Invalid JSON body");
      return b;
    } catch (e: any) {
      if (e.status) throw e;
      throw Object.assign(Error("Invalid JSON body"), { status: 400 });
    }
  };
  if (p === "/api/uploads" && m === "POST") {
    const b = await body();
    if (
      !idOK(b.id) ||
      !Number.isSafeInteger(b.size) ||
      b.size < 1 ||
      b.size > 4 * 1024 ** 3 ||
      !text(b.title)
    )
      return fail("Audio must be between 1 byte and 4 GiB with a title");
    const old = await env.DB.prepare("SELECT * FROM uploads WHERE id=?")
      .bind(b.id)
      .first<any>();
    if (old) {
      if (
        old.track_id &&
        !(await env.DB.prepare(
          "SELECT id FROM tracks WHERE id=? AND deleted_at IS NULL",
        )
          .bind(old.track_id)
          .first())
      )
        return fail("Completed track was deleted", 410);
      return response(old);
    }
    const meta = {
      title: text(b.title),
      artist: text(b.artist) || "Unknown artist",
      album: text(b.album),
      duration:
        Number.isFinite(b.duration) && b.duration >= 0 && b.duration <= 86400
          ? b.duration
          : 0,
      trackNumber:
        Number.isInteger(b.trackNumber) && b.trackNumber > 0
          ? b.trackNumber
          : null,
      replayGain:
        typeof b.replayGain === "number" && Math.abs(b.replayGain) <= 30
          ? b.replayGain
          : null,
    };
    if (
      await env.DB.prepare("SELECT id FROM tracks WHERE id=?")
        .bind(b.id)
        .first()
    )
      return fail("Track ID already exists", 409);
    const key = "audio/" + crypto.randomUUID(),
      upload = await env.BUCKET.createMultipartUpload(key);
    try {
      await env.DB.prepare(
        "INSERT INTO uploads(id,object_key,upload_id,metadata,size,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          b.id,
          key,
          upload.uploadId,
          JSON.stringify(meta),
          b.size,
          new Date().toISOString(),
        )
        .run();
    } catch (e) {
      await upload.abort();
      const existing = await env.DB.prepare("SELECT * FROM uploads WHERE id=?")
        .bind(b.id)
        .first();
      if (existing) return response(existing);
      throw e;
    }
    return response(
      await env.DB.prepare("SELECT * FROM uploads WHERE id=?")
        .bind(b.id)
        .first(),
      201,
    );
  }
  const u =
    /^\/api\/uploads\/([\w-]{1,128})(?:\/(parts\/([0-9]+)|complete))?$/.exec(p);
  if (u) {
    const row = await env.DB.prepare("SELECT * FROM uploads WHERE id=?")
      .bind(u[1])
      .first<any>();
    if (!row) return fail("Upload not found", 404);
    if (m === "GET" && !u[2]) return response(row);
    const upload = env.BUCKET.resumeMultipartUpload(
      row.object_key,
      row.upload_id,
    );
    if (m === "DELETE" && !u[2]) {
      if (!row.track_id) await upload.abort().catch(() => {});
      await env.DB.prepare("DELETE FROM uploads WHERE id=?").bind(row.id).run();
      return response({ ok: true });
    }
    if (m === "PUT" && u[3]) {
      if (row.track_id) return fail("Upload already complete", 409);
      const n = Number(u[3]),
        chunk = 8 * 1024 ** 2,
        count = Math.ceil(row.size / chunk);
      if (n < 1 || n > count) return fail("Invalid part");
      const bytes = await bounded(request, chunk);
      if (bytes.length !== (n === count ? row.size - (n - 1) * chunk : chunk))
        return fail("Incorrect part size");
      const mime = n === 1 ? sniff(bytes.subarray(0, 16)) : row.mime;
      if (n === 1 && !mime) return fail("Unsupported audio signature", 415);
      const part = await upload.uploadPart(n, bytes);
      await env.DB.prepare(
        "UPDATE uploads SET parts=json_set(parts,?,json(?)),mime=COALESCE(?,mime) WHERE id=?",
      )
        .bind('$."' + n + '"', JSON.stringify(part), mime, row.id)
        .run();
      return response(part);
    }
    if (m === "POST" && u[2] === "complete") {
      if (row.track_id) {
        const exists = await env.DB.prepare(
          "SELECT id FROM tracks WHERE id=? AND deleted_at IS NULL",
        )
          .bind(row.track_id)
          .first();
        return exists
          ? response({ id: row.track_id })
          : fail("Completed track was deleted", 410);
      }
      const parts = Object.values(JSON.parse(row.parts)) as R2UploadedPart[];
      parts.sort((a, b) => a.partNumber - b.partNumber);
      if (!row.mime || parts.length !== Math.ceil(row.size / (8 * 1024 ** 2)))
        return fail("Upload incomplete");
      let object = await env.BUCKET.head(row.object_key);
      if (!object) {
        await upload.complete(parts);
        object = await env.BUCKET.head(row.object_key);
      }
      if (object?.size !== row.size) return fail("Uploaded size mismatch");
      const b = JSON.parse(row.metadata);
      await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO tracks(id,title,artist,album,duration,track_number,mime,size,audio_key,created_at,idempotency_key,replay_gain) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          row.id,
          b.title,
          b.artist,
          b.album,
          b.duration,
          b.trackNumber,
          row.mime,
          row.size,
          row.object_key,
          row.created_at,
          row.id,
          b.replayGain,
        ),
        env.DB.prepare("UPDATE uploads SET track_id=? WHERE id=?").bind(
          row.id,
          row.id,
        ),
      ]);
      return response({ id: row.id });
    }
  }
  const a = /^\/api\/tracks\/([\w-]{1,128})\/art$/.exec(p);
  if (a && m === "PUT") {
    if (
      !(await env.DB.prepare(
        "SELECT id FROM tracks WHERE id=? AND deleted_at IS NULL",
      )
        .bind(a[1])
        .first())
    )
      return fail("Track not found", 404);
    const b = await bounded(request, 5 * 1024 ** 2);
    const mime =
      b[0] === 255 && b[1] === 216
        ? "image/jpeg"
        : b[0] === 137 && b[1] === 80
          ? "image/png"
          : String.fromCharCode(...b.subarray(0, 4)) === "RIFF" &&
              String.fromCharCode(...b.subarray(8, 12)) === "WEBP"
            ? "image/webp"
            : null;
    if (!mime) return fail("JPEG, PNG or WebP required");
    const old = await env.DB.prepare(
      "SELECT art_key FROM tracks WHERE id=? AND deleted_at IS NULL",
    )
      .bind(a[1])
      .first<any>();
    const key = "art/" + crypto.randomUUID();
    await env.BUCKET.put(key, b, { httpMetadata: { contentType: mime } });
    let updated;
    try {
      const results = await env.DB.batch([
        env.DB.prepare(
          "INSERT OR IGNORE INTO object_cleanup SELECT art_key FROM tracks WHERE id=? AND deleted_at IS NULL AND art_key IS ? AND art_key IS NOT NULL",
        ).bind(a[1], old?.art_key || null),
        env.DB.prepare(
          "UPDATE tracks SET art_key=?,art_mime=? WHERE id=? AND deleted_at IS NULL AND art_key IS ?",
        ).bind(key, mime, a[1], old?.art_key || null),
      ]);
      updated = results[1];
    } catch (e) {
      await env.BUCKET.delete(key);
      throw e;
    }
    if (!updated.meta.changes) {
      await env.BUCKET.delete(key);
      return fail("Track was changed or deleted; retry artwork", 409);
    }
    if (old?.art_key) {
      try {
        await env.BUCKET.delete(old.art_key);
        await env.DB.prepare("DELETE FROM object_cleanup WHERE object_key=?")
          .bind(old.art_key)
          .run();
      } catch {}
    }
    return response({ ok: true });
  }
  const pref = /^\/api\/tracks\/([\w-]{1,128})\/preferences$/.exec(p);
  if (pref && m === "PATCH") {
    const b = await body();
    if (
      typeof b.favorite !== "boolean" ||
      !Array.isArray(b.tags) ||
      b.tags.length > 30 ||
      !b.tags.every((t: unknown) => typeof t === "string" && t.length <= 40)
    )
      return fail("Invalid favorite or tags");
    await env.DB.prepare(
      "UPDATE tracks SET favorite=?,tags=? WHERE id=? AND deleted_at IS NULL",
    )
      .bind(b.favorite ? 1 : 0, JSON.stringify([...new Set(b.tags)]), pref[1])
      .run();
    return response({ ok: true });
  }
  if (p === "/api/smart-playlists") {
    if (m === "GET")
      return response({
        playlists: (await env.DB.prepare("SELECT * FROM smart_playlists").all())
          .results,
      });
    if (m === "POST") {
      const b = await body();
      const r = b.rules;
      if (
        !text(b.name, 100) ||
        !r ||
        !["all", "favorites", "unplayed", "recent"].includes(r.kind) ||
        typeof r.tag !== "string" ||
        r.tag.length > 40 ||
        !Number.isInteger(r.days) ||
        r.days < 1 ||
        r.days > 3650
      )
        return fail("Invalid smart playlist");
      if (b.restoreKey !== undefined && !idOK(b.restoreKey))
        return fail("Invalid restore key");
      if (b.restoreKey) {
        const old = await env.DB.prepare(
          "SELECT id FROM smart_playlists WHERE restore_key=?",
        )
          .bind(b.restoreKey)
          .first();
        if (old) return response(old);
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO smart_playlists(id,name,rules,restore_key) VALUES(?,?,?,?)",
      )
        .bind(id, text(b.name, 100), JSON.stringify(r), b.restoreKey || null)
        .run();
      return response({ id }, 201);
    }
  }
  if (/^\/api\/smart-playlists\/[\w-]+$/.test(p) && m === "DELETE") {
    await env.DB.prepare("DELETE FROM smart_playlists WHERE id=?")
      .bind(p.split("/").pop())
      .run();
    return response({ ok: true });
  }
  if (p === "/api/player-state") {
    if (m === "GET")
      return response(
        (await env.DB.prepare(
          "SELECT * FROM player_state WHERE id=1",
        ).first()) || { revision: 0, state: "null" },
      );
    if (m === "PUT") {
      const b = await body();
      const s = b.state;
      if (
        !Number.isInteger(b.revision) ||
        !s ||
        !Array.isArray(s.queue) ||
        s.queue.length > 1000 ||
        !s.queue.every(idOK) ||
        !idOK(s.trackId) ||
        !Number.isFinite(s.position) ||
        s.position < 0 ||
        s.position > 86400 ||
        !text(s.device, 80)
      )
        return fail("Invalid playback state");
      await env.DB.prepare(
        "INSERT OR IGNORE INTO player_state VALUES(1,0,'null',?)",
      )
        .bind(new Date().toISOString())
        .run();
      const r = await env.DB.prepare(
        "UPDATE player_state SET revision=revision+1,state=?,updated_at=? WHERE id=1 AND revision=?",
      )
        .bind(
          JSON.stringify({
            queue: s.queue,
            trackId: s.trackId,
            position: s.position,
            device: text(s.device, 80),
          }),
          new Date().toISOString(),
          b.revision,
        )
        .run();
      return r.meta.changes
        ? response({ revision: b.revision + 1 })
        : fail(
            "Playback state changed on another device. Refresh and try again.",
            409,
          );
    }
  }
  if (p === "/api/backup" && m === "GET") {
    const [tracks, playlists, links, history, smart] = await Promise.all(
      [
        "SELECT * FROM tracks WHERE deleted_at IS NULL",
        "SELECT * FROM playlists",
        "SELECT * FROM playlist_tracks",
        "SELECT * FROM history",
        "SELECT * FROM smart_playlists",
      ].map((sql) => env.DB.prepare(sql).all()),
    );
    return response({
      format: "still-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      tracks: tracks.results.map((t: any) => ({
        ...t,
        audio_key: undefined,
        art_key: undefined,
        idempotency_key: undefined,
        hasArt: !!t.art_key,
      })),
      playlists: playlists.results,
      links: links.results,
      history: history.results,
      smart: smart.results,
    });
  }
  return null;
}
