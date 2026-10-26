/* Isolated T0 restore and IndexedDB comparison. Never imports application code. */
(() => {
  const core = globalThis.HeartlogT0
  const DB_PREFIX = 'heartlog_t0_verify_'
  const SCHEMA = {
    persons: 'id, name, isActive, createdAt, updatedAt',
    preferences: 'id, personId, category, direction, updatedAt',
    entries: 'id, personId, occurredAt, type, createdAt, updatedAt',
    dailyStatus: 'id, personId, date, updatedAt',
    health: 'id, personId, occurredAt, status, updatedAt',
    gifts: 'id, personId, givenAt, updatedAt',
    wishes: 'id, personId, status, raisedAt, updatedAt',
    photos: 'id, personId, entryId, giftId, takenAt, createdAt, *tags',
    insights: 'id, personId, dimension, confirmState, updatedAt',
    summaries: 'id, personId, kind, rangeStart, rangeEnd, createdAt',
    meta: 'key',
  }
  const setState = (state) => {
    globalThis.__t0State = state
    const output = document.getElementById('status')
    if (output) output.textContent = state
  }

  function assert(condition, code) {
    if (!condition) throw new Error(code)
  }

  function openDatabase(name) {
    const db = new Dexie(name)
    db.version(1).stores(SCHEMA)
    return db
  }

  async function decodeBlob(blob) {
    try {
      const bitmap = await createImageBitmap(blob)
      const result = { ok: bitmap.width > 0 && bitmap.height > 0, width: bitmap.width, height: bitmap.height, decoder: 'createImageBitmap' }
      bitmap.close()
      return result
    } catch {
      let url
      try {
        url = URL.createObjectURL(blob)
        const image = new Image()
        await new Promise((resolve, reject) => {
          image.onload = resolve
          image.onerror = reject
          image.src = url
        })
        return { ok: image.naturalWidth > 0 && image.naturalHeight > 0, width: image.naturalWidth, height: image.naturalHeight, decoder: 'Image' }
      } catch {
        return { ok: false, width: 0, height: 0, decoder: 'unavailable' }
      } finally {
        if (url) URL.revokeObjectURL(url)
      }
    }
  }

  function findOrphanReferences(data) {
    const orphans = []
    const ids = {}
    for (const table of core.TABLE_NAMES) {
      ids[table] = new Set()
      for (const row of data[table]) ids[table].add(table === 'meta' ? row.key : row.id)
    }
    const one = (table, row, field, targetTable, targetId) => {
      if (typeof targetId === 'string' && targetId && !ids[targetTable].has(targetId)) orphans.push({ table, id: row.id, field, relatedTable: targetTable, relatedId: targetId })
    }
    const many = (table, row, field, targetTable, values) => {
      if (Array.isArray(values)) for (const targetId of values) one(table, row, field, targetTable, targetId)
    }
    for (const table of core.TABLE_NAMES) {
      if (table === 'persons' || table === 'meta') continue
      for (const row of data[table]) one(table, row, 'personId', 'persons', row.personId)
    }
    for (const row of data.persons) one('persons', row, 'avatarPhotoId', 'photos', row.avatarPhotoId)
    for (const table of ['entries', 'gifts']) for (const row of data[table]) many(table, row, 'photoIds', 'photos', row.photoIds)
    for (const row of data.photos) {
      one('photos', row, 'entryId', 'entries', row.entryId)
      one('photos', row, 'giftId', 'gifts', row.giftId)
    }
    for (const row of data.gifts) {
      one('gifts', row, 'entryId', 'entries', row.entryId)
      one('gifts', row, 'wishId', 'wishes', row.wishId)
    }
    for (const row of data.wishes) {
      one('wishes', row, 'giftId', 'gifts', row.giftId)
      many('wishes', row, 'entryIds', 'entries', row.entryIds)
    }
    for (const table of ['preferences', 'insights', 'summaries']) for (const row of data[table]) many(table, row, 'evidenceEntryIds', 'entries', row.evidenceEntryIds)
    for (const row of data.health) many('health', row, 'entryIds', 'entries', row.entryIds)
    for (const row of data.summaries) if (row.aiMeta) many('summaries', row, 'aiMeta.citedEntryIds', 'entries', row.aiMeta.citedEntryIds)
    return orphans
  }

  async function compareTables(source, restored) {
    const tables = []
    const differences = []
    const sourceRecords = []
    const restoredRecords = []
    for (const table of core.TABLE_NAMES) {
      const sourceRows = source[table]
      const restoredRows = restored[table]
      const keyOf = (row) => table === 'meta' ? row.key : row.id
      const sourceMap = new Map(sourceRows.map((row) => [keyOf(row), row]))
      const restoredMap = new Map(restoredRows.map((row) => [keyOf(row), row]))
      const sourceIndexes = new Map(sourceRows.map((row, index) => [keyOf(row), index]))
      const restoredIndexes = new Map(restoredRows.map((row, index) => [keyOf(row), index]))
      const sourceHashes = new Map()
      const restoredHashes = new Map()
      for (const row of sourceRows) {
        const hash = await core.recordHash(crypto, table, row)
        sourceHashes.set(keyOf(row), hash)
        sourceRecords.push(table === 'meta' ? { table, rowIndex: sourceIndexes.get(keyOf(row)), recordHash: hash } : { table, id: row.id, recordHash: hash })
      }
      for (const row of restoredRows) {
        const hash = await core.recordHash(crypto, table, row)
        restoredHashes.set(keyOf(row), hash)
        restoredRecords.push(table === 'meta' ? { table, rowIndex: restoredIndexes.get(keyOf(row)), recordHash: hash } : { table, id: row.id, recordHash: hash })
      }
      let missingCount = 0
      let extraCount = 0
      let differentContentCount = 0
      let matchedCount = 0
      for (const [key, hash] of sourceHashes) {
        const privateLocator = table === 'meta' ? { sourceRowIndex: sourceIndexes.get(key) } : { id: key }
        if (!restoredHashes.has(key)) {
          missingCount++
          differences.push({ table, kind: 'missing', ...privateLocator, sourceHash: hash })
        } else if (restoredHashes.get(key) !== hash) {
          differentContentCount++
          differences.push({ table, kind: 'different-content', ...privateLocator, sourceHash: hash, restoredHash: restoredHashes.get(key) })
        } else matchedCount++
      }
      for (const [key, hash] of restoredHashes) {
        if (!sourceHashes.has(key)) {
          extraCount++
          const privateLocator = table === 'meta' ? { restoredRowIndex: restoredIndexes.get(key) } : { id: key }
          differences.push({ table, kind: 'extra', ...privateLocator, restoredHash: hash })
        }
      }
      tables.push({ table, sourceCount: sourceRows.length, restoredCount: restoredRows.length, missingCount, extraCount, differentContentCount, matchedCount, ok: missingCount + extraCount + differentContentCount === 0 && sourceRows.length === restoredRows.length })
    }
    return { tables, differences, sourceRecords, restoredRecords }
  }

  async function compareMedia(sourceAudit, restoredPhotos) {
    const sourceByKey = new Map(sourceAudit.privateMedia.map((item) => [`${item.photoId}\u0000${item.kind}`, item]))
    const restoredMedia = []
    const differences = []
    const decodes = []
    for (const photo of restoredPhotos) {
      for (const [field, kind] of [['blob', 'original'], ['thumb', 'thumb']]) {
        const key = `${photo.id}\u0000${kind}`
        const expected = sourceByKey.get(key)
        if (!expected) {
          differences.push({ photoId: photo.id, kind, code: 'UNEXPECTED_RESTORED_MEDIA' })
          continue
        }
        const blob = photo[field]
        if (!(blob instanceof Blob)) {
          differences.push({ photoId: photo.id, kind, code: 'RESTORED_MEDIA_NOT_BLOB' })
          continue
        }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        const digest = await core.sha256(crypto, bytes)
        const actual = { photoId: photo.id, kind, sha256: digest, bytes: blob.size, mime: blob.type }
        restoredMedia.push(actual)
        if (expected.sha256 !== digest) differences.push({ photoId: photo.id, kind, code: 'MEDIA_HASH_MISMATCH', expectedHash: expected.sha256, actualHash: digest })
        if (expected.bytes !== blob.size) differences.push({ photoId: photo.id, kind, code: 'MEDIA_BYTES_MISMATCH' })
        if (expected.mime !== blob.type) differences.push({ photoId: photo.id, kind, code: 'MEDIA_MIME_MISMATCH' })
        const decode = await decodeBlob(blob)
        decodes.push({ photoId: photo.id, kind, ...decode })
        if (!decode.ok) differences.push({ photoId: photo.id, kind, code: 'MEDIA_DECODE_FAILED' })
      }
    }
    const restoredKeys = new Set(restoredMedia.map((item) => `${item.photoId}\u0000${item.kind}`))
    for (const expected of sourceAudit.privateMedia) {
      const key = `${expected.photoId}\u0000${expected.kind}`
      if (!restoredKeys.has(key) && !differences.some((item) => item.photoId === expected.photoId && item.kind === expected.kind && item.code === 'RESTORED_MEDIA_NOT_BLOB')) differences.push({ photoId: expected.photoId, kind: expected.kind, code: 'MISSING_RESTORED_MEDIA' })
    }
    return { restoredMedia, differences, decodes }
  }

  globalThis.runT0 = async (config) => {
    let db
    try {
      setState('preflight')
      assert(location.origin === 'http://127.0.0.1:5289', 'UNEXPECTED_ORIGIN')
      assert(typeof config.dbName === 'string' && config.dbName.startsWith(DB_PREFIX) && config.dbName.length > DB_PREFIX.length, 'INVALID_ISOLATED_DB_NAME')
      assert(config.dbName !== 'heartlog', 'REAL_DATABASE_FORBIDDEN')
      assert(typeof config.zipUrl === 'string' && config.zipUrl.startsWith('/@fs/'), 'INVALID_ZIP_URL')
      const response = await fetch(config.zipUrl, { cache: 'no-store', credentials: 'omit', redirect: 'error' })
      assert(response.ok, 'ZIP_FETCH_FAILED')
      assert(new URL(response.url).origin === location.origin, 'ZIP_ORIGIN_MISMATCH')
      const zipBuffer = await response.arrayBuffer()

      setState('read-only-audit')
      const sourceAudit = await core.auditBackup(zipBuffer, JSZip, crypto, config.expectedSha256)
      if (!sourceAudit.ok) return { ok: false, stage: 'read-only-audit', issueCount: sourceAudit.issues.length, issues: sourceAudit.publicIssues, private: { issues: sourceAudit.issues } }
      assert(sourceAudit.sourceSha256 === config.expectedSha256, 'AUDIT_ASSERTION_FAILED')

      setState('isolated-restore')
      await Dexie.delete(config.dbName)
      db = openDatabase(config.dbName)
      await db.open()
      assert(db.name === config.dbName && db.name !== 'heartlog', 'DATABASE_ISOLATION_FAILED')
      for (const table of db.tables) assert(await table.count() === 0, 'ISOLATED_DATABASE_NOT_EMPTY')
      const source = sourceAudit.data
      const photoRows = []
      for (const sourcePhoto of source.photos) {
        const row = structuredClone(sourcePhoto)
        const originalBytes = await sourceAudit.zip.file(`photos/${sourcePhoto.file}`).async('uint8array')
        const thumbBytes = await sourceAudit.zip.file(`photos/${sourcePhoto.thumbFile}`).async('uint8array')
        row.blob = new Blob([originalBytes], { type: sourcePhoto.mime })
        row.thumb = new Blob([thumbBytes], { type: sourcePhoto.mime })
        photoRows.push(row)
      }
      await db.transaction('rw', db.tables, async () => {
        for (const table of core.TABLE_NAMES) {
          const rows = table === 'photos' ? photoRows : source[table]
          await db.table(table).bulkAdd(rows)
        }
      })
      db.close()
      db = openDatabase(config.dbName)
      await db.open()

      setState('indexeddb-comparison')
      const restored = {}
      for (const table of core.TABLE_NAMES) restored[table] = await db.table(table).toArray()
      const comparison = await compareTables(source, restored)
      const media = await compareMedia(sourceAudit, restored.photos)
      const restoredOrphanReferences = findOrphanReferences(restored)
      const associationDifferences = []
      for (const photo of source.photos) {
        const actual = restored.photos.find((item) => item.id === photo.id)
        if (!actual) continue
        for (const field of ['personId', 'entryId', 'giftId']) {
          if (photo[field] !== actual[field]) associationDifferences.push({ photoId: photo.id, field })
        }
      }
      const mediaDecodeFailures = media.decodes.filter((item) => !item.ok).length
      const tablesOk = comparison.tables.every((item) => item.ok)
      const ok = tablesOk && media.differences.length === 0 && restoredOrphanReferences.length === 0 && associationDifferences.length === 0
      const tableCounts = Object.fromEntries(comparison.tables.map((item) => [item.table, item.restoredCount]))
      setState(ok ? 'pass' : 'fail')
      return {
        ok,
        stage: 'complete',
        databaseName: config.dbName,
        sourceSha256: sourceAudit.sourceSha256,
        tables: comparison.tables,
        media: { expected: sourceAudit.privateMedia.length, restored: media.restoredMedia.length, differences: media.differences.length, decoded: media.decodes.length - mediaDecodeFailures, decodeFailures: mediaDecodeFailures },
        restoredOrphanReferenceCount: restoredOrphanReferences.length,
        associationDifferenceCount: associationDifferences.length,
        tableCounts,
        private: {
          auditIssues: sourceAudit.issues,
          sourceRecords: comparison.sourceRecords,
          restoredRecords: comparison.restoredRecords,
          differences: comparison.differences,
          sourceMedia: sourceAudit.privateMedia,
          restoredMedia: media.restoredMedia,
          mediaDifferences: media.differences,
          decodes: media.decodes,
          restoredOrphanReferences,
          associationDifferences,
        },
      }
    } catch (error) {
      setState('error')
      return { ok: false, stage: globalThis.__t0State || 'error', errorName: error instanceof Error ? error.name : 'Error', errorCode: error instanceof Error ? error.message : 'UNKNOWN' }
    } finally {
      if (db) db.close()
    }
  }
})()
