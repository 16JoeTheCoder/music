CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL, duration REAL NOT NULL, track_number INTEGER, mime TEXT NOT NULL, size INTEGER NOT NULL, audio_key TEXT NOT NULL, art_key TEXT, art_mime TEXT, created_at TEXT NOT NULL, deleted_at TEXT, idempotency_key TEXT UNIQUE);
CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE playlist_tracks (playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, position INTEGER NOT NULL, PRIMARY KEY (playlist_id, track_id));
CREATE TABLE history (id TEXT PRIMARY KEY, track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE, played_at TEXT NOT NULL);
CREATE INDEX history_played_at ON history(played_at DESC);
CREATE INDEX tracks_deleted_at ON tracks(deleted_at);
