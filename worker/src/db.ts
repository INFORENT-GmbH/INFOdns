import mysql from 'mysql2/promise.js'

export const pool = mysql.createPool({
  host:     process.env.DB_HOST     ?? 'db',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? 'infodns',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'infodns',
  waitForConnections: true,
  connectionLimit: 5,
  timezone: '+00:00',
})

type P = any[]

export async function query<T = mysql.RowDataPacket>(sql: string, params?: unknown[]): Promise<T[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params as P)
  return rows as T[]
}

export async function queryOne<T = mysql.RowDataPacket>(sql: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function execute(sql: string, params?: unknown[]): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(sql, params as P)
  return result
}

/** Ping the DB until it responds, so worker can boot in parallel with mariadb. */
export async function waitForDb(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1')
      return
    } catch (err) {
      lastErr = err
      await new Promise(r => setTimeout(r, 200))
    }
  }
  throw new Error(`waitForDb: DB not reachable after ${timeoutMs}ms: ${(lastErr as Error)?.message}`)
}

export async function transaction<T>(fn: (conn: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  await conn.beginTransaction()
  try {
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}
