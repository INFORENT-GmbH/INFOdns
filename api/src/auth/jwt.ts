import { createHash, randomBytes } from 'crypto'
import { query, queryOne, execute } from '../db.js'

export interface JwtPayload {
  sub: number        // user id
  role: 'admin' | 'operator' | 'tenant'
  tenantId: number | null
  impersonatingId?: number   // real admin user id when impersonating
}

/** Hash a raw refresh token for DB storage */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url')
}

export async function saveRefreshToken(userId: number, raw: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  await execute(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, hashToken(raw), expiresAt.toISOString().slice(0, 19).replace('T', ' ')]
  )
}

export async function rotateRefreshToken(
  raw: string
): Promise<{ userId: number } | null> {
  type Row = { id: number; user_id: number; expires_at: string; revoked: number }
  const row = await queryOne<Row>(
    'SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = ?',
    [hashToken(raw)]
  )
  if (!row || row.revoked || new Date(row.expires_at) < new Date()) return null

  // Revoke the used token
  await execute('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?', [row.id])
  return { userId: row.user_id }
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await execute('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?', [userId])
}
