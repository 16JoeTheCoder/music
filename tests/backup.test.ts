import { it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";
const state = vi.hoisted(() => ({
  local: new Map<string, string>(),
  tracks: [] as any[],
  calls: [] as any[],
  fail: false,
}));
vi.mock("../src/model", () => ({
  readLocal: (k: string, f: any) =>
    JSON.parse(state.local.get(k) || "null") || f,
  writeLocal: (k: string, v: any) => state.local.set(k, JSON.stringify(v)),
  extension: () => "mp3",
  api: async (p: string, m = "GET", b: any) => {
    state.calls.push([p, m, b]);
    if (p === "/tracks") return { tracks: state.tracks };
    if (p.includes("preferences") && state.fail) {
      state.fail = false;
      throw Error("interrupted");
    }
    if (p === "/playlists") return { playlist: { id: "restored-playlist" } };
    return {};
  },
}));
import { restoreBackup, validateBackup } from "../src/backup";
Object.defineProperty(globalThis, "crypto", {
  value: webcrypto,
  configurable: true,
});
const track = (id: string) => ({
  id,
  title: id,
  artist: "Me",
  album: "Album",
  size: 4,
  duration: 2,
  mime: "audio/mpeg",
  tags: '["coding"]',
  favorite: 1,
  track_number: 1,
});
const backup = () => ({
  format: "still-backup",
  version: 1,
  tracks: [track("old-one"), track("old-two")],
  playlists: [{ id: "p".repeat(100), name: "Mix" }],
  links: [
    { playlist_id: "p".repeat(100), track_id: "old-one", position: 0 },
    { playlist_id: "p".repeat(100), track_id: "old-two", position: 1 },
  ],
  history: [],
  smart: [],
  queue: { ids: ["old-one", "old-two"], current: "old-two", position: 1 },
});
beforeEach(() => {
  state.local.clear();
  state.tracks = [];
  state.calls = [];
  state.fail = false;
});
it("validates all backup references before writing", async () => {
  const b = backup();
  b.links[0].track_id = "missing";
  expect(() => validateBackup(b)).toThrow();
  await expect(restoreBackup(b, [], [], async () => "new")).rejects.toThrow();
  expect(state.calls.length).toBe(0);
});
it("retries a partial restore without duplicating uploaded tracks and uses distinct source identities", async () => {
  const b = backup(),
    files = [
      new File(["ID3x"], "old-one.mp3"),
      new File(["ID3x"], "old-two.mp3"),
    ];
  const identities: string[] = [];
  const upload = vi.fn(async (_f: File, metadata: any) => {
    identities.push(metadata.restoreIdentity);
    const id = "new-" + identities.length;
    state.tracks.push({ id });
    return id;
  });
  state.fail = true;
  await expect(restoreBackup(b, files, [], upload)).rejects.toThrow(
    "interrupted",
  );
  const restored = await restoreBackup(b, files, [], upload);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(identities[0]).not.toBe(identities[1]);
  expect(restored.queue).toEqual(["new-1", "new-2"]);
  expect(restored.current).toBe("new-2");
  expect(restored.position).toBe(1);
  const create = state.calls.find((c) => c[0] === "/playlists");
  expect(create[2].restoreKey).toHaveLength(64);
  await restoreBackup(b, files, [], upload);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(
    state.calls
      .filter((c) => c[0] === "/playlists")
      .every((c) => c[2].restoreKey === create[2].restoreKey),
  ).toBe(true);
});
