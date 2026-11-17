import { useEffect, useRef, useState } from "react";
import { db, formatTime, readLocal, writeLocal, type Track } from "./model";
import { createHistoryQueue } from "./history";
import { api } from "./model";
const history = createHistoryQueue(
  {
    getAll: async () => (await db).getAll("outbox"),
    put: async (e) => (await db).put("outbox", e),
    delete: async (id) => (await db).delete("outbox", id),
    clear: async () => (await db).clear("outbox"),
  },
  (events) => api("/history", "POST", { events }),
  () => api("/history", "DELETE"),
);
export { history };
export function usePlayer(tracks: Track[], notify: (s: string) => void) {
  const saved = useRef(readLocal<any>("still-player", {}));
  const [queue, setQueue] = useState<string[]>([
      ...new Set<string>(saved.current.queue || []),
    ]),
    [current, setCurrent] = useState<string | null>(
      saved.current.current || null,
    ),
    [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(saved.current.position || 0),
    [duration, setDuration] = useState(0),
    [volume, setVolume] = useState(readLocal("still-volume", 0.8)),
    [shuffle, setShuffle] = useState(false),
    [repeat, setRepeat] = useState<"off" | "all" | "one">("off"),
    [eq, setEq] = useState<number[]>(readLocal("still-eq", [0, 0, 0])),
    [normalize, setNormalize] = useState(readLocal("still-normalize", false)),
    [sleepUntil, setSleepUntil] = useState<number | null>(null),
    [focusEnds, setFocusEnds] = useState<number | null>(null),
    [clock, setClock] = useState(Date.now());
  const refs = [useRef<HTMLAudioElement>(null), useRef<HTMLAudioElement>(null)];
  const active = useRef(0),
    context = useRef<AudioContext | null>(null),
    filters = useRef<BiquadFilterNode[]>([]),
    gain = useRef<GainNode | null>(null),
    urls = useRef(["", ""]),
    loaded = useRef(["", ""]),
    resume = useRef(saved.current.position || 0),
    latest = useRef<any>({}),
    listen = useRef({ seconds: 0, last: 0, recorded: false }),
    preload = useRef(""),
    requestVersion = useRef(0),
    slotVersion = useRef([0, 0]);
  const track = tracks.find((t) => t.id === current);
  const graph = () => {
    if (!context.current) {
      const AC = window.AudioContext;
      if (!AC) {
        notify(
          "EQ and normalization are unavailable in this browser. Standard playback is available.",
        );
        return;
      }
      const c = new AC();
      context.current = c;
      const fs = [
        c.createBiquadFilter(),
        c.createBiquadFilter(),
        c.createBiquadFilter(),
      ];
      fs[0].type = "lowshelf";
      fs[0].frequency.value = 200;
      fs[1].type = "peaking";
      fs[1].frequency.value = 1000;
      fs[1].Q.value = 1;
      fs[2].type = "highshelf";
      fs[2].frequency.value = 4000;
      gain.current = c.createGain();
      for (const ref of refs)
        if (ref.current) c.createMediaElementSource(ref.current).connect(fs[0]);
      fs[0].connect(fs[1]);
      fs[1].connect(fs[2]);
      fs[2].connect(gain.current);
      gain.current.connect(c.destination);
      filters.current = fs;
    }
    filters.current.forEach(
      (f, i) => (f.gain.value = latest.current.eq?.[i] || 0),
    );
    if (gain.current)
      gain.current.gain.value =
        Math.min(
          1,
          10 **
            ((latest.current.normalize
              ? latest.current.track?.replayGain || 0
              : 0) /
              20),
        ) *
        10 ** (-Math.max(0, ...(latest.current.eq || [0])) / 20);
    context.current?.resume().catch(() => {});
  };
  const source = async (id: string, index: number) => {
    const slot = ++slotVersion.current[index];
    const d = await (await db).get("downloads", id);
    if (slot !== slotVersion.current[index]) return "";
    if (urls.current[index]) URL.revokeObjectURL(urls.current[index]);
    urls.current[index] = d ? URL.createObjectURL(d.audio) : "";
    return urls.current[index] || `/api/tracks/${id}/audio`;
  };
  const chooseNext = (dir = 1) => {
    const { queue, current, shuffle, repeat } = latest.current;
    const i = queue.indexOf(current);
    if (shuffle && queue.length > 1) {
      const others = queue.filter((id: string) => id !== current);
      return others[Math.floor(Math.random() * others.length)];
    }
    if (i + dir >= queue.length && repeat !== "all") return null;
    return queue[(i + dir + queue.length) % queue.length];
  };
  const play = async (id: string, ids?: string[], at = 0) => {
    if (ids) setQueue([...new Set(ids)]);
    const el = refs[active.current].current;
    if (!el) return;
    const version = ++requestVersion.current;
    graph();
    el.pause();
    listen.current = { seconds: 0, last: at, recorded: false };
    resume.current = at;
    setCurrent(id);
    setPosition(at);
    setDuration(0);
    try {
      const src = await source(id, active.current);
      if (version !== requestVersion.current) return;
      el.src = src;
      loaded.current[active.current] = id;
      await el.play();
      if (version === requestVersion.current) setPlaying(true);
    } catch {
      if (version !== requestVersion.current) return;
      setPlaying(false);
      notify("Playback failed. Check sign-in, connection, or audio format.");
    }
  };
  latest.current = {
    queue,
    current,
    shuffle,
    repeat,
    eq,
    normalize,
    track,
    sleepUntil,
    focusEnds,
    position,
  };
  useEffect(() => {
    filters.current.forEach((f, i) => (f.gain.value = eq[i]));
    writeLocal("still-eq", eq);
  }, [eq]);
  useEffect(() => {
    const el = refs[active.current].current;
    const replay = normalize
      ? Math.min(1, 10 ** ((track?.replayGain || 0) / 20))
      : 1;
    if (gain.current)
      gain.current.gain.value = replay * 10 ** (-Math.max(0, ...eq) / 20);
    for (const r of refs) if (r.current) r.current.volume = volume;
    writeLocal("still-volume", volume);
    writeLocal("still-normalize", normalize);
  }, [volume, normalize, track?.id, eq]);
  useEffect(() => {
    const t = window.setInterval(() => {
      const { queue, current, position, sleepUntil, focusEnds } =
        latest.current;
      setClock(Date.now());
      writeLocal("still-player", {
        queue,
        current,
        position: refs[active.current].current?.currentTime || position,
      });
      if (sleepUntil && Date.now() >= sleepUntil) {
        refs[active.current].current?.pause();
        setSleepUntil(null);
        notify("Sleep timer finished");
      }
      if (focusEnds && Date.now() >= focusEnds) {
        refs[active.current].current?.pause();
        setFocusEnds(null);
        notify("Focus session complete");
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);
  // Preload one next track in the second native media element. Codec padding/browser scheduling can still leave a gap.
  useEffect(() => {
    if (!playing) return;
    const id = chooseNext();
    if (!id) return;
    const index = 1 - active.current;
    preload.current = id;
    source(id, index)
      .then((src) => {
        if (preload.current !== id) return;
        const el = refs[index].current;
        if (el) {
          el.src = src;
          el.preload = "auto";
          el.load();
          loaded.current[index] = id;
        }
      })
      .catch(() => {});
  }, [current, queue, shuffle, repeat, playing]);
  const ended = () => {
    if (latest.current.repeat === "one") {
      listen.current = { seconds: 0, last: 0, recorded: false };
      const el = refs[active.current].current!;
      el.currentTime = 0;
      el.play().catch(() => {});
      return;
    }
    const id = chooseNext();
    if (!id) {
      setPlaying(false);
      return;
    }
    const index = 1 - active.current,
      el = refs[index].current;
    if (el && loaded.current[index] === id) {
      active.current = index;
      resume.current = 0;
      listen.current = { seconds: 0, last: 0, recorded: false };
      setCurrent(id);
      setPosition(0);
      setDuration(el.duration || 0);
      el.play()
        .then(() => setPlaying(true))
        .catch(() => play(id));
    } else play(id);
  };
  const seek = (value: number) => {
    const el = refs[active.current].current;
    if (el && Number.isFinite(el.duration)) {
      el.currentTime = Math.max(0, Math.min(value, el.duration));
      listen.current.last = el.currentTime;
      setPosition(el.currentTime);
    }
  };
  useEffect(() => {
    const save = () => {
      const s = latest.current;
      writeLocal("still-player", {
        queue: s.queue,
        current: s.current,
        position: refs[active.current].current?.currentTime || s.position,
      });
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  const toggle = () => {
    const el = refs[active.current].current;
    if (!el) return;
    if (!el.paused) el.pause();
    else if (loaded.current[active.current] === current) {
      graph();
      el.play().catch(() => notify("Tap a track to resume playback"));
    } else if (current) play(current, undefined, position);
    else if (queue[0]) play(queue[0]);
  };
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return;
    const media = navigator.mediaSession;
    media.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
    });
    const handlers: Record<string, any> = {
      play: () => {
        const el = refs[active.current].current;
        el?.play().catch(() => notify("Open Still to resume playback"));
      },
      pause: () => refs[active.current].current?.pause(),
      nexttrack: () => {
        const id = chooseNext();
        if (id) play(id);
      },
      previoustrack: () => {
        const id = chooseNext(-1);
        if (id) play(id);
      },
      seekto: (e: any) => seek(e.seekTime),
      seekforward: (e: any) => seek(position + (e.seekOffset || 10)),
      seekbackward: (e: any) => seek(position - (e.seekOffset || 10)),
    };
    for (const [action, fn] of Object.entries(handlers))
      try {
        media.setActionHandler(action as MediaSessionAction, fn);
      } catch {}
  }, [track, queue, shuffle, repeat, position]);
  const bindings = (i: number) => ({
    ref: refs[i],
    onPlay: () => {
      if (i === active.current) setPlaying(true);
    },
    onPause: () => {
      if (i === active.current) setPlaying(false);
    },
    onLoadedMetadata: () => {
      const el = refs[i].current!;
      if (i === active.current) {
        setDuration(el.duration);
        if (resume.current) {
          el.currentTime = resume.current;
          resume.current = 0;
        }
      }
    },
    onTimeUpdate: () => {
      if (i !== active.current) return;
      const el = refs[i].current!,
        s = listen.current,
        delta = el.currentTime - s.last;
      s.last = el.currentTime;
      if (!el.paused && delta > 0 && delta < 2) s.seconds += delta;
      setPosition(el.currentTime);
      if (
        !s.recorded &&
        s.seconds >= Math.min(30, (el.duration || 60) / 2) &&
        current
      ) {
        s.recorded = true;
        history
          .record({
            id: crypto.randomUUID(),
            trackId: current,
            playedAt: new Date().toISOString(),
          })
          .then(() => history.sync())
          .catch(() => {});
      }
    },
    onEnded: () => {
      if (i === active.current) ended();
    },
    onError: () => {
      if (i === active.current) {
        setPlaying(false);
        notify(
          "Audio could not be decoded or fetched. Check sign-in and browser format support.",
        );
      }
    },
  });
  const restoreQueue = (ids: string[], id: string | null, at: number) => {
    requestVersion.current++;
    slotVersion.current[active.current]++;
    refs[active.current].current?.pause();
    loaded.current[active.current] = "";
    setQueue([...new Set(ids)]);
    setCurrent(id);
    setPosition(at);
    resume.current = at;
    writeLocal("still-player", { queue: ids, current: id, position: at });
  };
  return {
    restoreQueue,
    bindings,
    queue,
    setQueue,
    current,
    track,
    playing,
    position,
    duration,
    volume,
    setVolume,
    shuffle,
    setShuffle,
    repeat,
    setRepeat,
    eq,
    setEq,
    normalize,
    setNormalize,
    play,
    toggle,
    seek,
    next: (dir = 1) => {
      const id = chooseNext(dir);
      if (id) play(id);
    },
    sleepUntil,
    setSleepUntil,
    focusEnds,
    setFocusEnds,
    remaining: formatTime(
      Math.max(
        0,
        (Math.min(
          sleepUntil || Infinity,
          focusEnds || Infinity,
          clock + (sleepUntil || focusEnds ? Infinity : 0),
        ) -
          clock) /
          1000,
      ),
    ),
  };
}
