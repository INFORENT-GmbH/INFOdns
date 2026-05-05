-- Add 'dismissed' status to mail_queue so manually-acknowledged failures stay
-- distinguishable from naturally-completed sends. The worker only processes
-- 'pending' rows, so this status is safe (it won't be picked up again).
-- Dismissed rows are kept indefinitely — there is no purge in the codebase.

ALTER TABLE mail_queue
  MODIFY COLUMN status
  ENUM('pending','processing','done','failed','dismissed')
  NOT NULL DEFAULT 'pending';
