# Import: inforent-domains.sql

## Goal

Build an admin-only import wizard that:
1. Accepts an uploaded `.sql` file (the legacy `inforent-domains.sql` dump).
2. Parses the four source tables from the file in memory (no temp DB needed).
3. Presents a preview/selection UI — the admin chooses which entity types to import (tenants, domains, DNS records, TLD pricing).
4. Executes the import with conflict-handling rules described below.

The source file is a phpMyAdmin SQL dump from a MariaDB database named `isp`. It contains four tables:
`companies`, `domains`, `ns`, `domain_fees`.

---

## Source → Target Mapping

### Table: `companies` → `tenants`

| Source column | Type | Target | Notes |
|---|---|---|---|
| `company_id` | int | `tenants.id` | Use as the actual PK — do not auto-assign a new id |
| `keyword` | varchar(10) | `tenants.name` | Short company name, e.g. `INFORENT` |

**Conflict rule:** If a tenant with the same `id` already exists, update its `name` but leave all other fields unchanged.

---

### Table: `domains` → `domains` + new columns

The source `domains` table is keyed by `DOMAIN` (the FQDN string, e.g. `example.com`), not by an integer id.

| Source column | Type | Target column | Notes |
|---|---|---|---|
| `DOMAIN` | varchar(80) | `domains.fqdn` | Primary identifier — skip if FQDN already exists |
| `COMPANY_ID` | int | `domains.tenant_id` | FK to tenants |
| `PUBLISH` | char(1) `'0'`/`'1'` | *(new)* `domains.publish` | `'1'` = deploy DNS to our nameservers; `'0'` = do not deploy (we manage the domain but serve no zone). Stored as a separate boolean — do not confuse with `domains.status` (active/suspended). |
| `NOTE` | varchar(250) | `domains.notes` | Customer-visible note |
| `NOTE_INTERNAL` | varchar(250) | *(new)* `domains.notes_internal` | Admin-only note; needs new column |
| `COST_CENTER` | varchar(15) | *(new)* `domains.cost_center` | Searchable/filterable text field |
| `BRAND` | varchar(15) | *(new)* `domains.brand` | Searchable/filterable text field |
| `NS_REFERENCE` | varchar(80) | *(new)* `domains.ns_reference` | Points to another FQDN whose DNS records this domain mirrors (e.g. `aliro.com`) |
| `SMTP_TO` | varchar(100) | *(new)* `domains.smtp_to` | SMTP relay host, e.g. `smtp.inforent.net` — NULL if not set |
| `SPAM_TO` | varchar(50) | *(new)* `domains.spam_to` | Spam address, e.g. `spam@inforent.net` — NULL if not set |
| `ADD_FEE` | float | *(new)* `domains.add_fee` | Extra fee charged to the customer on top of base TLD price |
| `REGISTRAR` | char(1) `'0'`/`'1'` | *(new)* `domains.we_registered` | `'1'` = we registered this domain for the customer; `'0'` = customer manages registration themselves |
| `FLAG` | char(1) | *(new)* `domains.flag` | Meaning unclear — store as-is for now (values seen: `'0'`, `'1'`, `NULL`) |
| `TLD` | varchar(10) | — | Unused; derivable from FQDN |
| `ZONE` | varchar(20) | — | Unused |

**Conflict rule:** If a domain with the same `fqdn` already exists, skip creating/updating the domain row. DNS records for that domain are still imported (see below).

**New DB columns required** (migration needed before import can run):
```sql
ALTER TABLE domains
  ADD COLUMN notes_internal TEXT NULL,
  ADD COLUMN cost_center    VARCHAR(15) NULL,
  ADD COLUMN brand          VARCHAR(15) NULL,
  ADD COLUMN ns_reference   VARCHAR(253) NULL,
  ADD COLUMN smtp_to        VARCHAR(100) NULL,
  ADD COLUMN spam_to        VARCHAR(100) NULL,
  ADD COLUMN add_fee        DECIMAL(8,2) NULL,
  ADD COLUMN we_registered  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN flag           CHAR(1) NULL,
  ADD COLUMN publish        TINYINT(1) NOT NULL DEFAULT 1;
```

---

### Table: `ns` → `dns_records`

The source `ns` table is keyed by integer `id`, linked to domains by `DOMAIN` (FQDN string).

| Source column | Type | Target column | Notes |
|---|---|---|---|
| `DOMAIN` | varchar(80) | `dns_records.domain_id` | Resolve FQDN → `domains.id` |
| `HOST` | varchar(50) | `dns_records.name` | Relative label, e.g. `@`, `www`, `_dmarc`. NULL in source → treat as `@` |
| `TYPE` | varchar(5) | `dns_records.type` | Record type, e.g. `A`, `MX`, `TXT` |
| `PRIORITY` | varchar(2) | `dns_records.priority` | Only meaningful for MX; NULL otherwise |
| `ENTRY` | varchar(750) | `dns_records.value` | The rdata string, e.g. `1.2.3.4` or `"v=spf1 -all"` |
| `TTL` | int | `dns_records.ttl` | NULL means use domain default |
| `PTR` | char(1) | — | Legacy PTR flag; ignore |
| `id` | int | — | Source id; discard |

**Conflict rule:** For every domain that exists in the target (whether it was just created or already existed), **delete all existing DNS records** for that domain and re-insert the records from the source. This is a full overwrite per domain.

**Note:** Only import DNS records for domains whose FQDN exists in the target `domains` table after the domain import step.

---

### Table: `domain_fees` → new table `tld_pricing`

This table holds per-TLD pricing and registrar information. It needs a new database table.

| Source column | Type | Target column | Notes |
|---|---|---|---|
| `ZONE` | varchar(20) | `tld_pricing.zone` | The TLD zone key, e.g. `de`, `cn.com`, `co.uk` — used as PK |
| `TLD` | varchar(10) | `tld_pricing.tld` | The effective TLD, e.g. `de`, `com`, `uk` |
| `DESCRIPTION` | varchar(30) | `tld_pricing.description` | Human-readable name, e.g. `Germany` |
| `EK` | float | `tld_pricing.cost` | Our purchase price (Einkaufspreis) |
| `FEE` | int | `tld_pricing.fee` | Selling price to customer (Verkaufspreis) |
| `REGISTRAR` | varchar(10) | `tld_pricing.default_registrar` | Which registrar we primarily use for this TLD: `CN`, `MARCARIA`, `UD`, `UDR` |
| `NOTE` | varchar(30) | `tld_pricing.note` | Free-text note, e.g. `last_UD: 175,63` |
| `UDR` | float | `tld_pricing.price_udr` | Price at registrar UDR |
| `CN` | float | `tld_pricing.price_cn` | Price at registrar CN |
| `MARCARIA` | float | `tld_pricing.price_marcaria` | Price at registrar MARCARIA |
| `UD` | float | `tld_pricing.price_ud` | Price at registrar UD |
| `FLAG` | char(1) | — | Unused; discard |
| `COUNT` | int | — | Computed count; discard |

**Conflict rule:** If a row with the same `zone` already exists, update all its columns with the values from the source (upsert).

**New DB table required:**
```sql
CREATE TABLE tld_pricing (
  zone              VARCHAR(20)  NOT NULL PRIMARY KEY,
  tld               VARCHAR(10)  NOT NULL,
  description       VARCHAR(30)  NULL,
  cost              DECIMAL(6,2) NULL,
  fee               INT          NULL,
  default_registrar VARCHAR(10)  NULL,   -- CN | MARCARIA | UD | UDR
  note              VARCHAR(30)  NULL,
  price_udr         DECIMAL(6,2) NULL,
  price_cn          DECIMAL(6,2) NULL,
  price_marcaria    DECIMAL(6,2) NULL,
  price_ud          DECIMAL(6,2) NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## Registrar Reference on Domains

Each domain should also store which registrar actually holds it. This is separate from `we_registered`:

- Default: copy `tld_pricing.default_registrar` for the domain's TLD at import time.
- Admins can override it per domain after import.

Add column:
```sql
ALTER TABLE domains
  ADD COLUMN registrar VARCHAR(10) NULL;   -- CN | MARCARIA | UD | UDR | NULL
```

---

## Import UI (Admin Page)

- Upload a `.sql` file.
- Parse the four tables client-side or server-side and display a preview:
  - How many tenants found / how many would be skipped.
  - How many domains found / how many would be skipped.
  - How many DNS records found.
  - How many TLD pricing rows found / how many would be skipped.
- Checkboxes to select which entity types to include in this run.
- "Run Import" button executes the selected steps in order: tenants → tld_pricing → domains → dns_records.
- Show per-entity result counts (imported / skipped / errors) after completion.

---

## Open Questions

- `domains.FLAG` (`char(1)`, values `'0'`, `'1'`, `NULL`): meaning unknown. Store as-is for now; can be clarified and mapped later.