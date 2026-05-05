-- Wiederverwendbare Rechnungs-Vorlagen für eigene/manuelle Rechnungen.
-- Drafts brauchen keine eigene Tabelle (invoices.status = 'draft').
CREATE TABLE invoice_templates (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  description       TEXT         NULL,
  default_tax_mode  ENUM('standard','reverse_charge','small_business','non_eu')
                    NOT NULL DEFAULT 'standard',
  items_json        JSON         NOT NULL,
    -- Format: [{description, quantity, unit, unit_price_cents, tax_rate_percent}, ...]
  customer_notes    TEXT         NULL,
  created_by        INT UNSIGNED NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_tpl_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
