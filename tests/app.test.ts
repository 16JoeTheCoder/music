// @vitest-environment jsdom
import "fake-indexeddb/auto";
import React from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { App } from "../src/main";
const track = {
  id: "track-a",
  title: "My compilation",
  artist: "My artist",
  album: "Album",
  duration: 7200,
  trackNumber: 1,
  mime: "audio/mpeg",
  size: 1024,
  hasArt: false,
  createdAt: "2026-11-17",
  favorite: false,
  tags: ["coding"],
  replayGain: null,
};
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: any, init: any) => {
    const p = String(url);
    if (p.endsWith("/tracks")) return Response.json({ tracks: [track] });
    if (p.endsWith("/playlists")) return Response.json({ playlists: [] });
    if (p.endsWith("/smart-playlists")) return Response.json({ playlists: [] });
    if (p.endsWith("/history")) return Response.json({ events: [] });
    return Response.json({});
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("finds music, adds it to the persistent queue and switches light/code appearance", async () => {
  render(React.createElement(App));
  await screen.findByText("My compilation");
  fireEvent.change(screen.getByLabelText("Search music"), {
    target: { value: "missing" },
  });
  expect(screen.getByText("No matches")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search music"), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByLabelText("Options for My compilation"));
  fireEvent.click(screen.getByText("Add to queue"));
  fireEvent.click(screen.getAllByRole("button", { name: /Queue/ })[0]);
  expect(screen.getByRole("heading", { name: "Up next" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Toggle light and dark theme"));
  await waitFor(() =>
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("#101419"),
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]);
  expect(screen.getByRole("heading", { name: "Appearance" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Still Light" }));
  await waitFor(() =>
    expect(
      document.documentElement.style.getPropertyValue("--background"),
    ).toBe("#f7f6f0"),
  );
});
