import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Images } from 'lucide-react'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { DeletePhotoButton, PhotoCaptionButton, PhotoUploadButton } from '../author/lazy'
import { photosDesc } from '../lib/data'
import { PhotoTile, Lightbox } from '../components/Photos'
import { TreasureTargetAction } from '../components/TreasureTargetAction'
import { EmptyState } from '../components/bits'
import type { PublicPhoto } from '../types'
import { parseAny } from '../../lib/date'

interface PhotoGroup {
  key: string
  label: string
  items: { photo: PublicPhoto; index: number }[]
}

function groupPhotos(list: PublicPhoto[]): PhotoGroup[] {
  const groups: PhotoGroup[] = []
  const map = new Map<string, PhotoGroup>()
  list.forEach((photo, index) => {
    const date = photo.takenAt ? parseAny(photo.takenAt) : null
    const valid = date && !Number.isNaN(date.getTime())
    const key = valid ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}` : 'unknown'
    let group = map.get(key)
    if (!group) {
      group = { key, label: valid ? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月` : '日期未知', items: [] }
      map.set(key, group)
      groups.push(group)
    }
    group.items.push({ photo, index })
  })
  return groups
}

export default function Album() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [year, setYear] = useState<'all' | number>('all')
  const [index, setIndex] = useState<number | null>(null)
  const openedTarget = useRef(false)

  const all = useMemo(() => photosDesc(s), [s])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const photo of all) {
      if (!photo.takenAt) continue
      const date = parseAny(photo.takenAt)
      if (!Number.isNaN(date.getTime())) set.add(date.getFullYear())
    }
    return [...set].sort((a, b) => b - a)
  }, [all])

  const list = useMemo(() => {
    if (year === 'all') return all
    return all.filter((photo) => {
      if (!photo.takenAt) return false
      const date = parseAny(photo.takenAt)
      return !Number.isNaN(date.getTime()) && date.getFullYear() === year
    })
  }, [all, year])

  const groups = useMemo(() => groupPhotos(list), [list])

  useEffect(() => {
    const photoId = params.get('photo')
    if (!photoId || openedTarget.current) return
    const target = all.findIndex((photo) => photo.id === photoId)
    if (target >= 0) {
      openedTarget.current = true
      setYear('all')
      setIndex(target)
    }
  }, [all, params])

  return (
    <div className="v-album-page mx-auto max-w-[1120px]">
      <header className="v-page-header">
        <div>
          <div className="v-eyebrow">A COLLECTION OF LIGHT</div>
          <h1>光影收藏</h1>
          <p>共 {all.length} 张照片 · 按拍摄月份整理，点开可完整查看并左右切换。</p>
        </div>
        {editable && reload && (
          <Suspense fallback={null}>
            <PhotoUploadButton personId={s.person.id} onDone={() => void reload()} />
          </Suspense>
        )}
      </header>

      {years.length > 1 && (
        <div className="v-filter-row v-scroll-x mt-1" role="group" aria-label="按年份筛选照片">
          <button type="button" onClick={() => setYear('all')} aria-pressed={year === 'all'} className={year === 'all' ? 'v-filter-chip active' : 'v-filter-chip'}>全部</button>
          {years.map((value) => (
            <button key={value} type="button" onClick={() => setYear(value)} aria-pressed={year === value} className={year === value ? 'v-filter-chip active' : 'v-filter-chip'}>
              {value} 年
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={<Images size={22} />}
            title={all.length ? '这一年还没有照片' : '还没有已发布的照片'}
            desc={all.length ? '换一个年份看看。' : '作者发布照片之后，这里会按拍摄时间排列。'}
          />
        </div>
      ) : (
        <div className="v-album-groups">
          {groups.map((group) => (
            <section key={group.key} className="v-album-month">
              <div className="v-album-month-head">
                <h2>{group.label}</h2>
                <span>{group.items.length} 张</span>
              </div>
              <div className={`v-album-grid ${group.items.length >= 4 ? 'many' : ''}`}>
                {group.items.map(({ photo, index: photoIndex }) => (
                  <div key={photo.id} className="v-album-tile-wrap">
                    <PhotoTile photo={photo} eager={photoIndex < 8} onClick={() => setIndex(photoIndex)} className="v-album-tile" />
                    {editable && reload && (
                      <div className="absolute right-1.5 top-1.5 z-10">
                        <Suspense fallback={null}>
                          <DeletePhotoButton
                            photoId={photo.id}
                            compact
                            onDeleted={() => {
                              if (index !== null && index >= list.length - 1) setIndex(null)
                              void reload()
                            }}
                          />
                        </Suspense>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {index !== null && (
        <Lightbox
          photos={list}
          index={index}
          onIndexChange={setIndex}
          onClose={() => setIndex(null)}
          onOpenEntry={(id) => {
            setIndex(null)
            nav(`/stories/${id}`)
          }}
          renderAction={(photo) => <TreasureTargetAction targetType="photo" targetId={photo.id} />}
          renderCaption={
            editable && reload
              ? (photo) => (
                  <div className="mt-2">
                    <Suspense fallback={null}>
                      <PhotoCaptionButton photoId={photo.id} caption={photo.caption} onSaved={() => void reload()} />
                    </Suspense>
                  </div>
                )
              : undefined
          }
          renderDelete={
            editable && reload
              ? () => (
                  <Suspense fallback={null}>
                    <DeletePhotoButton
                      photoId={list[index].id}
                      label="删除这张"
                      onDeleted={() => {
                        setIndex(null)
                        void reload()
                      }}
                    />
                  </Suspense>
                )
              : undefined
          }
        />
      )}
    </div>
  )
}
