import { Suspense, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Images } from 'lucide-react'
import { useSnapshot, useSnapshotState } from '../state/SnapshotContext'
import { useAuthorReload } from '../author/AuthorReload'
import { DeletePhotoButton, PhotoUploadButton } from '../author/lazy'
import { photosDesc } from '../lib/data'
import { PhotoTile, Lightbox } from '../components/Photos'
import { EmptyState } from '../components/bits'
import { parseAny } from '../../lib/date'

export default function Album() {
  const s = useSnapshot()
  const { editable } = useSnapshotState()
  const reload = useAuthorReload()
  const nav = useNavigate()
  const [year, setYear] = useState<'all' | number>('all')
  const [index, setIndex] = useState<number | null>(null)

  const all = useMemo(() => photosDesc(s), [s])

  const years = useMemo(() => {
    const set = new Set<number>()
    for (const p of all) {
      if (p.takenAt) set.add(parseAny(p.takenAt).getFullYear())
    }
    return [...set].sort((a, b) => b - a)
  }, [all])

  const list = useMemo(() => {
    if (year === 'all') return all
    return all.filter((p) => p.takenAt && parseAny(p.takenAt).getFullYear() === year)
  }, [all, year])

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3 px-1">
        <div>
          <h1 className="text-[19px] font-semibold text-ink-900">相册</h1>
          <p className="mt-1 text-[11.5px] text-ink-500">
            共 {all.length} 张照片 · 点击查看大图，左右滑动切换
          </p>
        </div>
        {editable && reload && (
          <Suspense fallback={null}>
            <PhotoUploadButton personId={s.person.id} onDone={() => void reload()} />
          </Suspense>
        )}
      </header>

      {years.length > 1 && (
        <div className="v-scroll-x -mx-1 flex gap-1.5 overflow-x-auto px-1">
          <button
            type="button"
            onClick={() => setYear('all')}
            className={
              year === 'all'
                ? 'shrink-0 rounded-full border border-rose-soft bg-rose-soft/15 px-3 py-1 text-[11.5px] font-medium text-rose-deep'
                : 'shrink-0 rounded-full border border-cream-300 bg-white px-3 py-1 text-[11.5px] text-ink-500'
            }
          >
            全部
          </button>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={
                year === y
                  ? 'shrink-0 rounded-full border border-rose-soft bg-rose-soft/15 px-3 py-1 text-[11.5px] font-medium text-rose-deep'
                  : 'shrink-0 rounded-full border border-cream-300 bg-white px-3 py-1 text-[11.5px] text-ink-500'
              }
            >
              {y} 年
            </button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState
          icon={<Images size={22} />}
          title={all.length ? '这一年还没有照片' : '还没有已发布的照片'}
          desc={all.length ? '换一个年份看看。' : '作者发布照片之后，这里会按拍摄时间排列。'}
        />
      ) : (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
          {list.map((p, i) => (
            <div key={p.id} className="relative">
              <PhotoTile photo={p} eager={i < 6} onClick={() => setIndex(i)} className="aspect-[3/4]" />
              {editable && reload && (
                <div className="absolute right-1 top-1 z-10">
                  <Suspense fallback={null}>
                    <DeletePhotoButton
                      photoId={p.id}
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
