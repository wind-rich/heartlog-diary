import { useEffect, useMemo, useRef, useState } from 'react'
import { Dices, Heart, Lock, LockOpen, MapPin, Sparkles, Star, Trash2 } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { randomSeed } from '../../game/memory'
import {
  BUDGET_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  DEFAULT_FILTERS,
  DURATION_LABELS,
  SETTING_LABELS,
  allDateCards,
  comboKey,
  drawDateCombo,
  loadDateFavorites,
  removeDateFavorite,
  saveDateFavorite,
  type DateCard,
  type DateCardCategory,
  type DateDrawFilters,
  type FavoriteDateCombo,
} from '../../game/dateDraw'
import { GameHeader, GameResult } from '../../components/GameShared'

const CATEGORY_ICONS: Record<DateCardCategory, typeof Sparkles> = {
  activity: Sparkles,
  place: MapPin,
  surprise: Star,
}

type Combo = Partial<Record<DateCardCategory, DateCard>>
type Locks = Record<DateCardCategory, boolean>

const NO_LOCKS: Locks = { activity: false, place: false, surprise: false }

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-10 shrink-0 text-[11px] text-ink-400">{label}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-11 rounded-full border px-3 text-[12px] transition ${
            value === option.value
              ? 'border-rose-deep bg-rose-deep text-white'
              : 'border-cream-200 bg-white/70 text-ink-700 hover:border-rose-soft/60'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function CardBadges({ card }: { card: DateCard }) {
  const chips = [
    card.setting ? SETTING_LABELS[card.setting] : null,
    card.duration ? DURATION_LABELS[card.duration] : null,
    card.budget ? BUDGET_LABELS[card.budget] : null,
    ...card.displayTags,
  ].filter(Boolean) as string[]
  if (!chips.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip} className="rounded-full bg-cream-100 px-2 py-0.5 text-[10.5px] text-ink-500">{chip}</span>
      ))}
    </div>
  )
}

export default function DateDrawGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  // 公共快照的可选扩展字段；旧快照没有 gameContent 时用内置卡池也能玩
  const gameContent = (snapshot as { gameContent?: unknown }).gameContent
  const cards = useMemo(() => allDateCards(gameContent), [gameContent])

  const [filters, setFilters] = useState<DateDrawFilters>(DEFAULT_FILTERS)
  const [combo, setCombo] = useState<Combo>({})
  const [locks, setLocks] = useState<Locks>(NO_LOCKS)
  const [notice, setNotice] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<FavoriteDateCombo[]>([])
  const [drawn, setDrawn] = useState(false)
  const locksRef = useRef(locks)
  locksRef.current = locks
  const comboRef = useRef(combo)
  comboRef.current = combo

  useEffect(() => {
    setFavorites(loadDateFavorites(publishId))
  }, [publishId])

  const roll = (nextFilters: DateDrawFilters) => {
    const currentLocks = locksRef.current
    const currentCombo = comboRef.current
    const lockedCards: Combo = {}
    for (const category of CATEGORY_ORDER) {
      if (currentLocks[category] && currentCombo[category]) lockedCards[category] = currentCombo[category]
    }
    if (CATEGORY_ORDER.every((category) => lockedCards[category])) {
      setNotice('三项都已经锁定啦：这次没有可替换的卡。先解锁一项，再抽一次吧。')
      return
    }
    const outcome = drawDateCombo(cards, nextFilters, lockedCards, randomSeed())
    setCombo(outcome.combo)
    setDrawn(true)
    setNotice(
      outcome.missing.length
        ? `当前筛选下没有合适的「${outcome.missing.map((c) => CATEGORY_LABELS[c]).join('、')}」，建议放宽筛选条件再抽一次。`
        : null,
    )
  }

  // 进入页面自动抽第一组
  const firstRoll = useRef('')
  useEffect(() => {
    if (firstRoll.current === publishId) return
    firstRoll.current = publishId
    roll(DEFAULT_FILTERS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishId, cards])

  const changeFilter = (patch: Partial<DateDrawFilters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    roll(next)
  }

  const toggleLock = (category: DateCardCategory) => {
    if (!combo[category]) return
    setLocks((value) => ({ ...value, [category]: !value[category] }))
    setNotice(null)
  }

  const key = comboKey(combo)
  const isFavorite = key !== null && favorites.some((item) => item.id === key)

  const toggleFavorite = () => {
    if (!combo.activity || !combo.place || !combo.surprise) return
    setFavorites(
      isFavorite && key
        ? removeDateFavorite(publishId, key)
        : saveDateFavorite(publishId, { activity: combo.activity, place: combo.place, surprise: combo.surprise }),
    )
  }

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    roll(DEFAULT_FILTERS)
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4 pb-6">
      <GameHeader
        title="今天一起做什么"
        description="从活动、地点、小彩蛋里各抽一张，拼成今天的小小约会。结果只在这台设备上，不会读取定位或商家信息，也不会写进任务和日程。"
      />

      <section className="space-y-2.5 rounded-2xl border border-cream-200 bg-white/75 p-4">
        <FilterRow
          label="环境"
          value={filters.setting}
          onChange={(value) => changeFilter({ setting: value as DateDrawFilters['setting'] })}
          options={[
            { value: 'any', label: '不限' },
            { value: 'indoor', label: '室内' },
            { value: 'outdoor', label: '室外' },
          ]}
        />
        <FilterRow
          label="时长"
          value={filters.duration}
          onChange={(value) => changeFilter({ duration: value as DateDrawFilters['duration'] })}
          options={[
            { value: 'any', label: '不限' },
            { value: 'short', label: '2 小时内' },
            { value: 'half', label: '半天' },
            { value: 'day', label: '一整天' },
          ]}
        />
        <FilterRow
          label="预算"
          value={filters.budget}
          onChange={(value) => changeFilter({ budget: value as DateDrawFilters['budget'] })}
          options={[
            { value: 'any', label: '不限' },
            { value: 'free', label: '免费' },
            { value: 'low', label: '低预算' },
            { value: 'mid', label: '百元级' },
          ]}
        />
      </section>

      {notice && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center" aria-live="polite">
          <p className="text-[12px] leading-relaxed text-amber-800">{notice}</p>
          {drawn && (
            <button type="button" onClick={resetFilters} className="btn-ghost mt-2 inline-flex min-h-11 items-center px-3 text-[12px]">
              放宽为不限，再抽一次
            </button>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {CATEGORY_ORDER.map((category) => {
          const card = combo[category]
          const locked = locks[category] && Boolean(card)
          const Icon = CATEGORY_ICONS[category]
          return (
            <article
              key={category}
              data-date-card={category}
              data-card-id={card?.id ?? ''}
              data-locked={locked ? 'true' : 'false'}
              className={`flex flex-col rounded-2xl border p-4 transition ${
                locked ? 'border-rose-deep/60 bg-rose-soft/10' : 'border-cream-200 bg-white/80'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-rose-deep">
                  <Icon size={14} /> {CATEGORY_LABELS[category]}
                </span>
                <button
                  type="button"
                  disabled={!card}
                  onClick={() => toggleLock(category)}
                  aria-pressed={locked}
                  aria-label={locked ? `解锁「${CATEGORY_LABELS[category]}」` : `锁定「${CATEGORY_LABELS[category]}」`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[11px] text-ink-500 hover:text-rose-deep disabled:opacity-40"
                >
                  {locked ? <Lock size={14} /> : <LockOpen size={14} />}
                  {locked ? '已锁定' : '锁定'}
                </button>
              </div>
              {card ? (
                <>
                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-ink-900">{card.text}</p>
                  <CardBadges card={card} />
                </>
              ) : (
                <p className="mt-2 flex-1 text-[12px] leading-relaxed text-ink-400">
                  这一类暂时没有抽到合适的卡，放宽筛选试试。
                </p>
              )}
            </article>
          )
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => roll(filters)} className="btn-primary inline-flex min-h-11 items-center gap-2 px-4 text-[13px]">
          <Dices size={15} /> 再抽一次
        </button>
        <button
          type="button"
          disabled={!key}
          onClick={toggleFavorite}
          aria-pressed={isFavorite}
          className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px] disabled:opacity-40"
        >
          <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} className={isFavorite ? 'text-rose-deep' : ''} />
          {isFavorite ? '已收藏，点按取消' : '喜欢这组，存到本机'}
        </button>
      </div>

      {favorites.length > 0 && (
        <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
          <h2 className="text-[13px] font-semibold text-ink-900">本机收藏的组合</h2>
          <p className="mt-0.5 text-[11px] text-ink-400">只保存在这台设备，换设备或清除浏览器数据后不会保留。</p>
          <ul className="mt-3 space-y-2">
            {favorites.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-xl bg-cream-100/70 px-3 py-2.5">
                <div className="text-[12px] leading-relaxed text-ink-700">
                  <p><span className="text-rose-deep">做什么</span> · {item.activity.text}</p>
                  <p><span className="text-rose-deep">在哪里</span> · {item.place.text}</p>
                  <p><span className="text-rose-deep">小彩蛋</span> · {item.surprise.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFavorites(removeDateFavorite(publishId, item.id))}
                  aria-label="删除这组收藏"
                  className="mt-0.5 inline-flex min-h-11 shrink-0 items-center px-1 text-ink-400 hover:text-rose-deep"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <GameResult title="怎么玩得更顺手">
        <p>看中某一张就点「锁定」，再抽只会替换没锁的项；三项全锁时会明确提示，不会悄悄换掉。</p>
        <p className="mt-1">卡面由规则自动配对，室内活动不会配上公园这类室外地点；同一组筛选与种子下结果可复现。</p>
      </GameResult>
    </div>
  )
}
