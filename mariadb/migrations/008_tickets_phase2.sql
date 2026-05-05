-- 008_tickets_phase2.sql
--
-- Adds:
--  * kind column on ticket_messages   — distinguishes user replies from system events
--                                        (status / priority / assignee changes)
--  * FULLTEXT(body) on ticket_messages — backs full-text search across message bodies
--                                        (combined with LIKE fallback for short tokens)
--  * idx_ticket_created               — speeds up the C2 "needs reply" sub-select that
--                                        finds the most recent reply per ticket

ALTER TABLE ticket_messages
  ADD COLUMN kind ENUM('reply','event') NOT NULL DEFAULT 'reply' AFTER body;

ALTER TABLE ticket_messages
  ADD FULLTEXT KEY ft_body (body);

ALTER TABLE ticket_messages
  ADD INDEX idx_ticket_created (ticket_id, created_at);
