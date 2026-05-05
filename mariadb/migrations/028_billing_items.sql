-- billing_items: ein Eintrag = ein wiederkehrender (oder einmaliger) Posten
-- Quelle für Rechnungserstellung. Bei Domain-Insert wird automatisch ein
-- billing_item angelegt - manuelle Posten werden vom Admin erfasst.
CREATE TABLE billing_items (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             INT UNSIGNED NOT NULL,

  item_type             ENUM('domain','dnssec','mail_forward','manual','usage')
                        NOT NULL,
  ref_table             VARCHAR(64)  NULL,             -- z.B. 'domains'
  ref_id                INT UNSIGNED NULL,             -- z.B. domain.id
  description           VARCHAR(500) NOT NULL,
  description_template  VARCHAR(500) NULL,             -- z.B. "Domain {fqdn} ({period_start} - {period_end})"

  -- Preis (alles in Cents, Vorzeichen: positiv = Kunde zahlt)
  unit_price_cents      INT UNSIGNED NOT NULL,
  tax_rate_percent      DECIMAL(5,2) NULL,             -- NULL = Tenant/Settings-Default
  currency              CHAR(3)      NOT NULL DEFAULT 'EUR',

  -- Intervall
  interval_unit         ENUM('second','minute','hour','day','week','month','year','lifetime')
                        NOT NULL,
  interval_count        INT UNSIGNED NOT NULL DEFAULT 1,    -- z.B. "alle 2 Jahre" -> year/2

  -- Lebenszyklus
  started_at            DATETIME     NOT NULL,
  ends_at               DATETIME     NULL,                  -- gekündigt zu (inklusive Pro-Rating)
  last_billed_until     DATETIME     NULL,                  -- bis wohin schon abgerechnet
  next_due_at           DATETIME     NULL,                  -- berechnetes Hilfsfeld
  status                ENUM('active','paused','cancelled') NOT NULL DEFAULT 'active',

  notes                 TEXT         NULL,
  created_by            INT UNSIGNED NOT NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_tenant_status      (tenant_id, status),
  INDEX idx_next_due           (status, next_due_at),
  INDEX idx_ref                (ref_table, ref_id),
  CONSTRAINT fk_bi_tenant      FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_bi_created_by  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
