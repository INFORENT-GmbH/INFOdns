-- Singleton-Tabelle für Firmen-/Bank-/Rechnungseinstellungen
-- Genau eine Zeile mit id = 1.
CREATE TABLE company_settings (
  id                          TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  company_name                VARCHAR(255) NOT NULL,
  address_line1               VARCHAR(255) NOT NULL,
  address_line2               VARCHAR(255) NULL,
  zip                         VARCHAR(20)  NOT NULL,
  city                        VARCHAR(100) NOT NULL,
  country                     VARCHAR(2)   NOT NULL DEFAULT 'DE',
  phone                       VARCHAR(50)  NULL,
  email                       VARCHAR(255) NOT NULL,
  website                     VARCHAR(255) NULL,

  -- Steuerliche Pflichtangaben
  tax_id                      VARCHAR(50)  NULL,           -- Steuernummer
  vat_id                      VARCHAR(50)  NULL,           -- USt-IdNr.
  commercial_register         VARCHAR(100) NULL,           -- HRB Nr.
  managing_director           VARCHAR(255) NULL,

  -- Bankverbindung (eine globale Verbindung)
  bank_name                   VARCHAR(100) NOT NULL,
  iban                        VARCHAR(34)  NOT NULL,
  bic                         VARCHAR(11)  NOT NULL,
  account_holder              VARCHAR(255) NOT NULL,

  -- Rechnungs-Defaults
  default_currency            CHAR(3)      NOT NULL DEFAULT 'EUR',
  default_payment_terms_days  INT          NOT NULL DEFAULT 14,
  default_tax_rate_percent    DECIMAL(5,2) NOT NULL DEFAULT 19.00,
  postal_fee_cents            INT          NOT NULL DEFAULT 180,    -- 1,80 €
  invoice_number_format       VARCHAR(50)  NOT NULL DEFAULT '{year}-{seq:05d}',
  invoice_footer_text         TEXT         NULL,
  logo_path                   VARCHAR(255) NULL,

  -- Abrechnungslauf
  auto_issue_drafts           TINYINT(1)   NOT NULL DEFAULT 0,      -- 0 = Admin-Approval
  auto_issue_threshold_cents  INT          NULL,                    -- z.B. 5000 = nur <50€ auto-issuen

  updated_at                  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT chk_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Initiale Zeile mit Platzhaltern - Admin muss in Settings-UI vervollständigen
INSERT INTO company_settings
  (id, company_name, address_line1, zip, city, country, email,
   bank_name, iban, bic, account_holder, invoice_footer_text)
VALUES
  (1, 'INFORENT GmbH', '<TBD>', '00000', '<TBD>', 'DE', 'rechnung@inforent.net',
   '<TBD>', 'DE00000000000000000000', '<TBD>', 'INFORENT GmbH',
   'Vielen Dank für Ihr Vertrauen.');
