import { beforeAll, afterAll, it, expect } from "vitest";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import schema1 from "../migrations/0001_initial.sql?raw";
import schema2 from "../migrations/0002_still_plus.sql?raw";
let mf: Miniflare;
const origin = "http://localhost";
const call = (path: string, method = "GET", body?: any) =>
  mf.dispatchFetch(origin + "/api" + path, {
    method,
    headers: {
      Origin: origin,
      ...(body && !(body instanceof Uint8Array)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof Uint8Array
        ? body
        : body
          ? JSON.stringify(body)
          : undefined,
  } as any);
const json = async (path: string, method = "GET", body?: any) => {
  const r = await call(path, method, body);
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  return r.json() as Promise<any>;
};
beforeAll(async () => {
  const b = await build({
    entryPoints: ["server/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  mf = new Miniflare({
    modules: true,
    script: b.outputFiles[0].text,
    compatibilityDate: "2025-03-01",
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    bindings: { DEV_AUTH_BYPASS: "true" },
  });
  const d = await mf.getD1Database("DB");
  await d.exec(schema1);
  await d.exec(schema2);
});
afterAll(() => mf.dispose());
it("resumes multipart audio, validates parts, finalizes idempotently and streams across the part boundary", async () => {
  const data = new Uint8Array(8 * 1024 ** 2);
  data.set(new TextEncoder().encode("ID3"));
  data[data.length - 1] = 42;
  const tail = new Uint8Array([11, 12, 13]);
  const meta = {
    id: "multipart-track",
    title: "Long compilation",
    artist: "Me",
    size: data.length + tail.length,
    duration: 7200,
  };
  const initial = await json("/uploads", "POST", meta);
  expect((await json("/uploads", "POST", meta)).upload_id).toBe(
    initial.upload_id,
  );
  expect((await call("/uploads/multipart-track/complete", "POST")).status).toBe(
    400,
  );
  expect(
    (await call("/uploads/multipart-track/parts/1", "PUT", new Uint8Array([1])))
      .status,
  ).toBe(400);
  await json("/uploads/multipart-track/parts/1", "PUT", data);
  const resumed = await json("/uploads/multipart-track");
  expect(Object.keys(JSON.parse(resumed.parts))).toEqual(["1"]);
  await json("/uploads/multipart-track/parts/2", "PUT", tail);
  expect((await json("/uploads/multipart-track/complete", "POST")).id).toBe(
    meta.id,
  );
  expect((await json("/uploads/multipart-track/complete", "POST")).id).toBe(
    meta.id,
  );
  const r = await mf.dispatchFetch(
    origin + "/api/tracks/" + meta.id + "/audio",
    { headers: { Range: `bytes=${data.length - 1}-${data.length + 2}` } },
  );
  expect(r.status).toBe(206);
  expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([42, 11, 12, 13]);
  // Completed upload session deletion must not delete its audio; IDs cannot hijack tracks.
  await json("/uploads/multipart-track", "DELETE");
  expect((await call("/uploads", "POST", meta)).status).toBe(409);
});
it("rejects arbitrary data and all unauthenticated multipart/control/backup routes", async () => {
  await json("/uploads", "POST", { id: "bad-audio", title: "Bad", size: 3 });
  expect(
    (await call("/uploads/bad-audio/parts/1", "PUT", new Uint8Array([1, 2, 3])))
      .status,
  ).toBe(415);
  for (const path of [
    "/uploads",
    "/uploads/x/complete",
    "/tracks/x/preferences",
    "/player-state",
    "/backup",
    "/smart-playlists",
  ])
    expect(
      (
        await mf.dispatchFetch("https://music.example/api" + path, {
          method: "POST",
        })
      ).status,
    ).toBe(401);
});
it("round trips preferences and backup and restores playlist creation idempotently", async () => {
  await json("/tracks/multipart-track/preferences", "PATCH", {
    favorite: true,
    tags: ["focus", "coding"],
  });
  const t = (await json("/tracks")).tracks.find(
    (t: any) => t.id === "multipart-track",
  );
  expect(t.favorite).toBe(true);
  expect(t.tags).toEqual(["focus", "coding"]);
  const p = await json("/playlists", "POST", {
    name: "Restored",
    restoreKey: "backup-playlist",
  });
  expect(
    (
      await json("/playlists", "POST", {
        name: "Restored",
        restoreKey: "backup-playlist",
      })
    ).playlist.id,
  ).toBe(p.playlist.id);
  await json("/smart-playlists", "POST", {
    name: "Focus favorites",
    rules: { kind: "favorites", tag: "focus", days: 30 },
    restoreKey: "smart-restored",
  });
  await json("/smart-playlists", "POST", {
    name: "Focus favorites",
    rules: { kind: "favorites", tag: "focus", days: 30 },
    restoreKey: "smart-restored",
  });
  expect((await json("/smart-playlists")).playlists.length).toBe(1);
  const b = await json("/backup");
  expect(b.format).toBe("still-backup");
  expect(b.tracks[0].audio_key).toBeUndefined();
  expect(b.tracks[0].favorite).toBe(1);
});
it("uses optimistic revisions for explicit device handoff", async () => {
  const a = await json("/player-state");
  const state = {
    trackId: "multipart-track",
    queue: ["multipart-track"],
    position: 3600,
    device: "Phone",
  };
  const b = await json("/player-state", "PUT", { revision: a.revision, state });
  expect(b.revision).toBe(1);
  expect(
    (await call("/player-state", "PUT", { revision: 0, state })).status,
  ).toBe(409);
  expect(JSON.parse((await json("/player-state")).state)).toEqual(state);
});
it("replaces artwork without retaining superseded objects and deletes the current artwork with a track", async () => {
  const d = await mf.getD1Database("DB"),
    bucket = await mf.getR2Bucket("BUCKET");
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await json("/tracks/multipart-track/art", "PUT", bytes);
  const first = await d
    .prepare("SELECT art_key FROM tracks WHERE id=?")
    .bind("multipart-track")
    .first<any>();
  await json("/tracks/multipart-track/art", "PUT", bytes);
  const second = await d
    .prepare("SELECT art_key FROM tracks WHERE id=?")
    .bind("multipart-track")
    .first<any>();
  expect(first.art_key).not.toBe(second.art_key);
  expect(await bucket.get(first.art_key)).toBeNull();
  expect(await bucket.get(second.art_key)).not.toBeNull();
  await json("/tracks/multipart-track", "DELETE");
  await expect.poll(async () => await bucket.get(second.art_key)).toBeNull();
});
