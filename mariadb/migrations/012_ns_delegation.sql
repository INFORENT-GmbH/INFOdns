ALTER TABLE domains
  ADD COLUMN ns_ok         TINYINT(1) NULL COMMENT 'NULL=unchecked, 0=mismatch, 1=ok',
  ADD COLUMN ns_checked_at DATETIME   NULL COMMENT 'UTC timestamp of last public DNS check';
