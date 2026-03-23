-- Clear stale DS-format values so worker re-extracts in DNSKEY format on next zone render
UPDATE domains SET dnssec_ds = NULL WHERE dnssec_ds IS NOT NULL;
