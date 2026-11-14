import "fake-indexeddb/auto";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { createHistoryQueue, type HistoryEvent } from "../src/history";

async function setup() {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange });
  const db = await openDB("history-test", 1, {
    upgrade(d) {
      d.createObjectStore("outbox", { keyPath: "id" });
    },
  });
  const store = {
    getAll: () => db.getAll("outbox"),
    put: (e: HistoryEvent) => db.put("outbox", e),
    delete: (id: string) => db.delete("outbox", id),
    clear: () => db.clear("outbox"),
  };
  return { db, store };
}
const event = (i: number): HistoryEvent => ({
  id: `event-${String(i).padStart(4, "0")}`,
  trackId: "track-1",
  playedAt: "2026-01-01T00:00:00.000Z",
});

describe("durable offline history", () => {
  it("persists offline events, retries failures, and batches more than 500 without duplication", async () => {
    const { db, store } = await setup();
    const remote = new Map<string, HistoryEvent>();
    let fail = true;
    const sizes: number[] = [];
    const queue = createHistoryQueue(
      store,
      async (events) => {
        sizes.push(events.length);
        if (fail) throw Error("offline");
        for (const e of events) remote.set(e.id, e);
      },
      async () => {
        remote.clear();
      },
    );
    for (let i = 0; i < 501; i++) await queue.record(event(i));
    await expect(queue.sync()).rejects.toThrow("offline");
    expect(await store.getAll()).toHaveLength(501);
    fail = false;
    await queue.sync();
    await queue.sync();
    expect(sizes).toEqual([500, 500, 1]);
    expect(remote.size).toBe(501);
    expect(await store.getAll()).toHaveLength(0);
    db.close();
  });
  it("waits for an in-flight sync before clearing and preserves later plays", async () => {
    const { db, store } = await setup();
    const remote = new Map<string, HistoryEvent>();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = createHistoryQueue(
      store,
      async (events) => {
        await blocked;
        for (const e of events) remote.set(e.id, e);
      },
      async () => {
        remote.clear();
      },
    );
    await queue.record(event(1));
    const sync = queue.sync();
    const clear = queue.clear();
    const record = queue.record(event(2));
    release();
    await Promise.all([sync, clear, record]);
    expect(remote.size).toBe(0);
    expect((await store.getAll()).map((e) => e.id)).toEqual([event(2).id]);
    db.close();
  });
  it("retains local queued events when remote clear fails", async () => {
    const { db, store } = await setup();
    const queue = createHistoryQueue(
      store,
      async () => {},
      async () => {
        throw Error("offline");
      },
    );
    await queue.record(event(1));
    await expect(queue.clear()).rejects.toThrow("offline");
    expect(await store.getAll()).toHaveLength(1);
    db.close();
  });
});
