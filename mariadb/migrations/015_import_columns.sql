-- New columns on domains for isp import
ALTER TABLE domains
  ADD COLUMN notes_internal TEXT NULL,
  ADD COLUMN cost_center    VARCHAR(15) NULL,
  ADD COLUMN brand          VARCHAR(15) NULL,
  ADD COLUMN ns_reference   VARCHAR(253) NULL,
  ADD COLUMN smtp_to        VARCHAR(100) NULL,
  ADD COLUMN spam_to        VARCHAR(50) NULL,
  ADD COLUMN add_fee        DECIMAL(8,2) NULL,
  ADD COLUMN we_registered  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN flag           CHAR(1) NULL,
  ADD COLUMN publish        TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN registrar      VARCHAR(10) NULL;

-- TLD pricing table
CREATE TABLE tld_pricing (
  zone              VARCHAR(20)  NOT NULL PRIMARY KEY,
  tld               VARCHAR(10)  NOT NULL,
  description       VARCHAR(30)  NULL,
  cost              DECIMAL(6,2) NULL,
  fee               INT          NULL,
  default_registrar VARCHAR(10)  NULL,
  note              VARCHAR(30)  NULL,
  price_udr         DECIMAL(6,2) NULL,
  price_cn          DECIMAL(6,2) NULL,
  price_marcaria    DECIMAL(6,2) NULL,
  price_ud          DECIMAL(6,2) NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
