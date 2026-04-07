CREATE TABLE registrars (
  code       VARCHAR(10)  NOT NULL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  url        VARCHAR(255) NULL,
  notes      TEXT         NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO registrars (code, name) VALUES
  ('CN',       'China Nic'),
  ('MARCARIA', 'Marcaria'),
  ('UD',       'United Domains'),
  ('UDR',      'United Domains Reseller')
