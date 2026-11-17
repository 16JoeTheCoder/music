# Still design system

The library remains the primary workspace, with persistent playback on desktop and Android web. Desktop has a quiet sidebar and large searchable track rows; phone navigation offers Library, Queue, Offline, Settings and Browse. Albums, artists, favorites, history and playlists are available from Browse. A stacked mobile player keeps seek/shuffle/repeat/previous/next reachable with44px controls.

All application surfaces use semantic CSS custom properties: background, surface, raised, text, muted, border, accent, accentText, danger and focus, plus radius and detail-font. Built-in Light preserves warm paper #f7f6f0, ink #252d26, forest #365644, DM Sans body and DM Serif Display main headings. Code uses charcoal #101419, cool white #e6edf3, green #8bd5b4, DM Sans headings and monospace details. Fonts are self-hosted. Imported themes customize this fixed contract rather than component selectors. Appearance defaults to Light unless a saved choice exists; System is optional.

Borders distinguish surfaces, selected controls also have textual/pressed/current-page state, keyboard focus is explicit, dialogs contain focus, destructive actions ask confirmation, and reduced-motion preferences suppress transitions. Transfer rows show only real progress. Offline indicators say copies are device-local. No fabricated music, metrics, marketing artwork or decorative section eyebrows.

Browser visual verification remains blocked by the managed preview relay. DOM tests cover interaction paths but do not establish computed contrast, responsive render quality or real-device ergonomics. Built-in and imported token contrast is checked programmatically.
