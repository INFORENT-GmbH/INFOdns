import { z } from 'zod'
import { isIPv4, isIPv6 } from 'net'

const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i
const isHostname = (v: string) => HOSTNAME_RE.test(v)

const fqdn = z.string().max(253).refine(isHostname, 'Invalid hostname')
const label = z.string().max(253)  // record name (relative or "@")

const typeValidators: Record<string, z.ZodTypeAny> = {
  A: z.object({
    name: label, type: z.literal('A'),
    ttl: z.number().int().positive().optional(),
    value: z.string().refine(v => isIPv4(v), 'Invalid IPv4'),
  }),

  AAAA: z.object({
    name: label, type: z.literal('AAAA'),
    ttl: z.number().int().positive().optional(),
    value: z.string().refine(v => isIPv6(v), 'Invalid IPv6'),
  }),

  CNAME: z.object({
    name: label, type: z.literal('CNAME'),
    ttl: z.number().int().positive().optional(),
    value: fqdn,
  }),

  MX: z.object({
    name: label, type: z.literal('MX'),
    ttl: z.number().int().positive().optional(),
    priority: z.number().int().min(0).max(65535),
    value: fqdn,
  }),

  NS: z.object({
    name: label, type: z.literal('NS'),
    ttl: z.number().int().positive().optional(),
    value: fqdn,
  }),

  TXT: z.object({
    name: label, type: z.literal('TXT'),
    ttl: z.number().int().positive().optional(),
    value: z.string().max(4096),
  }),

  SRV: z.object({
    name: label, type: z.literal('SRV'),
    ttl: z.number().int().positive().optional(),
    priority: z.number().int().min(0).max(65535),
    weight: z.number().int().min(0).max(65535),
    port: z.number().int().min(0).max(65535),
    value: fqdn,  // target hostname
  }),

  CAA: z.object({
    name: label, type: z.literal('CAA'),
    ttl: z.number().int().positive().optional(),
    // value format: "0 issue \"letsencrypt.org\""
    value: z.string().refine(v => /^(0|128)\s+(issue|issuewild|iodef)\s+".+"$/.test(v), 'Invalid CAA rdata'),
  }),

  PTR: z.object({
    name: label, type: z.literal('PTR'),
    ttl: z.number().int().positive().optional(),
    value: fqdn,
  }),

  TLSA: z.object({
    name: label, type: z.literal('TLSA'),
    ttl: z.number().int().positive().optional(),
    // value: "usage selector mtype hex"
    value: z.string().refine(v => /^\d+\s+\d+\s+\d+\s+[0-9a-fA-F]+$/.test(v), 'Invalid TLSA rdata'),
  }),

  SSHFP: z.object({
    name: label, type: z.literal('SSHFP'),
    ttl: z.number().int().positive().optional(),
    value: z.string().refine(v => /^\d+\s+\d+\s+[0-9a-fA-F]+$/.test(v), 'Invalid SSHFP rdata'),
  }),

  DS: z.object({
    name: label, type: z.literal('DS'),
    ttl: z.number().int().positive().optional(),
    value: z.string().refine(v => /^\d+\s+\d+\s+\d+\s+[0-9a-fA-F]+$/.test(v), 'Invalid DS rdata'),
  }),

  NAPTR: z.object({
    name: label, type: z.literal('NAPTR'),
    ttl: z.number().int().positive().optional(),
    value: z.string().min(1),
  }),

  ALIAS: z.object({
    name: label, type: z.literal('ALIAS'),
    ttl: z.number().int().positive().optional(),
    value: fqdn,
  }),
}

export type RecordType = keyof typeof typeValidators

export function validateRecord(data: unknown): { success: true; data: any } | { success: false; error: string } {
  const raw = data as any
  const validator = typeValidators[raw?.type]
  if (!validator) return { success: false, error: `Unsupported record type: ${raw?.type}` }
  const result = validator.safeParse(data)
  if (!result.success) return { success: false, error: result.error.message }
  return { success: true, data: result.data }
}
