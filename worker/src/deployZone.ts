import { rename, open } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execFileAsync = promisify(execFile)

const ZONE_DIR      = process.env.ZONE_DIR               ?? '/bind/primary/zones'
const RNDC_HOST     = process.env.BIND_PRIMARY_HOST      ?? 'bind-primary'
const RNDC_PORT     = process.env.BIND_PRIMARY_RNDC_PORT ?? '953'
const RNDC_KEY_FILE = process.env.RNDC_KEY_FILE          ?? '/etc/rndc/rndc.key'

/** Write content to a tmp file, fsync, then atomically rename to destPath. */
export async function writeAtomic(destPath: string, content: string): Promise<void> {
  const tmpPath = `${destPath}.tmp`
  const fh = await open(tmpPath, 'w')
  try {
    await fh.writeFile(content, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  await rename(tmpPath, destPath)
}

/**
 * Atomically writes a zone file and reloads BIND.
 * Always does reconfig before reload so newly added zones are registered.
 */
export async function deployZone(fqdn: string, content: string): Promise<void> {
  const zonePath = join(ZONE_DIR, `${fqdn}.zone`)

  await writeAtomic(zonePath, content)
  await rndcReconfig(RNDC_HOST, RNDC_PORT)
  await rndcReload(fqdn)
}

export async function rndcReload(fqdn: string): Promise<void> {
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
