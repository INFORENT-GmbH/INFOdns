-- INFOdns schema
-- All timestamps UTC, all tables utf8mb4 InnoDB

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- ── customers ────────────────────────────────────────────────
CREATE TABLE customers (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) NOT NULL,
  is_active  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── users ────────────────────────────────────────────────────
CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id   INT UNSIGNED NULL,                         -- NULL = internal staff
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,                     -- bcrypt
  role          ENUM('admin','operator','customer') NOT NULL DEFAULT 'customer',
  full_name     VARCHAR(255) NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── refresh_tokens ───────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  token_hash VARCHAR(255) NOT NULL,                        -- SHA-256 of the raw token
  expires_at DATETIME     NOT NULL,
  revoked    TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── soa_templates ────────────────────────────────────────────
CREATE TABLE soa_templates (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NULL,                           -- NULL = global default
  mname       VARCHAR(253) NOT NULL,
  rname       VARCHAR(253) NOT NULL,
  refresh     INT UNSIGNED NOT NULL DEFAULT 3600,
  retry       INT UNSIGNED NOT NULL DEFAULT 900,
  expire      INT UNSIGNED NOT NULL DEFAULT 604800,
  minimum_ttl INT UNSIGNED NOT NULL DEFAULT 300,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── domains ──────────────────────────────────────────────────
CREATE TABLE domains (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id      INT UNSIGNED NOT NULL,
  fqdn             VARCHAR(253) NOT NULL,
  status           ENUM('active','pending','suspended','deleted') NOT NULL DEFAULT 'pending',
  zone_status      ENUM('clean','dirty','error')                  NOT NULL DEFAULT 'dirty',
  last_serial      INT UNSIGNED NOT NULL DEFAULT 0,               -- YYYYMMDDnn
  last_rendered_at DATETIME NULL,
  default_ttl      INT UNSIGNED NOT NULL DEFAULT 3600,
  dnssec_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  notes            TEXT NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fqdn (fqdn),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── dns_records ──────────────────────────────────────────────
CREATE TABLE dns_records (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id  INT UNSIGNED NOT NULL,
  name       VARCHAR(253) NOT NULL,                        -- relative label or "@"
  type       ENUM(
               'A','AAAA','CNAME','MX','NS','TXT','SRV',
               'CAA','PTR','NAPTR','TLSA','SSHFP','DNSKEY','DS'
             ) NOT NULL,
  ttl        INT UNSIGNED NULL,                            -- NULL = domain default_ttl
  priority   SMALLINT UNSIGNED NULL,                       -- MX, SRV
  weight     SMALLINT UNSIGNED NULL,                       -- SRV
  port       SMALLINT UNSIGNED NULL,                       -- SRV
  value      TEXT NOT NULL,                                -- normalized rdata string
  is_deleted TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE,
  INDEX idx_domain_type      (domain_id, type),
  INDEX idx_domain_name_type (domain_id, name, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── zone_render_queue ────────────────────────────────────────
CREATE TABLE zone_render_queue (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  domain_id   INT UNSIGNED NOT NULL,
  priority    TINYINT UNSIGNED NOT NULL DEFAULT 5,
  retries     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_retries TINYINT UNSIGNED NOT NULL DEFAULT 3,
  status      ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  error       TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_domain (domain_id),               -- one pending job per domain
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── bulk_jobs ────────────────────────────────────────────────
CREATE TABLE bulk_jobs (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  created_by        INT UNSIGNED NOT NULL,
  operation         ENUM('add','replace','delete','upsert','change_ttl') NOT NULL,
  status            ENUM('draft','previewing','approved','running','done','failed') NOT NULL DEFAULT 'draft',
  filter_json       JSON NOT NULL,
  payload_json      JSON NOT NULL,
  preview_json      JSON NULL,
  affected_domains  INT UNSIGNED NOT NULL DEFAULT 0,
  processed_domains INT UNSIGNED NOT NULL DEFAULT 0,
  error             TEXT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── bulk_job_domains ─────────────────────────────────────────
CREATE TABLE bulk_job_domains (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bulk_job_id INT UNSIGNED NOT NULL,
  domain_id   INT UNSIGNED NOT NULL,
  status      ENUM('pending','done','failed') NOT NULL DEFAULT 'pending',
  error       TEXT NULL,
  UNIQUE KEY uq_job_domain (bulk_job_id, domain_id),
  FOREIGN KEY (bulk_job_id) REFERENCES bulk_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (domain_id)   REFERENCES domains(id)   ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── audit_logs ───────────────────────────────────────────────
CREATE TABLE audit_logs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NULL,
  customer_id INT UNSIGNED NULL,
  domain_id   INT UNSIGNED NULL,
  entity_type VARCHAR(64)  NOT NULL,
  entity_id   INT UNSIGNED NULL,
  action      VARCHAR(64)  NOT NULL,
  old_value   JSON NULL,
  new_value   JSON NULL,
  ip_address  VARCHAR(45)  NULL,
  user_agent  VARCHAR(512) NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_domain  (domain_id),
  INDEX idx_user    (user_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── seed: global SOA template ────────────────────────────────
INSERT INTO soa_templates (customer_id, mname, rname, refresh, retry, expire, minimum_ttl)
VALUES (NULL, 'ns1.example.com.', 'hostmaster.example.com.', 3600, 900, 604800, 300);
