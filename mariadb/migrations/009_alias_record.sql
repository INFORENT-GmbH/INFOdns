-- Add ALIAS record type for CNAME flattening support
ALTER TABLE dns_records
  MODIFY COLUMN type ENUM(
    'A','AAAA','CNAME','MX','NS','TXT','SRV',
    'CAA','PTR','NAPTR','TLSA','SSHFP','DNSKEY','DS','ALIAS'
  ) NOT NULL;
