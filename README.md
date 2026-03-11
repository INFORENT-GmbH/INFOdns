# INFOdns

An internal DNS management panel modelled on AutoDNS. Staff and customers manage DNS records for many domains via a hidden primary BIND server that pushes zones to three public secondaries via AXFR/IXFR. The database is the single source of truth; zone files are always derived from it.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Docker Compose Stack                     │
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────────┐ │
│  │  Web UI  │──▶│   API    │──▶│         Worker           │ │
│  │ (React)  │   │(Fastify) │   │  (zone gen + rndc reload)│ │
│  └──────────┘   └────┬─────┘   └───────────┬──────────────┘ │
│        ▲  WS         │                      │                │
│        └─────────────┘             ┌────────▼────────┐       │
│                 ┌────▼─────┐       │  Hidden Primary │       │
│                 │ MariaDB  │       │     BIND 9.18   │       │
│                 └──────────┘       └────────┬────────┘       │
│                                             │ AXFR/IXFR      │
│                                  ┌──────────┼──────────┐     │
│                                  ▼          ▼          ▼     │
│                             ┌────────┐ ┌────────┐ ┌────────┐ │
│                             │  NS1   │ │  NS2   │ │  NS3   │ │
│                             └────────┘ └────────┘ └────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. User edits a record in the Web UI
2. API validates, writes to MariaDB, enqueues a render job
3. Worker renders the zone file, validates with `named-checkzone`, atomically replaces the file, runs `rndc reload`
4. Primary sends NOTIFY → secondaries pull via AXFR/IXFR
5. Worker broadcasts a WebSocket event → UI status badge updates live

The Worker is the **only** process that writes zone files or calls rndc.

---

## Services

| Service | Image / Build | Networks | Ports |
|---|---|---|---|
| `db` | `mariadb:11` | internal | — |
| `api` | `./api` (Fastify + Node) | internal + public | 3000 |
| `worker` | `./worker` (Node poll loop) | internal | — |
| `web` | `./web` (React + Vite + nginx) | public | 80 |
| `bind-primary` | `internetsystemsconsortium/bind9:9.18` | **internal only** | 53, 953 (internal) |
| `bind-secondary1/2/3` | same image | internal + public | 5301–5303:53 |

`bind-primary` is on the `internal: true` Docker network — it is **never reachable from the internet**.

---

## Directory Layout

```
INFOdns/
├── docker-compose.yml
├── .env                        ← secrets (never commit)
├── .env.example
├── api/                        ← Fastify API
│   └── src/
│       ├── index.ts            ← server bootstrap, plugin registration
│       ├── db.ts               ← mysql2 pool helpers
│       ├── auth/               ← JWT sign/verify, login/refresh/logout routes
│       ├── middleware/auth.ts  ← requireAuth, RBAC enforcement
│       ├── domains/routes.ts   ← CRUD for domains
│       ├── records/
│       │   ├── routes.ts       ← CRUD for dns_records, enqueues render
│       │   └── validators.ts   ← per-type Zod validators (A/AAAA/MX/SRV/…)
│       ├── bulk/routes.ts      ← bulk job CRUD, preview, approve
│       ├── customers/routes.ts
│       ├── users/routes.ts
│       ├── audit/              ← audit log middleware + read routes
│       └── ws/
│           ├── hub.ts          ← in-process WebSocket client registry
│           ├── routes.ts       ← GET /api/v1/ws — upgrade + JWT auth
│           └── internal.ts     ← POST /internal/broadcast — worker→hub bridge
├── worker/                     ← Node poll loop
│   └── src/
│       ├── index.ts            ← poll loop, job claim, processJob orchestration
│       ├── renderZone.ts       ← pure function: DB records → BIND zone string
│       ├── validateZone.ts     ← shells out to named-checkzone
│       ├── deployZone.ts       ← atomic file replace + rndc reload
│       ├── namedConf.ts        ← named.conf.local generator + rndc reconfig
│       ├── serialNumber.ts     ← YYYYMMDDnn serial inside a DB transaction
│       ├── bulkExecutor.ts     ← processes approved bulk jobs in batches
│       ├── broadcast.ts        ← fire-and-forget POST to /internal/broadcast
│       └── db.ts               ← mysql2 pool helpers
├── web/                        ← React + Vite SPA
│   ├── nginx.conf              ← SPA fallback + /api/ proxy + WS upgrade
│   └── src/
│       ├── App.tsx             ← router, QueryClientProvider, AuthProvider
│       ├── context/AuthContext.tsx  ← JWT state, silent refresh on mount
│       ├── hooks/useWs.ts      ← WebSocket hook, reconnects, cache updates
│       ├── api/client.ts       ← axios instance + all API call functions
│       ├── components/
│       │   ├── Layout.tsx      ← nav bar, useWs(accessToken) mounted here
│       │   └── ZoneStatusBadge.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── DomainsPage.tsx
│           ├── DomainDetailPage.tsx  ← inline record editing, apply via bulk job
│           ├── BulkJobsPage.tsx
│           ├── CustomersPage.tsx
│           ├── UsersPage.tsx
│           └── AuditLogPage.tsx
├── bind/
│   ├── primary/                ← named.conf, zones/ (written by worker)
│   ├── secondary1/2/3/         ← named.conf, zones/ (written by BIND via AXFR)
│   ├── tsig.key                ← TSIG for AXFR auth (not committed)
│   └── rndc.key                ← rndc control key (not committed)
├── mariadb/
│   ├── data/                   ← MariaDB data dir (not committed)
│   └── init/001_schema.sql     ← full schema, runs once on first start
└── scripts/
    ├── init-tsig.sh
    ├── init-rndc.sh
    └── backup.sh
```

---

## Initial Setup

### 1. Generate secrets

```bash
# TSIG key for AXFR authentication
./scripts/init-tsig.sh

# rndc control key
./scripts/init-rndc.sh
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DB_ROOT_PASSWORD=<strong password>
DB_PASSWORD=<strong password>
JWT_SECRET=<32+ random chars>
JWT_REFRESH_SECRET=<32+ random chars>
INTERNAL_SECRET=<random hex, e.g. openssl rand -hex 32>

# NS records injected into every zone (trailing dot required)
NS_RECORDS=ns1.yourdomain.com.,ns2.yourdomain.com.,ns3.yourdomain.com.

# SOA primary nameserver + contact
SOA_MNAME=ns1.yourdomain.com.
SOA_RNAME=hostmaster.yourdomain.com.

# Public URL of the API — what the browser talks to
PUBLIC_API_URL=https://dns.yourdomain.com
```

`INTERNAL_SECRET` is shared between `api` and `worker`. It protects `/internal/broadcast` which is only reachable inside the Docker internal network — it is never exposed publicly.

### 3. Start the stack

```bash
docker compose up -d
```

### 4. Create first admin user

```bash
docker compose exec api node -e "
const bcrypt = require('bcrypt');
const { query } = require('./dist/db.js');
bcrypt.hash('yourpassword', 12).then(h =>
  query('INSERT INTO users (customer_id,email,password_hash,role,full_name) VALUES (NULL,?,?,?,?)',
    ['admin@example.com', h, 'admin', 'Admin'])
).then(() => process.exit(0));
"
```

---

## Zone Render Pipeline

Every record mutation (create / update / delete) calls `enqueueRender(domainId)` in the API, which inserts or updates a row in `zone_render_queue` with `status = 'pending'`.

The worker polls every 2 seconds and processes pending jobs:

1. **Claim** — `UPDATE zone_render_queue SET status='processing' WHERE id=? AND status='pending'` (optimistic lock; only one worker wins)
2. **Load** — fetch domain, customer, SOA template, all non-deleted records
3. **Serial** — `SELECT last_serial FOR UPDATE`, compute `YYYYMMDDnn`, update atomically
4. **Render** — pure TypeScript function builds the zone file string: `$ORIGIN`, `$TTL`, SOA, NS records (from env), then all records
5. **Validate** — `named-checkzone <fqdn> <tmpfile>` — non-zero exit marks the job failed
6. **Sync conf** — regenerate `named.conf.local` for primary (and all secondaries) and run `rndc reconfig` — ensures newly created domains are known to BIND before reload
7. **Deploy** — write to `<fqdn>.zone.tmp`, then `rename()` to `<fqdn>.zone` (atomic)
8. **Reload** — `rndc -s bind-primary -p 953 reload <fqdn>`
9. **Mark clean** — update `domains.zone_status = 'clean'`, queue row `status = 'done'`
10. **Broadcast** — POST to `/internal/broadcast` → WebSocket hub pushes `domain_status` event to all connected clients

On failure after `max_retries` (default 3): job marked `failed`, domain marked `error`, error message stored in queue and broadcast via WebSocket.

**Important:** `syncNamedConf()` runs before `deployZone()` inside `processJob`. This fixes a race where a newly created domain's zone file would be deployed before BIND knew about the zone, causing `rndc reload` to return "not found".

---

## WebSocket Live Updates

The UI connects to `ws[s]://<host>/api/v1/ws?token=<access_token>` immediately after login (mounted in `Layout`, which only renders after auth is confirmed).

nginx forwards WebSocket upgrades to the API:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_read_timeout 3600s;
```

The API verifies the JWT from the query string before upgrading. On close the client reconnects after 3 seconds.

### Event types

| Type | Payload | UI effect |
|---|---|---|
| `domain_status` | `domainId, zone_status, last_serial, last_rendered_at, zone_error` | Updates domain detail cache, invalidates domain list |
| `record_changed` | `domainId` | Invalidates records cache for that domain |
| `bulk_job_progress` | `jobId, status, processed_domains, affected_domains` | Updates bulk job cache, invalidates job list |

Worker → API communication uses a private HTTP endpoint `/internal/broadcast` protected by `x-internal-secret`. This is only reachable inside the Docker `internal` network.

---

## Bulk Editing

Bulk jobs apply record mutations across many domains at once.

### Operations

| Operation | What it does |
|---|---|
| `add` | Add records to matched domains |
| `replace` | Find matching records and replace them |
| `delete` | Delete matching records |
| `upsert` | Replace if exists, add if not |
| `change_ttl` | Change TTL on matching records |

### Filter modes

```json
{ "mode": "all" }
{ "mode": "customer", "customer_ids": [1, 2] }
{ "mode": "explicit", "domain_ids": [10, 11] }
```

### Match criteria

```json
{
  "match": {
    "name": "@",
    "type": "A",
    "value_contains": "1.2.3.4"
  }
}
```

All three fields are optional and ANDed together. Always specify `name` when targeting a specific record to avoid hitting multiple records with the same type/value (e.g. `@` vs `mail` A records pointing to the same IP).

### Lifecycle

`draft` → `previewing` → `approved` → `running` → `done` / `failed`

- **Preview** resolves the filter to a domain list and computes per-domain diffs
- **Approve** triggers the worker to execute in batches of 50 domains
- Each domain is isolated — one failure does not stop the batch
- Zone renders are enqueued per domain after mutations

---

## Inline Record Editing (Domain Detail Page)

Records are edited directly in the table — no modal. All changes are staged locally and applied together when the user clicks **Apply changes**.

- **Edit** — click any field (name, type, TTL, value) and type. Row turns yellow.
- **Add** — click **+ Add Record** to insert a new empty row at the top (green). Fill in fields.
- **Delete** — click Delete to mark a row red. Click Restore to undo.
- **Revert** — click ↩ on a dirty row to revert just that row.
- **Apply** — creates records, deletes records, and creates bulk jobs (replace) for edits, then clears all pending state.
- **Discard** — clears all pending state without saving.

Apply order: new records first → deletes → edits (via bulk replace).

---

## RBAC

| Role | Domains | Records | Bulk Jobs | Customers | Users | Audit |
|---|---|---|---|---|---|---|
| `admin` | all CRUD | all CRUD | all CRUD | all CRUD | all CRUD | read all |
| `operator` | all CRUD | all CRUD | all CRUD | read | — | read all |
| `customer` | own only | own only | own only | — | own profile | own only |

Ownership is enforced at the SQL level — `AND customer_id = ?` is injected for customer-role requests.

---

## Auth

- **Access token**: JWT, 15-minute lifetime, signed with `JWT_SECRET`
- **Refresh token**: 7-day lifetime, stored as SHA-256 hash in `refresh_tokens` table, set as `httpOnly` cookie
- On page load the browser silently calls `POST /auth/refresh` — if the cookie is valid a new access token is issued; otherwise the user is redirected to `/login`
- Passwords: bcrypt cost 12

---

## Security Notes

- `bind-primary` is on a Docker `internal: true` network — no internet egress or ingress possible
- TSIG key (`hmac-sha256`) authenticates AXFR transfers between primary and secondaries; never committed to git
- rndc key is separate from TSIG; worker holds it via volume mount + env pointer
- `INTERNAL_SECRET` protects the worker→API broadcast endpoint; only reachable inside the internal Docker network
- All secrets live in `.env` — never commit it
- Rate limiting on auth endpoints (10 req/min per IP via `@fastify/rate-limit`)
- Security headers via `@fastify/helmet`

---

## Development

### Running locally (without Docker)

Requires Node 20+, a local MariaDB instance, and BIND tools installed for `named-checkzone`.

```bash
# API
cd api && npm install && npm run dev

# Worker
cd worker && npm install && npm run dev

# Web
cd web && npm install && npm run dev
```

Set `VITE_API_URL=http://localhost:3000` in `web/.env.local` for the dev server to proxy correctly.

### Rebuilding after code changes

```bash
docker compose up -d --build api worker web
```

### Viewing logs

```bash
docker compose logs -f api
docker compose logs -f worker
```

---

## Environment Variables Reference

| Variable | Service | Description |
|---|---|---|
| `DB_ROOT_PASSWORD` | db | MariaDB root password |
| `DB_PASSWORD` | api, worker | MariaDB `infodns` user password |
| `JWT_SECRET` | api | Access token signing key |
| `JWT_REFRESH_SECRET` | api | Refresh token signing key |
| `INTERNAL_SECRET` | api, worker | Shared secret for `/internal/broadcast` |
| `NS_RECORDS` | worker | Comma-separated NS FQDNs for zone rendering |
| `SOA_MNAME` | worker | SOA primary nameserver (trailing dot) |
| `SOA_RNAME` | worker | SOA hostmaster email in DNS format (trailing dot) |
| `SECONDARY_HOSTS` | worker | Comma-separated secondary BIND hostnames for rndc |
| `PUBLIC_API_URL` | web | Full URL the browser uses to reach the API |
| `API_INTERNAL_URL` | worker | Internal Docker URL for the API (`http://api:3000`) |
| `NAMED_CHECKZONE_BIN` | worker | Override path to `named-checkzone` binary |
