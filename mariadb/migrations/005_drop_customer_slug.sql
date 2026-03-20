-- Drop the unused slug column from customers
ALTER TABLE customers DROP INDEX uq_slug, DROP COLUMN slug;
