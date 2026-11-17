# Deployment, privacy, and operations

Still is designed for a single private owner. These instructions describe a Cloudflare Worker with static assets, D1, R2, and Cloudflare Access. They do not deploy the app or configure an account for you. Do not use Cloudflare Pages for this project.

## Before you start

- Control the `josefyang.com` zone in the same Cloudflare account, or use an equivalent hostname in a zone you control.
- Have access to the GitHub repository at <https://github.com/16JoeTheCoder/music.git> and a Cloudflare account with Workers, D1, R2 and Zero Trust Access. The repository connection and Cloudflare account must be authorized in their own dashboards.
- R2 requires an account subscription and checkout even though it includes free monthly usage. Whether Cloudflare requests a payment method for your account is determined at checkout; do not assume no card is needed. [R2 setup](https://developers.cloudflare.com/r2/get-started/)
- Keep the audio originals elsewhere. D1 is metadata, while R2 contains audio; backing up only one is insufficient.

## Configure Access before accepting traffic

1. In Cloudflare Zero Trust, set up your team and enable an identity provider such as [email one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/).
2. Create a self-hosted Access application for the exact hostname `music.josefyang.com` covering all paths. Add an Allow policy with an **Emails** rule for your exact email address, `YOUR_EMAIL@example.com` (replace this placeholder). Do not allow an entire email domain, everyone, or a service token as a substitute. Choose an appropriate session duration.
3. Record the team issuer URL `https://YOUR_TEAM.cloudflareaccess.com` and the application's audience (AUD) tag. Configure the Worker with those values and the same exact allowed email. The Worker verifies the signed `Cf-Access-Jwt-Assertion`, issuer, audience, expiration and allowed email on API requests; missing or invalid configuration must fail closed. [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
4. Route only the intended hostname to the Worker and disable any unused `workers.dev` and preview URLs. An Access policy for one hostname does not automatically protect alternate hostnames. Never expose the bucket through `r2.dev`, a public custom domain, or public object URLs. Only the Worker should access it through its R2 binding.

## Provision storage and build

Create a private R2 bucket and D1 database in your account, for example with `npx wrangler r2 bucket create private-music` and `npx wrangler d1 create music` after authenticating Wrangler to the intended account. In `wrangler.jsonc`, replace the D1 database ID placeholder with the ID returned by Cloudflare and adjust `database_name` and `bucket_name` to match your resources. The binding names must remain `DB` and `BUCKET`. Set `ACCESS_ISSUER`, `ACCESS_AUDIENCE` and `ALLOWED_EMAIL` under `vars` to the Access values described above. These are runtime configuration values; never put tokens or credentials in the configuration file. If you prefer to keep your email out of Git, configure these as Worker secrets instead and remove the placeholder variables from Wrangler configuration. Confirm the deployed runtime settings after each build. Keep production and test resources separate. Apply D1 migrations before deploying code that requires them; take a backup first. Do not run a destructive reset against production. Resource creation and migrations are deliberately separate from deployment so a routine build cannot silently change the database.

Connect the repository to **Workers Builds** in Cloudflare, choose the intended production branch and repository root, and use:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

Use the generic Worker setup (no framework preset). The repository root is the build root; static output is `dist` through the Wrangler assets binding, with no separate Pages output setting. The Worker name must be `private-music` to match Wrangler. Set the Worker runtime configuration and resource bindings before the first deployment. The configuration declares `music.josefyang.com` as a custom domain and disables `workers.dev` and preview URLs; confirm these settings in the dashboard after deployment. Build variables are separate from Worker runtime variables. Limit Git deployment permissions and review changes before pushing to the production branch: pushes to that branch can deploy automatically. Disable production-connected previews or give them isolated resources and their own Access protection. See [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

For schema updates, review the SQL and compatibility with the currently deployed version, back up D1, and apply the migrations explicitly using the configured production binding:

```sh
npm run db:migrate:remote
```

Verify that Wrangler is authenticated to the intended account and the `DB` binding resolves to the intended database before running this command. This changes the remote database. Roll back a Worker deployment separately from database changes; a code rollback does not undo migrations.

## Local authentication

The Worker fails API requests closed without valid Access configuration. For local-only development, create an untracked `.dev.vars` file containing `DEV_AUTH_BYPASS=true`, then visit `http://localhost:8787` (or `127.0.0.1`). The bypass is accepted only when the request URL uses a loopback hostname, but this is still a development convenience: never configure it on a deployed Worker, forward it through a public proxy, or use production resources for local tests. Remove the file when finished. Wrangler stores local D1 and R2 state under `.wrangler`; it can contain test data and should not be committed.

## Private data and offline behavior

Access is an online gate, not encryption of downloaded media. Offline files live in browser storage on each device and can remain available after the online Access session expires, provided the app shell and files are already saved. Reauthentication is required when contacting the protected service again. Browser storage can be evicted, cleared, or unavailable in private browsing; available quota and playback formats depend on the browser and device. Download over a reliable connection, confirm offline playback before relying on it, and keep originals backed up. Sign-out or revoking Access does not remotely erase previously downloaded data. Clear this site's storage on each device when removing local copies.

Access policies, identity configuration and credentials are security-critical. Protect the owner email account and Cloudflare account with strong authentication. D1 and R2 administrators can access stored data, and browser/device users may access local downloads. Do not put credentials, actual owner email, Access tokens, music files, or production data in the repository, build logs, issues, or screenshots.

## Backups and recovery

Keep independent copies of original audio outside R2. Export D1 using [Cloudflare's D1 export guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/) and copy the private R2 objects to a protected backup using the [R2 S3-compatible tools](https://developers.cloudflare.com/r2/examples/aws/aws-cli/). Protect exported metadata, objects, and credentials; a SQL export does not include R2 audio. Coordinate backups so metadata and objects represent the same point in time where possible. Periodically restore both into separate test resources and verify playback. Neither browser downloads nor Git are a complete backup.

## Upload and format limits

The main client uses authenticated8MiB multipart uploads to the existing private R2 bucket, with an enforced4GiB per-file cap. This avoids whole-file buffering in the Worker. The legacy multipart-form endpoint remains limited to25MiB audio plus5MiB artwork and31MiB total request. New artwork uploads remain limited to5MiB. Audio signatures identify MP3, FLAC, Ogg, WAV, MP4-family and WebM containers; actual codec playback depends on the browser. No transcoding is performed. Tests cover multipart objects above8MiB; production4GiB and real Android behavior remain unverified. See [features](features.md).

## Upgrade to Still Plus

Back up the existing D1 database and private R2 originals. Apply the committed migrations to the existing database before merging/deploying the release branch. The new migration is additive: favorites/tags/ReplayGain columns, upload sessions, smart playlists, a playback-state row, restore idempotency keys and pending object cleanup. Do not reset the database. Verify your actual database ID and existing binding names before running `npm run db:migrate:remote` from an authenticated local checkout or Cloudflare's authorized build environment. This operation changes production schema but does not deploy the Worker.

Then merge the release branch into the production branch used by Workers Builds. Keep Build=`npm run build` and Deploy=`npx wrangler deploy`. No new R2 bucket, D1 database, Access audience, secrets, CORS policy or public URL is required. Upload requests remain same-origin and authenticated; do not enable public R2 access or direct unauthenticated uploads. Keep the default seven-day incomplete-multipart lifecycle, or a longer one; old sessions are restarted by the client. Theme packages and sound preferences live in browser storage, not new Cloudflare bindings.

Validate theme import/export, a file above25MiB with interrupted/retried upload, cross-part seeking, paused offline download retry, backup restore into isolated resources, and handoff between two authenticated devices before trusting the upgrade with your only copy of music.

## Costs and limits

Cloudflare pricing and entitlements change; verify your account and current pricing before enabling services. As documented on 2026-11-14:

- [R2 Standard](https://developers.cloudflare.com/r2/pricing/) includes 10 GB-month of storage, 1 million Class A and 10 million Class B operations per month; the free tier does not cover Infrequent Access. Usage beyond included amounts is billed. R2 direct egress is free, but connected services can charge.
- [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) includes 100,000 requests per day and 10 ms CPU per invocation; other limits apply. Streaming and upload requests still consume service resources.
- [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/) includes 5 million rows read and 100,000 rows written per day and 5 GB total storage, subject to database limits. Queries fail when free daily usage is exhausted. See [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

These figures are not a spending cap or a guarantee of zero cost. Review billing, usage and limits in the Cloudflare dashboard, including Access and build entitlements, before use. Payment method requirements and pricing for the specific account are not verified here.

## Troubleshooting

- **Access loop or denied:** check the application hostname and path, exact email rule, identity provider, session, and device clock. Check the issuer, audience and allowed email in Worker runtime settings. Reauthenticate; do not weaken the policy to make the app work.
- **API errors:** check Worker logs without exposing tokens or personal metadata, confirm the D1 and R2 bindings point to the correct resources, and apply pending migrations deliberately. Confirm daily quotas and billing state.
- **Upload or playback fails:** check file type, file size and browser codec support; retry on a stable network. Test both a fresh stream and seeking. Check Cloudflare request limits and Worker logs.
- **Offline fails:** first load the app and save the track while online, then verify the browser has retained the app and local storage. Storage clearing, eviction, private browsing, or lack of space can remove downloads. Reconnect and download again.
- **A build fails:** confirm the correct repository branch, root, Node version, build command and deploy command in Workers Builds. Build environment variables and deployed Worker settings are distinct.

## Production acceptance checklist

Before adding a real library, verify with a small, non-sensitive test file:

- [ ] The intended hostname opens an Access login and the exact allowed email can authenticate.
- [ ] A different email is denied. An unauthenticated API request and a forged or wrong-audience token are rejected. Alternate Worker and preview hostnames cannot bypass authorization.
- [ ] R2 public access and `r2.dev` are disabled; no bucket custom domain exists. No object URL is public.
- [ ] Upload, library refresh, playback, seeking, editing and deletion work as intended; inspect both D1 and R2 for correct results.
- [ ] Download a track, reload once online, then turn the network off and open the app and play it. Repeat after an Access session expires. Reconnect and confirm online requests require authentication again.
- [ ] Check a second browser/device, mobile layout, supported formats, storage usage and quota failure behavior.
- [ ] Back up and restore D1 and R2 into isolated test resources. Confirm the restored library plays.
- [ ] Review Workers Builds settings, production branch permissions, billing, alerts, and the account's actual quotas. Record a rollback plan.

## Verification limits for this workspace

Production Cloudflare resources, the Access policy, domain routing, billing checkout, and real Android installation have not been configured or tested here. Local automated tests use Miniflare D1/R2 and signed test JWTs with a mocked JWKS endpoint. Service-worker routing is tested in a simulated worker environment; this does not establish real browser installation, storage eviction behavior, codec support, background playback, or Access-session expiry on a phone. The managed browser preview relay timed out, so desktop/mobile visual and interaction checks could not be completed.

The4GiB multipart cap is an enforced application limit, not a verified production capacity claim. Large-file production tests are still required. Local downloads remain device-local after server deletion on another device until removed or site storage is cleared. Simultaneous tabs/devices may race history clearing with in-flight listening-history submissions; pause playback and close other tabs when clearing history if a strict cutoff matters. This app has no remote erase mechanism for offline copies.
