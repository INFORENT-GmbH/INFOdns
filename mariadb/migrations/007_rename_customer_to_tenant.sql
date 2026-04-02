-- Migration 007: rename customer → tenant throughout all tables (idempotent)
-- CHANGE COLUMN on FK columns requires ALGORITHM=INPLACE.
-- MODIFY COLUMN for ENUM changes requires ALGORITHM=COPY.
-- These two are incompatible in a single statement, so they are split.

-- 1. Rename the customers table to tenants
ALTER TABLE IF EXISTS customers RENAME TO tenants;

-- 2. Rename customer_id → tenant_id in users (FK column, separate from ENUM change)
ALTER TABLE IF EXISTS users
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NULL,
  ALGORITHM=INPLACE;
-- Expand ENUM to include both values, migrate data, then drop the old value
ALTER TABLE IF EXISTS users
  MODIFY COLUMN role ENUM('admin','operator','customer','tenant') NOT NULL DEFAULT 'tenant';
UPDATE users SET role = 'tenant' WHERE role = 'customer';
ALTER TABLE IF EXISTS users
  MODIFY COLUMN role ENUM('admin','operator','tenant') NOT NULL DEFAULT 'tenant';

-- 3. Rename user_customers → user_tenants and its FK column
ALTER TABLE IF EXISTS user_customers RENAME TO user_tenants;
ALTER TABLE IF EXISTS user_tenants
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NOT NULL,
  ALGORITHM=INPLACE;

-- 4. Rename customer_id → tenant_id in soa_templates
ALTER TABLE IF EXISTS soa_templates
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NULL,
  ALGORITHM=INPLACE;

-- 5. Rename customer_id → tenant_id in domains
ALTER TABLE IF EXISTS domains
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NOT NULL,
  ALGORITHM=INPLACE;

-- 6. Rename customer_id → tenant_id in labels
ALTER TABLE IF EXISTS labels
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NULL,
  ALGORITHM=INPLACE;

-- 7. Rename customer_id → tenant_id in audit_logs (no FK constraint)
ALTER TABLE IF EXISTS audit_logs
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NULL;

-- 8. Rename customer_id → tenant_id in support_tickets (FK column, separate from index changes)
ALTER TABLE IF EXISTS support_tickets
  CHANGE COLUMN IF EXISTS customer_id tenant_id INT UNSIGNED NULL,
  ALGORITHM=INPLACE;
ALTER TABLE IF EXISTS support_tickets
  DROP INDEX IF EXISTS idx_customer,
  ADD INDEX IF NOT EXISTS idx_tenant (tenant_id);

-- 9. Rename customer_ids → tenant_ids in user_invites (JSON, no FK), update role ENUM separately
ALTER TABLE IF EXISTS user_invites
  CHANGE COLUMN IF EXISTS customer_ids tenant_ids JSON NULL;
ALTER TABLE IF EXISTS user_invites
  MODIFY COLUMN role ENUM('admin','operator','customer','tenant') NOT NULL DEFAULT 'tenant';
UPDATE user_invites SET role = 'tenant' WHERE role = 'customer';
ALTER TABLE IF EXISTS user_invites
  MODIFY COLUMN role ENUM('admin','operator','tenant') NOT NULL DEFAULT 'tenant';
