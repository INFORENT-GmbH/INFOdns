-- VIES (EU-USt-IdNr.-Validierung) Cache pro Tenant.
-- Ergebnis wird gespeichert damit nicht bei jedem Aufruf neu geprueft wird.
ALTER TABLE tenants
  ADD COLUMN vat_id_valid          TINYINT(1)   NULL          AFTER vat_id,
  ADD COLUMN vat_id_validated_at   DATETIME     NULL          AFTER vat_id_valid,
  ADD COLUMN vat_id_check_name     VARCHAR(255) NULL          AFTER vat_id_validated_at,
  ADD COLUMN vat_id_check_address  TEXT         NULL          AFTER vat_id_check_name;
