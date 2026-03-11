import mysql from 'mysql2/promise.js'

/** Returns today as YYYYMMDD integer in UTC */
function todayInt(): number {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return Number(`${y}${m}${day}`)
}

/**
 * Atomically increments the SOA serial for a domain.
 * Must be called inside an existing transaction with a FOR UPDATE lock.
 * Format: YYYYMMDDnn (max 99 increments per day).
 */
export function nextSerial(currentSerial: number): number {
  const today = todayInt()
  const currentDatePart = Math.floor(currentSerial / 100)

  if (currentDatePart === today) {
    const nn = currentSerial % 100
    if (nn >= 99) throw new Error(`SOA serial exhausted for today (${today}99). Try again tomorrow.`)
    return currentSerial + 1
  }
  return today * 100 + 1
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
