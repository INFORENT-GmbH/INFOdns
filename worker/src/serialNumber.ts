import mysql from 'mysql2/promise.js'

/**
 * Returns the next SOA serial. Uses Unix timestamp (seconds since epoch).
 * Math.max ensures monotonic increase if two renders happen within the same second.
 */
export function nextSerial(currentSerial: number): number {
  return Math.max(currentSerial + 1, Math.floor(Date.now() / 1000))
}

/**
 * Claim and increment the serial for domainId inside the given connection (within a transaction).
 * Returns the new serial.
 */
export async function claimSerial(conn: mysql.PoolConnection, domainId: number): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    'SELECT last_serial FROM domains WHERE id = ? FOR UPDATE',
    [domainId]
  )
  const current: number = (rows[0] as any)?.last_serial ?? 0
  const serial = nextSerial(current)
  await conn.execute('UPDATE domains SET last_serial = ? WHERE id = ?', [serial, domainId])
  return serial
}
