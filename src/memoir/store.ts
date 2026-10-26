/**
 * 回忆录的读写。
 *
 * 两条硬规则，写在这里而不是散在界面里：
 * 1. **人工内容不可被 AI 覆盖**：只要章节被作者动过（`editedAt` 有值），
 *    `replaceAiSection` 就会拒绝；AI 只能通过 `appendDraft` 新建章节。
 * 2. **删除走 Dexie 的 deleting 钩子**（`memoirs` 已加入墓碑实体），
 *    这样删除会随同步上行，换设备后不会「又回来了」。
 */
import { db, nowISO, uid } from '../db/db'
import type { AIConfig } from '../db/types'
import type { Memoir, MemoirDraft, MemoirSection, SectionOrigin } from './types'

export function emptySection(input: { heading?: string; body?: string; entryIds?: string[]; origin?: SectionOrigin } = {}): MemoirSection {
  const t = nowISO()
  return {
    id: uid('ms_'),
    heading: input.heading ?? '',
    body: input.body ?? '',
    entryIds: input.entryIds ?? [],
    origin: input.origin ?? 'manual',
    createdAt: t,
    updatedAt: t,
  }
}

export async function listMemoirs(personId: string): Promise<Memoir[]> {
  const rows = await db.memoirs.where('personId').equals(personId).toArray()
  return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getMemoir(id: string): Promise<Memoir | undefined> {
  return db.memoirs.get(id)
}

export async function createMemoir(
  personId: string,
  init: { title?: string; subtitle?: string; rangeStart?: string; rangeEnd?: string } = {},
): Promise<Memoir> {
  const t = nowISO()
  const row: Memoir = {
    id: uid('mb_'),
    personId,
    title: init.title?.trim() || '未命名回忆录',
    subtitle: init.subtitle?.trim() || undefined,
    rangeStart: init.rangeStart,
    rangeEnd: init.rangeEnd,
    sections: [],
    status: 'draft',
    createdAt: t,
    updatedAt: t,
  }
  await db.memoirs.put(row)
  return row
}

type MemoirPatch = Partial<Pick<Memoir, 'title' | 'subtitle' | 'rangeStart' | 'rangeEnd' | 'status'>>

export async function updateMemoir(id: string, patch: MemoirPatch): Promise<Memoir | undefined> {
  const cur = await db.memoirs.get(id)
  if (!cur) return undefined
  const next: Memoir = { ...cur, ...patch, updatedAt: nowISO() }
  if (next.title !== undefined) next.title = next.title.trim() || '未命名回忆录'
  await db.memoirs.put(next)
  return next
}

export async function deleteMemoir(id: string): Promise<void> {
  await db.memoirs.delete(id)
}

/** 整篇一起写：章节顺序、增删都在这一条路径上 */
export async function saveSections(id: string, sections: MemoirSection[]): Promise<Memoir | undefined> {
  const cur = await db.memoirs.get(id)
  if (!cur) return undefined
  const next: Memoir = { ...cur, sections, updatedAt: nowISO() }
  await db.memoirs.put(next)
  return next
}

export async function appendSection(id: string, section: MemoirSection): Promise<Memoir | undefined> {
  const cur = await db.memoirs.get(id)
  if (!cur) return undefined
  return saveSections(id, [...cur.sections, section])
}

export async function patchSection(
  id: string,
  sectionId: string,
  patch: Partial<Pick<MemoirSection, 'heading' | 'body' | 'entryIds'>>,
): Promise<Memoir | undefined> {
  const cur = await db.memoirs.get(id)
  if (!cur) return undefined
  const t = nowISO()
  const sections = cur.sections.map((s) =>
    s.id === sectionId
      ? {
          ...s,
          ...patch,
          // 作者手改过的章节从此锁定，AI 重生成不得覆盖
          editedAt: t,
          updatedAt: t,
        }
      : s,
  )
  return saveSections(id, sections)
}

export async function removeSection(id: string, sectionId: string): Promise<Memoir | undefined> {
  const cur = await db.memoirs.get(id)
  if (!cur) return undefined
  return saveSections(
    id,
    cur.sections.filter((s) => s.id !== sectionId),
  )
}

export async function moveSection(id: string, sectionId: string, dir: -1 | 1): Promise<Memoir | undefined> {
  const cur = await db.memoirs.get(id)
  if (!cur) return undefined
  const i = cur.sections.findIndex((s) => s.id === sectionId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= cur.sections.length) return cur
  const sections = [...cur.sections]
  ;[sections[i], sections[j]] = [sections[j], sections[i]]
  return saveSections(id, sections)
}

/**
 * 章节是否已被人工锁定（不能被 AI 覆盖）。
 * 判定只看 `editedAt`：AI 自己生成、作者没动过的章节可以重新生成。
 */
export function sectionLocked(section: MemoirSection): boolean {
  return Boolean(section.editedAt)
}

export function canRegenerate(section: MemoirSection): boolean {
  return section.origin === 'ai' && !sectionLocked(section)
}

/** 把一次 AI 草稿变成一个**新章节**（默认行为，永远不碰已有内容） */
export function draftToSection(draft: MemoirDraft, heading: string, entryIds: string[]): MemoirSection {
  const t = nowISO()
  return {
    id: uid('ms_'),
    heading: heading.trim() || '未命名章节',
    body: draft.text,
    entryIds,
    origin: 'ai',
    citeMap: draft.citeMap,
    aiMeta: {
      model: draft.model,
      at: draft.at,
      citedEntryIds: draft.citedEntryIds,
    },
    createdAt: t,
    updatedAt: t,
  }
}

export interface ApplyDraftResult {
  ok: boolean
  message: string
  memoir?: Memoir
  section?: MemoirSection
}

/** 追加 AI 章节 */
export async function appendDraft(memoirId: string, draft: MemoirDraft, heading: string, entryIds: string[]): Promise<ApplyDraftResult> {
  const section = draftToSection(draft, heading, entryIds)
  const next = await appendSection(memoirId, section)
  if (!next) return { ok: false, message: '回忆录不存在' }
  return { ok: true, message: '已作为新章节插入，正文可直接修改', memoir: next, section }
}

/**
 * 替换某一章的 AI 草稿。
 *
 * 只允许替换「AI 生成且作者没改过」的章节。作者改过 → 明确拒绝，
 * 而不是悄悄覆盖（T5 验收要求）。拒绝时告诉调用方改用「另存为新章节」。
 */
export async function replaceAiSection(memoirId: string, sectionId: string, draft: MemoirDraft): Promise<ApplyDraftResult> {
  const cur = await db.memoirs.get(memoirId)
  if (!cur) return { ok: false, message: '回忆录不存在' }
  const target = cur.sections.find((s) => s.id === sectionId)
  if (!target) return { ok: false, message: '章节不存在' }
  if (target.origin !== 'ai') return { ok: false, message: '这一章是作者手写的，不能覆盖；请用「另存为新章节」' }
  if (sectionLocked(target)) {
    return { ok: false, message: '这一章你已经改过了，AI 不会覆盖它；请用「另存为新章节」' }
  }
  const t = nowISO()
  const sections = cur.sections.map((s) =>
    s.id === sectionId
      ? {
          ...s,
          body: draft.text,
          entryIds: draft.citedEntryIds,
          citeMap: { ...(s.citeMap ?? {}), ...draft.citeMap },
          aiMeta: { model: draft.model, at: draft.at, citedEntryIds: draft.citedEntryIds },
          updatedAt: t,
        }
      : s,
  )
  const next = await saveSections(memoirId, sections)
  return { ok: true, message: '已按新草稿更新这一章', memoir: next, section: next?.sections.find((s) => s.id === sectionId) }
}

/** 字数（中文按字计，英文按词计，用于界面显示进度） */
export function memoirLength(m: Memoir): number {
  const text = [m.title, m.subtitle ?? '', ...m.sections.map((s) => `${s.heading}\n${s.body}`)].join('\n')
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const words = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9']+/g) ?? []).length
  return cjk + words
}

/** AI 可用性说明：不可用时只是禁用草稿按钮，不影响编辑与导出 */
export function aiDraftHint(config: AIConfig, cloudSignedIn: boolean): string | null {
  if (config.provider === 'cloud') {
    return cloudSignedIn ? null : '云端 AI 需要先登录云端账号'
  }
  if (!config.enabled) return '尚未启用 AI：可以在设置里配置，或直接手写'
  if (!config.apiKey) return 'AI 已启用但缺少 API Key'
  return null
}
