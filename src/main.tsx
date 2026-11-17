import "@fontsource/dm-serif-display/latin-400.css";
import { restoreBackup, validateBackup } from "./backup";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-700.css";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Heart,
  Download,
  Upload,
  Search,
  Settings,
  Library,
  ListMusic,
  Plus,
  X,
  ChevronUp,
  ChevronDown,
  Trash2,
  MoreHorizontal,
  Music2,
  Check,
  Monitor,
  Sun,
  Moon,
  ArrowRight,
  Clock,
  Cloud,
  Headphones,
} from "lucide-react";
import {
  api,
  db,
  formatTime,
  saveFile,
  saveJSON,
  readLocal,
  writeLocal,
  extension,
  type Track,
  type Playlist,
} from "./model";
import {
  light,
  code,
  validateTheme,
  applyTheme,
  schema,
  guide,
  type Theme,
} from "./themes";
import { uploadFile, downloadTrack, type Transfer } from "./transfers";
import { usePlayer, history } from "./usePlayer";
import "./style.css";
const builtins = [light, code];
function Dialog({
  title,
  children,
  close,
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    const first = ref.current?.querySelector<HTMLElement>(
      "input,button,select",
    );
    first?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const items = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select,textarea,a[href]",
          ) || [],
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (
          index < 0 ||
          (e.shiftKey && index === 0) ||
          (!e.shiftKey && index === items.length - 1)
        ) {
          e.preventDefault();
          (e.shiftKey ? items.at(-1) : items[0])?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      opener?.focus();
    };
  }, []);
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="section-heading">
          <h2>{title}</h2>
          <button aria-label="Close dialog" onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Cover({ track }: { track?: Track }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true,
      url = "";
    if (!track) {
      setSrc("");
      return;
    }
    db.then((d) => d.get("downloads", track.id)).then((item) => {
      if (!active) return;
      if (item?.art) {
        url = URL.createObjectURL(item.art);
        setSrc(url);
      } else setSrc(track.hasArt ? `/api/tracks/${track.id}/art` : "");
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [track?.id, track?.hasArt]);
  return (
    <span className="cover">
      {src ? <img alt="" src={src} onError={() => setSrc("")} /> : <Music2 />}
    </span>
  );
}
export function App() {
  const [tracks, setTracks] = useState<Track[]>([]),
    [playlists, setPlaylists] = useState<Playlist[]>([]),
    [smart, setSmart] = useState<any[]>([]),
    [events, setEvents] = useState<any[]>([]),
    [downloads, setDownloads] = useState<string[]>([]),
    [page, setPage] = useState("library"),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("newest"),
    [online, setOnline] = useState(navigator.onLine),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [dialog, setDialog] = useState(""),
    [edit, setEdit] = useState<Track | null>(null),
    [name, setName] = useState(""),
    [jobs, setJobs] = useState<Transfer[]>([]),
    [pending, setPending] = useState(false),
    [installed, setInstalled] = useState<any>(null),
    [remote, setRemote] = useState<any>(null),
    [device, setDevice] = useState(
      readLocal(
        "still-device",
        "My " + (/Android/i.test(navigator.userAgent) ? "phone" : "computer"),
      ),
    ),
    [backup, setBackup] = useState<any>(null),
    [restoreFiles, setRestoreFiles] = useState<File[]>([]),
    [rule, setRule] = useState({ kind: "favorites", tag: "", days: 30 });
  const [custom, setCustom] = useState<Theme[]>(() =>
      readLocal<any[]>("still-themes", []).flatMap((t) => {
        try {
          return [validateTheme(t)];
        } catch {
          return [];
        }
      }),
    ),
    [themeId, setThemeId] = useState(readLocal("still-theme", "still-light")),
    [preview, setPreview] = useState<Theme | null>(null),
    [systemDark, setSystemDark] = useState(
      matchMedia("(prefers-color-scheme: dark)").matches,
    );
  const [storage, setStorage] = useState(""),
    [playlistPick, setPlaylistPick] = useState(""),
    [tagsInput, setTagsInput] = useState("");
  const input = useRef<HTMLInputElement>(null),
    themeInput = useRef<HTMLInputElement>(null);
  const controllers = useRef(new Map<string, AbortController>()),
    files = useRef(new Map<string, File>());
  const notify = (s: string) => {
    setNotice(s);
  };
  const player = usePlayer(tracks, notify);
  const run = async (fn: () => Promise<void>) => {
    setPending(true);
    try {
      await fn();
    } catch (e: any) {
      notify(
        e.name === "QuotaExceededError"
          ? "Storage is full. Remove downloads and retry."
          : e.message || "Operation failed",
      );
    } finally {
      setPending(false);
    }
  };
  const refresh = async () => {
    const d = await db;
    setDownloads((await d.getAllKeys("downloads")).map(String));
    try {
      const [t, p, s, h] = await Promise.all([
        api("/tracks"),
        api("/playlists"),
        api("/smart-playlists"),
        api("/history"),
      ]);
      setTracks(t.tracks);
      setPlaylists(p.playlists);
      setSmart(s.playlists);
      setEvents(h.events);
      setError("");
      await d.put(
        "data",
        {
          tracks: t.tracks,
          playlists: p.playlists,
          smart: s.playlists,
          events: h.events,
        },
        "snapshot",
      );
    } catch (e: any) {
      const snapshot = await d.get("data", "snapshot");
      if (snapshot) {
        setTracks(snapshot.tracks);
        setPlaylists(snapshot.playlists);
        setSmart(snapshot.smart);
        setEvents(snapshot.events);
      } else {
        setTracks((await d.get("data", "tracks")) || []);
        setPlaylists((await d.get("data", "playlists")) || []);
      }
      if (navigator.onLine)
        setError(e.message + " — showing any saved library.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    refresh();
    history.sync().catch(() => {});
    const on = () => {
        setOnline(true);
        history
          .sync()
          .catch(() => {})
          .finally(refresh);
      },
      off = () => setOnline(false),
      install = (e: Event) => {
        e.preventDefault();
        setInstalled(e);
      };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", install);
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() =>
          notify(
            "Offline shell could not update. Reopen Still online and authenticated.",
          ),
        );
    navigator.storage
      ?.estimate()
      .then((e) =>
        setStorage(
          `${((e.usage || 0) / 1024 ** 3).toFixed(2)} GB used / ${((e.quota || 0) / 1024 ** 3).toFixed(1)} GB available quota`,
        ),
      );
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", install);
    };
  }, []);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)"),
      fn = () => setSystemDark(media.matches);
    media.addEventListener("change", fn);
    return () => media.removeEventListener("change", fn);
  }, []);
  const themes = [...builtins, ...custom],
    activeTheme =
      preview ||
      (themeId === "system"
        ? systemDark
          ? code
          : light
        : themes.find((t) => t.id === themeId) || light);
  useEffect(() => {
    applyTheme(activeTheme);
  }, [activeTheme]);
  useEffect(() => {
    writeLocal("still-theme", themeId);
    writeLocal("still-themes", custom);
  }, [themeId, custom]);
  const changePage = (p: string, id = "") => {
    setPage(p);
    setSelected(id);
    setQuery("");
  };
  const playlist = playlists.find((p) => p.id === selected);
  const smartPlaylist = smart.find((p) => p.id === selected);
  let list = tracks;
  if (page === "favorites") list = list.filter((t) => t.favorite);
  if (page === "downloads") list = list.filter((t) => downloads.includes(t.id));
  if (page === "playlist")
    list = (playlist?.trackIds || [])
      .map((id) => tracks.find((t) => t.id === id))
      .filter(Boolean) as Track[];
  if (page === "album")
    list = list.filter((t) => `${t.artist}\u0000${t.album}` === selected);
  if (page === "artist") list = list.filter((t) => t.artist === selected);
  if (page === "history")
    list = events
      .map((h) => tracks.find((t) => t.id === h.trackId))
      .filter(Boolean) as Track[];
  if (page === "smart" && smartPlaylist) {
    const r = JSON.parse(smartPlaylist.rules);
    list = list.filter(
      (t) =>
        (r.kind !== "favorites" || t.favorite) &&
        (r.kind !== "unplayed" || !events.some((h) => h.trackId === t.id)) &&
        (r.kind !== "recent" ||
          Date.parse(t.createdAt) >= Date.now() - r.days * 86400000) &&
        (!r.tag || t.tags.includes(r.tag)),
    );
  }
  list = list.filter((t) =>
    `${t.title} ${t.artist} ${t.album} ${t.tags.join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (page === "album")
    list = [...list].sort(
      (a, b) => (a.trackNumber || 9999) - (b.trackNumber || 9999),
    );
  if (!["playlist", "history", "queue", "album"].includes(page))
    list = [...list].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "artist"
          ? a.artist.localeCompare(b.artist)
          : sort === "duration"
            ? b.duration - a.duration
            : Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
  const title =
    page === "playlist"
      ? playlist?.name
      : page === "smart"
        ? smartPlaylist?.name
        : page === "album"
          ? selected.split("\u0000")[1] || "Unknown album"
          : page === "artist"
            ? selected
            : (
                {
                  library: "Your library",
                  favorites: "Favorites",
                  downloads: "Downloads",
                  history: "Listening history",
                  albums: "Albums",
                  artists: "Artists",
                  queue: "Up next",
                  settings: "Settings",
                } as Record<string, string>
              )[page] || "Library";
  const patchFavorite = async (t: Track) => {
    await api(`/tracks/${t.id}/preferences`, "PATCH", {
      favorite: !t.favorite,
      tags: t.tags,
    });
    await refresh();
  };
  const updateJob = (id: string, progress: number, status: string) =>
    setJobs((js) =>
      js.map((j) =>
        j.id === id ? { ...j, progress, status, error: undefined } : j,
      ),
    );
  const startUpload = async (
    file: File,
    id: string = crypto.randomUUID(),
    details?: any,
  ) => {
    files.current.set(id, file);
    const controller = new AbortController();
    controllers.current.set(id, controller);
    setJobs((js) => [
      ...js.filter((j) => j.id !== id),
      { id, name: file.name, kind: "upload", progress: 0, status: "Preparing" },
    ]);
    try {
      const trackId = await uploadFile(
        file,
        controller.signal,
        (p, s) => updateJob(id, p, s),
        details,
      );
      await refresh();
      return trackId;
    } catch (e: any) {
      setJobs((js) =>
        js.map((j) =>
          j.id === id
            ? {
                ...j,
                status: e.name === "AbortError" ? "Paused" : "Failed",
                error: e.message,
              }
            : j,
        ),
      );
      throw e;
    } finally {
      controllers.current.delete(id);
    }
  };
  const startDownload = async (t: Track) => {
    const id = "download:" + t.id;
    if (controllers.current.has(id)) return;
    const c = new AbortController();
    controllers.current.set(id, c);
    setJobs((js) => [
      ...js.filter((j) => j.id !== id),
      { id, name: t.title, kind: "download", progress: 0, status: "Preparing" },
    ]);
    try {
      await downloadTrack(t, c.signal, (p, s) => updateJob(id, p, s));
      await refresh();
    } catch (e: any) {
      setJobs((js) =>
        js.map((j) =>
          j.id === id
            ? {
                ...j,
                status: e.name === "AbortError" ? "Paused" : "Failed",
                error: e.message,
              }
            : j,
        ),
      );
      throw e;
    } finally {
      controllers.current.delete(id);
    }
  };
  const downloadList = () =>
    run(async () => {
      let failures = 0;
      for (const t of list.filter((t) => !downloads.includes(t.id)))
        try {
          await startDownload(t);
        } catch {
          failures++;
        }
      notify(
        failures
          ? `${failures} downloads need retry. Other tracks were saved.`
          : "All selected tracks are saved on this device.",
      );
    });
  const removeDownload = async (t: Track) => {
    const d = await db;
    await d.delete("downloads", t.id);
    await d.delete("data", "partial:" + t.id);
    await refresh();
  };
  const reorder = (array: string[], index: number, delta: number) => {
    const result = [...array];
    [result[index], result[index + delta]] = [
      result[index + delta],
      result[index],
    ];
    return result;
  };
  const addQueue = (id: string, next = false) => {
    const q = player.queue.filter((existing) => existing !== id);
    if (next) {
      const i = q.indexOf(player.current || "");
      q.splice(i + 1, 0, id);
    } else q.push(id);
    player.setQueue(q);
    notify(next ? "Added to play next" : "Added to queue");
  };
  const getRemote = async () => {
    const r = await api("/player-state");
    setRemote({ ...r, parsed: JSON.parse(r.state) });
    return r;
  };
  const publish = () =>
    run(async () => {
      if (!player.current) throw Error("Choose a track first");
      const r = await api("/player-state");
      await api("/player-state", "PUT", {
        revision: r.revision,
        state: {
          queue: player.queue,
          trackId: player.current,
          position: player.position,
          device,
        },
      });
      await getRemote();
      notify("Playback position is ready for your other device.");
    });
  const exportContext = () => {
    const content =
      guide +
      "\n## JSON Schema\n```json\n" +
      JSON.stringify(schema, null, 2) +
      "\n```\n## Still Light example\n```json\n" +
      JSON.stringify(light, null, 2) +
      "\n```\n## Still Code example\n```json\n" +
      JSON.stringify(code, null, 2) +
      "\n```\n";
    saveFile(
      "STILL_THEME_CONTEXT.md",
      new Blob([content], { type: "text/markdown" }),
    );
    notify("Self-contained theme authoring context exported.");
  };
  const getBackup = async () => {
    const b = await api("/backup");
    b.themes = { custom, selected: themeId };
    b.queue = {
      ids: player.queue,
      current: player.current,
      position: player.position,
    };
    return b;
  };
  const exportDirectory = () =>
    run(async () => {
      if (!("showDirectoryPicker" in window))
        throw Error(
          "Folder export needs a supporting desktop browser. Use metadata export and original-file links below.",
        );
      const dir = await (window as any).showDirectoryPicker({
        mode: "readwrite",
      });
      const b = await getBackup();
      for (const t of tracks) {
        const r = await fetch(`/api/tracks/${t.id}/audio`);
        if (
          !r.ok ||
          !r.body ||
          !r.headers.get("content-type")?.startsWith("audio/")
        )
          throw Error("Sign in again before exporting");
        const handle = await dir.getFileHandle(`${t.id}.${extension(t.mime)}`, {
          create: true,
        });
        await r.body.pipeTo(await handle.createWritable());
        if (t.hasArt) {
          const art = await fetch(`/api/tracks/${t.id}/art`);
          if (
            !art.ok ||
            !art.body ||
            !art.headers.get("content-type")?.startsWith("image/")
          )
            throw Error("Artwork export failed; authenticate and retry");
          if (art.ok && art.body) {
            const handle = await dir.getFileHandle(`${t.id}.cover`, {
              create: true,
            });
            await art.body.pipeTo(await handle.createWritable());
          }
        }
        notify(`Exported ${t.title}`);
      }
      const handle = await dir.getFileHandle("still-backup.json", {
          create: true,
        }),
        writer = await handle.createWritable();
      await writer.write(JSON.stringify(b, null, 2));
      await writer.close();
      notify("Backup folder saved. Keep its manifest and media together.");
    });
  const restore = () =>
    run(async () => {
      const result = await restoreBackup(
        backup,
        restoreFiles,
        tracks,
        (file, details) => startUpload(file, undefined, details),
      );
      setCustom(result.custom);
      setThemeId(result.themeId);
      await refresh();
      player.restoreQueue(result.queue, result.current, result.position);
      setDialog("");
      notify(
        "Restore complete. Audio and metadata were restored; playback is paused.",
      );
    });
  const pageNav = [
    ["library", "Library", Library],
    ["albums", "Albums", Music2],
    ["artists", "Artists", Headphones],
    ["favorites", "Favorites", Heart],
    ["downloads", "Downloads", Download],
    ["history", "History", Clock],
    ["queue", "Queue", ListMusic],
    ["settings", "Settings", Settings],
  ] as const;
  const row = (t: Track, index: number, queue = false) => (
    <div
      className="track-row"
      key={
        queue
          ? `${t.id}:${index}`
          : page === "history"
            ? `${t.id}:${index}`
            : t.id
      }
    >
      <button
        className="track-play"
        onClick={() =>
          player.play(t.id, queue ? player.queue : list.map((t) => t.id))
        }
        aria-label={`Play ${t.title}`}
      >
        <Cover track={t} />
      </button>
      <button
        className="track-name"
        onClick={() =>
          player.play(t.id, queue ? player.queue : list.map((t) => t.id))
        }
      >
        <strong>{t.title}</strong>
        <span>
          {t.artist} {t.album && `· ${t.album}`}
        </span>
        {downloads.includes(t.id) && (
          <small>
            <Download size={12} /> On this device
          </small>
        )}
      </button>
      <span className="time">{formatTime(t.duration)}</span>
      <button
        onClick={() => run(() => patchFavorite(t))}
        aria-label={`${t.favorite ? "Unfavorite" : "Favorite"} ${t.title}`}
        aria-pressed={t.favorite}
      >
        <Heart fill={t.favorite ? "currentColor" : "none"} />
      </button>
      {(queue || page === "playlist") && (
        <div className="reorder">
          <button
            aria-label={`Move ${t.title} up`}
            disabled={index === 0 || !!query}
            onClick={() =>
              queue
                ? player.setQueue(reorder(player.queue, index, -1))
                : run(async () => {
                    await api(`/playlists/${selected}/tracks`, "PUT", {
                      trackIds: reorder(playlist!.trackIds, index, -1),
                    });
                    await refresh();
                  })
            }
          >
            <ChevronUp />
          </button>
          <button
            aria-label={`Move ${t.title} down`}
            disabled={
              index === (queue ? player.queue.length : list.length) - 1 ||
              !!query
            }
            onClick={() =>
              queue
                ? player.setQueue(reorder(player.queue, index, 1))
                : run(async () => {
                    await api(`/playlists/${selected}/tracks`, "PUT", {
                      trackIds: reorder(playlist!.trackIds, index, 1),
                    });
                    await refresh();
                  })
            }
          >
            <ChevronDown />
          </button>
        </div>
      )}
      <button
        aria-label={`Options for ${t.title}`}
        onClick={() => {
          setEdit(t);
          setTagsInput(t.tags.join(", "));
          setDialog(queue ? "queue-track" : "track");
        }}
      >
        <MoreHorizontal />
      </button>
    </div>
  );
  return (
    <div className="app">
      <aside>
        <button className="brand" onClick={() => changePage("library")}>
          <img src="/icon-192.png" alt="" />
          still<span>Personal music</span>
        </button>
        <nav aria-label="Main navigation">
          {pageNav.map(([id, label, Icon]) => (
            <button
              key={id}
              aria-current={page === id ? "page" : undefined}
              className={page === id ? "active" : ""}
              onClick={() => changePage(id)}
            >
              <Icon />
              {label}
              {id === "queue" && <small>{player.queue.length}</small>}
            </button>
          ))}
        </nav>
        <div className="section-heading">
          <h2>Playlists</h2>
          <button
            aria-label="Create playlist"
            onClick={() => {
              setName("");
              setDialog("new-playlist");
            }}
          >
            <Plus />
          </button>
        </div>
        {playlists.map((p) => (
          <button
            className={"nav-playlist " + (selected === p.id ? "active" : "")}
            key={p.id}
            onClick={() => changePage("playlist", p.id)}
          >
            <ListMusic />
            {p.name}
          </button>
        ))}
        {smart.map((p) => (
          <button
            className={"nav-playlist " + (selected === p.id ? "active" : "")}
            key={p.id}
            onClick={() => changePage("smart", p.id)}
          >
            <Shuffle />
            {p.name}
          </button>
        ))}
        <button
          className="text-action"
          onClick={() => {
            setName("");
            setDialog("smart");
          }}
        >
          + Smart playlist
        </button>
      </aside>
      <main>
        <header>
          <span className="connection">
            {online ? "Online" : "Offline · device copies only"}
          </span>
          <div className="header-actions">
            <button
              aria-label="Toggle light and dark theme"
              onClick={() => {
                setPreview(null);
                setThemeId(
                  activeTheme.mode === "dark" ? "still-light" : "still-code",
                );
              }}
            >
              {activeTheme.mode === "dark" ? <Sun /> : <Moon />}
            </button>
            <button
              className="primary"
              disabled={!online}
              onClick={() => input.current?.click()}
            >
              <Upload />
              Add music
            </button>
          </div>
        </header>
        <input
          hidden
          ref={input}
          type="file"
          accept="audio/*"
          multiple
          onChange={(e) => {
            const fs = Array.from(e.target.files || []);
            e.currentTarget.value = "";
            run(async () => {
              for (const f of fs)
                try {
                  await startUpload(f);
                } catch {
                  notify(
                    "Some uploads need retry. Reselect the same file to resume.",
                  );
                }
            });
          }}
        />
        <div className="content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              <p>
                {page === "downloads"
                  ? "Saved only on this device. Browser storage can be cleared or evicted."
                  : page === "queue"
                    ? `${player.queue.length} tracks · playback stays with you`
                    : page === "settings"
                      ? "Make Still feel like yours."
                      : `${list.length} tracks · your private collection`}
              </p>
            </div>
            {["playlist", "smart"].includes(page) && (
              <button
                onClick={() => {
                  setName(title || "");
                  setDialog(
                    page === "playlist" ? "edit-playlist" : "delete-smart",
                  );
                }}
              >
                {page === "playlist"
                  ? "Edit playlist"
                  : "Delete smart playlist"}
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error} <button onClick={refresh}>Retry</button>
            </div>
          )}
          {!online && (
            <p className="hint">
              Uploads and library changes need an authenticated connection.
              Previously downloaded audio stays available locally.
            </p>
          )}
          {jobs.length > 0 && (
            <section className="transfers">
              <div className="section-heading">
                <h2>Transfers</h2>
                <button
                  onClick={() =>
                    setJobs((js) => js.filter((j) => j.status !== "Complete"))
                  }
                >
                  Clear completed
                </button>
              </div>
              {jobs.map((j) => (
                <div className="transfer" key={j.id}>
                  <div>
                    <strong>{j.name}</strong>
                    <span>
                      {j.kind} · {j.status} · {j.progress}%
                    </span>
                    {j.error && <small role="alert">{j.error}</small>}
                    <progress
                      max={100}
                      value={j.progress}
                      aria-label={`${j.kind} ${j.name}`}
                    />
                  </div>
                  {controllers.current.has(j.id) ? (
                    <button
                      onClick={() => controllers.current.get(j.id)?.abort()}
                    >
                      Pause
                    </button>
                  ) : (
                    j.status !== "Complete" && (
                      <button
                        onClick={() =>
                          run(async () => {
                            if (j.kind === "upload") {
                              const f = files.current.get(j.id);
                              if (f) await startUpload(f, j.id);
                              else input.current?.click();
                            } else {
                              const t = tracks.find(
                                (t) => j.id === "download:" + t.id,
                              );
                              if (t) await startDownload(t);
                            }
                          })
                        }
                      >
                        Retry
                      </button>
                    )
                  )}
                </div>
              ))}
            </section>
          )}
          {loading ? (
            <p role="status">Opening your library…</p>
          ) : page === "settings" ? (
            <div className="settings-grid">
              <section>
                <h2>Appearance</h2>
                <p>
                  Choose a built-in look or import your own theme. Changes are
                  saved on this device.
                </p>
                <div className="theme-grid">
                  {[
                    { id: "system", name: "System", mode: "system" },
                    ...themes,
                  ].map((t) => (
                    <button
                      className={
                        "theme-option " + (themeId === t.id ? "selected" : "")
                      }
                      key={t.id}
                      onClick={() => {
                        setThemeId(t.id);
                        setPreview(null);
                      }}
                    >
                      {t.mode === "dark" ? (
                        <Moon />
                      ) : t.mode === "light" ? (
                        <Sun />
                      ) : (
                        <Monitor />
                      )}
                      <strong>{t.name}</strong>
                      {themeId === t.id && <Check />}
                    </button>
                  ))}
                </div>
                <div className="actions">
                  <button onClick={() => themeInput.current?.click()}>
                    Import theme
                  </button>
                  <button
                    onClick={() =>
                      saveJSON(
                        activeTheme.id + ".still-theme.json",
                        activeTheme,
                      )
                    }
                  >
                    Export theme
                  </button>
                  <button onClick={exportContext}>
                    Export AI authoring context
                  </button>
                  {custom.some((t) => t.id === themeId) && (
                    <button
                      onClick={() => {
                        setCustom((ts) => ts.filter((t) => t.id !== themeId));
                        setThemeId("system");
                      }}
                    >
                      Remove custom theme
                    </button>
                  )}
                </div>
                <input
                  hidden
                  ref={themeInput}
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.currentTarget.value = "";
                    if (f)
                      run(async () => {
                        if (f.size > 32768)
                          throw Error("Theme must be smaller than 32 KiB");
                        const t = validateTheme(JSON.parse(await f.text()));
                        if (builtins.some((b) => b.id === t.id))
                          throw Error("Built-in theme IDs are reserved");
                        setPreview(t);
                        setDialog("theme-preview");
                      });
                  }}
                />
              </section>
              <section>
                <h2>Sound and sessions</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={player.normalize}
                    onChange={(e) => player.setNormalize(e.target.checked)}
                  />
                  Normalize tagged tracks
                </label>
                <p className="hint">
                  Uses embedded ReplayGain track tags, attenuating loud tracks
                  only. Untagged tracks are unchanged. No loudness analysis or
                  guaranteed equal volume.
                </p>
                {["Bass · 200 Hz", "Mid · 1 kHz", "Treble · 4 kHz"].map(
                  (label, i) => (
                    <label className="slider-field" key={label}>
                      {label}
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={1}
                        value={player.eq[i]}
                        onChange={(e) =>
                          player.setEq(
                            player.eq.map((v, n) =>
                              n === i ? +e.target.value : v,
                            ),
                          )
                        }
                      />
                      <span>{player.eq[i]} dB</span>
                    </label>
                  ),
                )}
                <button onClick={() => player.setEq([0, 0, 0])}>
                  Reset EQ
                </button>
                <p className="hint">
                  Next-track preloading reduces transition delays. Browser
                  scheduling and codec padding prevent guaranteed
                  sample-accurate gapless playback.
                </p>
                <div className="actions">
                  {[15, 30, 60].map((n) => (
                    <button
                      key={n}
                      onClick={() =>
                        player.setSleepUntil(Date.now() + n * 60000)
                      }
                    >
                      Sleep in {n}m
                    </button>
                  ))}
                  <button onClick={() => player.setSleepUntil(null)}>
                    Cancel sleep
                  </button>
                </div>
                <div className="actions">
                  <button
                    onClick={() => player.setFocusEnds(Date.now() + 25 * 60000)}
                  >
                    Focus · 25m
                  </button>
                  <button
                    onClick={() => player.setFocusEnds(Date.now() + 50 * 60000)}
                  >
                    Focus · 50m
                  </button>
                  <button onClick={() => player.setFocusEnds(null)}>
                    End focus session
                  </button>
                </div>
                {(player.sleepUntil || player.focusEnds) && (
                  <p role="status">
                    Session remaining: {player.remaining}. Playback pauses at
                    the end. Browser suspension can delay timers.
                  </p>
                )}
              </section>
              <section>
                <h2>Continue on another device</h2>
                <label>
                  Device name
                  <input
                    maxLength={80}
                    value={device}
                    onChange={(e) => {
                      setDevice(e.target.value);
                      writeLocal("still-device", e.target.value);
                    }}
                  />
                </label>
                <div className="actions">
                  <button
                    disabled={!online || !player.current}
                    onClick={publish}
                  >
                    Send current position
                  </button>
                  <button
                    disabled={!online}
                    onClick={() =>
                      run(async () => {
                        await getRemote();
                      })
                    }
                  >
                    Check other device
                  </button>
                </div>
                {remote?.parsed && (
                  <div>
                    <p>
                      {remote.parsed.device} ·{" "}
                      {tracks.find((t) => t.id === remote.parsed.trackId)
                        ?.title || "Track unavailable"}{" "}
                      · {formatTime(remote.parsed.position)}
                    </p>
                    <button
                      onClick={() =>
                        run(async () => {
                          const latest = await getRemote();
                          if (latest.revision !== remote.revision)
                            throw Error(
                              "Position changed. Review the refreshed handoff.",
                            );
                          if (
                            !tracks.some((t) => t.id === remote.parsed.trackId)
                          )
                            throw Error("Track no longer exists");
                          await player.play(
                            remote.parsed.trackId,
                            remote.parsed.queue,
                            remote.parsed.position,
                          );
                        })
                      }
                    >
                      Continue here
                    </button>
                  </div>
                )}
                <p className="hint">
                  Explicit position handoff; sending does not stop another
                  device or synchronize speakers.
                </p>
              </section>
              <section>
                <h2>Offline storage</h2>
                <p>{storage || "Storage estimate unavailable"}</p>
                <p>
                  {downloads.length} complete tracks on this device. Paused
                  downloads keep partial data for retry.
                </p>
                <div className="actions">
                  <button
                    onClick={() =>
                      run(async () => {
                        const d = await db;
                        for (const key of await d.getAllKeys("data"))
                          if (String(key).startsWith("partial:"))
                            await d.delete("data", key);
                        notify("Incomplete downloads removed");
                      })
                    }
                  >
                    Remove incomplete downloads
                  </button>
                  <button
                    onClick={() =>
                      run(async () => {
                        const ok = await navigator.storage?.persist?.();
                        notify(
                          ok
                            ? "Persistent storage granted. Keep original backups."
                            : "Browser did not grant persistent storage; downloads can be evicted.",
                        );
                      })
                    }
                  >
                    Request persistent storage
                  </button>
                </div>
              </section>
              <section>
                <h2>Backup and restore</h2>
                <p>
                  A complete backup includes its metadata manifest, audio files
                  named by track ID, and optional cover files. Keep them
                  together in a private folder.
                </p>
                <div className="actions">
                  <button
                    disabled={!online || pending}
                    onClick={exportDirectory}
                  >
                    Export complete folder
                  </button>
                  <button
                    disabled={!online}
                    onClick={() =>
                      run(async () =>
                        saveJSON("still-backup.json", await getBackup()),
                      )
                    }
                  >
                    Export metadata
                  </button>
                  <button onClick={() => setDialog("restore")}>
                    Restore backup
                  </button>
                </div>
                <details>
                  <summary>
                    Original-file downloads for browsers without folder export
                  </summary>
                  <p>
                    Export metadata above, then save each original and cover
                    below. These files are private; your browser may ask to
                    allow downloads.
                  </p>
                  {tracks.map((t) => (
                    <div className="file-link" key={t.id}>
                      <span>{t.title}</span>
                      <a
                        href={`/api/tracks/${t.id}/audio?download=1`}
                        download={`${t.id}.${extension(t.mime)}`}
                      >
                        Audio
                      </a>
                      {t.hasArt && (
                        <a
                          href={`/api/tracks/${t.id}/art?download=1`}
                          download={`${t.id}.cover`}
                        >
                          Cover
                        </a>
                      )}
                    </div>
                  ))}
                </details>
              </section>
              <section>
                <h2>Install Still</h2>
                {installed ? (
                  <button
                    className="primary"
                    onClick={() =>
                      run(async () => {
                        await installed.prompt();
                        await installed.userChoice;
                        setInstalled(null);
                      })
                    }
                  >
                    Install app
                  </button>
                ) : (
                  <p>
                    Android Chrome: menu → Install app or Add to Home screen.
                    Desktop Chrome/Edge: use the address-bar install icon when
                    offered. The app requires HTTPS and a successful
                    authenticated online visit before offline use.
                  </p>
                )}
              </section>
            </div>
          ) : page === "albums" || page === "artists" ? (
            <div className="collection-grid">
              {Array.from(
                new Set(
                  tracks.map((t) =>
                    page === "albums"
                      ? `${t.artist}\u0000${t.album}`
                      : t.artist,
                  ),
                ),
              ).map((key) => {
                const t = tracks.find(
                  (t) =>
                    (page === "albums"
                      ? `${t.artist}\u0000${t.album}`
                      : t.artist) === key,
                )!;
                return (
                  <button
                    className="collection"
                    key={key}
                    onClick={() =>
                      changePage(page === "albums" ? "album" : "artist", key)
                    }
                  >
                    <Cover track={t} />
                    <strong>
                      {page === "albums"
                        ? t.album || "Unknown album"
                        : t.artist}
                    </strong>
                    <span>{page === "albums" ? t.artist : ""}</span>
                  </button>
                );
              })}
            </div>
          ) : page === "queue" ? (
            <section>
              <div className="actions">
                <button onClick={() => player.setQueue([])}>Clear queue</button>
                <button onClick={() => setDialog("handoff")}>
                  Share position with another device
                </button>
              </div>
              {player.queue.map((id, i) => {
                const t = tracks.find((t) => t.id === id);
                return t ? (
                  row(t, i, true)
                ) : (
                  <div key={i}>
                    Track unavailable{" "}
                    <button
                      onClick={() =>
                        player.setQueue(player.queue.filter((_, n) => n !== i))
                      }
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {!player.queue.length && (
                <div className="empty">
                  <ListMusic />
                  <h2>Your next listen starts here</h2>
                  <p>
                    Use a track’s options to play next or add it to the queue.
                  </p>
                  <button onClick={() => changePage("library")}>
                    Browse library
                  </button>
                </div>
              )}
            </section>
          ) : (
            <>
              <div className="toolbar">
                <label className="search">
                  <Search />
                  <input
                    aria-label="Search music"
                    placeholder="Search tracks, artists, albums, tags"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                {!["playlist", "history"].includes(page) && (
                  <select
                    aria-label="Sort tracks"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="newest">Recently added</option>
                    <option value="title">Title</option>
                    <option value="artist">Artist</option>
                    <option value="duration">Longest first</option>
                  </select>
                )}
                <button
                  className="primary"
                  disabled={!list.length}
                  onClick={() =>
                    player.play(
                      list[0].id,
                      list.map((t) => t.id),
                    )
                  }
                >
                  <Play />
                  Play
                </button>
                {["playlist", "smart"].includes(page) && (
                  <button disabled={!online || pending} onClick={downloadList}>
                    <Download />
                    Download all
                  </button>
                )}
                {page === "playlist" && (
                  <button onClick={() => setDialog("add-tracks")}>
                    Add tracks
                  </button>
                )}
                {page === "history" && (
                  <button onClick={() => setDialog("clear-history")}>
                    Clear history
                  </button>
                )}
              </div>
              {list.length ? (
                list.map((t, i) => row(t, i))
              ) : (
                <div className="empty">
                  <Music2 />
                  <h2>{query ? "No matches" : "Room for your music"}</h2>
                  <p>
                    {page === "downloads"
                      ? "Download music from a track’s options to listen offline."
                      : page === "history"
                        ? "Meaningful listens appear after 30 seconds or half the track."
                        : "Add your own audio, or choose another view."}
                  </p>
                  <button
                    disabled={!online}
                    onClick={() => input.current?.click()}
                  >
                    Add music
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <footer className="player">
        <div className="now">
          <Cover track={player.track} />
          <div>
            <strong>
              {player.track?.title || "Choose something to listen to"}
            </strong>
            <span>{player.track?.artist || "Your private music library"}</span>
          </div>
          <button aria-label="Open queue" onClick={() => changePage("queue")}>
            <ListMusic />
          </button>
        </div>
        <div className="playback">
          <div className="controls">
            <button
              aria-label="Shuffle"
              aria-pressed={player.shuffle}
              onClick={() => player.setShuffle(!player.shuffle)}
            >
              <Shuffle />
            </button>
            <button aria-label="Previous track" onClick={() => player.next(-1)}>
              <SkipBack />
            </button>
            <button
              className="primary play-main"
              aria-label={player.playing ? "Pause" : "Play"}
              onClick={player.toggle}
            >
              {player.playing ? <Pause /> : <Play />}
            </button>
            <button aria-label="Next track" onClick={() => player.next()}>
              <SkipForward />
            </button>
            <button
              aria-label={`Repeat ${player.repeat}`}
              aria-pressed={player.repeat !== "off"}
              onClick={() =>
                player.setRepeat(
                  player.repeat === "off"
                    ? "all"
                    : player.repeat === "all"
                      ? "one"
                      : "off",
                )
              }
            >
              <Repeat />
              {player.repeat === "one" && <small>1</small>}
            </button>
          </div>
          <div className="seek">
            <time>{formatTime(player.position)}</time>
            <input
              type="range"
              aria-label="Playback position"
              min={0}
              max={
                Number.isFinite(player.duration) && player.duration > 0
                  ? player.duration
                  : Math.max(1, player.track?.duration || 1)
              }
              value={player.position}
              onChange={(e) => player.seek(+e.target.value)}
            />
            <time>{formatTime(player.duration || player.track?.duration)}</time>
          </div>
        </div>
        <label className="volume">
          Volume
          <input
            aria-label="Volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.volume}
            onChange={(e) => player.setVolume(+e.target.value)}
          />
        </label>
        <audio {...player.bindings(0)} />
        <audio {...player.bindings(1)} />
      </footer>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {[
          ["library", "Library", Library],
          ["queue", "Queue", ListMusic],
          ["downloads", "Offline", Download],
          ["settings", "Settings", Settings],
        ].map(([id, label, Icon]: any) => (
          <button
            key={id}
            aria-current={page === id ? "page" : undefined}
            onClick={() => changePage(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
        <button onClick={() => setDialog("browse")}>
          <MoreHorizontal />
          Browse
        </button>
      </nav>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X />
          </button>
        </div>
      )}
      {dialog && (
        <Dialog
          key={dialog}
          title={
            (
              {
                track: "Track options",
                "queue-track": "Queued track",
                edit: "Edit track",
                "new-playlist": "Create playlist",
                "edit-playlist": "Edit playlist",
                smart: "Create smart playlist",
                "theme-preview": "Preview theme",
                restore: "Restore backup",
                "add-tracks": "Add tracks",
                browse: "Browse your library",
                "clear-history": "Clear history",
                handoff: "Send playback position",
                "delete-smart": "Delete smart playlist",
              } as Record<string, string>
            )[dialog] || "Still"
          }
          close={() => {
            setDialog("");
            setPreview(null);
          }}
        >
          {dialog === "browse" ? (
            <div className="dialog-list">
              {pageNav.map(([id, label, Icon]) => (
                <button
                  key={id}
                  onClick={() => {
                    changePage(id);
                    setDialog("");
                  }}
                >
                  <Icon />
                  {label}
                </button>
              ))}
              {playlists.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    changePage("playlist", p.id);
                    setDialog("");
                  }}
                >
                  {p.name}
                </button>
              ))}
              {smart.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    changePage("smart", p.id);
                    setDialog("");
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button
                onClick={() => {
                  setName("");
                  setDialog("new-playlist");
                }}
              >
                Create playlist
              </button>
              <button
                onClick={() => {
                  setName("");
                  setDialog("smart");
                }}
              >
                Create smart playlist
              </button>
            </div>
          ) : dialog === "theme-preview" && preview ? (
            <>
              <p>
                {preview.name} is shown temporarily. Apply to keep it or cancel
                to restore your saved theme.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setCustom((ts) => [
                    ...ts.filter((t) => t.id !== preview.id),
                    preview,
                  ]);
                  setThemeId(preview.id);
                  setPreview(null);
                  setDialog("");
                }}
              >
                Apply theme
              </button>
            </>
          ) : dialog === "track" || dialog === "queue-track" ? (
            edit && (
              <div className="dialog-list">
                <strong>{edit.title}</strong>
                <button
                  onClick={() => {
                    addQueue(edit.id, true);
                    setDialog("");
                  }}
                >
                  Play next
                </button>
                <button
                  onClick={() => {
                    addQueue(edit.id);
                    setDialog("");
                  }}
                >
                  Add to queue
                </button>
                <button onClick={() => setDialog("edit")}>
                  Edit details and tags
                </button>
                <button
                  disabled={!online || pending}
                  onClick={() =>
                    run(async () => {
                      await startDownload(edit);
                      setDialog("");
                    })
                  }
                >
                  Download on this device
                </button>
                {downloads.includes(edit.id) && (
                  <button
                    onClick={() =>
                      run(async () => {
                        await removeDownload(edit);
                        setDialog("");
                      })
                    }
                  >
                    Remove offline copy
                  </button>
                )}
                {dialog === "queue-track" && (
                  <button
                    onClick={() => {
                      player.setQueue(
                        player.queue.filter((id) => id !== edit.id),
                      );
                      setDialog("");
                    }}
                  >
                    Remove from queue
                  </button>
                )}
                {page === "playlist" && (
                  <button
                    onClick={() =>
                      run(async () => {
                        await api(`/playlists/${selected}/tracks`, "PUT", {
                          trackIds: playlist!.trackIds.filter(
                            (id) => id !== edit.id,
                          ),
                        });
                        await refresh();
                        setDialog("");
                      })
                    }
                  >
                    Remove from playlist
                  </button>
                )}
                <label>
                  Add to playlist
                  <select
                    value={playlistPick}
                    onChange={(e) => setPlaylistPick(e.target.value)}
                  >
                    <option value="">Choose playlist</option>
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!playlistPick}
                  onClick={() =>
                    run(async () => {
                      const p = playlists.find((p) => p.id === playlistPick)!;
                      await api(`/playlists/${p.id}/tracks`, "PUT", {
                        trackIds: [...new Set([...p.trackIds, edit.id])],
                      });
                      await refresh();
                      setDialog("");
                    })
                  }
                >
                  Add to selected playlist
                </button>
                <button
                  className="danger"
                  onClick={() => setDialog("delete-track")}
                >
                  Delete from library
                </button>
              </div>
            )
          ) : dialog === "edit" && edit ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(`/tracks/${edit.id}`, "PATCH", {
                    title: edit.title,
                    artist: edit.artist,
                    album: edit.album,
                    trackNumber: edit.trackNumber,
                  });
                  await api(`/tracks/${edit.id}/preferences`, "PATCH", {
                    favorite: edit.favorite,
                    tags: tagsInput
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(0, 30),
                  });
                  await refresh();
                  setDialog("");
                });
              }}
            >
              {(["title", "artist", "album"] as const).map((k) => (
                <label key={k}>
                  {k}
                  <input
                    maxLength={200}
                    required={k !== "album"}
                    value={edit[k]}
                    onChange={(e) => setEdit({ ...edit, [k]: e.target.value })}
                  />
                </label>
              ))}
              <label>
                Track number
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={edit.trackNumber || ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      trackNumber: e.target.value ? +e.target.value : null,
                    })
                  }
                />
              </label>
              <label>
                Tags (comma separated)
                <input
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                />
              </label>
              <button className="primary" disabled={pending}>
                Save details
              </button>
            </form>
          ) : dialog === "new-playlist" || dialog === "edit-playlist" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api(
                    dialog === "new-playlist"
                      ? "/playlists"
                      : `/playlists/${selected}`,
                    dialog === "new-playlist" ? "POST" : "PATCH",
                    { name },
                  );
                  await refresh();
                  setDialog("");
                });
              }}
            >
              <label>
                Name
                <input
                  maxLength={100}
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button className="primary" disabled={pending}>
                Save playlist
              </button>
              {dialog === "edit-playlist" && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => setDialog("delete-playlist")}
                >
                  Delete playlist
                </button>
              )}
            </form>
          ) : dialog === "smart" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api("/smart-playlists", "POST", { name, rules: rule });
                  await refresh();
                  setDialog("");
                });
              }}
            >
              <label>
                Name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Include
                <select
                  value={rule.kind}
                  onChange={(e) => setRule({ ...rule, kind: e.target.value })}
                >
                  <option value="favorites">Favorites</option>
                  <option value="recent">Recently added</option>
                  <option value="unplayed">Not in recent history</option>
                  <option value="all">All tracks</option>
                </select>
              </label>
              <label>
                Within days (recently added)
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={rule.days}
                  onChange={(e) => setRule({ ...rule, days: +e.target.value })}
                />
              </label>
              <label>
                With tag (optional)
                <input
                  maxLength={40}
                  value={rule.tag}
                  onChange={(e) => setRule({ ...rule, tag: e.target.value })}
                />
              </label>
              <p className="hint">
                Rules update as your library changes. Unplayed uses the latest
                500 history entries.
              </p>
              <button className="primary" disabled={pending}>
                Create smart playlist
              </button>
            </form>
          ) : dialog === "add-tracks" ? (
            <div className="dialog-list">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  aria-pressed={playlist?.trackIds.includes(t.id)}
                  onClick={() =>
                    run(async () => {
                      const ids = playlist!.trackIds;
                      await api(`/playlists/${selected}/tracks`, "PUT", {
                        trackIds: ids.includes(t.id)
                          ? ids.filter((id) => id !== t.id)
                          : [...ids, t.id],
                      });
                      await refresh();
                    })
                  }
                >
                  {playlist?.trackIds.includes(t.id) ? <Check /> : <Plus />}
                  {t.title}
                </button>
              ))}
            </div>
          ) : dialog === "restore" ? (
            <>
              <p>
                Restore adds tracks and playlists. Existing matching track IDs
                are reused. Select a metadata manifest and all audio/cover files
                from the same backup. Keep originals until verified.
              </p>
              <label>
                Metadata manifest
                <input
                  type="file"
                  accept=".json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      run(async () => {
                        if (f.size > 20 * 1024 ** 2)
                          throw Error("Manifest exceeds 20 MiB");
                        const b = JSON.parse(await f.text());
                        validateBackup(b);
                        setBackup(b);
                      });
                  }}
                />
              </label>
              <label>
                Audio and cover files
                <input
                  type="file"
                  multiple
                  onChange={(e) =>
                    setRestoreFiles(Array.from(e.target.files || []))
                  }
                />
              </label>
              <p>
                {backup?.tracks?.length || 0} tracks in manifest ·{" "}
                {restoreFiles.length} files selected
              </p>
              <button
                className="primary"
                disabled={pending || !backup}
                onClick={restore}
              >
                Restore backup
              </button>
            </>
          ) : dialog === "handoff" ? (
            <>
              <p>
                Save this track, queue and position for your other device. Open
                Settings there and select Check other device → Continue here.
              </p>
              <button
                className="primary"
                disabled={!online || !player.current || pending}
                onClick={publish}
              >
                Send position
              </button>
            </>
          ) : dialog === "clear-history" ? (
            <>
              <p>
                Clear online listening history and this device’s pending
                listens. Requires a connection. Other devices may still have
                unsynced plays.
              </p>
              <button
                className="danger"
                disabled={!online || pending}
                onClick={() =>
                  run(async () => {
                    await history.clear();
                    setEvents([]);
                    await refresh();
                    setDialog("");
                  })
                }
              >
                Clear history
              </button>
            </>
          ) : dialog.startsWith("delete-") ? (
            <>
              <p>
                {dialog === "delete-track"
                  ? `Delete “${edit?.title}” and its playlist links? Other devices’ offline copies cannot be remotely erased.`
                  : dialog === "delete-playlist"
                    ? "Delete this playlist? Music stays in your library."
                    : "Delete this smart playlist? Music stays in your library."}{" "}
                This cannot be undone.
              </p>
              <button
                className="danger"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    if (dialog === "delete-track" && edit) {
                      await api("/tracks/" + edit.id, "DELETE");
                      await removeDownload(edit);
                      player.setQueue(
                        player.queue.filter((id) => id !== edit.id),
                      );
                    } else
                      await api(
                        (dialog === "delete-playlist"
                          ? "/playlists/"
                          : "/smart-playlists/") + selected,
                        "DELETE",
                      );
                    await refresh();
                    setDialog("");
                    if (dialog !== "delete-track") changePage("library");
                  })
                }
              >
                Confirm deletion
              </button>
            </>
          ) : null}
        </Dialog>
      )}
    </div>
  );
}
const root = document.getElementById("root");
if (root) {
  try {
    const id = readLocal<string>("still-theme", "still-light");
    const t =
      id === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? code
          : light
        : [light, code, ...readLocal<Theme[]>("still-themes", [])].find(
            (t) => t.id === id,
          ) || light;
    applyTheme(validateTheme(t));
  } catch {
    applyTheme(light);
  }
  createRoot(root).render(<App />);
}
