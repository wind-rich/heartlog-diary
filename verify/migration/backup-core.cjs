/* T0 backup audit primitives. No application imports and no network access. */
(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  root.HeartlogT0 = api
})(globalThis, function () {
  const TABLE_NAMES = ['persons', 'preferences', 'entries', 'dailyStatus', 'health', 'gifts', 'wishes', 'photos', 'insights', 'summaries', 'meta']
  const COUNT_TABLES = TABLE_NAMES.filter((name) => name !== 'meta')
  const S = (required = true) => ({ type: 'string', required })
  const N = (required = true) => ({ type: 'number', required })
  const B = (required = true) => ({ type: 'boolean', required })
  const SA = (required = true) => ({ type: 'string[]', required })
  const AA = (required = true) => ({ type: 'anniversary[]', required })
  const O = (required = true) => ({ type: 'object', required })
  const COMMON = { id: S(), personId: S(), createdAt: S(), updatedAt: S() }
  const ANNIVERSARY_SCHEMA = {
    id: S(), name: S(), date: S(), calendarType: S(), repeatYearly: B(), note: S(false),
  }
  const AI_META_SCHEMA = {
    model: S(false), includeHealth: B(false), includePrivate: B(false), query: S(false), citedEntryIds: SA(false), gaps: S(false),
  }
  const SCHEMAS = {
    persons: {
      id: S(), createdAt: S(), updatedAt: S(), name: S(), nickname: S(false), avatarPhotoId: S(false), birthday: S(false), calendarType: S(), zodiac: S(false),
      zodiacOverridden: B(false), meetDate: S(false), anniversaries: AA(), intro: S(false), tags: SA(), isActive: B(),
    },
    preferences: {
      ...COMMON, category: S(), name: S(), direction: S(), likeLevel: N(false), note: S(false), tags: SA(),
      lastConfirmedAt: S(false), evidenceEntryIds: SA(),
    },
    entries: {
      ...COMMON, occurredAt: S(), type: S(), title: S(), content: S(false), taSaid: S(false), myObservation: S(false),
      mood: S(false), moodCustom: S(false), moodLevel: N(false), tagList: SA(), photoIds: SA(), followUp: S(false),
      followUpDone: B(), quick: B(),
    },
    dailyStatus: {
      ...COMMON, date: S(), mood: S(false), moodCustom: S(false), moodLevel: N(false), energy: N(false), sleepHours: N(false),
      goodThing: S(false), worry: S(false), needAttention: S(false), note: S(false),
    },
    health: {
      ...COMMON, occurredAt: S(), symptom: S(), severity: N(false), medication: S(false), note: S(false), status: S(),
      recovery: S(false), resolvedAt: S(false), entryIds: SA(),
    },
    gifts: {
      ...COMMON, name: S(), givenAt: S(), occasion: S(false), feedback: S(false), note: S(false), amount: N(false),
      entryId: S(false), wishId: S(false), photoIds: SA(),
    },
    wishes: {
      ...COMMON, content: S(), raisedAt: S(false), status: S(), priority: N(false), occasion: S(false), note: S(false),
      giftId: S(false), entryIds: SA(),
    },
    photos: {
      id: S(), personId: S(), createdAt: S(), mime: S(), size: N(), takenAt: S(false), caption: S(false), entryId: S(false),
      giftId: S(false), tags: SA(), keepOriginal: B(), file: S(), thumbFile: S(),
    },
    insights: {
      ...COMMON, dimension: S(), description: S(), evidenceType: S(), evidenceEntryIds: SA(), confirmState: S(), userEdited: B(),
    },
    summaries: {
      ...COMMON, kind: S(), title: S(), rangeStart: S(), rangeEnd: S(), content: S(), generator: S(), aiMeta: O(false), evidenceEntryIds: SA(),
    },
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }

  function typeMatches(value, type) {
    if (type === 'string') return typeof value === 'string'
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
    if (type === 'boolean') return typeof value === 'boolean'
    if (type === 'string[]') return Array.isArray(value) && value.every((item) => typeof item === 'string')
    if (type === 'anniversary[]') return Array.isArray(value) && value.every(isObject)
    if (type === 'object') return isObject(value)
    return false
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (isObject(value)) {
      const out = {}
      for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) out[key] = canonicalize(value[key])
      }
      return out
    }
    return value
  }

  function normalizeRecord(table, row) {
    const copy = { ...row }
    if (table === 'photos') {
      delete copy.blob
      delete copy.thumb
    }
    return canonicalize(copy)
  }

  async function sha256(cryptoApi, value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    const view = ArrayBuffer.isView(bytes) ? bytes : new Uint8Array(bytes)
    const digest = await cryptoApi.subtle.digest('SHA-256', view)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  async function recordHash(cryptoApi, table, row) {
    return sha256(cryptoApi, JSON.stringify(normalizeRecord(table, row)))
  }

  function safeRelativePath(path) {
    if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') || path.startsWith('/')) return false
    if (/^[a-zA-Z]:/.test(path)) return false
    const clean = path.endsWith('/') ? path.slice(0, -1) : path
    const parts = clean.split('/')
    return parts.every((part) => part && part !== '.' && part !== '..') && path === path.normalize('NFC')
  }

  function publicIssue(issue) {
    return { code: issue.code, table: issue.table, field: issue.field }
  }

  async function auditBackup(zipBuffer, JSZip, cryptoApi, expectedSha256) {
    const issues = []
    const fieldMap = new Map()
    const privateRecords = []
    const privateMedia = []
    const anniversaryInventory = []
    const addIssue = (code, details = {}) => issues.push({ code, ...details })
    const addField = (table, field, known, typePolicy, occurrences = 1) => {
      const key = `${table}\u0000${field}`
      const existing = fieldMap.get(key)
      if (existing) existing.occurrences += occurrences
      else fieldMap.set(key, {
        table, field, status: known ? 'known' : 'unknown', typePolicy,
        strategy: known ? 'validate-and-preserve-exact' : 'preserve-exact-no-coercion', occurrences,
      })
    }

    const sourceSha256 = await sha256(cryptoApi, zipBuffer)
    if (expectedSha256 && sourceSha256 !== expectedSha256) addIssue('SOURCE_SHA256_MISMATCH')
    let zip
    let data
    let manifest
    try {
      zip = await JSZip.loadAsync(zipBuffer, { checkCRC32: true, createFolders: false })
    } catch {
      addIssue('ZIP_PARSE_OR_CRC_FAILED')
      return { ok: false, sourceSha256, issues, publicIssues: issues.map(publicIssue), counts: {}, fields: [], privateRecords, privateMedia }
    }

    const zipEntries = Object.values(zip.files)
    const casePaths = new Map()
    for (const entry of zipEntries) {
      const originalName = entry.unsafeOriginalName || entry.name
      if (!safeRelativePath(entry.name) || !safeRelativePath(originalName)) addIssue('UNSAFE_ZIP_PATH')
      const folded = entry.name.toLocaleLowerCase('en-US')
      if (casePaths.has(folded)) addIssue('CASE_INSENSITIVE_ZIP_PATH_COLLISION')
      casePaths.set(folded, entry.name)
    }

    const manifestEntry = zip.file('manifest.json')
    const dataEntry = zip.file('data.json')
    if (!manifestEntry) addIssue('MANIFEST_MISSING')
    if (!dataEntry) addIssue('DATA_MISSING')
    try { manifest = manifestEntry ? JSON.parse(await manifestEntry.async('string')) : undefined } catch { addIssue('MANIFEST_JSON_INVALID') }
    try { data = dataEntry ? JSON.parse(await dataEntry.async('string')) : undefined } catch { addIssue('DATA_JSON_INVALID') }
    if (!isObject(manifest)) addIssue('MANIFEST_NOT_OBJECT')
    if (!isObject(data)) addIssue('DATA_NOT_OBJECT')
    if (!isObject(manifest) || !isObject(data)) {
      return { ok: false, sourceSha256, zipEntryCount: zipEntries.length, issues, publicIssues: issues.map(publicIssue), counts: {}, fields: [], privateRecords, privateMedia }
    }

    const manifestSchema = { app: S(), version: N(), counts: O(), exportedAt: S(false), appName: S(false), note: S(false) }
    for (const [field, policy] of Object.entries(manifestSchema)) {
      addField('manifest', field, true, policy.type, 0)
      if (Object.hasOwn(manifest, field)) {
        fieldMap.get(`manifest\u0000${field}`).occurrences = 1
        if (!typeMatches(manifest[field], policy.type)) addIssue('MANIFEST_FIELD_TYPE', { table: 'manifest', field })
      } else if (policy.required) addIssue('MANIFEST_FIELD_MISSING', { table: 'manifest', field })
    }
    for (const field of Object.keys(manifest)) if (!Object.hasOwn(manifestSchema, field)) addField('manifest', field, false, 'unvalidated-metadata')
    if (manifest.app !== 'heartlog') addIssue('MANIFEST_APP_MISMATCH', { table: 'manifest', field: 'app' })
    if (manifest.version !== 1) addIssue('MANIFEST_VERSION_UNSUPPORTED', { table: 'manifest', field: 'version' })

    for (const field of Object.keys(data)) {
      if (!TABLE_NAMES.includes(field)) {
        addField('data', field, false, 'unvalidated-top-level')
        addIssue('UNKNOWN_TOP_LEVEL_TABLE', { table: 'data', field })
      }
    }

    const ids = {}
    const rowsById = {}
    const counts = {}
    for (const table of TABLE_NAMES) {
      const rows = data[table]
      if (!Array.isArray(rows)) {
        addIssue('TABLE_NOT_ARRAY', { table })
        counts[table] = 0
        ids[table] = new Set()
        rowsById[table] = new Map()
        continue
      }
      counts[table] = rows.length
      ids[table] = new Set()
      rowsById[table] = new Map()
      const schema = SCHEMAS[table]
      if (schema) for (const [field, policy] of Object.entries(schema)) addField(table, field, true, policy.type, 0)
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]
        if (!isObject(row)) {
          addIssue('ROW_NOT_OBJECT', { table, rowIndex: index })
          continue
        }
        if (table === 'meta') {
          if (typeof row.key !== 'string' || !row.key) addIssue('META_KEY_INVALID', { table, rowIndex: index })
          if (!Object.hasOwn(row, 'value')) addIssue('META_VALUE_MISSING', { table, rowIndex: index })
          const keyToken = typeof row.key === 'string' ? row.key : `invalid-row-${index}`
          if (ids.meta.has(keyToken)) addIssue('DUPLICATE_ID', { table, rowIndex: index })
          ids.meta.add(keyToken)
          privateRecords.push({ table, rowIndex: index, recordHash: await recordHash(cryptoApi, table, row) })
          continue
        }
        if (typeof row.id !== 'string' || !row.id) addIssue('ROW_ID_INVALID', { table, rowIndex: index, field: 'id' })
        else {
          if (ids[table].has(row.id)) addIssue('DUPLICATE_ID', { table, rowIndex: index, id: row.id, field: 'id' })
          ids[table].add(row.id)
          if (!rowsById[table].has(row.id)) rowsById[table].set(row.id, row)
        }
        for (const [field, policy] of Object.entries(schema)) {
          if (Object.hasOwn(row, field)) {
            fieldMap.get(`${table}\u0000${field}`).occurrences++
            if (!typeMatches(row[field], policy.type)) addIssue('FIELD_TYPE_MISMATCH', { table, rowIndex: index, id: row.id, field })
          } else if (policy.required) addIssue('FIELD_REQUIRED_MISSING', { table, rowIndex: index, id: row.id, field })
        }
        for (const field of Object.keys(row)) if (!Object.hasOwn(schema, field)) addField(table, field, false, 'unvalidated-unknown-json-value')
        privateRecords.push({ table, id: row.id, rowIndex: index, recordHash: await recordHash(cryptoApi, table, row) })

        if (table === 'persons' && Array.isArray(row.anniversaries)) {
          for (let aIndex = 0; aIndex < row.anniversaries.length; aIndex++) {
            const anniversary = row.anniversaries[aIndex]
            if (!isObject(anniversary)) continue
            for (const [field, policy] of Object.entries(ANNIVERSARY_SCHEMA)) {
              if (Object.hasOwn(anniversary, field)) {
                if (!typeMatches(anniversary[field], policy.type)) addIssue('ANNIVERSARY_FIELD_TYPE', { table, rowIndex: index, id: row.id, field })
              } else if (policy.required) addIssue('ANNIVERSARY_FIELD_REQUIRED_MISSING', { table, rowIndex: index, id: row.id, field })
            }
            for (const field of Object.keys(anniversary)) if (!Object.hasOwn(ANNIVERSARY_SCHEMA, field)) addField('persons.anniversaries', field, false, 'unvalidated-unknown-json-value')
            anniversaryInventory.push({ personId: row.id, anniversaryId: anniversary.id, personRowIndex: index, anniversaryIndex: aIndex })
          }
        }
        if (table === 'summaries' && isObject(row.aiMeta)) {
          for (const [field, policy] of Object.entries(AI_META_SCHEMA)) {
            if (Object.hasOwn(row.aiMeta, field) && !typeMatches(row.aiMeta[field], policy.type)) addIssue('AI_META_FIELD_TYPE', { table, rowIndex: index, id: row.id, field: `aiMeta.${field}` })
          }
          for (const field of Object.keys(row.aiMeta)) if (!Object.hasOwn(AI_META_SCHEMA, field)) addField('summaries.aiMeta', field, false, 'unvalidated-unknown-json-value')
        }
      }
    }

    const anniversaryIds = new Set()
    for (const item of anniversaryInventory) {
      if (typeof item.anniversaryId !== 'string' || !item.anniversaryId) continue
      if (anniversaryIds.has(item.anniversaryId)) addIssue('DUPLICATE_ANNIVERSARY_ID', { table: 'persons', id: item.personId, relatedId: item.anniversaryId })
      anniversaryIds.add(item.anniversaryId)
    }

    if (isObject(manifest.counts)) {
      for (const table of COUNT_TABLES) {
        if (!Number.isInteger(manifest.counts[table]) || manifest.counts[table] < 0) addIssue('MANIFEST_COUNT_TYPE', { table: 'manifest', field: `counts.${table}` })
        else if (manifest.counts[table] !== counts[table]) addIssue('MANIFEST_COUNT_MISMATCH', { table, field: `counts.${table}` })
      }
      for (const field of Object.keys(manifest.counts)) if (!COUNT_TABLES.includes(field)) addIssue('MANIFEST_UNKNOWN_COUNT_TABLE', { table: 'manifest', field: `counts.${field}` })
    }

    const ref = (sourceTable, row, field, targetTable, targetId) => {
      if (typeof targetId !== 'string' || !targetId) return
      if (!ids[targetTable]?.has(targetId)) addIssue('ORPHAN_REFERENCE', { table: sourceTable, id: row.id, field, relatedTable: targetTable, relatedId: targetId })
    }
    const refArray = (sourceTable, row, field, targetTable) => {
      if (!Array.isArray(row[field])) return
      const seen = new Set()
      for (const targetId of row[field]) {
        if (typeof targetId !== 'string') continue
        if (seen.has(targetId)) addIssue('DUPLICATE_REFERENCE_IN_ROW', { table: sourceTable, id: row.id, field, relatedId: targetId })
        seen.add(targetId)
        ref(sourceTable, row, field, targetTable, targetId)
      }
    }
    for (const table of TABLE_NAMES) {
      if (table === 'persons' || table === 'meta') continue
      for (const row of Array.isArray(data[table]) ? data[table] : []) if (isObject(row)) ref(table, row, 'personId', 'persons', row.personId)
    }
    for (const row of Array.isArray(data.persons) ? data.persons : []) {
      if (!isObject(row)) continue
      ref('persons', row, 'avatarPhotoId', 'photos', row.avatarPhotoId)
      const avatar = rowsById.photos.get(row.avatarPhotoId)
      if (avatar && avatar.personId !== row.id) addIssue('CROSS_PERSON_REFERENCE', { table: 'persons', id: row.id, field: 'avatarPhotoId', relatedId: row.avatarPhotoId })
    }
    for (const table of ['entries', 'gifts']) {
      for (const row of Array.isArray(data[table]) ? data[table] : []) {
        if (!isObject(row)) continue
        refArray(table, row, 'photoIds', 'photos')
        for (const photoId of Array.isArray(row.photoIds) ? row.photoIds : []) {
          const photo = rowsById.photos.get(photoId)
          if (!photo) continue
          if (photo[table === 'entries' ? 'entryId' : 'giftId'] !== row.id) addIssue('PHOTO_BACKREFERENCE_MISMATCH', { table, id: row.id, field: 'photoIds', relatedId: photoId })
          if (photo.personId !== row.personId) addIssue('CROSS_PERSON_REFERENCE', { table, id: row.id, field: 'photoIds', relatedId: photoId })
        }
      }
    }
    for (const row of Array.isArray(data.photos) ? data.photos : []) {
      if (!isObject(row)) continue
      ref('photos', row, 'entryId', 'entries', row.entryId)
      ref('photos', row, 'giftId', 'gifts', row.giftId)
      for (const [field, targetTable, idField] of [['entryId', 'entries', 'entryId'], ['giftId', 'gifts', 'giftId']]) {
        const target = rowsById[targetTable].get(row[field])
        if (!target) continue
        if (!Array.isArray(target.photoIds) || !target.photoIds.includes(row.id)) addIssue('PHOTO_REVERSE_REFERENCE_MISSING', { table: 'photos', id: row.id, field, relatedId: row[field] })
        if (target.personId !== row.personId) addIssue('CROSS_PERSON_REFERENCE', { table: 'photos', id: row.id, field: idField, relatedId: row[field] })
      }
    }
    for (const row of Array.isArray(data.gifts) ? data.gifts : []) {
      if (!isObject(row)) continue
      ref('gifts', row, 'entryId', 'entries', row.entryId)
      ref('gifts', row, 'wishId', 'wishes', row.wishId)
      const linkedWish = rowsById.wishes.get(row.wishId)
      if (linkedWish && linkedWish.giftId !== row.id) addIssue('WISH_GIFT_BACKREFERENCE_MISMATCH', { table: 'gifts', id: row.id, field: 'wishId', relatedId: row.wishId })
    }
    for (const row of Array.isArray(data.wishes) ? data.wishes : []) {
      if (!isObject(row)) continue
      ref('wishes', row, 'giftId', 'gifts', row.giftId)
      refArray('wishes', row, 'entryIds', 'entries')
      const linkedGift = rowsById.gifts.get(row.giftId)
      if (linkedGift && linkedGift.wishId !== row.id) addIssue('WISH_GIFT_BACKREFERENCE_MISMATCH', { table: 'wishes', id: row.id, field: 'giftId', relatedId: row.giftId })
    }
    for (const table of ['preferences', 'insights', 'summaries', 'health']) {
      for (const row of Array.isArray(data[table]) ? data[table] : []) {
        if (!isObject(row)) continue
        refArray(table, row, table === 'health' ? 'entryIds' : 'evidenceEntryIds', 'entries')
        if (table === 'summaries' && isObject(row.aiMeta) && Array.isArray(row.aiMeta.citedEntryIds)) {
          const seenCitations = new Set()
          for (const targetId of row.aiMeta.citedEntryIds) {
            if (typeof targetId !== 'string') continue
            if (seenCitations.has(targetId)) addIssue('DUPLICATE_REFERENCE_IN_ROW', { table, id: row.id, field: 'aiMeta.citedEntryIds', relatedId: targetId })
            seenCitations.add(targetId)
            ref(table, row, 'aiMeta.citedEntryIds', 'entries', targetId)
          }
        }
      }
    }

    const referencedFiles = new Map()
    if (Array.isArray(data.photos)) {
      for (const row of data.photos) {
        if (!isObject(row)) continue
        for (const [field, kind] of [['file', 'original'], ['thumbFile', 'thumb']]) {
          const file = row[field]
          if (typeof file !== 'string') continue
          if (!safeRelativePath(file) || file.includes('/')) addIssue('UNSAFE_MEDIA_PATH', { table: 'photos', id: row.id, field })
          const zipPath = `photos/${file}`
          const entry = zip.file(zipPath)
          if (!entry || entry.dir) {
            addIssue('MEDIA_FILE_MISSING', { table: 'photos', id: row.id, field })
            continue
          }
          const folded = zipPath.toLocaleLowerCase('en-US')
          if (referencedFiles.has(folded)) addIssue('MEDIA_FILE_REFERENCED_MORE_THAN_ONCE', { table: 'photos', id: row.id, field })
          referencedFiles.set(folded, zipPath)
          const bytes = await entry.async('uint8array')
          const digest = await sha256(cryptoApi, bytes)
          if (kind === 'original' && row.size !== bytes.byteLength) addIssue('PHOTO_SIZE_MISMATCH', { table: 'photos', id: row.id, field: 'size' })
          if (!/^image\/[a-z0-9.+-]+$/i.test(row.mime || '')) addIssue('PHOTO_MIME_INVALID', { table: 'photos', id: row.id, field: 'mime' })
          privateMedia.push({ photoId: row.id, kind, file, zipPath, sha256: digest, bytes: bytes.byteLength, mime: row.mime })
        }
      }
    }
    for (const entry of zipEntries) {
      if (entry.dir) {
        if (entry.name !== 'photos/') addIssue('UNEXPECTED_ZIP_DIRECTORY')
        continue
      }
      const allowedRoot = ['manifest.json', 'data.json', 'README.txt'].includes(entry.name)
      if (!allowedRoot && !referencedFiles.has(entry.name.toLocaleLowerCase('en-US'))) addIssue('ORPHAN_OR_UNEXPECTED_ZIP_FILE')
    }

    const fields = Array.from(fieldMap.values()).sort((a, b) => `${a.table}.${a.field}`.localeCompare(`${b.table}.${b.field}`))
    return {
      ok: issues.length === 0,
      app: manifest.app === 'heartlog' ? 'heartlog' : 'unexpected',
      version: manifest.version,
      sourceSha256,
      zipEntryCount: zipEntries.length,
      zipFileCount: zipEntries.filter((entry) => !entry.dir).length,
      counts,
      issues,
      publicIssues: issues.map(publicIssue),
      fields,
      privateRecords,
      privateMedia,
      anniversaryInventory,
      data,
      zip,
      referencedFileCount: referencedFiles.size,
    }
  }

  return { TABLE_NAMES, COUNT_TABLES, SCHEMAS, canonicalize, normalizeRecord, sha256, recordHash, safeRelativePath, auditBackup, publicIssue }
})
