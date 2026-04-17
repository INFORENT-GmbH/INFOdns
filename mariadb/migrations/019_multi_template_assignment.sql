CREATE TABLE domain_templates (
  domain_id   INT UNSIGNED NOT NULL,
  template_id INT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (domain_id, template_id),
  FOREIGN KEY (domain_id)   REFERENCES domains(id)       ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES dns_templates(id) ON DELETE CASCADE,
  INDEX idx_dt_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrate existing single-template assignments to the join table
INSERT INTO domain_templates (domain_id, template_id)
  SELECT id, template_id FROM domains WHERE template_id IS NOT NULL;

ALTER TABLE domains DROP FOREIGN KEY fk_domain_template;
ALTER TABLE domains DROP COLUMN template_id;
