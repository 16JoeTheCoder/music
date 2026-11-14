import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const origin = "https://music.example";
const shell = ["/", "/manifest.webmanifest", "/assets/app.js"];
async function harness(
  options: {
    rejectPath?: string;
    redirectedPath?: string;
    htmlPath?: string;
  } = {},
) {
  const source = (await readFile("public/sw.js", "utf8"))
    .replace("__BUILD_CACHE__", "still-shell-test")
    .replace(/\/\*__SHELL__\*\/\s*\[\]/, JSON.stringify(shell));
  const listeners: Record<string, (event: any) => void> = {};
  const stored = new Map<string, Response>();
  const calls: string[] = [];
  let offline = false;
  const key = (value: string | { url: string }) =>
    typeof value === "string" ? value : new URL(value.url).pathname;
  const cache = {
    put: async (path: string, response: Response) => {
      stored.set(path, response);
    },
    match: async (path: string) => stored.get(path),
  };
  const caches = {
    open: async () => cache,
    match: async (path: string) => stored.get(path),
    keys: async () => ["still-shell-test"],
    delete: async () => true,
  };
  class WorkerRequest {
    url: string;
    constructor(path: string) {
      this.url = new URL(path, origin).href;
    }
  }
  const fetcher = async (request: { url: string }) => {
    const path = key(request);
    calls.push(path);
    if (offline || path === options.rejectPath) throw Error("network failure");
    const response = new Response(
      path === options.htmlPath ? "<html>login</html>" : `shell:${path}`,
      {
        headers: {
          "Content-Type":
            path === options.htmlPath ? "text/html" : "text/plain",
        },
      },
    );
    Object.defineProperty(response, "url", { value: origin + path });
    Object.defineProperty(response, "redirected", {
      value: path === options.redirectedPath,
    });
    return response;
  };
  vm.runInNewContext(source, {
    self: {
      location: { origin },
      clients: { claim: async () => {} },
      addEventListener: (name: string, fn: (event: any) => void) => {
        listeners[name] = fn;
      },
    },
    caches,
    fetch: fetcher,
    Request: WorkerRequest,
    Response,
    URL,
    Error,
  });
  return {
    stored,
    calls,
    setOffline: () => {
      offline = true;
    },
    install: async () => {
      let pending!: Promise<void>;
      listeners.install({
        waitUntil: (p: Promise<void>) => {
          pending = p;
        },
      });
      await pending;
    },
    dispatch: (path: string, mode = "cors", method = "GET") => {
      let pending: Promise<Response> | undefined;
      listeners.fetch({
        request: { url: origin + path, mode, method },
        respondWith: (p: Promise<Response>) => {
          pending = p;
        },
      });
      return pending;
    },
  };
}
describe("offline shell service worker", () => {
  it("caches only declared shell assets and serves the shell for offline navigation", async () => {
    const h = await harness();
    await h.install();
    expect([...h.stored.keys()]).toEqual(shell);
    h.setOffline();
    expect(await (await h.dispatch("/playlist", "navigate"))!.text()).toBe(
      "shell:/",
    );
    expect(await (await h.dispatch("/assets/app.js"))!.text()).toBe(
      "shell:/assets/app.js",
    );
    expect(h.dispatch("/api/tracks")).toBeUndefined();
    expect(h.dispatch("/cdn-cgi/access/login")).toBeUndefined();
    expect(h.dispatch("/private-data")).toBeUndefined();
    expect(h.dispatch("/api/tracks", "cors", "POST")).toBeUndefined();
    expect([...h.stored.keys()]).toEqual(shell);
  });
  it("rejects redirected authentication responses and HTML returned for JS assets", async () => {
    await expect(
      (await harness({ redirectedPath: "/" })).install(),
    ).rejects.toThrow();
    await expect(
      (await harness({ htmlPath: "/assets/app.js" })).install(),
    ).rejects.toThrow();
    await expect(
      (await harness({ rejectPath: "/" })).install(),
    ).rejects.toThrow();
  });
});
