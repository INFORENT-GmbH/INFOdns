# INFORENT Prisma

An internal DNS management panel modelled on AutoDNS. Staff and tenants manage DNS records for many domains via a hidden primary BIND server that pushes zones to public secondaries via AXFR/IXFR. The database is the single source of truth; zone files are always derived from it.

The panel goes beyond plain zone management: it includes a multi-tenant support ticket system with email import, an ISP database migration tool, registrar and TLD pricing administration, reusable record templates, DNSSEC management, multi-resolver DNS health checks, an audit log, bulk editing across many domains, live nameserver status, a mail queue, and full English/German localization.

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

**Data flow (record edit):**
1. User edits a record in the Web UI
2. API validates, writes to MariaDB, enqueues a render job
3. Worker renders the zone file, validates with `named-checkzone`, atomically replaces the file, runs `rndc reload`
4. Worker updates the catalog zone (RFC 9432) → primary sends NOTIFY → secondaries automatically discover and pull all member zones via AXFR
5. Worker broadcasts a WebSocket event → UI status badge updates live

**Email notifications** are DB-queued: the API (or worker) inserts a row into `mail_queue` with a template name + JSON payload. The worker poll loop picks it up, renders the HTML template, and sends via SMTP with up to 10 retries. Templates: login notification (per-user, localized en/de), zone deploy success/failure (admin-only), ticket new/reply (per-tenant + admin), invite, password reset.

**Ticket import** runs in the worker: an IMAP poll loop ingests messages from the support mailbox and converts them into ticket messages, threading by `Message-ID` / `In-Reply-To` and falling back to subject `[#nnn]` markers.

The Worker is the **only** process that writes zone files or calls rndc.

---

## Services

| Service | Image / Build | Networks | Ports |
|---|---|---|---|
| `db` | `mariadb:11` | internal + public | 3306 |
| `phpmyadmin` | `phpmyadmin/phpmyadmin` | internal + public | 8080 |
| `api` | `./api` (Fastify + Node) | internal + public | 3000 |
| `worker` | `./worker` (Node poll loop) | internal | — |
| `web` | `./web` (React + Vite + nginx) | public | 80 |
| `bind-primary` | `internetsystemsconsortium/bind9:9.18` | **internal only** | 53, 953 (internal) |

`bind-primary` is on the `internal: true` Docker network — it is **never reachable from the internet**.

The two public secondaries run on real external servers deployed separately:

| Server | Hostname | IP | Role |
|---|---|---|---|
| ns1 | `ns1.dns.inforant.de` | `168.119.122.226` | Hidden primary (Docker stack) |
| ns3 | `ns3.dns.infrant.de` | `5.78.139.169` | Public secondary |
| ns2 | `ns2.dns.inforant.de` | `89.167.67.148` | Public secondary |

---

## Feature Overview

### DNS & Zone Management
- **Domain & record CRUD** — A, AAAA, CNAME, MX, NS, TXT, SRV, CAA, PTR, NAPTR, TLSA, SSHFP, DS, ALIAS — each with per-type Zod validators
- **Zone render pipeline** — DB → rendered zone file → `named-checkzone` → atomic file replace → `rndc reload`
- **Catalog zones** (RFC 9432) — secondaries auto-discover member zones; no manual per-zone config on secondaries
- **Bulk editing** — `add` / `replace` / `delete` / `upsert` / `change_ttl` across many domains, with preview-then-approve flow
- **Inline record editing** — domain detail page edits records directly in the table; changes staged locally and applied together (no modal)
- **Zone file import** — paste an RFC 1035 zone file into a single domain; parser stages new/conflict/edited rows for review before applying
- **DNS health check** — on-demand multi-resolver `dig` against a domain; highlights resolver disagreements
- **DNSSEC** — enable/disable per domain; worker periodically verifies DNSKEY visibility; UI shows the DS record (keytag + SHA-256 digest) for parent registration
- **Domain labels** — key=value tags with auto-generated or hex colors, used for filtering and organization
- **DNS templates** — reusable record sets attachable to domains; apply modes `add_missing`, `overwrite_matching`, `replace_all`
- **Audit log** — every record/domain/template/bulk mutation captured with JSON diff and user/IP

### Multi-tenancy & Auth
- **JWT auth** — 15-min access token + 7-day httpOnly refresh cookie, silent refresh on mount, bcrypt cost 12
- **RBAC** — `admin` / `operator` / `tenant`; tenant ownership enforced in SQL
- **User invitations** — admin/operator creates an invite, system emails a one-time activation link; user sets password on accept
- **Multi-tenant users** — a single user can be linked to multiple tenants via `user_tenants`
- **i18n** — UI fully localized in English and German; user locale stored on the user record

### Operations & Observability
- **WebSocket live updates** — domain status, record changes, bulk job progress, NS status changes
- **Nameserver status monitor** — API polls TCP/53 on ns1/ns2/ns3 every 2s, broadcasts state changes; history kept in `ns_checks`
- **Mail queue** — DB-backed send queue with up to 10 retries; admin UI to view, retry, or inspect failures
- **Auto-migrations** — API runs pending SQL migrations from `mariadb/migrations/` on startup
- **Health endpoints** — `GET /health` (liveness) and `GET /ready` (DB connectivity)
- **Rate limiting** — 10 req/min per IP on auth endpoints
- **Security headers** — `@fastify/helmet`

### Support & Billing Adjacencies
- **Support ticket system** — multi-channel (web + email IMAP), statuses (open/in_progress/waiting/closed), priorities, assignment to staff, internal-only notes, file attachments per message, threading by `Message-ID`/`In-Reply-To`
- **Registrar directory** — manage registrar codes (CN, MARCARIA, UD, UDR…), names, URLs
- **TLD pricing** — per-zone cost/fee + per-registrar prices; default registrar auto-assigned at import time based on domain TLD
- **ISP database import** — bulk migrate tenants, TLD pricing, domains, and DNS records from a legacy `isp` schema; preview shows insert/update/skip/overwrite per row, then run selectively

---

## Directory Layout

```
INFOdns/
├── docker-compose.yml
├── .env                        ← secrets (never commit)
├── .env.example
├── api/                        ← Fastify API
│   └── src/
│       ├── index.ts            ← server bootstrap, plugin & route registration, runs migrations, starts NS poller
│       ├── db.ts               ← mysql2 pool helpers + runMigrations()
│       ├── auth/               ← JWT sign/verify, login/refresh/logout, invite accept, password reset
│       ├── middleware/auth.ts  ← requireAuth, RBAC enforcement
│       ├── domains/routes.ts   ← CRUD for domains + labels + DNSSEC + DNS check
│       ├── records/
│       │   ├── routes.ts       ← CRUD for dns_records, enqueues render
│       │   ├── validators.ts   ← per-type Zod validators
│       │   └── parseZone.ts    ← RFC 1035 zone file parser (single-domain import)
│       ├── bulk/routes.ts      ← bulk job CRUD, preview, approve
│       ├── tenants/routes.ts
│       ├── users/routes.ts     ← user CRUD, invites
│       ├── tickets/routes.ts   ← support ticket CRUD, messages, attachments
│       ├── import/             ← ISP database migration
│       │   ├── routes.ts       ← preview + run
│       │   └── executor.ts     ← transactional insert/update across tenants/tld_pricing/domains/records
│       ├── registrars/routes.ts
│       ├── templates/routes.ts ← DNS record templates + apply
│       ├── tld-pricing/routes.ts
│       ├── ns-status/index.ts  ← TCP/53 poller + broadcaster + GET /ns-status
│       ├── mail-queue/routes.ts← admin view + retry
│       ├── audit/              ← audit log middleware + read routes
│       └── ws/
│           ├── hub.ts          ← in-process WebSocket client registry
│           ├── routes.ts       ← GET /api/v1/ws — upgrade + JWT auth via Sec-WebSocket-Protocol
│           └── internal.ts     ← POST /internal/broadcast — worker→hub bridge
├── worker/                     ← Node poll loop
│   └── src/
│       ├── index.ts            ← poll loop, job claim, processJob orchestration
│       ├── renderZone.ts       ← pure function: DB records → BIND zone string
│       ├── validateZone.ts     ← shells out to named-checkzone
│       ├── deployZone.ts       ← atomic file replace + rndc reload
│       ├── namedConf.ts        ← named.conf.local generator + catalog zone deploy + rndc reconfig
│       ├── catalogZone.ts      ← renders catalog zone (RFC 9432)
│       ├── nsDelegation.ts     ← parent-zone NS delegation check helper
│       ├── dnssecCheck.ts      ← periodic DNSKEY visibility check + broadcast
│       ├── serialNumber.ts     ← YYYYMMDDnn serial inside a DB transaction
│       ├── bulkExecutor.ts     ← processes approved bulk jobs in batches
│       ├── ticketMailImporter.ts← IMAP poll → ticket_messages
│       ├── broadcast.ts        ← fire-and-forget POST to /internal/broadcast
│       ├── mailer.ts           ← mail queue poller (DB-backed, retry up to 10×)
│       ├── mailTemplates.ts    ← HTML email templates (login, zone deploy, ticket, invite, reset)
│       └── db.ts               ← mysql2 pool helpers
├── web/                        ← React + Vite SPA
│   ├── nginx.conf              ← SPA fallback + /api/ proxy + WS upgrade
│   └── src/
│       ├── App.tsx             ← router, QueryClientProvider, AuthProvider, I18nProvider
│       ├── context/AuthContext.tsx
│       ├── i18n/               ← I18nContext + en/de translations
│       ├── hooks/
│       │   ├── useWs.ts        ← WebSocket hook (Sec-WebSocket-Protocol auth, reconnect, cache routing)
│       │   ├── useModalA11y.ts ← focus trap, ESC, return focus
│       │   ├── useIsMobile.ts
│       │   ├── navGuard.ts     ← warns on dirty-state navigation
│       │   └── domainEditCache.ts ← persists in-flight inline edits across navigations
│       ├── api/client.ts       ← axios instance + all API call functions
│       ├── components/
│       │   ├── Layout.tsx      ← nav bar, useWs(accessToken) mounted here
│       │   ├── ZoneStatusBadge.tsx
│       │   ├── LabelChip.tsx
│       │   ├── ColorPicker.tsx
│       │   ├── DnsCheckModal.tsx   ← multi-resolver dig comparison
│       │   ├── DnssecModal.tsx     ← enable/disable + DS record display
│       │   ├── ImportZoneModal.tsx ← single-domain zone file import
│       │   ├── RecordModal.tsx
│       │   ├── Select.tsx
│       │   └── Tooltip.tsx
│       └── pages/
│           ├── LoginPage.tsx
│           ├── AcceptInvitePage.tsx
│           ├── DomainsLayout.tsx + DomainsDashboard.tsx + DomainsPage.tsx
│           ├── DomainDetailPage.tsx
│           ├── JobsPage.tsx              ← bulk job list + wizard
│           ├── ImportPage.tsx            ← ISP migration UI
│           ├── TenantsPage.tsx
│           ├── UsersPage.tsx
│           ├── TicketsPage.tsx + TicketDetailPage.tsx
│           ├── RegistrarsPage.tsx
│           ├── TemplatesPage.tsx
│           ├── TldPricingPage.tsx
│           ├── MailQueuePage.tsx
│           └── AuditLogPage.tsx
├── bind/
│   ├── primary/                ← named.conf, zones/, keys-dnssec/ (written by worker), deployed to ns1
│   ├── secondary3/             ← named.conf + options + catalog zone config, deployed to ns3 by CI
│   ├── secondary2/             ← named.conf + options + catalog zone config, deployed to ns2 by CI
│   ├── tsig.key                ← TSIG for AXFR auth (not committed, deploy manually)
│   └── rndc.key                ← rndc control key (not committed, deploy manually)
├── .github/
│   └── workflows/
│       ├── deploy-ns1.yml      ← deploy full stack to ns1 on push to main
│       ├── deploy-ns3.yml      ← deploy BIND config to ns3 on bind/secondary3 change
│       └── deploy-ns2.yml      ← deploy BIND config to ns2 on bind/secondary2 change
├── mariadb/
│   ├── data/                   ← MariaDB data dir (not committed)
│   ├── init/001_schema.sql     ← initial schema, runs once on first start
│   └── migrations/             ← incremental SQL, applied by API at startup
├── uploads/                    ← ticket attachment storage (mounted into api)
└── scripts/
    ├── init-tsig.sh
    ├── init-rndc.sh
    └── backup.sh
```

---

## Database Schema

| Table | Purpose |
|---|---|
| `tenants` | Customers / organizations |
| `users` | Staff + tenant accounts (with `locale` for i18n) |
| `user_tenants` | Many-to-many user ↔ tenant |
| `user_invites` | One-time activation tokens |
| `refresh_tokens` | SHA-256 hashed refresh tokens |
| `soa_templates` | SOA defaults (global + per-tenant) |
| `domains` | Domain registry — zone status, DNSSEC fields, import metadata |
| `labels` + `domain_labels` | Key=value tags with colors |
| `dns_records` | DNS record store (incl. ALIAS) |
| `zone_render_queue` | Async render jobs (UNIQUE on `domain_id` — coalesces edits) |
| `bulk_jobs` + `bulk_job_domains` | Batch edit operations and per-domain status |
| `audit_logs` | Immutable change log with JSON diff |
| `ns_checks` | Nameserver health history |
| `support_tickets` + `ticket_messages` + `ticket_attachments` | Ticket system |
| `registrars` | Registrar directory |
| `tld_pricing` | TLD cost + per-registrar prices |
| `dns_templates` + `dns_template_records` + `domain_templates` | Reusable record templates |
| `mail_queue` | Outbound email queue with retry |

Schema lives in [mariadb/init/001_schema.sql](mariadb/init/001_schema.sql); incremental changes go in [mariadb/migrations/](mariadb/migrations/) and are applied automatically by the API at startup.

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

Edit `.env` (see the [Environment Variables Reference](#environment-variables-reference) for the full list).

### 3. Start the stack

```bash
docker compose up -d
```

The API runs pending migrations from `mariadb/migrations/` on every start.

### 4. Create first admin user

```bash
docker compose exec api node -e "
const bcrypt = require('bcrypt');
const { query } = require('./dist/db.js');
bcrypt.hash('yourpassword', 12).then(h =>
  query('INSERT INTO users (tenant_id,email,password_hash,role,full_name) VALUES (NULL,?,?,?,?)',
    ['admin@example.com', h, 'admin', 'Admin'])
).then(() => process.exit(0));
"
```

Subsequent users can be added via the **Users** page using the invitation flow.

---

## Deployment (GitHub Actions)

Three workflows handle deployment on every push to `main`:

| Workflow | Trigger | Target | What it deploys |
|---|---|---|---|
| `deploy-ns1.yml` | Any change except secondary configs | `ns1.inforant.net` | Full Docker Compose stack |
| `deploy-ns3.yml` | `bind/secondary3/**` changed | `ns3.dns.infrant.de` | BIND config only (to `/etc/bind/`) |
| `deploy-ns2.yml` | `bind/secondary2/**` changed | `ns2.dns.inforant.de` | BIND config only (to `/etc/bind/`) |

### Required GitHub Secrets & Variables

In **Settings → Secrets and variables → Actions**:

| Name | Type | Value |
|---|---|---|
| `SSH_PRIVATE_KEY` | Secret | Ed25519 private key with root access to all three servers |
| `SSH_PATH_NS1` | Variable | `root@ns1.inforant.net:/root/bind` |
| `SSH_PATH_NS3` | Variable | `root@ns3.dns.infrant.de:/root/bind` |
| `SSH_PATH_NS2` | Variable | `root@ns2.dns.inforant.de:/root/bind` |

### One-time server setup

Each server needs the corresponding public SSH key in `/root/.ssh/authorized_keys`. The ns1 server also needs Docker and Docker Compose installed.

On the secondary servers, the deploy user (`inforent`) needs passwordless sudo so the CI workflow can sync config to `/etc/bind/`, install BIND, and run `rndc`:

```bash
# On ns2 and ns3 (run once as root):
echo 'inforent ALL=(ALL) NOPASSWD:ALL' | tee /etc/sudoers.d/inforent
```

The initial TSIG key must be placed manually before the first deploy:

```bash
# On ns2 and ns3 (run once):
mkdir -p /etc/bind
scp bind/tsig.key inforent@ns2.dns.inforant.de:/etc/bind/tsig.key
scp bind/tsig.key inforent@ns3.dns.infrant.de:/etc/bind/tsig.key
```

The CI workflow syncs `bind/secondary2/` (or `secondary3/`) directly to `/etc/bind/` on the server. The config includes a catalog zone entry — secondaries automatically discover and pull all member zones from ns1 without needing per-zone configuration.

```
include "/etc/bind/tsig.key";
include "/etc/bind/named.conf.options";
include "/etc/bind/named.conf.local";
```

---

## Zone Render Pipeline

Every record mutation (create / update / delete) calls `enqueueRender(domainId)` in the API, which inserts or updates a row in `zone_render_queue` with `status = 'pending'`. The UNIQUE key on `domain_id` means rapid edits coalesce into a single render.

The worker polls every 2 seconds and processes pending jobs:

1. **Claim** — `UPDATE zone_render_queue SET status='processing' WHERE id=? AND status='pending'` (optimistic lock; only one worker wins)
2. **Load** — fetch domain, tenant, SOA template, all non-deleted records
3. **Serial** — `SELECT last_serial FOR UPDATE`, compute `YYYYMMDDnn`, update atomically
4. **Render** — pure TypeScript function builds the zone file string: `$ORIGIN`, `$TTL`, SOA, NS records (from env), then all records
5. **Validate** — `named-checkzone <fqdn> <tmpfile>` — non-zero exit marks the job failed
6. **Sync conf** — regenerate `named.conf.local` for the primary, render + deploy the catalog zone (RFC 9432), and run `rndc reconfig` + `rndc reload catalog.dns.inforant.de` — ensures newly created domains are known to BIND before reload
7. **Deploy** — write to `<fqdn>.zone.tmp`, then `rename()` to `<fqdn>.zone` (atomic)
8. **Reload** — `rndc -s bind-primary -p 953 reload <fqdn>`
9. **Mark clean** — update `domains.zone_status = 'clean'`, queue row `status = 'done'`
10. **Broadcast** — POST to `/internal/broadcast` → WebSocket hub pushes `domain_status` event to all connected clients

On failure after `max_retries` (default 3): job marked `failed`, domain marked `error`, error message stored in queue and broadcast via WebSocket.

**Important:** `syncNamedConf()` runs before `deployZone()` inside `processJob`. This fixes a race where a newly created domain's zone file would be deployed before BIND knew about the zone, causing `rndc reload` to return "not found".

---

## WebSocket Live Updates

The UI connects to `ws[s]://<host>/api/v1/ws` immediately after login (mounted in `Layout`, which only renders after auth is confirmed). The access token is sent via the `Sec-WebSocket-Protocol` header — not in the query string — to keep tokens out of nginx access logs and `Referer` headers. The browser offers two protocols: the literal `bearer` and the JWT itself; the API echoes one back to complete the handshake.

nginx forwards WebSocket upgrades to the API:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_read_timeout 3600s;
```

The API verifies the JWT before upgrading. On close the client reconnects after 3 seconds.

### Event types

| Type | Payload | UI effect |
|---|---|---|
| `domain_status` | `domainId, zone_status, last_serial, last_rendered_at, zone_error` | Updates domain detail cache, invalidates domain list |
| `record_changed` | `domainId` | Invalidates records cache for that domain |
| `bulk_job_progress` | `jobId, status, processed_domains, affected_domains` | Updates bulk job cache, invalidates job list |
| `ns_status` | `host, up, latency_ms, checked_at` | Updates the nameserver indicator in the nav bar |
| `dnssec_status` | `domainId, dnssec_ok, dnssec_checked_at` | Updates the DNSSEC badge on the domain |
| `ticket_changed` | `ticketId` | Invalidates ticket detail / list caches |

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
{ "mode": "tenant", "tenant_ids": [1, 2] }
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

## Domain Labels

Domains support key=value labels (similar to Hetzner Cloud tags) for organization and filtering.

- Labels are stored in the `domain_labels` table — multiple labels per domain, duplicate keys allowed
- Each label has an optional hex color (`#rrggbb`); if omitted, a color is auto-generated deterministically from the key
- Text color is automatically chosen (white or dark) based on luminance of the background

### Managing labels

On the **domain detail page**, labels appear below the meta block:
- Click **+ New / + Neu** to open the add form (key + value + optional color)
- Click any label chip to edit it inline (key, value, color)
- Click ✕ on a chip to remove it
- The color picker shows 10 pastel hex presets, a color wheel, and a free hex input

### Filtering by label in the domain list

The label filter input in the domains list accepts:
- `key` — matches domains that have any label with that key
- `key=value` — matches domains with that exact key/value pair

The filter only applies on Enter or when a datalist suggestion is selected — partial text does not trigger filtering.

### API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/domains/labels` | Returns all distinct `{key, values[]}` for autocomplete |
| `PUT` | `/api/v1/domains/:id/labels` | Full-replace labels for a domain (body: `{ labels: [{key, value, color?}] }`) |

---

## DNS Templates

Reusable record sets that can be assigned to domains or applied one-time.

- Scope: admins create global templates; operators create tenant-scoped templates
- A template owns its records; editing records on the template lets you re-apply to all linked domains
- Apply modes:
  - `add_missing` — only insert records that don't already exist on the target
  - `overwrite_matching` — replace records that match by name+type
  - `replace_all` — drop the existing record set in scope and replace with the template

### API

| Method | Path | Description |
|---|---|---|
| `GET` / `POST` | `/api/v1/templates` | List / create templates |
| `PUT` / `DELETE` | `/api/v1/templates/:id` | Update / delete a template |
| `POST` / `PUT` / `DELETE` | `/api/v1/templates/:id/records[/:recordId]` | Manage records inside a template |
| `GET` / `POST` | `/api/v1/domains/:domainId/templates` | List / link templates to a domain |
| `POST` | `/api/v1/domains/:domainId/apply-template/preview` | Compute the diff |
| `POST` | `/api/v1/domains/:domainId/apply-template` | Apply (queues a render) |

---

## DNSSEC

Per-domain DNSSEC management.

- **Enable** — worker generates ZSK + KSK in `bind/primary/keys-dnssec/`, signs the zone, advertises a DNSKEY in the rendered zone
- **Disable** — keys are removed and the zone re-rendered without DNSSEC records
- **DS record** — UI computes keytag and SHA-256 digest in the browser from the DNSKEY response; the operator copies this to the parent zone registrar
- **Health check** — the worker periodically queries the domain's DNSKEY across resolvers; `domains.dnssec_ok` and `domains.dnssec_checked_at` are updated, and a `dnssec_status` event is broadcast over WebSocket

---

## DNS Health Check (multi-resolver)

The **DNS Check** modal on the domain detail page runs `dig` against multiple resolvers (public — Google, Cloudflare, Quad9 — and the internal primary) for every record on the domain. Results are color-coded: green if all resolvers agree, red if they diverge, gray for record types the check doesn't support. Useful for confirming propagation after edits and diagnosing split DNS.

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

Pending edits survive navigation away and back via `domainEditCache`. A nav guard warns before discarding dirty state.

---

## Zone File Import (single domain)

The **Import zone file** modal on the domain detail page parses a pasted RFC 1035 zone file and stages the result for review.

- Supported types: A, AAAA, CNAME, MX, NS, TXT, SRV, CAA, PTR, NAPTR, TLSA, SSHFP, DS, ALIAS
- TTL shorthands accepted (`60m`, `1h`, `1d`, `1w`)
- Skipped: SOA, DNSKEY, NSEC, RRSIG, CDS, CDNSKEY (managed by the system)
- Conflicts (existing record with same name+type) prompt for keep / overwrite per row
- Nothing is written until the user confirms — staged rows go through the same inline-edit Apply flow

---

## Support Ticket System

Multi-channel support tickets backed by `support_tickets`, `ticket_messages`, and `ticket_attachments`.

- **Channels** — created from the web UI or imported from email (IMAP poll loop in the worker)
- **Threading** — incoming mail matched by `Message-ID` / `In-Reply-To` first, then by `[#nnn]` subject marker
- **Status** — `open` / `in_progress` / `waiting` / `closed`
- **Priority** — `low` / `normal` / `high` / `urgent`
- **Assignment** — to any staff user
- **Internal notes** — messages flagged `internal` are visible to staff only and not sent in reply email
- **Attachments** — files stored on disk under `uploads/`, served via authenticated GET; size limit 20 MB, up to 20 files per upload (enforced by `@fastify/multipart`)
- **Notifications** — requester emailed on staff reply; admins emailed on new ticket via the standard `mail_queue`

### API

| Method | Path | Description |
|---|---|---|
| `GET` / `POST` / `PUT` | `/api/v1/tickets[/:id]` | List / create / update tickets |
| `POST` | `/api/v1/tickets/:id/messages` | Add a message (set `internal=true` for staff-only) |
| `POST` | `/api/v1/tickets/:id/messages/:msgId/attachments` | Multipart upload |
| `GET` | `/api/v1/tickets/:id/attachments/:fileId` | Download an attachment |

---

## Registrars & TLD Pricing

- **Registrars** (`registrars` table) — directory of code/name/url for the registrars used by tenants (presets: `CN`, `MARCARIA`, `UD`, `UDR`)
- **TLD pricing** (`tld_pricing` table) — per-zone `cost`, `fee`, `default_registrar`, and per-registrar prices
- Used during ISP import to auto-set a sensible default registrar based on the domain's TLD

### API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/registrars` | List registrars |
| `POST` / `PUT` / `DELETE` | `/api/v1/registrars[/:code]` | Admin CRUD |
| `GET` / `POST` | `/api/v1/tld-pricing` | List / create |
| `PUT` / `DELETE` | `/api/v1/tld-pricing/:zone` | Update / delete |

---

## ISP Database Import

Bulk migration tool for moving an existing customer base from a legacy `isp` schema into INFORENT Prisma.

- **Source** — reads `isp.companies`, `isp.domain_fees`, `isp.domains`, `isp.ns` (read-only)
- **Targets** — writes `tenants`, `tld_pricing`, `domains`, `dns_records`
- **Filters** — by tenant ID, TLD zone, domain FQDN, or specific record IDs
- **Preview first** — every row is annotated `insert` / `update` / `skip` / `overwrite`; the operator picks which to actually run
- **Transactional** — each domain's records are inserted in a single transaction; failures don't leave half-imported zones

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/import/preview` | Compute the diff with status flags |
| `POST` | `/api/v1/import/run` | Execute the selected rows |

The worker side of the import lives in [api/src/import/executor.ts](api/src/import/executor.ts).

---

## Nameserver Status

The API runs a TCP/53 poller for ns1 (in-Docker), ns2, and ns3 every 2 seconds. State changes (`up` ↔ `down`) are written to `ns_checks` and broadcast over WebSocket. The nav bar shows three indicator dots; the `/api/v1/ns-status` endpoint returns the current snapshot for non-WS clients.

Configure the IPs via `NS1_IP`, `NS2_IP`, `NS3_IP` env vars on the API.

---

## Mail Queue

All outbound email is queued in `mail_queue` and sent by the worker. Each row stores template name, JSON payload, status (`pending` / `processing` / `done` / `failed`), retry count, and the last error. The worker retries failed rows up to 10 times with backoff.

The **Mail Queue** admin page surfaces the queue: filter by status, view payload + last error, force-retry a failed row.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/mail-queue` | List entries (filter by status) |
| `POST` | `/api/v1/mail-queue/:id/retry` | Reset to `pending` |

---

## Auth, Invites & Password Reset

- **Access token** — JWT, 15-minute lifetime, signed with `JWT_SECRET`
- **Refresh token** — 7-day lifetime, stored as SHA-256 hash in `refresh_tokens`, set as `httpOnly` cookie
- **Silent refresh** — on page load the browser calls `POST /auth/refresh`; if the cookie is valid a new access token is issued
- **Passwords** — bcrypt cost 12
- **Invites** — `user_invites` row with one-time token; email sent via `mail_queue`; `AcceptInvitePage` lets the user set a password and activates the account
- **Password reset** — same token mechanism; reset email contains a link back to the SPA

---

## Audit Log

Every record/domain/template/bulk/auth mutation is captured in `audit_logs` by middleware in [api/src/audit/middleware.ts](api/src/audit/middleware.ts). Each row stores actor, IP, route, entity type+id, and a JSON diff of before/after. Admins and operators can read the full log; tenants only see entries that touch their own data.

---

## Internationalization (i18n)

UI is fully localized in **English** and **German**.

- Translations live in [web/src/i18n/translations.ts](web/src/i18n/translations.ts)
- Active locale is read from the user record (`users.locale`) and exposed via React context (`I18nContext`)
- Login page detects the browser's `navigator.language` for the pre-auth experience
- Email templates are also localized (login notification picks the recipient's locale)

---

## RBAC

| Role | Domains | Records | Bulk Jobs | Templates | Tenants | Users | Audit | Tickets | Import | Pricing |
|---|---|---|---|---|---|---|---|---|---|---|
| `admin` | all CRUD | all CRUD | all CRUD | all CRUD | all CRUD | all CRUD | read all | all CRUD | run | all CRUD |
| `operator` | all CRUD | all CRUD | all CRUD | tenant-scoped | read | — | read all | all CRUD | — | read |
| `tenant` | own only | own only | own only | apply only | — | own profile | own only | own only | — | — |

Ownership is enforced at the SQL level — `AND tenant_id = ?` is injected for tenant-role requests.

---

## Security Notes

- `bind-primary` is on a Docker `internal: true` network — no internet egress or ingress possible
- TSIG key (`hmac-sha256`) authenticates AXFR transfers between primary and secondaries; never committed to git
- rndc key is separate from TSIG; worker holds it via volume mount + env pointer
- `INTERNAL_SECRET` protects the worker→API broadcast endpoint; only reachable inside the internal Docker network
- WebSocket access tokens travel in `Sec-WebSocket-Protocol`, never in URL query strings
- All secrets live in `.env` — never commit it
- Rate limiting on auth endpoints (10 req/min per IP via `@fastify/rate-limit`)
- Security headers via `@fastify/helmet`
- Multipart uploads (ticket attachments) capped at 20 MB × 20 files per request

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
docker compose up -d --build --remove-orphans api worker web
```

### Viewing logs

```bash
docker compose logs -f api
docker compose logs -f worker
```

### Database access

phpMyAdmin is exposed on `http://localhost:8080` (login form, no auto-login). MariaDB itself is also exposed on `:3306` for direct client access in dev environments.

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
| `SECONDARY_IPS` | worker | Comma-separated public IPs of real secondaries for `also-notify` |
| `NS1_IP` / `NS2_IP` / `NS3_IP` | api | IPs polled by the NS status monitor |
| `PUBLIC_API_URL` | web | Full URL the browser uses to reach the API |
| `APP_PUBLIC_URL` | worker | Portal URL embedded in invite / ticket / reset emails |
| `API_INTERNAL_URL` | worker | Internal Docker URL for the API (`http://api:3000`) |
| `BIND_PRIMARY_HOST` | api, worker | Hostname for `rndc` (`bind-primary` inside the stack) |
| `BIND_PRIMARY_RNDC_PORT` | worker | rndc port (default 953) |
| `RNDC_KEY_FILE` | worker | Path to rndc key inside the worker container |
| `BIND_KEYS_DIR` | api | Path to DNSSEC key directory (read by API for DS preview) |
| `NAMED_CHECKZONE_BIN` | worker | Override path to `named-checkzone` binary |
| `SMTP_HOST` / `SMTP_PORT` | worker | SMTP server for outgoing mail |
| `SMTP_USER` / `SMTP_PASS` | worker | SMTP auth |
| `SMTP_FROM` | worker | From address |
| `MAIL_FROM_NAME` | worker | Friendly name for the From header |
| `MAIL_ADMIN_TO` | worker | Recipient for zone deploy success/failure notifications |
| `IMAP_ENABLED` | worker | Set to `true` to start the ticket mail importer |
| `IMAP_HOST` / `IMAP_PORT` / `IMAP_TLS` | worker | IMAP server settings |
| `IMAP_USER` / `IMAP_PASS` | worker | IMAP auth |
| `IMAP_POLL_INTERVAL_SECONDS` | worker | Poll cadence (default 60) |
| `NODE_ENV` | api, worker | `production` or `development` |
