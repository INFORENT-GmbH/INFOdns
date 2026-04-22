-- Tenant profile fields
ALTER TABLE tenants
  ADD COLUMN company_name VARCHAR(255) NULL AFTER name,
  ADD COLUMN first_name   VARCHAR(100) NULL AFTER company_name,
  ADD COLUMN last_name    VARCHAR(100) NULL AFTER first_name,
  ADD COLUMN street       VARCHAR(255) NULL AFTER last_name,
  ADD COLUMN zip          VARCHAR(20)  NULL AFTER street,
  ADD COLUMN city         VARCHAR(100) NULL AFTER zip,
  ADD COLUMN country      VARCHAR(2)   NULL AFTER city,
  ADD COLUMN phone        VARCHAR(50)  NULL AFTER country,
  ADD COLUMN fax          VARCHAR(50)  NULL AFTER phone,
  ADD COLUMN email        VARCHAR(255) NULL AFTER fax,
  ADD COLUMN vat_id       VARCHAR(50)  NULL AFTER email,
  ADD COLUMN notes        TEXT         NULL AFTER vat_id;

-- User profile fields
ALTER TABLE users
  ADD COLUMN phone   VARCHAR(50)  NULL AFTER locale,
  ADD COLUMN street  VARCHAR(255) NULL AFTER phone,
  ADD COLUMN zip     VARCHAR(20)  NULL AFTER street,
  ADD COLUMN city    VARCHAR(100) NULL AFTER zip,
  ADD COLUMN country VARCHAR(2)   NULL AFTER city;
