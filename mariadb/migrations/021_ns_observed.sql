ALTER TABLE domains
  ADD COLUMN ns_observed TEXT NULL COMMENT 'Comma-separated list of NS records last observed in public DNS (lowercased, no trailing dot)';
