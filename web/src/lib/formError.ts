// API errors from Zod come back as `{ message: "<JSON-stringified ZodIssue[]>" }`.
// Unwrap to a flat "field: message, field: message" string for inline display.

type AnyError = {
  response?: { data?: { message?: string; error?: string; code?: string } }
  message?: string
} | unknown

export function formatApiError(err: AnyError, fallback = 'Request failed'): string {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string }
  const data = e?.response?.data
  let msg: string = data?.message ?? data?.error ?? e?.message ?? fallback
  // Zod errors are JSON-stringified arrays of issues — unwrap to readable text.
  try {
    const parsed: unknown = JSON.parse(msg)
    if (Array.isArray(parsed)) {
      msg = parsed
        .map((z: { path?: (string | number)[]; message?: string }) =>
          `${z.path?.join('.') || 'field'}: ${z.message}`
        )
        .join(', ')
    }
  } catch { /* not JSON, use as-is */ }
  return msg
}
