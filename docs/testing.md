# Verification

Run `npm ci && npm run check`. Tests use actual local D1/R2 via Miniflare for API operations, real signed RSA JWTs against a mocked JWKS service for identity boundary cases, fake IndexedDB for durable history queue scenarios, and a simulated service-worker global for shell routing.

Coverage includes upload validation and retry idempotency; stream range and unsatisfiable range responses; playlist mutation, ordering, and batches above the D1 Free query count; history idempotency, clearing, offline retry, batches above 500, and same-page clear ordering; invalid/missing token claims and signatures; excluding private API and Access paths from shell cache; rejecting authentication redirects during shell installation.

`wrangler deploy --dry-run --outdir /tmp/still-worker` checks the Worker bundle without deployment. Never replace this with a live deployment from the coding workspace: production must use Cloudflare's GitHub connection.

For manual production and Android checks, use the acceptance checklist in deployment.md. Automated local checks cannot establish production privacy or real-device behavior.

## Latest local result

On 2026-11-14, `npm run check` passed: TypeScript, 15 tests across four files, and the production Vite build with a versioned offline shell. `wrangler deploy --dry-run` passed with the D1/R2/assets bindings; no live deployment was performed. `npm audit --omit=dev --audit-level=high` reported zero production dependency vulnerabilities.

Terra 6.1 agents independently reviewed security/data behavior and desktop/Android interface code. Material findings were corrected, including required JWT expiry, upload body bounds, D1 batching, offline queue batching and retry, modal focus, mobile playback control reachability, download response validation, and installation guidance. The interface review was limited to source because the managed preview relay could not start; no screenshot or real browser pass is claimed.
