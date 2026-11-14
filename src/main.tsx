import { createHistoryQueue } from "./history";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "@fontsource/dm-serif-display/latin-400.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { openDB } from "idb";
import { parseBlob } from "music-metadata";
import {
  Library,
  ListMusic,
  Download,
  Plus,
  Search,
  Upload,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  MoreHorizontal,
  X,
  Music2,
  Check,
  Trash2,
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  WifiOff,
  Smartphone,
  Disc3,
  Clock3,
  Menu,
} from "lucide-react";
import "./style.css";

type Track = {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  [key: string]: any;
};
type Playlist = {
  id: string;
  name: string;
  trackIds?: string[];
  tracks?: Track[];
  [key: string]: any;
};
type Downloaded = { id: string; track: Track; audio: Blob; art?: Blob };
type Job = {
  id: string;
  file: File;
  status: string;
  progress: number;
  error?: string;
};
const db = openDB("still-offline", 1, {
  upgrade(d) {
    d.createObjectStore("downloads", { keyPath: "id" });
    d.createObjectStore("data");
    d.createObjectStore("outbox", { keyPath: "id" });
  },
});
const uid = (): string => crypto.randomUUID();
const fmt = (s?: number) => {
  if (!s || !isFinite(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const api = async (path: string, opts?: RequestInit) => {
  const r = await fetch("/api" + path, opts);
  if (!r.ok) {
    let e: any;
    try {
      e = await r.json();
    } catch {}
    throw new Error(e?.error || `Request failed (${r.status})`);
  }
  if (r.status === 204) return null;
  return r.json() as Promise<any>;
};
const json = (method: string, body?: any): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const historyQueue = createHistoryQueue(
  {
    getAll: async () => (await db).getAll("outbox"),
    put: async (e) => {
      await (await db).put("outbox", e);
    },
    delete: async (id) => {
      await (await db).delete("outbox", id);
    },
    clear: async () => {
      await (await db).clear("outbox");
    },
  },
  (events) => api("/history", json("POST", { events })),
  () => api("/history", { method: "DELETE" }),
);
const ids = (p: Playlist) => p.trackIds || p.tracks?.map((t) => t.id) || [];
function App() {
  const [history, setHistory] = useState<any[]>([]),
    [loadError, setLoadError] = useState("");
  const recorded = useRef(false),
    listened = useRef(0),
    lastTime = useRef(0),
    opener = useRef<HTMLElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]),
    [playlists, setPlaylists] = useState<Playlist[]>([]),
    [downloads, setDownloads] = useState<Downloaded[]>([]),
    [page, setPage] = useState("library"),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [online, setOnline] = useState(navigator.onLine),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState(""),
    [edit, setEdit] = useState<Track | null>(null),
    [name, setName] = useState(""),
    [jobs, setJobs] = useState<Job[]>([]),
    [busy, setBusy] = useState(false),
    [install, setInstall] = useState<any>(null),
    [menu, setMenu] = useState<string | null>(null);
  const [current, setCurrent] = useState<Track | null>(null),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [volume, setVolume] = useState(0.8),
    [shuffle, setShuffle] = useState(false),
    [repeat, setRepeat] = useState(false),
    [queue, setQueue] = useState<Track[]>([]);
  const audio = useRef<HTMLAudioElement>(null),
    fileInput = useRef<HTMLInputElement>(null),
    blobUrl = useRef("");
  const flash = (s: string) => {
    setNotice(s);
    setTimeout(() => setNotice(""), 5000);
  };
  useEffect(() => {
    if (!modal && !edit) return;
    if (!opener.current) opener.current = document.activeElement as HTMLElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modal) setModal("");
        else setEdit(null);
      }
      if (e.key === "Tab") {
        const dialog = document.querySelector("[role=dialog]");
        const items = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) || [],
        );
        if (!items.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => {
      const dialog = document.querySelector("[role=dialog]");
      dialog
        ?.querySelector<HTMLElement>("input, button:not(:disabled)")
        ?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      if (!document.querySelector("[role=dialog]")) {
        opener.current?.focus();
        opener.current = null;
      }
    };
  }, [modal, !!edit]);
  const refreshDownloads = async () =>
    setDownloads(await (await db).getAll("downloads"));
  const refresh = async () => {
    try {
      const [t, p] = await Promise.all([api("/tracks"), api("/playlists")]);
      const ts = t.tracks || [],
        ps = p.playlists || [];
      setTracks(ts);
      setPlaylists(ps);
      setLoadError("");
      const d = await db;
      await d.put("data", ts, "tracks");
      await d.put("data", ps, "playlists");
    } catch {
      if (navigator.onLine)
        setLoadError(
          "Could not reach your library. Check your connection and try again.",
        );
      const d = await db;
      setTracks((await d.get("data", "tracks")) || []);
      setPlaylists((await d.get("data", "playlists")) || []);
    }
    await refreshDownloads();
  };
  const sync = async () => {
    try {
      await historyQueue.sync();
      await refresh();
    } catch {
      await refresh();
    }
  };
  useEffect(() => {
    sync();
    const on = () => {
        setOnline(true);
        sync();
      },
      off = () => setOnline(false),
      before = (e: Event) => {
        e.preventDefault();
        setInstall(e);
      };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", before);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", before);
    };
  }, []);
  const available = useMemo(
    () => (online ? tracks : downloads.map((d) => d.track)),
    [online, tracks, downloads],
  );
  const playlist = playlists.find((p) => p.id === selected);
  const list =
    page === "history"
      ? (history
          .map((h: any) => tracks.find((t) => t.id === h.trackId))
          .filter(Boolean) as Track[])
      : page === "playlist" && playlist
        ? (ids(playlist)
            .map((id) => available.find((t) => t.id === id))
            .filter(Boolean) as Track[])
        : page === "downloads"
          ? downloads.map((d) => d.track)
          : available;
  const filtered = list.filter((t) =>
    `${t.title} ${t.artist || ""} ${t.album || ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const record = async (t: Track) => {
    const event = {
      id: uid(),
      trackId: t.id,
      playedAt: new Date().toISOString(),
    };
    await historyQueue.record(event);
    if (navigator.onLine) sync();
  };
  const playTrack = async (t: Track, source = filtered) => {
    setQueue(source);
    setCurrent(t);
    recorded.current = false;
    listened.current = 0;
    lastTime.current = 0;
    setTime(0);
    const el = audio.current;
    if (!el) return;
    if (blobUrl.current) URL.revokeObjectURL(blobUrl.current);
    const d = downloads.find((x) => x.id === t.id);
    blobUrl.current = d ? URL.createObjectURL(d.audio) : "";
    el.src = blobUrl.current || `/api/tracks/${encodeURIComponent(t.id)}/audio`;
    try {
      await el.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      flash(
        "Could not play this track. Check your connection or download it first.",
      );
    }
  };
  const next = (dir = 1) => {
    if (!queue.length) return;
    const i = queue.findIndex((t) => t.id === current?.id);
    if (dir === 1 && i === queue.length - 1 && !shuffle) {
      setPlaying(false);
      return;
    }
    const n =
      shuffle && queue.length > 1
        ? Math.floor(Math.random() * queue.length)
        : (i + dir + queue.length) % queue.length;
    playTrack(queue[n], queue);
  };
  useEffect(() => {
    if ("mediaSession" in navigator && current) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: current.title,
        artist: current.artist || "Unknown artist",
        album: current.album || "",
      });
      navigator.mediaSession.setActionHandler("play", () =>
        audio.current?.play(),
      );
      navigator.mediaSession.setActionHandler("pause", () =>
        audio.current?.pause(),
      );
      navigator.mediaSession.setActionHandler("nexttrack", () => next());
      navigator.mediaSession.setActionHandler("previoustrack", () => next(-1));
    }
  }, [current, queue, shuffle, downloads]);
  const upload = async (file: File, id: string = uid()) => {
    setJobs((j) => [
      ...j.filter((x) => x.id !== id),
      { id, file, status: "Reading details", progress: 5 },
    ]);
    try {
      if (file.size > 25 * 1024 * 1024)
        throw new Error("File exceeds the 25 MiB limit");
      let meta: any = {},
        format: any = {};
      try {
        const parsed = await parseBlob(file);
        meta = parsed.common;
        format = parsed.format;
      } catch {}
      const form = new FormData();
      form.append("audio", file);
      form.append("title", meta.title || file.name.replace(/\.[^.]+$/, ""));
      if (meta.artist) form.append("artist", meta.artist);
      if (meta.album) form.append("album", meta.album);
      if (format.duration) form.append("duration", String(format.duration));
      if (meta.track?.no) form.append("trackNumber", String(meta.track.no));
      if (meta.picture?.[0])
        form.append(
          "art",
          new Blob([meta.picture[0].data], { type: meta.picture[0].format }),
          "cover",
        );
      form.append("idempotencyKey", id);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/tracks");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable)
            setJobs((j) =>
              j.map((x) =>
                x.id === id
                  ? {
                      ...x,
                      status: "Uploading",
                      progress: Math.round((e.loaded / e.total) * 100),
                    }
                  : x,
              ),
            );
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            let message = "Upload failed";
            try {
              message = JSON.parse(xhr.responseText).error || message;
            } catch {}
            reject(new Error(message));
          }
        };
        xhr.onerror = () => reject(new Error("Connection lost"));
        xhr.send(form);
      });
      setJobs((j) =>
        j.map((x) =>
          x.id === id ? { ...x, status: "Complete", progress: 100 } : x,
        ),
      );
      refresh();
    } catch (e: any) {
      setJobs((j) =>
        j.map((x) =>
          x.id === id ? { ...x, status: "Failed", error: e.message } : x,
        ),
      );
    }
  };
  const download = async (t: Track, quiet = false) => {
    try {
      setBusy(true);
      const [a, c] = await Promise.all([
        fetch(`/api/tracks/${t.id}/audio`),
        fetch(`/api/tracks/${t.id}/art`),
      ]);
      if (
        !a.ok ||
        !a.headers.get("content-type")?.toLowerCase().startsWith("audio/")
      )
        throw Error("Could not download audio. Please sign in and try again.");
      const audioBlob = await a.blob();
      if (!audioBlob.size || (t.size && audioBlob.size !== t.size))
        throw Error("Download was incomplete. Please try again.");
      const item: Downloaded = {
        id: t.id,
        track: t,
        audio: audioBlob,
        art:
          c.ok && c.headers.get("content-type")?.startsWith("image/")
            ? await c.blob()
            : undefined,
      };
      await (await db).put("downloads", item);
      await refreshDownloads();
      if (!quiet) flash("Saved for offline listening");
      return true;
    } catch (e: any) {
      if (!quiet)
        flash(
          e.name === "QuotaExceededError"
            ? "Not enough storage to download this track."
            : e.message || "Download failed",
        );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const savePlaylist = async (p: Playlist, trackIds: string[]) => {
    try {
      await api(`/playlists/${p.id}/tracks`, json("PUT", { trackIds }));
      await refresh();
    } catch (e: any) {
      flash(e.message);
    }
  };
  const removeDownload = async (id: string) => {
    await (await db).delete("downloads", id);
    refreshDownloads();
    flash("Download removed");
  };
  const saveEdit = async () => {
    if (!edit) return;
    try {
      await api(
        `/tracks/${edit.id}`,
        json("PATCH", {
          title: edit.title,
          artist: edit.artist,
          album: edit.album,
          trackNumber: edit.trackNumber,
        }),
      );
      setEdit(null);
      refresh();
    } catch (e: any) {
      flash(e.message);
    }
  };
  const deleteTrack = async () => {
    if (!edit) return;
    try {
      await api(`/tracks/${edit.id}`, { method: "DELETE" });
      await (await db).delete("downloads", edit.id);
      setEdit(null);
      setModal("");
      refresh();
    } catch (e: any) {
      flash(e.message);
    }
  };
  const nav = (p: string) => {
    setPage(p);
    setSelected(null);
    setQuery("");
  };
  const art = (t: Track) => {
    const d = downloads.find((x) => x.id === t.id);
    return <Cover track={t} downloaded={d} online={online} />;
  };
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">
            <img src="/icon.svg" alt="" />
          </div>
          <div>
            <strong>
              still<span>.</span>
            </strong>
            <small>YOUR MUSIC, AT REST</small>
          </div>
        </div>
        <div className="side-label">YOUR SPACE</div>
        <nav>
          <button
            className={page === "library" ? "active" : ""}
            onClick={() => nav("library")}
          >
            <Library /> Library{" "}
            <span>{tracks.length.toString().padStart(2, "0")}</span>
          </button>
          <button
            className={page === "downloads" ? "active" : ""}
            onClick={() => nav("downloads")}
          >
            <Download /> Downloads{" "}
            <span>{downloads.length.toString().padStart(2, "0")}</span>
          </button>
          <button
            className={page === "history" ? "active" : ""}
            onClick={async () => {
              nav("history");
              try {
                const h = await api("/history");
                setHistory(h.events || h.history || []);
              } catch {
                flash("History is unavailable offline");
              }
            }}
          >
            <Clock3 /> History
          </button>
        </nav>
        <div className="side-label playlist-label">
          PLAYLISTS{" "}
          <button
            aria-label="Create playlist"
            onClick={() => {
              setName("");
              setModal("create");
            }}
          >
            <Plus />
          </button>
        </div>
        <div className="side-playlists">
          {playlists.length === 0 ? (
            <p>
              Your playlists will
              <br />
              find a home here.
            </p>
          ) : (
            playlists.map((p) => (
              <button
                className={selected === p.id ? "active" : ""}
                key={p.id}
                onClick={() => {
                  setSelected(p.id);
                  setPage("playlist");
                  setQuery("");
                }}
              >
                <ListMusic />
                {p.name}
              </button>
            ))
          )}
        </div>
        <div className="side-bottom">
          <button onClick={() => setModal("install")}>
            <Smartphone /> Install Still <span>↗</span>
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            YOUR SPACE <span>/</span>{" "}
            <b>
              {page === "playlist"
                ? playlist?.name
                : page === "downloads"
                  ? "Downloads"
                  : page === "history"
                    ? "History"
                    : "Library"}
            </b>
          </div>
          <div className="top-actions">
            <span className={"connection " + (!online ? "offline" : "")}>
              <i />
              {online ? "Online" : "Offline"}
            </span>
            <button
              className="icon-button mobile-menu"
              onClick={() => setModal("nav")}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <button className="avatar" title="Your private library">
              S
            </button>
          </div>
        </header>
        <section className="content">
          {loadError && (
            <div className="load-error" role="alert">
              {loadError} <button onClick={refresh}>Try again</button>
            </div>
          )}
          <div className="hero">
            <div>
              <h1>
                {page === "downloads"
                  ? "Downloads"
                  : page === "history"
                    ? "Listening history"
                    : page === "playlist"
                      ? playlist?.name
                      : "Your library"}
                <em>.</em>
              </h1>
              <p>
                {page === "downloads"
                  ? "Your music, ready whenever you are."
                  : page === "playlist"
                    ? "A collection made by you."
                    : "A quieter way to keep your music close."}
              </p>
            </div>
            <div className="hero-actions">
              {page === "history" ? (
                <button
                  className="secondary"
                  onClick={() => setModal("clearHistory")}
                >
                  Clear history
                </button>
              ) : page === "playlist" ? (
                <>
                  <button
                    className="secondary"
                    onClick={() => {
                      setName(playlist?.name || "");
                      setModal("rename");
                    }}
                  >
                    Edit playlist
                  </button>
                  <button
                    className="primary"
                    disabled={!filtered.length}
                    onClick={() => playTrack(filtered[0], filtered)}
                  >
                    <Play fill="currentColor" /> Play playlist
                  </button>
                </>
              ) : (
                <button
                  className="primary"
                  onClick={() => fileInput.current?.click()}
                >
                  <Plus /> Add music
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => {
              Array.from(e.target.files || []).forEach((f) => upload(f));
              e.currentTarget.value = "";
            }}
          />
          {jobs.length > 0 && (
            <div className="jobs">
              <div className="section-title">
                UPLOADS{" "}
                <button
                  onClick={() =>
                    setJobs((j) => j.filter((x) => x.status !== "Complete"))
                  }
                >
                  Clear completed
                </button>
              </div>
              {jobs.map((j) => (
                <div className="job" key={j.id}>
                  <Music2 />
                  <div>
                    <b>{j.file.name}</b>
                    <small>{j.error || j.status}</small>
                    <progress value={j.progress} max="100" />
                  </div>
                  {j.status === "Failed" && (
                    <button onClick={() => upload(j.file, j.id)}>Retry</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="library-head">
            <div>
              <div className="section-title">
                {page === "playlist"
                  ? "TRACKS IN THIS PLAYLIST"
                  : page === "downloads"
                    ? "SAVED OFFLINE"
                    : "ALL TRACKS"}{" "}
                <span>{filtered.length.toString().padStart(2, "0")}</span>
              </div>
              <p>
                {page === "downloads"
                  ? "Saved on this device for listening without a connection"
                  : page === "playlist"
                    ? "A little something for every moment"
                    : "Everything in its right place"}
              </p>
            </div>
            <div className="library-tools">
              <label className="search">
                <Search />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your music"
                  aria-label="Search your music"
                />
              </label>
              {page === "playlist" && (
                <button className="secondary" onClick={() => setModal("add")}>
                  <Plus /> Add tracks
                </button>
              )}
            </div>
          </div>
          {filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-art">
                <div className="record">
                  <div />
                </div>
                <span className="spark one">✳</span>
                <span className="spark two">✦</span>
              </div>
              <h2>
                {query
                  ? "No tracks found"
                  : page === "history"
                    ? "Nothing played yet"
                    : page === "downloads"
                      ? "Take your music with you"
                      : page === "playlist"
                        ? "A playlist with possibility"
                        : "A little quiet in here"}
              </h2>
              <p>
                {query
                  ? "Try a different search."
                  : page === "history"
                    ? "Tracks you listen to will appear here."
                    : page === "downloads"
                      ? "Download a track or playlist to listen offline, wherever you are."
                      : page === "playlist"
                        ? "Add a few tracks and make it your own."
                        : "Every good collection starts somewhere. Add your music and make this space your own."}
              </p>
              {!query && (
                <button
                  className="text-button"
                  onClick={() =>
                    page === "playlist"
                      ? setModal("add")
                      : page === "downloads"
                        ? nav("library")
                        : fileInput.current?.click()
                  }
                >
                  {page === "playlist"
                    ? "Add tracks"
                    : page === "downloads"
                      ? "Browse your library"
                      : "Add your first tracks"}{" "}
                  <span>→</span>
                </button>
              )}
            </div>
          ) : (
            <div className="track-list">
              <div className="table-head">
                <span>#</span>
                <span>TITLE</span>
                <span>ALBUM</span>
                <span>TIME</span>
                <span />
              </div>
              {filtered.map((t, i) => (
                <div className="track-row" key={`${t.id}-${i}`}>
                  <button
                    className="row-number"
                    onClick={() => playTrack(t, filtered)}
                    aria-label={`Play ${t.title}`}
                  >
                    {current?.id === t.id && playing
                      ? "♫"
                      : String(i + 1).padStart(2, "0")}
                  </button>
                  <button
                    className="track-info"
                    onClick={() => playTrack(t, filtered)}
                  >
                    {art(t)}
                    <span>
                      <b>{t.title}</b>
                      <small>
                        {t.artist || "Unknown artist"}{" "}
                        {downloads.some((d) => d.id === t.id) && (
                          <span
                            aria-label="Downloaded on this device"
                            title="Downloaded on this device"
                          >
                            ↓
                          </span>
                        )}
                      </small>
                    </span>
                  </button>
                  <span className="album">{t.album || "—"}</span>
                  <span className="track-time">{fmt(t.duration)}</span>
                  <div className="row-actions">
                    {page === "playlist" && (
                      <>
                        <button
                          aria-label="Move up"
                          disabled={!!query || i === 0}
                          onClick={() => {
                            const a = ids(playlist!);
                            const n = a.indexOf(t.id);
                            if (n < 1) return;
                            [a[n - 1], a[n]] = [a[n], a[n - 1]];
                            savePlaylist(playlist!, a);
                          }}
                        >
                          <ChevronUp />
                        </button>
                        <button
                          aria-label="Move down"
                          disabled={!!query || i === filtered.length - 1}
                          onClick={() => {
                            const a = ids(playlist!);
                            const n = a.indexOf(t.id);
                            if (n < 0 || n >= a.length - 1) return;
                            [a[n + 1], a[n]] = [a[n], a[n + 1]];
                            savePlaylist(playlist!, a);
                          }}
                        >
                          <ChevronDown />
                        </button>
                      </>
                    )}
                    <button
                      aria-label={`Options for ${t.title}`}
                      onClick={() => setMenu(menu === t.id ? null : t.id)}
                    >
                      <MoreHorizontal />
                    </button>
                    {menu === t.id && (
                      <div className="dropdown">
                        <button
                          onClick={() => {
                            setEdit({ ...t });
                            setMenu(null);
                          }}
                        >
                          Edit details
                        </button>
                        <button
                          disabled={busy || !online}
                          onClick={() => {
                            download(t);
                            setMenu(null);
                          }}
                        >
                          {downloads.some((d) => d.id === t.id)
                            ? "Download again"
                            : "Download"}
                        </button>
                        {downloads.some((d) => d.id === t.id) && (
                          <button
                            onClick={() => {
                              removeDownload(t.id);
                              setMenu(null);
                            }}
                          >
                            Remove download
                          </button>
                        )}
                        {page === "playlist" && (
                          <button
                            onClick={() => {
                              savePlaylist(
                                playlist!,
                                ids(playlist!).filter((id) => id !== t.id),
                              );
                              setMenu(null);
                            }}
                          >
                            Remove from playlist
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
      <div className="player">
        <div className="now">
          {current ? (
            art(current)
          ) : (
            <div className="cover placeholder">
              <Music2 />
            </div>
          )}
          <div>
            <b>{current?.title || "Nothing playing yet"}</b>
            <small>{current?.artist || "Your next favorite awaits"}</small>
          </div>
        </div>
        <div className="player-center">
          <div className="controls">
            <button
              className={shuffle ? "on" : ""}
              onClick={() => setShuffle(!shuffle)}
              aria-label="Shuffle"
              aria-pressed={shuffle}
            >
              <Shuffle />
            </button>
            <button onClick={() => next(-1)} aria-label="Previous track">
              <SkipBack fill="currentColor" />
            </button>
            <button
              className="play-button"
              aria-label={playing ? "Pause" : "Play"}
              onClick={() => {
                if (!current && filtered.length) playTrack(filtered[0]);
                else if (playing) audio.current?.pause();
                else audio.current?.play();
              }}
            >
              {playing ? (
                <Pause fill="currentColor" />
              ) : (
                <Play fill="currentColor" />
              )}
            </button>
            <button onClick={() => next()} aria-label="Next track">
              <SkipForward fill="currentColor" />
            </button>
            <button
              className={repeat ? "on" : ""}
              onClick={() => setRepeat(!repeat)}
              aria-label="Repeat track"
              aria-pressed={repeat}
            >
              <Repeat />
            </button>
          </div>
          <div className="seek">
            <span>{fmt(time)}</span>
            <input
              aria-label="Playback position"
              type="range"
              min="0"
              max={duration || 1}
              value={Math.min(time, duration || 1)}
              onChange={(e) => {
                if (audio.current) audio.current.currentTime = +e.target.value;
                setTime(+e.target.value);
              }}
            />
            <span>{fmt(duration)}</span>
          </div>
        </div>
        <div className="player-right">
          <Volume2 />
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => {
              setVolume(+e.target.value);
              if (audio.current) audio.current.volume = +e.target.value;
            }}
          />
        </div>
        <audio
          ref={audio}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            const v = e.currentTarget.currentTime;
            const delta = v - lastTime.current;
            if (delta > 0 && delta < 1.5) listened.current += delta;
            lastTime.current = v;
            setTime(v);
            if (
              current &&
              !recorded.current &&
              listened.current >=
                Math.min(10, (e.currentTarget.duration || 20) / 2)
            ) {
              recorded.current = true;
              record(current);
            }
          }}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            e.currentTarget.volume = volume;
          }}
          onError={() => {
            setPlaying(false);
            flash(
              "Could not play this track. Check your connection or download it first.",
            );
          }}
          onEnded={() => (repeat ? audio.current?.play() : next())}
        />
      </div>
      <div className="mobile-nav">
        <button onClick={() => nav("library")}>
          <Library />
          Library
        </button>
        <button onClick={() => setModal("nav")}>
          <ListMusic />
          Playlists
        </button>
        <button onClick={() => nav("downloads")}>
          <Download />
          Downloads
        </button>
      </div>
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {modal && (
        <div className="overlay" onMouseDown={() => setModal("")}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              (
                {
                  nav: "Navigation",
                  create: "Create playlist",
                  rename: "Edit playlist",
                  add: "Add tracks",
                  install: "Install Still",
                  clearHistory: "Clear listening history",
                  deletePlaylist: "Delete playlist",
                  deleteTrack: "Delete track",
                } as Record<string, string>
              )[modal] || "Music library dialog"
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setModal("")}
              aria-label="Close"
            >
              <X />
            </button>
            {modal === "nav" ? (
              <>
                <h2>Your space</h2>
                <button
                  className="modal-row"
                  onClick={() => {
                    nav("library");
                    setModal("");
                  }}
                >
                  Library
                </button>
                <button
                  className="modal-row"
                  onClick={() => {
                    nav("downloads");
                    setModal("");
                  }}
                >
                  Downloads
                </button>
                <button
                  className="modal-row"
                  onClick={async () => {
                    nav("history");
                    setModal("");
                    try {
                      const h = await api("/history");
                      setHistory(h.events || []);
                    } catch {
                      flash("History is unavailable offline");
                    }
                  }}
                >
                  History
                </button>
                <button
                  className="modal-row"
                  onClick={() => setModal("install")}
                >
                  Install Still
                </button>
                <h3>Playlists</h3>
                {playlists.map((p) => (
                  <button
                    className="modal-row"
                    key={p.id}
                    onClick={() => {
                      setSelected(p.id);
                      setPage("playlist");
                      setModal("");
                    }}
                  >
                    {p.name}
                  </button>
                ))}
                <button
                  className="secondary"
                  onClick={() => {
                    setName("");
                    setModal("create");
                  }}
                >
                  <Plus /> New playlist
                </button>
              </>
            ) : modal === "create" || modal === "rename" ? (
              <>
                <h2>
                  {modal === "create" ? "Make a playlist" : "Edit playlist"}
                </h2>
                <p>Give this collection a name that feels right.</p>
                <label className="field">
                  Playlist name
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Slow mornings"
                  />
                </label>
                <button
                  className="primary"
                  disabled={!name.trim()}
                  onClick={async () => {
                    try {
                      if (modal === "create")
                        await api(
                          "/playlists",
                          json("POST", { name: name.trim() }),
                        );
                      else
                        await api(
                          `/playlists/${playlist?.id}`,
                          json("PATCH", { name: name.trim() }),
                        );
                      setModal("");
                      refresh();
                    } catch (e: any) {
                      flash(e.message);
                    }
                  }}
                >
                  Save playlist
                </button>
                {modal === "rename" && (
                  <button
                    className="danger-link"
                    onClick={() => setModal("deletePlaylist")}
                  >
                    Delete playlist
                  </button>
                )}
                {modal === "rename" && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      if (playlist) {
                        let failed = 0,
                          saved = 0;
                        for (const id of ids(playlist)) {
                          const t = tracks.find((x) => x.id === id);
                          if (t && !downloads.some((d) => d.id === id)) {
                            if (await download(t, true)) saved++;
                            else failed++;
                          }
                        }
                        flash(
                          failed
                            ? `${saved} saved, ${failed} failed. Check your connection and storage.`
                            : `${saved} tracks saved for offline listening.`,
                        );
                      }
                    }}
                  >
                    Download playlist ↓
                  </button>
                )}
              </>
            ) : modal === "deletePlaylist" ? (
              <>
                <h2>Delete this playlist?</h2>
                <p>Your tracks will stay in your library.</p>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await api(`/playlists/${playlist?.id}`, {
                        method: "DELETE",
                      });
                      setModal("");
                      nav("library");
                      refresh();
                    } catch (e: any) {
                      flash(e.message);
                    }
                  }}
                >
                  Delete playlist
                </button>
              </>
            ) : modal === "add" ? (
              <>
                <h2>Add tracks</h2>
                <p>Choose songs for {playlist?.name}.</p>
                <div className="pick-list">
                  {tracks.map((t) => (
                    <button
                      key={t.id}
                      aria-pressed={ids(playlist!).includes(t.id)}
                      onClick={() => {
                        const a = ids(playlist!);
                        savePlaylist(
                          playlist!,
                          a.includes(t.id)
                            ? a.filter((x) => x !== t.id)
                            : [...a, t.id],
                        );
                      }}
                    >
                      {art(t)}
                      <span>
                        {t.title}
                        <small>{t.artist || "Unknown artist"}</small>
                      </span>
                      {ids(playlist!).includes(t.id) ? <Check /> : <Plus />}
                    </button>
                  ))}
                  {!tracks.length && <p>Add music to your library first.</p>}
                </div>
              </>
            ) : modal === "install" ? (
              <>
                <h2>Make yourself at home.</h2>
                <p>
                  Install Still for quick access and a more focused listening
                  experience.
                </p>
                {install ? (
                  <button
                    className="primary"
                    onClick={async () => {
                      await install.prompt();
                      setInstall(null);
                      setModal("");
                    }}
                  >
                    Install Still
                  </button>
                ) : (
                  <p>
                    On iPhone or iPad, open the Share menu in Safari and choose
                    “Add to Home Screen”. On Android, open your browser menu and
                    choose “Install app” or “Add to Home screen”. On desktop,
                    look for the install icon in your browser’s address bar.
                  </p>
                )}
              </>
            ) : modal === "clearHistory" ? (
              <>
                <h2>Clear listening history?</h2>
                <p>
                  This removes your listening history, including any plays
                  waiting to sync.
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await historyQueue.clear();
                      setHistory([]);
                      setModal("");
                      flash("History cleared");
                    } catch (e: any) {
                      flash(e.message);
                    }
                  }}
                >
                  Clear history
                </button>
              </>
            ) : modal === "deleteTrack" ? (
              <>
                <h2>Delete this track?</h2>
                <p>
                  “{edit?.title}” will be removed from your library and
                  playlists. This cannot be undone.
                </p>
                <button className="primary" onClick={deleteTrack}>
                  Delete track
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
      {edit && !modal && (
        <div className="overlay" onMouseDown={() => setEdit(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit track"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setEdit(null)}
              aria-label="Close"
            >
              <X />
            </button>
            <h2>Edit track</h2>
            {(["title", "artist", "album", "trackNumber"] as const).map((k) => (
              <label className="field" key={k}>
                {k}
                <input
                  value={edit[k] || ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      [k]:
                        k === "trackNumber"
                          ? Number(e.target.value)
                          : e.target.value,
                    })
                  }
                />
              </label>
            ))}
            <button className="primary" onClick={saveEdit}>
              Save changes
            </button>
            <button
              className="danger-link"
              onClick={() => setModal("deleteTrack")}
            >
              Delete track
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
function Cover({
  track,
  downloaded,
  online,
}: {
  track: Track;
  downloaded?: Downloaded;
  online: boolean;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (downloaded?.art) {
      const u = URL.createObjectURL(downloaded.art);
      setUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setUrl(online ? `/api/tracks/${track.id}/art` : "");
  }, [track.id, downloaded, online]);
  return (
    <div className="cover">
      {url && !failed ? (
        <img src={url} onError={() => setFailed(true)} alt="" />
      ) : (
        <Music2 />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
