-- Domain lifecycle: soft-delete timestamp + reminder bitmask
ALTER TABLE domains
  ADD COLUMN deleted_at     DATETIME         NULL DEFAULT NULL AFTER notes,
  ADD COLUMN reminder_flags TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER deleted_at;
