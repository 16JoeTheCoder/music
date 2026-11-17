# Verification

Run `npm ci && npm run check`. Tests use actual local D1/R2 via Miniflare for API operations, real signed RSA JWTs against a mocked JWKS service for identity boundary cases, fake IndexedDB for durable history queue scenarios, and a simulated service-worker global for shell routing.

Coverage includes upload validation and retry idempotency; stream range and unsatisfiable range responses; playlist mutation, ordering, and batches above the D1 Free query count; history idempotency, clearing, offline retry, batches above 500, and same-page clear ordering; invalid/missing token claims and signatures; excluding private API and Access paths from shell cache; rejecting authentication redirects during shell installation.

`wrangler deploy --dry-run --outdir /tmp/still-worker` checks the Worker bundle without deployment. Never replace this with a live deployment from the coding workspace: production must use Cloudflare's GitHub connection.

For manual production and Android checks, use the acceptance checklist in deployment.md. Automated local checks cannot establish production privacy or real-device behavior.

## Latest local result

On2026-11-17, the expanded suite passed32 tests across10 files before final packaging. It includes Miniflare multipart resume/finalize/idempotency, cross-part range reads, upload collision/auth rejection, handoff revisions, backup fields, artwork replacement/deletion, partial offline download retry and sign-in-page rejection, same-content restore identities, interrupted restore retry, theme schema/contrast rejection, player timer persistence under frequent time updates, queued state restore, rapid offline selection races, mocked Web Audio gain/EQ headroom, and DOM library/search/queue/appearance interactions.

The implementation was written by the main agent. Terra6.1 reviewers performed read-only security and UX checks, with their material findings corrected. DOM tests and mocked audio graphs do not prove real browser decoding, audio quality, sample-accurate gaplessness, background behavior, PWA installation, or phone layout. The managed preview relay again timed out, so no real-browser or real-Android pass is claimed. Cloudflare production resources and Access are not verified here. No live deployment is run from this workspace.
