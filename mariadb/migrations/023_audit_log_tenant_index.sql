-- audit_logs.tenant_id is filtered on every audit-logs page load by tenant
-- users (`WHERE tenant_id IN (SELECT tenant_id FROM user_tenants ...)`), but
-- the column has no FK and therefore no auto-created index, so the planner
-- falls back to a full scan. Other tenant_id columns (domains, users,
-- soa_templates, labels) already have FKs which give them an implicit index.

ALTER TABLE audit_logs
  ADD INDEX idx_tenant (tenant_id);
