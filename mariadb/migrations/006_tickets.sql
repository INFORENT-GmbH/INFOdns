CREATE TABLE support_tickets (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject         VARCHAR(500)  NOT NULL,
  status          ENUM('open','in_progress','waiting','closed') NOT NULL DEFAULT 'open',
  priority        ENUM('low','normal','high','urgent')          NOT NULL DEFAULT 'normal',
  requester_email VARCHAR(255)  NOT NULL,
  requester_name  VARCHAR(255)  NOT NULL DEFAULT '',
  customer_id     INT UNSIGNED  NULL,
  assigned_to     INT UNSIGNED  NULL,
  source          ENUM('web','email')                           NOT NULL DEFAULT 'web',
  message_id      VARCHAR(500)  NULL UNIQUE,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id)     ON DELETE SET NULL,
  INDEX idx_status   (status),
  INDEX idx_customer (customer_id),
  INDEX idx_assigned (assigned_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE ticket_messages (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id       INT UNSIGNED  NOT NULL,
  author_user_id  INT UNSIGNED  NULL,
  author_name     VARCHAR(255)  NOT NULL DEFAULT '',
  author_email    VARCHAR(255)  NOT NULL DEFAULT '',
  body            TEXT          NOT NULL,
  is_internal     TINYINT(1)    NOT NULL DEFAULT 0,
  source          ENUM('web','email')    NOT NULL DEFAULT 'web',
  message_id      VARCHAR(500)  NULL UNIQUE,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id)      REFERENCES support_tickets(id) ON DELETE CASCADE,
  FOREIGN KEY (author_user_id) REFERENCES users(id)           ON DELETE SET NULL,
  INDEX idx_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pop3_seen_uids (
  uid         VARCHAR(128) NOT NULL PRIMARY KEY,
  imported_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
