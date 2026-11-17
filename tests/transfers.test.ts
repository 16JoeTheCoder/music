import "fake-indexeddb/auto";
import { it, expect, vi, afterEach } from "vitest";
import { webcrypto } from "node:crypto";
import { downloadTrack, uploadFile } from "../src/transfers";
import { db, type Track } from "../src/model";
vi.mock("music-metadata", () => ({
  parseBlob: async () => ({ common: {}, format: { duration: 7200 } }),
}));
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v),
});
afterEach(() => vi.unstubAllGlobals());
const track = {
  id: "offline-test",
  size: 8 * 1024 ** 2 + 3,
  mime: "audio/mpeg",
  title: "Test",
  hasArt: false,
} as Track;
it("retains a completed part after interrupted offline download and resumes without exposing partial audio", async () => {
  const d = await db;
  await d.clear("downloads");
  await d.clear("data");
  let fail = true;
  const ranges: string[] = [];
  vi.stubGlobal("fetch", async (_url: any, init: any) => {
    const range = init.headers.Range;
    ranges.push(range);
    if (fail && ranges.length === 2) throw Error("network");
    const size = range.startsWith("bytes=0-") ? 8 * 1024 ** 2 : 3;
    return new Response(new Uint8Array(size), {
      status: 206,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Range": range.replace("=", " ") + `/${track.size}`,
      },
    });
  });
  await expect(
    downloadTrack(track, new AbortController().signal, () => {}),
  ).rejects.toThrow("network");
  expect(await d.get("downloads", track.id)).toBeUndefined();
  fail = false;
  await downloadTrack(track, new AbortController().signal, () => {});
  expect(ranges).toEqual([
    "bytes=0-8388607",
    "bytes=8388608-8388610",
    "bytes=8388608-8388610",
  ]);
  expect((await d.get("downloads", track.id)).audio.size).toBe(track.size);
  expect(await d.get("data", "partial:" + track.id)).toBeUndefined();
});
it("does not store an Access login page as downloaded audio", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("<html>login</html>", {
        headers: { "Content-Type": "text/html" },
      }),
  );
  await expect(
    downloadTrack(
      { ...track, id: "login-page" },
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow("sign-in");
  expect(await (await db).get("downloads", "login-page")).toBeUndefined();
});
it("distinguishes equal-size/name files by content and distinct restore identities by source ID", async () => {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => memory.get(k) || null,
    setItem: (k: string, v: string) => memory.set(k, v),
  });
  memory.clear();
  const ids: string[] = [];
  vi.stubGlobal("fetch", async (_url: any, opts: any) => {
    const b = JSON.parse(opts.body);
    ids.push(b.id);
    return Response.json({ track_id: b.id });
  });
  const options = {
    title: "Restored",
    artist: "A",
    album: "",
    duration: 1,
    trackNumber: null,
    replayGain: null,
  };
  const f = new File(["ID3a"], "same.mp3", { lastModified: 1 }),
    other = new File(["ID3b"], "same.mp3", { lastModified: 1 });
  const a = await uploadFile(
      f,
      new AbortController().signal,
      () => {},
      options,
    ),
    b = await uploadFile(
      other,
      new AbortController().signal,
      () => {},
      options,
    );
  expect(a).not.toBe(b);
  const c = await uploadFile(f, new AbortController().signal, () => {}, {
      ...options,
      restoreIdentity: "source1",
    }),
    e = await uploadFile(f, new AbortController().signal, () => {}, {
      ...options,
      restoreIdentity: "source2",
    });
  expect(c).not.toBe(e);
  expect(
    await uploadFile(f, new AbortController().signal, () => {}, {
      ...options,
      restoreIdentity: "source1",
    }),
  ).toBe(c);
});
