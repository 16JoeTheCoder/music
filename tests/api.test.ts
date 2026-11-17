import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
import { build } from "esbuild";
import schema2 from "../migrations/0002_still_plus.sql?raw";
import schema from "../migrations/0001_initial.sql?raw";
import { parseRange, sniffAudio } from "../server/index";

describe("audio validation", () => {
  it("recognizes supported signatures and rejects arbitrary bytes", () => {
    expect(sniffAudio(new TextEncoder().encode("ID3\u0004\0\0"))).toBe(
      "audio/mpeg",
    );
    expect(sniffAudio(new TextEncoder().encode("fLaC"))).toBe("audio/flac");
    expect(sniffAudio(new TextEncoder().encode("not audio"))).toBeNull();
  });
  it("handles bounded, open and suffix ranges and rejects invalid ones", () => {
    expect(parseRange("bytes=2-4", 10)).toEqual({ offset: 2, length: 3 });
    expect(parseRange("bytes=8-", 10)).toEqual({ offset: 8, length: 2 });
    expect(parseRange("bytes=-3", 10)).toEqual({ offset: 7, length: 3 });
    expect(parseRange("bytes=10-", 10)).toBeNull();
    expect(parseRange("bytes=0-1,3-4", 10)).toBeNull();
  });
});

describe("worker with D1 and R2", () => {
  let mf: Miniflare;
  const origin = "http://localhost";
  const call = (path: string, init: RequestInit = {}) =>
    mf.dispatchFetch(origin + path, init as any);
  const mutation = (
    method: string,
    body?: BodyInit,
    contentType?: string,
  ): RequestInit => ({
    method,
    body,
    headers: {
      Origin: origin,
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
  });
  let id: string;
  beforeAll(async () => {
    const bundle = await build({
      entryPoints: ["server/index.ts"],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2022",
    });
    mf = new Miniflare({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2025-03-01",
      d1Databases: ["DB"],
      r2Buckets: ["BUCKET"],
      bindings: {
        DEV_AUTH_BYPASS: "true",
        ACCESS_ISSUER: "",
        ACCESS_AUDIENCE: "",
        ALLOWED_EMAIL: "",
      },
    });
    const db = await mf.getD1Database("DB");
    await db.exec(schema);
    await db.exec(schema2);
  });
  afterAll(async () => {
    await mf?.dispose();
  });
  it("fails closed outside localhost and rejects cross-origin mutations", async () => {
    expect(
      (await mf.dispatchFetch("https://music.example/api/tracks")).status,
    ).toBe(401);
    expect(
      (
        await call("/api/history", {
          method: "DELETE",
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
  });
  it("uploads once for an idempotency key and streams exact byte ranges", async () => {
    const upload = () => {
      const form = new FormData();
      form.set(
        "audio",
        new File([new TextEncoder().encode("ID3abcdefghijk")], "track.mp3"),
      );
      form.set("title", "Test");
      form.set("artist", "Artist");
      form.set("duration", "12");
      form.set("idempotencyKey", "upload-1");
      return form;
    };
    const send = async () => {
      const req = new Request(
        origin + "/api/tracks",
        mutation("POST", upload()),
      );
      return call("/api/tracks", {
        method: "POST",
        headers: Object.fromEntries(req.headers),
        body: await req.arrayBuffer(),
      });
    };
    const first = await send();
    expect(first.status).toBe(201);
    id = ((await first.json()) as any).track.id;
    const second = await send();
    expect(((await second.json()) as any).track.id).toBe(id);
    const partial = await call(`/api/tracks/${id}/audio`, {
      headers: { Range: "bytes=-4" },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("Content-Range")).toBe("bytes 10-13/14");
    expect(await partial.text()).toBe("hijk");
    const bad = await call(`/api/tracks/${id}/audio`, {
      headers: { Range: "bytes=100-" },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("Content-Range")).toBe("bytes */14");
  });
  it("persists playlist order, deduplicates history, and removes deleted tracks", async () => {
    const created = await call(
      "/api/playlists",
      mutation(
        "POST",
        JSON.stringify({ name: "Favorites" }),
        "application/json",
      ),
    );
    const playlist = ((await created.json()) as any).playlist;
    expect(
      (
        await call(
          `/api/playlists/${playlist.id}/tracks`,
          mutation(
            "PUT",
            JSON.stringify({ trackIds: [id] }),
            "application/json",
          ),
        )
      ).status,
    ).toBe(200);
    const event = {
      id: "event-1",
      trackId: id,
      playedAt: "2026-01-01T00:00:00.000Z",
    };
    for (let i = 0; i < 2; i++)
      expect(
        (
          await call(
            "/api/history",
            mutation(
              "POST",
              JSON.stringify({ events: [event] }),
              "application/json",
            ),
          )
        ).status,
      ).toBe(200);
    expect(
      ((await (await call("/api/history")).json()) as any).events,
    ).toHaveLength(1);
    expect((await call(`/api/tracks/${id}`, mutation("DELETE"))).status).toBe(
      200,
    );
    expect((await call(`/api/tracks/${id}/audio`)).status).toBe(404);
    expect(
      ((await (await call("/api/playlists")).json()) as any).playlists[0]
        .trackIds,
    ).toEqual([]);
  });
  it("rejects invalid uploads and malformed metadata", async () => {
    const form = new FormData();
    form.set("audio", new File(["not audio"], "fake.mp3"));
    form.set("title", "Bad");
    const req = new Request(origin + "/api/tracks", mutation("POST", form));
    expect(
      (
        await call("/api/tracks", {
          method: "POST",
          headers: Object.fromEntries(req.headers),
          body: await req.arrayBuffer(),
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await call(
          "/api/playlists",
          mutation("POST", JSON.stringify({ name: "" }), "application/json"),
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("/api/history", mutation("POST", "{bad", "application/json")))
        .status,
    ).toBe(400);
  });
  it("orders a large playlist, renames it, syncs and clears a large history batch", async () => {
    const db = await mf.getD1Database("DB");
    const ids = Array.from({ length: 65 }, (_, i) => `bulk-${i}`);
    await db.batch(
      ids.map((id, i) =>
        db
          .prepare(
            "INSERT INTO tracks (id,title,artist,album,duration,mime,size,audio_key,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            id,
            `Track ${i}`,
            "Artist",
            "",
            1,
            "audio/mpeg",
            1,
            `audio/${id}`,
            "2026-01-01T00:00:00Z",
          ),
      ),
    );
    const created = await call(
      "/api/playlists",
      mutation("POST", JSON.stringify({ name: "Large" }), "application/json"),
    );
    const playlist = ((await created.json()) as any).playlist;
    const reversed = [...ids].reverse();
    expect(
      (
        await call(
          `/api/playlists/${playlist.id}/tracks`,
          mutation(
            "PUT",
            JSON.stringify({ trackIds: reversed }),
            "application/json",
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/playlists/${playlist.id}`,
          mutation(
            "PATCH",
            JSON.stringify({ name: "Renamed" }),
            "application/json",
          ),
        )
      ).status,
    ).toBe(200);
    const playlists = ((await (await call("/api/playlists")).json()) as any)
      .playlists;
    const actual = playlists.find((p: any) => p.id === playlist.id);
    expect(actual.name).toBe("Renamed");
    expect(actual.trackIds).toEqual(reversed);
    const events = ids.map((trackId, i) => ({
      id: `bulk-event-${i}`,
      trackId,
      playedAt: "2026-01-01T00:00:00Z",
    }));
    events.push({
      id: "stale",
      trackId: "missing",
      playedAt: "2026-01-01T00:00:00Z",
    });
    expect(
      (
        await call(
          "/api/history",
          mutation("POST", JSON.stringify({ events }), "application/json"),
        )
      ).status,
    ).toBe(200);
    expect(
      ((await (await call("/api/history")).json()) as any).events,
    ).toHaveLength(65);
    expect((await call("/api/history", mutation("DELETE"))).status).toBe(200);
    expect(
      ((await (await call("/api/history")).json()) as any).events,
    ).toHaveLength(0);
  });
});
