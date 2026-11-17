# Still Plus

## Appearance and custom themes

Settings → Appearance offers the existing warm Light palette and display type, Code (charcoal, restrained green/blue, technical detail type), and System. Selection and custom packages persist on the current device and work offline. Theme preview is temporary until Apply; cancellation restores the saved selection. Invalid stored packages fall back safely. A quick header button switches the built-ins.

Import a version-1 `.still-theme.json` file below32KiB. Only semantic six-digit color values, a constrained font choice, radius and metadata are accepted. No CSS, scripts, markup, URLs or remote fonts are loaded. Contrast validation includes primary/muted/action/error text. Built-in IDs are reserved. Export theme downloads the active package. Export AI authoring context downloads one self-contained Markdown document containing the complete schema, token explanations, restrictions, workflow, accessibility checklist, and both full examples. The same material lives in `docs/themes/` for any agent working from the repository.

## Uploads and offline storage

The normal client now uses8MiB multipart pieces. Each part is below the Cloudflare Free request body limit. Files up to4GiB are accepted by the application; this is an enforced cap, not a verified4GiB production guarantee. Local tests exercise an8MiB-plus-tail object and cross-part range reads. Real large-file behavior needs production tests. The legacy single-request endpoint remains capped at25MiB for compatibility.

Progress, pause and retry are visible. Pausing preserves already uploaded parts; reselect the original file after reopening. A bounded-memory SHA256 content fingerprint prevents mixing different reselected files with the same name/size/date. Checking identity reads the entire file before upload and can take time for long compilations. No music bytes are put in localStorage. Upload mappings and incomplete server sessions persist. Sessions older than six days are restarted because R2 normally aborts incomplete multipart uploads after seven days. Keep that lifecycle policy at seven days or longer. There is no background transfer after the browser closes.

Explicit offline downloads use authenticated8MiB byte-range requests. Only a complete audio Blob is promoted into the playable downloads store; paused/interrupted parts remain separate for retry. Sign-in pages, wrong ranges and truncated data are rejected. Settings can remove incomplete downloads and request persistent browser storage. Quota estimates are browser-provided; neither persistence nor retention is guaranteed. Offline music is not encrypted and remains private only to the browser/device account. Server deletion cannot erase copies on other devices.

## Playback queue and browsing

Play replaces the queue with the current view. Track options offer Play next and Add to queue. Queue tracks can be moved with accessible buttons and removed; queue, current track and position are saved locally every second and on page hide. A track appears at most once in a queue: re-adding it moves it to the chosen position. Queue restore is paused until a user gesture. Shuffle avoids immediately selecting the same track; repeat cycles off/all/one.

Browse albums and artists, favorite tracks, sort tracks, and filter by track/artist/album/tags. Albums default to track-number order. Edit tags as comma-separated labels. Smart playlists combine a favorites/recent/unplayed/all rule with an optional exact tag and recent-days window. Unplayed is based on the latest500 history entries, not lifetime listening. Smart playlist definitions sync through D1, while their matches are evaluated against the loaded library.

## Sound and sessions

The three-band Web Audio EQ supports bass, mid and treble, with headroom attenuation equal to the largest positive band boost to reduce clipping risk. Optional normalization reads embedded ReplayGain track tags and attenuates only; tracks without tags remain unchanged. This is not waveform loudness analysis or a guarantee of equal perceived loudness. EQ and normalization require browser AudioContext support.

The next track is preloaded into a second media element. This reduces transition delay but does not guarantee sample-accurate gapless playback: scheduling, browser buffering and codec padding can leave gaps. No server transcoding is added.

Sleep timers and25/50-minute focus sessions pause playback when their deadlines pass. If both are enabled, the earliest deadline is displayed; either deadline pauses playback. Browser/OS suspension may delay timers and background playback. Media Session offers play/pause/previous/next/seek where supported.

## Backups and restore

Complete folder export streams originals, covers and the metadata manifest to a chosen folder in browsers supporting File System Access. Other browsers can export metadata plus each original/cover from Settings. A JSON manifest alone is not a complete backup. Do not use Git for music backups.

Restore validates the manifest and references before writes, matches files named by original track IDs, then uploads media and restores metadata, favorites, tags, playlists, smart rules, history, themes and queue position. Existing track IDs are reused and their metadata/preferences updated. Per-backup mappings persist for retry; server restore keys make playlist creation idempotent. Distinct source tracks containing identical audio remain distinct during restore. Queue restore is paused. A restore can still stop halfway on network/quota errors; retain originals and retry the exact same manifest. Clearing local browser storage loses restore mappings. Restore is additive, not an atomic replacement of the existing library. Offline download copies and device-specific sound/timer settings are not included.

## Device handoff

Settings → Continue on another device sends the current track, position, device label and queue. On the other device, Check other device → Continue here explicitly starts playback there. Optimistic revisions reject conflicting writes; the receive action checks for a newer state before continuing. This is a manual snapshot handoff, not synchronized speakers, remote pause/control, or continuous automatic position sync. Both devices must authenticate online and have the same track available.
