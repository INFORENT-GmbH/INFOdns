-- Lückenlose Rechnungsnummern pro Jahr (GoBD).
-- Vergabe via SELECT ... FOR UPDATE in numbering.ts.
CREATE TABLE invoice_number_sequence (
  year         SMALLINT UNSIGNED PRIMARY KEY,
  last_number  INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Hauptrechnungstabelle
CREATE TABLE invoices (
  id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                   INT UNSIGNED NOT NULL,

  -- Identifikation (NULL solange Draft)
  invoice_number              VARCHAR(50)  NULL,
  status                      ENUM('draft','issued','sent','paid','partial','overdue',
                                   'cancelled','credit_note')
                              NOT NULL DEFAULT 'draft',
  kind                        ENUM('invoice','credit_note','dunning_invoice')
                              NOT NULL DEFAULT 'invoice',
  original_invoice_id         INT UNSIGNED NULL,         -- bei Storno

  -- Zeit
  invoice_date                DATE         NULL,         -- gesetzt beim Issuing
  service_period_start        DATETIME     NULL,
  service_period_end          DATETIME     NULL,
  due_date                    DATE         NULL,

  -- Beträge (Cents)
  currency                    CHAR(3)      NOT NULL DEFAULT 'EUR',
  subtotal_cents              INT          NOT NULL DEFAULT 0,
  tax_total_cents             INT          NOT NULL DEFAULT 0,
  total_cents                 INT          NOT NULL DEFAULT 0,
  paid_cents                  INT          NOT NULL DEFAULT 0,

  -- Steuerkontext (Snapshot zum Issuing-Zeitpunkt)
  tax_mode                    ENUM('standard','reverse_charge','small_business','non_eu')
                              NOT NULL DEFAULT 'standard',
  tax_note                    TEXT         NULL,

  -- Zustellung
  postal_delivery             TINYINT(1)   NOT NULL DEFAULT 0,
  postal_fee_cents            INT          NOT NULL DEFAULT 0,
  pdf_path                    VARCHAR(500) NULL,         -- relativer Pfad in /storage/invoices/
  sent_at                     DATETIME     NULL,
  sent_via                    ENUM('email','postal','both','none') NULL,

  -- Snapshots für Unveränderlichkeit (§14 UStG / GoBD)
  billing_address_snapshot    JSON         NULL,         -- Anschrift Empfänger zum Versand
  company_snapshot            JSON         NULL,         -- eigene Firmen-/Bankdaten

  -- Audit
  created_by                  INT UNSIGNED NOT NULL,
  cancelled_by                INT UNSIGNED NULL,
  cancelled_at                DATETIME     NULL,
  cancellation_reason         TEXT         NULL,
  notes                       TEXT         NULL,         -- intern
  customer_notes              TEXT         NULL,         -- erscheint auf Rechnung

  created_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_invoice_number (invoice_number),
  INDEX idx_tenant_status (tenant_id, status),
  INDEX idx_due           (status, due_date),
  CONSTRAINT fk_inv_tenant   FOREIGN KEY (tenant_id)  REFERENCES tenants(id),
  CONSTRAINT fk_inv_created  FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_inv_original FOREIGN KEY (original_invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Positionen
CREATE TABLE invoice_items (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id          INT UNSIGNED NOT NULL,
  billing_item_id     INT UNSIGNED NULL,                 -- Quelle, falls aus Abo
  position            SMALLINT UNSIGNED NOT NULL,        -- Sortierung 1..n
  description         VARCHAR(500) NOT NULL,
  period_start        DATETIME     NULL,                 -- Leistungszeitraum
  period_end          DATETIME     NULL,

  quantity            DECIMAL(20,6) NOT NULL DEFAULT 1,  -- Pro-Rata-Faktor
  unit                VARCHAR(20)  NULL,                 -- 'Stk', 'Sek', 'GB', ...
  unit_price_cents    INT          NOT NULL,
  tax_rate_percent    DECIMAL(5,2) NOT NULL,

  line_subtotal_cents INT          NOT NULL,
  line_tax_cents      INT          NOT NULL,
  line_total_cents    INT          NOT NULL,

  INDEX idx_invoice (invoice_id, position),
  CONSTRAINT fk_ii_invoice  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_ii_billitem FOREIGN KEY (billing_item_id) REFERENCES billing_items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
