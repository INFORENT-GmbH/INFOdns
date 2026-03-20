import mysql from 'mysql2/promise.js'

export const pool = mysql.createPool({
  host:     process.env.DB_HOST     ?? 'db',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? 'infodns',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'infodns',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+00:00',
})

// mysql2's ExecuteValues type is too narrow for runtime values; cast to any[].
type P = any[]

export async function query<T = mysql.RowDataPacket>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await pool.execute<mysql.RowDataPacket[]>(sql, params as P)
  return rows as T[]
}

export async function queryOne<T = mysql.RowDataPacket>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

export async function execute(sql: string, params?: unknown[]): Promise<mysql.ResultSetHeader> {
  const [result] = await pool.execute<mysql.ResultSetHeader>(sql, params as P)
  return result
}

/** Run multiple statements in a transaction. Rolls back on error. */
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

/** Run pending SQL migrations from /app/migrations/ on startup. */
export async function runMigrations(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  const [applied] = await pool.execute<mysql.RowDataPacket[]>(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  )
  const done = new Set(applied.map((r) => r.filename))

  const { readdir, readFile } = await import('fs/promises')
  const { resolve, join } = await import('path')
  // Volume-mounted at /app/migrations in production; relative in dev
  const dir = resolve(process.env.MIGRATIONS_DIR ?? '/app/migrations')
  let files: string[]
  try {
    files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()
  } catch {
    return // no migrations dir — skip
  }

  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(join(dir, file), 'utf-8')
    const conn = await pool.getConnection()
    try {
      // Execute each statement separately (mysql2 doesn't support multi-statement by default)
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        // Strip leading SQL comment lines from each chunk
        .map(s => s.replace(/^(\s*--.*\n?)+/, '').trim())
        .filter(s => s.length > 0)
      for (const stmt of statements) {
        await conn.execute(stmt)
      }
      await conn.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [file])
      console.log(`Migration applied: ${file}`)
    } catch (err) {
      console.error(`Migration failed: ${file}`, err)
      throw err
    } finally {
      conn.release()
    }
  }
}
