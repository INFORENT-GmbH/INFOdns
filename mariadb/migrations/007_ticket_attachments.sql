CREATE TABLE ticket_attachments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id     INT UNSIGNED  NOT NULL,
  message_id    INT UNSIGNED  NULL,
  filename      VARCHAR(255)  NOT NULL,
  original_name VARCHAR(255)  NOT NULL,
  mime_type     VARCHAR(127)  NOT NULL DEFAULT 'application/octet-stream',
  size          INT UNSIGNED  NOT NULL,
  created_by    INT UNSIGNED  NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id)  REFERENCES support_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (message_id) REFERENCES ticket_messages(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)           ON DELETE SET NULL,
  INDEX idx_ticket  (ticket_id),
  INDEX idx_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
