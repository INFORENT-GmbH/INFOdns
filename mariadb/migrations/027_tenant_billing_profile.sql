-- Billing-Profil-Felder pro Tenant
ALTER TABLE tenants
  ADD COLUMN billing_email                 VARCHAR(255) NULL                AFTER email,
  ADD COLUMN tax_mode                      ENUM('standard','reverse_charge','small_business','non_eu')
                                           NOT NULL DEFAULT 'standard'      AFTER vat_id,
  ADD COLUMN tax_rate_percent_override     DECIMAL(5,2) NULL                AFTER tax_mode,
  ADD COLUMN payment_terms_days_override   INT          NULL                AFTER tax_rate_percent_override,
  ADD COLUMN postal_delivery_default       TINYINT(1)   NOT NULL DEFAULT 0  AFTER payment_terms_days_override,
  ADD COLUMN invoice_locale                ENUM('de','en') NOT NULL DEFAULT 'de' AFTER postal_delivery_default,
  ADD COLUMN dunning_paused                TINYINT(1)   NOT NULL DEFAULT 0  AFTER invoice_locale,
  ADD COLUMN billing_notes                 TEXT         NULL                AFTER dunning_paused;
