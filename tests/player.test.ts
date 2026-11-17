// @vitest-environment jsdom
import "fake-indexeddb/auto";
import React from "react";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { usePlayer } from "../src/usePlayer";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("../src/model", async () => {
  const mod = await vi.importActual<any>("../src/model");
  return {
    ...mod,
    db: Promise.resolve({
      get: (...args: any[]) => lookup(...args),
      put: async () => {},
      getAll: async () => [],
      delete: async () => {},
      clear: async () => {},
    }),
    api: async () => ({}),
  };
});
let p: ReturnType<typeof usePlayer>;
const note = vi.fn();
const tracks = [
  { id: "one", title: "One", artist: "Me", duration: 120 },
  { id: "two", title: "Two", artist: "Me", duration: 120 },
] as any;
function Test() {
  p = usePlayer(tracks, note);
  return React.createElement(
    "div",
    {},
    React.createElement("audio", p.bindings(0)),
    React.createElement("audio", p.bindings(1)),
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  note.mockClear();
  lookup.mockReset().mockResolvedValue(null);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  Object.defineProperty(HTMLMediaElement.prototype, "duration", {
    get: () => 120,
    configurable: true,
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("fires sleep timer and persists position despite frequent playback updates", async () => {
  const view = render(React.createElement(Test));
  await act(async () => {
    await p.play("one", ["one", "two"]);
    p.setSleepUntil(Date.now() + 2000);
  });
  const audio = view.container.querySelector("audio")!;
  for (let i = 1; i <= 12; i++) {
    await act(async () => {
      audio.currentTime = i * 0.25;
      fireEvent.timeUpdate(audio);
      vi.advanceTimersByTime(250);
    });
  }
  expect(note).toHaveBeenCalledWith("Sleep timer finished");
  expect(JSON.parse(localStorage.getItem("still-player")!).current).toBe("one");
  expect(p.sleepUntil).toBeNull();
});
it("restores a queue paused, preserves position and normalizes duplicate IDs", async () => {
  localStorage.setItem(
    "still-player",
    JSON.stringify({
      queue: ["one", "one", "two"],
      current: "one",
      position: 17,
    }),
  );
  render(React.createElement(Test));
  expect(p.queue).toEqual(["one", "two"]);
  await act(async () => {
    p.restoreQueue(["two", "two", "one"], "two", 51);
  });
  expect(p.queue).toEqual(["two", "one"]);
  expect(p.current).toBe("two");
  expect(p.position).toBe(51);
  expect(p.playing).toBe(false);
});

it("keeps the newer offline source alive when rapid selections resolve out of order", async () => {
  let first!: (v: any) => void, second!: (v: any) => void;
  lookup
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          first = r;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          second = r;
        }),
    );
  const create = vi.fn(() => "blob:current");
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }),
  );
  const view = render(React.createElement(Test));
  let a!: Promise<void>, b!: Promise<void>;
  await act(async () => {
    a = p.play("one");
  });
  await act(async () => {
    b = p.play("two");
  });
  await act(async () => {
    second({ audio: new Blob(["new"]) });
    await b;
  });
  await act(async () => {
    first({ audio: new Blob(["old"]) });
    await a;
  });
  expect(p.current).toBe("two");
  expect(view.container.querySelector("audio")!.getAttribute("src")).toBe(
    "blob:current",
  );
  expect(create).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
});
it("applies tagged attenuation and EQ headroom when the audio graph is first created", async () => {
  const fs: any[] = [],
    gs: any[] = [];
  class Context {
    destination = {};
    createBiquadFilter() {
      const f = {
        gain: { value: 0 },
        frequency: { value: 0 },
        Q: { value: 0 },
        type: "",
        connect: vi.fn(),
      };
      fs.push(f);
      return f;
    }
    createGain() {
      const g = { gain: { value: 1 }, connect: vi.fn() };
      gs.push(g);
      return g;
    }
    createMediaElementSource() {
      return { connect: vi.fn() };
    }
    resume() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", Context);
  localStorage.setItem("still-normalize", "true");
  localStorage.setItem("still-eq", "[6,0,0]");
  tracks[0].replayGain = -6;
  render(React.createElement(Test));
  await act(async () => {
    await p.play("one", ["one", "two"]);
  });
  expect(fs.map((f) => f.gain.value)).toEqual([6, 0, 0]);
  expect(gs[0].gain.value).toBeCloseTo(10 ** (-12 / 20));
  delete tracks[0].replayGain;
  vi.unstubAllGlobals();
});
