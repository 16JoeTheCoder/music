# Still

A private, personal music library for the browser. Still uses a React/Vite client, a Cloudflare Worker for its API and static assets, D1 for library data, and a private R2 bucket for audio. Cloudflare Access protects the application; the Worker independently validates identity for API requests. The intended production address is `https://music.josefyang.com`.

This repository does not create or configure your Cloudflare account. Before putting music in the service, follow [deployment and privacy](docs/deployment.md), then complete the production acceptance checklist there. Keep your own backups of your original files.

## Develop locally

Install Node.js 22.12 or newer and npm, then run:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open the URL printed by Wrangler. Local D1 and R2 are separate from production and persist in Wrangler's local state. `npm run dev` builds the client before starting the Worker; rebuild and restart it after client changes. `npm run dev:ui` starts Vite for UI work, but on its own is not a complete backend. Do not expose a local development server to the public internet. See [deployment](docs/deployment.md) for local authentication and production configuration.

Run `npm run check` for type checking, tests, and a production build. A successful local build does not prove production authentication, offline behavior, or Cloudflare resource configuration.

## Privacy and offline

Music is stored in your private R2 bucket and served through the authenticated Worker, never a public bucket URL. Access protects the network service, but a downloaded track remains on the device in browser-managed storage. It is not encrypted by Still and may be readable by someone with access to that browser profile or device. Clearing site data, browser eviction, a lost device, or private browsing may remove downloads. Device operating-system encryption and a locked account help protect local copies. See [deployment and privacy](docs/deployment.md) for limitations and backup guidance.

See [test evidence and verification limits](docs/testing.md) for coverage and checks still required on your deployed domain.

## Still Plus

Importable Light/Code/custom themes, resumable multipart uploads and offline downloads, a persistent queue, albums/artists/favorites/tags, smart playlists, portable backup/restore, sleep/focus sessions, three-band EQ and ReplayGain attenuation, next-track preloading, and explicit device handoff are implemented. See [feature behavior and limitations](docs/features.md) and [theme authoring context](docs/themes/THEME_AUTHORING.md).

Existing installations must apply `migrations/0002_still_plus.sql` to the existing D1 database before deploying this release. No new storage bindings, secrets or public buckets are needed. Keep deployment through Cloudflare's GitHub connection.
