export type HistoryEvent = { id: string; trackId: string; playedAt: string };
export type HistoryStore = {
  getAll(): Promise<HistoryEvent[]>;
  put(event: HistoryEvent): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  clear(): Promise<unknown>;
};

/** Serializes history operations so an older upload cannot undo a clear. */
export function createHistoryQueue(
  store: HistoryStore,
  send: (events: HistoryEvent[]) => Promise<unknown>,
  clearRemote: () => Promise<unknown>,
) {
  let pending: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation, operation);
    pending = result.catch(() => {});
    return result;
  }
  return {
    record(event: HistoryEvent) {
      return serial(async () => {
        await store.put(event);
      });
    },
    sync() {
      return serial(async () => {
        const events = await store.getAll();
        for (let offset = 0; offset < events.length; offset += 500) {
          const batch = events.slice(offset, offset + 500);
          await send(batch);
          for (const event of batch) await store.delete(event.id);
        }
      });
    },
    clear() {
      return serial(async () => {
        await clearRemote();
        await store.clear();
      });
    },
  };
}
