-- Zahlungseingänge
CREATE TABLE payments (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id   INT UNSIGNED NOT NULL,
  paid_at      DATE         NOT NULL,
  amount_cents INT          NOT NULL,                            -- darf negativ sein (Rückbuchung)
  method       ENUM('transfer','sepa','cash','card','manual','offset')
               NOT NULL DEFAULT 'transfer',
  reference    VARCHAR(255) NULL,                                -- Verwendungszweck / TX-ID
  notes        TEXT         NULL,
  created_by   INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_invoice (invoice_id),
  CONSTRAINT fk_pay_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id),
  CONSTRAINT fk_pay_user    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mahnstufen (Konfiguration)
CREATE TABLE dunning_levels (
  level           TINYINT UNSIGNED PRIMARY KEY,    -- 0 = Erinnerung, 1..3 = Mahnung
  label           VARCHAR(50)  NOT NULL,
  days_after_due  INT          NOT NULL,
  fee_cents       INT          NOT NULL DEFAULT 0,
  template_key    VARCHAR(100) NOT NULL            -- Schlüssel in mailTemplates.ts
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO dunning_levels (level, label, days_after_due, fee_cents, template_key) VALUES
  (0, 'Zahlungserinnerung',     7,    0, 'dunning_reminder'),
  (1, '1. Mahnung',            14,  500, 'dunning_1'),
  (2, '2. Mahnung',            28, 1000, 'dunning_2'),
  (3, '3. Mahnung / Inkasso',  45, 2000, 'dunning_3');

-- Mahn-Historie (UNIQUE pro Rechnung+Stufe verhindert Doppel-Mahnungen)
CREATE TABLE dunning_log (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id      INT UNSIGNED NOT NULL,
  level           TINYINT UNSIGNED NOT NULL,
  sent_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fee_added_cents INT          NOT NULL DEFAULT 0,
  mail_queue_id   INT UNSIGNED NULL,
  pdf_path        VARCHAR(500) NULL,

  UNIQUE KEY uq_inv_level (invoice_id, level),
  CONSTRAINT fk_dunning_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
