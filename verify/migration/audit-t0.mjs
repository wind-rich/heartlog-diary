import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const core = require('./backup-core.cjs')
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '../..')
export const DEFAULT_ZIP = resolve(ROOT, 'verify/_artifacts/migration/private/original/source-backup.zip')
export const EXPECTED_SHA256 = 'a1eee5fe41593ea4cb0b101bead4b67ca6e49060cec21fdea239154c8d7476d7'
export const ARTIFACTS = resolve(ROOT, 'verify/_artifacts/migration')
export const PRIVATE_OUT = resolve(ARTIFACTS, 'private/t0')

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'w' })
}

export async function runAudit(zipPath = DEFAULT_ZIP) {
  const startedAt = new Date().toISOString()
  const bytes = readFileSync(zipPath)
  const audit = await core.auditBackup(bytes, JSZip, webcrypto, EXPECTED_SHA256)
  const generatedAt = new Date().toISOString()
  const publicReport = {
    schema: 'heartlog-t0-audit-public-v1',
    startedAt,
    generatedAt,
    ok: audit.ok,
    source: { sha256: audit.sourceSha256, expectedSha256: EXPECTED_SHA256, bytes: bytes.byteLength },
    app: audit.app,
    version: audit.version,
    zipEntryCount: audit.zipEntryCount,
    zipFileCount: audit.zipFileCount,
    referencedMediaFiles: audit.referencedFileCount || 0,
    counts: audit.counts,
    issueCount: audit.issues.length,
    issues: audit.publicIssues || [],
    fields: audit.fields,
    recoveryAuthorized: audit.ok,
    privateReport: 'private/t0/audit-private.json',
  }
  const privateReport = {
    schema: 'heartlog-t0-audit-private-v1',
    startedAt,
    generatedAt,
    ok: audit.ok,
    sourceSha256: audit.sourceSha256,
    issues: audit.issues,
    records: audit.privateRecords,
    media: audit.privateMedia,
    anniversaries: audit.anniversaryInventory || [],
    confidentiality: 'Private identifiers and hashes only. No record values, meta keys/values, or image bytes.',
  }
  writeJson(resolve(ARTIFACTS, 't0-audit.json'), publicReport)
  writeJson(resolve(PRIVATE_OUT, 'audit-private.json'), privateReport)
  return { audit, publicReport, privateReport, sourceBytes: bytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { audit } = await runAudit(process.env.HL_T0_ZIP ? resolve(process.env.HL_T0_ZIP) : DEFAULT_ZIP)
    const mediaCount = audit.privateMedia.length
    console.log(`${audit.ok ? 'AUDIT PASS' : 'AUDIT FAIL'} tables=${core.TABLE_NAMES.length} media=${mediaCount} issues=${audit.issues.length}`)
    console.log(`Public report: ${relative(ROOT, resolve(ARTIFACTS, 't0-audit.json')).replaceAll('\\', '/')}`)
    console.log(`Private report: ${relative(ROOT, resolve(PRIVATE_OUT, 'audit-private.json')).replaceAll('\\', '/')}`)
    if (!audit.ok) process.exitCode = 1
  } catch (error) {
    console.error(`AUDIT ERROR ${error instanceof Error ? error.name : 'unknown'}`)
    process.exitCode = 1
  }
}
