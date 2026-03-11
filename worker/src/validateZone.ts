import { execFile } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

const execFileAsync = promisify(execFile)

const NAMED_CHECKZONE = process.env.NAMED_CHECKZONE_BIN ?? 'named-checkzone'

export interface ValidationResult {
  ok: boolean
  error?: string
}

/**
 * Validates a zone file string using named-checkzone.
 * Writes to a temp file, runs the check, cleans up.
 */
export async function validateZone(fqdn: string, content: string): Promise<ValidationResult> {
  const tmpFile = join(tmpdir(), `infodns-${randomBytes(6).toString('hex')}.zone`)
  await writeFile(tmpFile, content, 'utf8')

  try {
    await execFileAsync(NAMED_CHECKZONE, [fqdn, tmpFile])
    return { ok: true }
  } catch (err: any) {
    const detail: string = (err.stderr || err.stdout || err.message || String(err)).trim()
    return { ok: false, error: detail }
  } finally {
    await unlink(tmpFile).catch(() => {})
  }
}
