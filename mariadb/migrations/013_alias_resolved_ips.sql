ALTER TABLE dns_records
  ADD COLUMN alias_resolved TEXT NULL
  COMMENT 'Last-resolved IPs for ALIAS records (comma-separated, sorted); NULL = not yet resolved';
