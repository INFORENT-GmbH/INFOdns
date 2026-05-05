-- mail_queue um Datei-Anhänge erweitern.
-- Format: JSON-Array von {path, filename, contentType?}
-- Beispiel: [{"path": "/storage/invoices/2026/2026-00042.pdf", "filename": "Rechnung_2026-00042.pdf"}]
ALTER TABLE mail_queue
  ADD COLUMN attachments_json JSON NULL AFTER body_text;
