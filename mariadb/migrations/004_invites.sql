CREATE TABLE IF NOT EXISTS user_invites (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  token_hash   VARCHAR(64)  NOT NULL UNIQUE,
  role         ENUM('admin','operator','customer') NOT NULL DEFAULT 'customer',
  full_name    VARCHAR(255) NOT NULL DEFAULT '',
  locale       ENUM('en','de') NOT NULL DEFAULT 'de',
  customer_ids JSON         NULL,
  invited_by   INT UNSIGNED NULL,
  expires_at   DATETIME     NOT NULL,
  used_at      DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  CONSTRAINT fk_invite_invited_by FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
