I want to import the domains, customers, ns records and domain prices from inforent-domains.sql

The admin should be able to upload the file and select which data to import.

This is quite complex as the source database does not really make use of IDs, please check.

table companies: all those companies need to be imported as tenants (skip if they exist already by id)
company_id = is the id - we need to use this as id if we import
keyword = is the company name

table domains:
DOMAIN = is the full domain name, like example.com. if it does not exist yet, it needs to be created.
TLD = is the TLD, like .com, not needed
ZONE = not needed
COST_CENTER and BRAND = small text field. this should end up as a new additional field for domains which can be edited/searched.
PUBLISH = 0 means we manage the domain somehow, but we do not deploy the DNS to our NS. 1 means we publish it on our NS.
REGISTRAR = 1 means we have registered this domain for the customer. 0 means domain registration is managed by the customer.
NOTE = note text to be set by customer
NOTE_INTERNAL = note text to be set by admins only
! FLAG = was ist das?
NS_REFERENCE = e.g. example2.com - domain will always use the same dns records from the selected domain
SMTP_TO = SMTP server (like smtp.inforent.net) or NULL
SPAM_TO = e.g. spam@inforent.net or NULL
ADD_FEE = extra fee for the customer

table ns: all DNS records
DOMAIN = e.g. domain.com
HOST = e.g. @ or www
TYPE = record type, e.g. A
PRIORITY
ENTRY = the entry like 1.2.3.4
PTR
TTL

table domain_fees:
ZONE = e.g. .cn.com or .de
TLD = for ZONE cn.com it would be com, for ZONE de it's de
Description: Text field
EK = buy price for us
FEE = verkaufspreis
NOTE = text field
FLAG = kann weg
COUNT = zählt anzahl der domains, brauchen wir nicht

in the domain_fees table we also have:
REGISTRAR = text field, this is where we registreted the domain. this is either CN, MARCARIA, UD or UDR.
then we have the columns UDR, CN, MARCARIA and UD which include the price of the domain at the given registrar.
basically this means we also need registrar management (those are all manual, no domain is auto-registered).
most domains are registreted at the REGISTRAR. this should become a new reference with domains table, which defaults to the REGISTRAR for the TLD from domain_fees, but admins can change it to other registrar