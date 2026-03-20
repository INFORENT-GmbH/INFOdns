-- Mail queue table for reliable email delivery with retry support
CREATE TABLE IF NOT EXISTS mail_queue (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  to_email    VARCHAR(255) NOT NULL,
  template    VARCHAR(100) NULL,          -- e.g. 'login_notification', 'zone_deploy_success'
  payload     JSON         NULL,          -- template parameters (rendered by worker at send time)
  body_html   TEXT         NULL,          -- pre-rendered HTML (used if template is NULL)
  body_text   TEXT         NULL,          -- plain-text fallback
  subject     VARCHAR(500) NULL,          -- pre-rendered subject (used if template is NULL)
  status      ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  retries     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_retries TINYINT UNSIGNED NOT NULL DEFAULT 10,
  error       TEXT         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add locale preference to users (default German)
ALTER TABLE users ADD COLUMN locale ENUM('en','de') NOT NULL DEFAULT 'de' AFTER is_active;
