-- 017_user_profile.sql
-- Replace full_name with first_name / last_name, add address & contact fields

-- ── users: add structured name, address, contact columns ─────
ALTER TABLE users
  ADD COLUMN first_name VARCHAR(255) NOT NULL DEFAULT '' AFTER role,
  ADD COLUMN last_name  VARCHAR(255) NOT NULL DEFAULT '' AFTER first_name,
  ADD COLUMN street     VARCHAR(255) NULL AFTER last_name,
  ADD COLUMN zip        VARCHAR(20)  NULL AFTER street,
  ADD COLUMN city       VARCHAR(100) NULL AFTER zip,
  ADD COLUMN country    VARCHAR(100) NULL AFTER city,
  ADD COLUMN phone      VARCHAR(50)  NULL AFTER country,
  ADD COLUMN mobile     VARCHAR(50)  NULL AFTER phone;

-- Migrate existing full_name → last_name (safest default)
UPDATE users SET last_name = full_name WHERE full_name != '';

ALTER TABLE users DROP COLUMN full_name;

-- ── user_invites: same name split ────────────────────────────
ALTER TABLE user_invites
  ADD COLUMN first_name VARCHAR(255) NOT NULL DEFAULT '' AFTER role,
  ADD COLUMN last_name  VARCHAR(255) NOT NULL DEFAULT '' AFTER first_name;

UPDATE user_invites SET last_name = full_name WHERE full_name != '';

ALTER TABLE user_invites DROP COLUMN full_name;
