import type { PublicEntry, PublicPhoto } from '../types'
import { shuffleWithSeed, usablePhotos } from './memory'

/** 同一轮内不重复；调用方只在抽完一轮后重新洗牌。 */
export function buildMemoryBoxQueue(photos: PublicPhoto[] | undefined, seed: string): PublicPhoto[] {
  const seen = new Set<string>()
  return shuffleWithSeed(usablePhotos(photos), seed).filter((photo) => {
    if (seen.has(photo.id)) return false
    seen.add(photo.id)
    return true
  })
}

export function relatedEntryForPhoto(photo: PublicPhoto | undefined, entries: PublicEntry[]): PublicEntry | undefined {
  if (!photo) return undefined
  return entries.find((entry) => entry.id === photo.entryId) ?? entries.find((entry) => entry.photoIds.includes(photo.id))
}
