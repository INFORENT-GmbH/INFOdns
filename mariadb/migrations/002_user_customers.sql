-- Add user_tenants junction table for many-to-many user ↔ tenant assignment
CREATE TABLE IF NOT EXISTS user_tenants (
  user_id   INT UNSIGNED NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (user_id)   REFERENCES users(id)   ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrate existing single-tenant assignments
INSERT IGNORE INTO user_tenants (user_id, tenant_id)
SELECT id, tenant_id FROM users WHERE tenant_id IS NOT NULL;
