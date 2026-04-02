ALTER TABLE domains
  ADD COLUMN dnssec_ok         TINYINT(1) NULL COMMENT 'NULL=unchecked/disabled, 0=DNSKEY not visible in public DNS, 1=ok',
  ADD COLUMN dnssec_checked_at DATETIME   NULL COMMENT 'UTC timestamp of last public DNS DNSKEY check';
