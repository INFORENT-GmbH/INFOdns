# INFOdns — Claude Context

## What this is

Internal DNS management panel. React SPA + Fastify API + Node worker + hidden primary BIND + 3 public secondaries. MariaDB is the source of truth; zone files are always derived from it.

## Project state

All phases complete and working:
- Auth (JWT + httpOnly refresh cookie, silent refresh on mount)
- RBAC: admin / operator / customer (ownership enforced at SQL level)
- Domain + record CRUD with per-type Zod validators
- Zone render pipeline: Worker polls queue → renders zone → named-checkzone → atomic file replace → rndc reload
- Bulk editing: add / replace / delete / upsert / change_ttl across many domains
- WebSocket live updates: domain_status, record_changed, bulk_job_progress
- Audit log
- Inline record editing on domain detail page (no modal — deferred apply)

Not yet built: password change UI, DNSSEC, health endpoints, graceful SIGTERM, SOA template UI, backup script.

## Critical architecture notes

**Zone render order (worker/src/index.ts `processJob`):**
`syncNamedConf()` must run BEFORE `deployZone()` on every job — not just on domain add/remove. This fixes the race where a newly created domain's rndc reload returns "not found" because BIND's named.conf.local hadn't been updated yet.

**WebSocket token timing:**
`useWs(accessToken)` is mounted in `Layout` (not in `RequireAuth` or `App`). It receives `accessToken` as React state from `AuthContext` — not the module-level axios token — so the effect re-runs when the token becomes available after silent refresh.

**Bulk match precision:**
Always include `name` in match criteria. Without it, a replace/delete targeting `type=A, value=x.x.x.x` will hit ALL A records with that value (e.g. both `@` and `mail`).

**Worker → API events:**
Worker is a separate process and can't access the in-process WS hub directly. It POSTs to `/internal/broadcast` (protected by `x-internal-secret` header, only reachable inside the Docker `internal` network). Hub then pushes to all connected WS clients.

**named-checkzone binary:**
Must be available in the worker container. Set `NAMED_CHECKZONE_BIN` env var to override the path if needed.

**zone_render_queue uniqueness:**
UNIQUE KEY on `domain_id` — only one pending job per domain. Rapid edits coalesce into one render.

## Key files

| File | Purpose |
|---|---|
| `mariadb/init/001_schema.sql` | Source of truth for data model |
| `worker/src/index.ts` | Poll loop + processJob orchestration |
| `worker/src/renderZone.ts` | Pure function: DB records → BIND zone string |
| `worker/src/deployZone.ts` | Atomic file replace + rndc reload |
| `worker/src/namedConf.ts` | named.conf.local generator + rndc reconfig |
| `worker/src/broadcast.ts` | Fire-and-forget POST to /internal/broadcast |
| `worker/src/bulkExecutor.ts` | Processes approved bulk jobs in batches of 50 |
| `api/src/ws/hub.ts` | In-process WS client registry |
| `api/src/records/validators.ts` | Per-type DNS record Zod validators |
| `api/src/bulk/routes.ts` | Bulk job CRUD, preview, approve |
| `web/src/pages/DomainDetailPage.tsx` | Inline record editing with deferred apply |
| `web/src/hooks/useWs.ts` | WS hook — reconnects, routes events to React Query |
| `web/nginx.conf` | SPA fallback + /api/ proxy with WS upgrade headers |

## Preferences

- Inline table editing over modals
- Changes staged locally, applied all at once (deferred apply pattern)
- Queries always enabled — no "search first" gates
- Zod errors come back as JSON string inside `message` — unwrap to `field: message` for display
- No unnecessary abstractions or extra error handling for impossible cases
