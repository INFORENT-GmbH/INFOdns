-- Add user_customers junction table for many-to-many user ↔ customer assignment
CREATE TABLE IF NOT EXISTS user_customers (
  user_id     INT UNSIGNED NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, customer_id),
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrate existing single-customer assignments
INSERT IGNORE INTO user_customers (user_id, customer_id)
SELECT id, customer_id FROM users WHERE customer_id IS NOT NULL;
