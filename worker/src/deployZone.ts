import { open, unlink } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)

const ZONE_DIR      = process.env.ZONE_DIR               ?? '/bind/primary/zones'
const RNDC_HOST     = process.env.BIND_PRIMARY_HOST      ?? 'bind-primary'
const RNDC_PORT     = process.env.BIND_PRIMARY_RNDC_PORT ?? '953'
const RNDC_KEY_FILE = process.env.RNDC_KEY_FILE          ?? '/etc/rndc/rndc.key'

// Mirror of the API's FQDN validator. Re-checked here so a malformed value
// from the DB (or a future caller) can never reach rndc as a positional arg.
const FQDN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

function assertFqdn(fqdn: string): void {
  if (!FQDN_RE.test(fqdn)) throw new Error(`refusing to invoke rndc with invalid fqdn: ${JSON.stringify(fqdn)}`)
}

/**
 * Write content to destPath in-place (truncate + write + fsync).
 * We do NOT use rename because Docker bind-mounted directories are
 * resolved by inode — rename() creates a new inode that the BIND
 * container never sees until restarted.
 */
export async function writeAtomic(destPath: string, content: string): Promise<void> {
  const fh = await open(destPath, 'w')
  try {
    await fh.writeFile(content, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
}

/**
 * Atomically writes a zone file and reloads BIND.
 * Always does reconfig before reload so newly added zones are registered.
 * Retries reload if BIND hasn't finished processing reconfig yet.
 */
export async function deployZone(fqdn: string, content: string): Promise<void> {
  assertFqdn(fqdn)
  const zonePath = join(ZONE_DIR, `${fqdn}.zone`)

  // Delete stale unsigned-zone journals before replacing the zone file —
  // a full zone file replacement invalidates them (serial mismatch). The
  // signed-zone journals (.signed.jnl/.jbk) are intentionally NOT deleted
  // here: BIND's inline-signing uses them for incremental re-signing on
  // edits. Wiping them would force a full re-sign every render. Disable
  // cleanup is handled separately in cleanupDnssecArtifacts().
  await unlink(`${zonePath}.jnl`).catch(() => {})
  await unlink(`${zonePath}.jbk`).catch(() => {})

  await writeAtomic(zonePath, content)
  await rndcReconfig(RNDC_HOST, RNDC_PORT)

  // BIND may need a moment after reconfig to register a new zone.
  // Retry reload up to 5 times with 1s between attempts.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await rndcReload(fqdn)
      return
    } catch (err: any) {
      const notFound = err.message?.includes('not found') || err.stderr?.includes('not found')
      if (notFound && attempt < 5) {
        console.log(`[deploy] rndc reload ${fqdn} not found (attempt ${attempt}/5), retrying after ${attempt}s...`)
        await new Promise(r => setTimeout(r, 1000 * attempt))
        // Re-issue reconfig in case BIND dropped it
        await rndcReconfig(RNDC_HOST, RNDC_PORT).catch(() => {})
        continue
      }
      throw err
    }
  }
}

export async function rndcReload(fqdn: string): Promise<void> {
  assertFqdn(fqdn)
  await execFileAsync('rndc', [
    '-4',
    '-s', RNDC_HOST,
    '-p', RNDC_PORT,
    '-k', RNDC_KEY_FILE,
    'reload', fqdn,
  ])
}

export async function rndcReconfig(host: string, port = RNDC_PORT): Promise<void> {
  await execFileAsync('rndc', [
    '-4',
    '-s', host,
    '-p', port,
    '-k', RNDC_KEY_FILE,
    'reconfig',
  ])
}

/**
 * Remove BIND's inline-signing artifacts for a zone. Called when DNSSEC is
 * disabled so a stale signed zone file doesn't get resurrected if DNSSEC is
 * later re-enabled. Caller should issue rndc reload <fqdn> afterward to
 * make BIND drop in-memory signed state.
 */
export async function cleanupDnssecArtifacts(fqdn: string): Promise<void> {
  assertFqdn(fqdn)
  const zonePath = join(ZONE_DIR, `${fqdn}.zone`)
  await unlink(`${zonePath}.signed`).catch(() => {})
  await unlink(`${zonePath}.signed.jnl`).catch(() => {})
  await unlink(`${zonePath}.signed.jbk`).catch(() => {})
}

export async function rndcDnssecStatus(fqdn: string): Promise<string> {
  assertFqdn(fqdn)
  const { stdout } = await execFileAsync('rndc', [
    '-4',
    '-s', RNDC_HOST,
    '-p', RNDC_PORT,
    '-k', RNDC_KEY_FILE,
    'dnssec', '-status', fqdn,
  ])
  return stdout
}
