# Still
A single person's private music library, available on desktop and Android. Upload owned music, organize playlists, stream through authenticated endpoints, and explicitly retain device-local copies for offline listening. No sample tracks, public registration, analytics, or marketing surface.

Primary scene: frequent listening at a desk or from a phone, with quick access to playback and downloaded music. Cloudflare Workers, D1, private R2, and Access protect the hosted library. Deployment must originate from the GitHub connection, never this workspace.

Design is pinned by the brief: calm, focused, clean, polished, accessible; simplicity comparable to Brain.fm and quality comparable to Apple Music without copying either. Routine choices are delegated to the builder; no design approval round is required.

Still Plus adds portable non-executable custom themes, resumable multipart transfers, a persistent unique-track queue, album/artist/favorite/tag views, rule-based smart playlists, additive backup/restore, timed listening sessions, browser EQ and tagged ReplayGain attenuation, next-track preloading, and explicit cross-device position handoff. Keep the browser/audio limitations in docs/features.md visible rather than claiming native-device or sample-accurate guarantees.
