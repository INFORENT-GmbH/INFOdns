-- User soft-delete: admins can delete users without losing audit history
ALTER TABLE users
  ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL AFTER is_active;
