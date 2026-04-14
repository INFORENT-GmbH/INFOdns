ALTER TABLE domains ADD COLUMN template_id INT UNSIGNED NULL;
ALTER TABLE domains ADD CONSTRAINT fk_domain_template FOREIGN KEY (template_id) REFERENCES dns_templates(id) ON DELETE SET NULL
