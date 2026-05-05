-- Mehrere Geschäftsführer als JSON-Array von user_ids.
-- Der frühere VARCHAR-Freitext managing_director bleibt für historische
-- Daten erhalten, wird aber nicht mehr aktiv genutzt.
ALTER TABLE company_settings
  ADD COLUMN managing_director_ids JSON NULL AFTER managing_director;
