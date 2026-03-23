ALTER TABLE domains
  ADD COLUMN dnssec_ds TEXT NULL COMMENT 'DS record lines extracted from rndc dnssec -status';
