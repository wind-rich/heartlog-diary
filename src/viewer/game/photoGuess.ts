import type { PublicPhoto } from '../types'
import { shuffleWithSeed, usablePhotos } from './memory'

export interface GuessQuestion {
  id: string
  answerId: string
  optionIds: string[]
  cropX: number
  cropY: number
}

export interface GuessRecord {
  bestCorrect: number
  bestAssists: number
  clears: number
}

/** ID 与已知媒体哈希/URL 都去重，避免同一图片成为自己的干扰项。 */
export function distinctGuessPhotos(photos: PublicPhoto[] | undefined): PublicPhoto[] {
  const ids = new Set<string>()
  const media = new Set<string>()
  const out: PublicPhoto[] = []
  for (const photo of usablePhotos(photos)) {
    const mediaKey = photo.media.thumb.hash || photo.media.full.hash || photo.media.thumb.url
    if (ids.has(photo.id) || (mediaKey && media.has(mediaKey))) continue
    ids.add(photo.id)
    if (mediaKey) media.add(mediaKey)
    out.push(photo)
  }
  return out
}

export function buildGuessQuestions(
  photos: PublicPhoto[] | undefined,
  publishId: string,
  seed: string,
  count = 5,
): GuessQuestion[] {
  const pool = distinctGuessPhotos(photos)
  if (pool.length < 4) return []
  const targets = shuffleWithSeed(pool, `${publishId}|guess-targets|${seed}`).slice(0, Math.min(count, pool.length))
  return targets.map((answer, index) => {
    const distractors = shuffleWithSeed(
      pool.filter((photo) => photo.id !== answer.id),
      `${publishId}|guess-distractors|${seed}|${answer.id}`,
    ).slice(0, 3)
    const optionIds = shuffleWithSeed([answer.id, ...distractors.map((photo) => photo.id)], `${seed}|options|${index}`)
    return {
      id: `${publishId}|${seed}|${index}`,
      answerId: answer.id,
      optionIds,
      cropX: (index * 37 + answer.id.length * 11) % 76,
      cropY: (index * 53 + answer.id.length * 7) % 76,
    }
  })
}

const keyFor = (publishId: string, questionCount: number) =>
  `heartlog.game.photoGuess.v1.${publishId || 'unknown'}.${questionCount}`

export function loadGuessRecord(publishId: string, questionCount: number): GuessRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(publishId, questionCount))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<GuessRecord>
    if (typeof value.bestCorrect !== 'number') return null
    return { bestCorrect: value.bestCorrect, bestAssists: value.bestAssists ?? 0, clears: value.clears ?? 0 }
  } catch {
    return null
  }
}

export function saveGuessRecord(
  publishId: string,
  questionCount: number,
  result: { correct: number; assists: number },
): GuessRecord {
  const previous = loadGuessRecord(publishId, questionCount)
  const better =
    !previous || result.correct > previous.bestCorrect ||
    (result.correct === previous.bestCorrect && result.assists < previous.bestAssists)
  const record = {
    bestCorrect: better ? result.correct : previous!.bestCorrect,
    bestAssists: better ? result.assists : previous!.bestAssists,
    clears: (previous?.clears ?? 0) + 1,
  }
  try {
    localStorage.setItem(keyFor(publishId, questionCount), JSON.stringify(record))
  } catch {
    // 本机成绩不可用时不影响继续游戏。
  }
  return record
}
