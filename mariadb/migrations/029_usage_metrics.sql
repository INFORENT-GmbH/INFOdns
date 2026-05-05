-- Pay-per-use Sammler. Externe oder interne Reporter schreiben hier rein,
-- der usageAggregator im Worker fasst die Mengen zu billable Buckets zusammen.
CREATE TABLE usage_metrics (
  id                  BIGINT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  billing_item_id     INT UNSIGNED     NOT NULL,
  recorded_at         DATETIME(3)      NOT NULL,
  quantity            DECIMAL(20,6)    NOT NULL,            -- Sekunden, Requests, MB, ...
  metadata            JSON             NULL,
  consumed_invoice_id INT UNSIGNED     NULL,                -- gesetzt sobald berechnet

  INDEX idx_item_time   (billing_item_id, recorded_at),
  INDEX idx_unconsumed  (consumed_invoice_id, billing_item_id),
  CONSTRAINT fk_usage_item FOREIGN KEY (billing_item_id) REFERENCES billing_items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
