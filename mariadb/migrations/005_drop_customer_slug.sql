-- Drop the unused slug column from tenants
ALTER TABLE tenants DROP INDEX uq_slug, DROP COLUMN slug;
