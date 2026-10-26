import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Play, RotateCcw, SkipForward, ZoomIn } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import { randomSeed } from '../../game/memory'
import {
  buildGuessQuestions,
  distinctGuessPhotos,
  loadGuessRecord,
  saveGuessRecord,
  type GuessRecord,
} from '../../game/photoGuess'
import { useFullPhotoUrl } from '../../data/cloud'
import { GameHeader, GameResult, PhotoMemoryLinks } from '../../components/GameShared'

export default function PhotoGuessGame() {
  const snapshot = useSnapshot()
  const publishId = snapshot.manifest?.publishId ?? ''
  const pool = useMemo(() => distinctGuessPhotos(snapshot.photos), [snapshot.photos])
  const byId = useMemo(() => new Map(pool.map((photo) => [photo.id, photo])), [pool])
  const [started, setStarted] = useState(false)
  const [seed, setSeed] = useState(() => randomSeed())
  const [round, setRound] = useState(0)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [clueLevel, setClueLevel] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [assists, setAssists] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [record, setRecord] = useState<GuessRecord | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const recordedRound = useRef('')
  const questions = useMemo(() => buildGuessQuestions(pool, publishId, seed), [pool, publishId, seed])
  const question = questions[index]
  const answer = byId.get(question?.answerId ?? '')
  const fullUrl = useFullPhotoUrl(answer)
  const done = started && index >= questions.length

  useEffect(() => setStarted(false), [publishId])
  useEffect(() => {
    if (!done || recordedRound.current === `${publishId}|${round}`) return
    recordedRound.current = `${publishId}|${round}`
    setRecord(saveGuessRecord(publishId, questions.length, { correct, assists }))
  }, [done, publishId, round, questions.length, correct, assists])

  const begin = () => {
    setSeed(randomSeed())
    setRound((value) => value + 1)
    setIndex(0)
    setSelected(null)
    setRevealed(false)
    setClueLevel(0)
    setCorrect(0)
    setAssists(0)
    setSkipped(0)
    setImageFailed(false)
    setRecord(loadGuessRecord(publishId, Math.min(5, pool.length)))
    setStarted(true)
  }

  const next = (skip = false) => {
    if (skip) setSkipped((value) => value + 1)
    setIndex((value) => value + 1)
    setSelected(null)
    setRevealed(false)
    setClueLevel(0)
    setImageFailed(false)
  }

  const choose = (photoId: string) => {
    if (revealed || !question) return
    setSelected(photoId)
    setRevealed(true)
    if (photoId === question.answerId) setCorrect((value) => value + 1)
  }

  const reveal = () => {
    if (revealed) return
    setAssists((value) => value + 1)
    setRevealed(true)
  }

  if (pool.length < 4) {
    return <div className="mx-auto max-w-[560px]"><GameHeader title="猜猜是哪一张" description="需要至少 4 张不同的已发布照片，正确答案和干扰项都来自当前版本。" /><GameResult title="不同照片还不够">当前有 {pool.length} 张不同照片，不足 4 张时不会用重复照片凑选项。</GameResult></div>
  }

  if (!started) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <GameHeader title="猜猜是哪一张" description={`每局最多 5 题，从局部找出对应的完整照片。本题库可出 ${Math.min(5, pool.length)} 题。`} />
        <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
          <p className="text-[12px] leading-relaxed text-ink-500">可以放大线索或直接揭晓；看不清也能换一题，跳过不算答错。辅助次数会单独展示。</p>
          <button type="button" onClick={begin} className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-[13px]"><Play size={15} /> 开始猜图</button>
        </section>
      </div>
    )
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[560px] space-y-4">
        <GameHeader title="猜猜是哪一张" description="这一局的结果只保存在本机，不会生成关系评分或排行榜。" />
        <GameResult title="这一局完成了">
          <p>答对 {correct} / {questions.length - skipped} 题 · 辅助 {assists} 次 · 跳过 {skipped} 题</p>
          {record && <p className="mt-1">本题量最佳：{record.bestCorrect} 题 · 最少辅助 {record.bestAssists} 次</p>}
          <button type="button" onClick={begin} className="btn-primary mt-3 inline-flex min-h-11 items-center gap-2 px-4 text-[12px]"><RotateCcw size={14} /> 再玩一局</button>
        </GameResult>
      </div>
    )
  }

  if (!question || !answer) {
    return <div className="mx-auto max-w-[560px]"><GameHeader title="猜猜是哪一张" description="当前题池已经变化。" /><GameResult title="这一题无法继续">请重新开始一局，不会把失效候选判为正确。</GameResult></div>
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-4 pb-6">
      <GameHeader title="猜猜是哪一张" description={`第 ${index + 1} / ${questions.length} 题 · 答对 ${correct} · 辅助 ${assists} 次`} />
      <section className="rounded-2xl border border-cream-200 bg-white/75 p-3">
        <div
          data-guess-crop={clueLevel}
          role="img"
          aria-label="待辨认的照片局部"
          className="mx-auto aspect-[4/3] w-full max-w-[520px] rounded-xl bg-cream-100 bg-no-repeat"
          style={{ backgroundImage: `url(${JSON.stringify(fullUrl)})`, backgroundSize: `${[250, 190, 135][clueLevel]}%`, backgroundPosition: `${question.cropX}% ${question.cropY}%` }}
        />
        <img src={fullUrl} alt="" onError={() => setImageFailed(true)} className="pointer-events-none absolute h-px w-px opacity-0" />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <button type="button" disabled={revealed || clueLevel >= 2} onClick={() => { setClueLevel((value) => Math.min(2, value + 1)); setAssists((value) => value + 1) }} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px] disabled:opacity-40"><ZoomIn size={14} /> 放大线索</button>
          <button type="button" disabled={revealed} onClick={reveal} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px] disabled:opacity-40"><Eye size={14} /> 直接揭晓</button>
          <button type="button" onClick={() => next(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]"><SkipForward size={14} /> 这题看不清，换一题</button>
        </div>
      </section>

      {imageFailed ? (
        <GameResult title="这张图片加载失败">可以换一题继续，不计答错。</GameResult>
      ) : revealed ? (
        <div className="space-y-3" aria-live="polite">
          <GameResult title={selected === answer.id ? '认出来了' : selected ? '正确照片已经标出' : '已经揭晓'}>
            <p>{answer.caption || '这张照片没有填写说明'}</p>
          </GameResult>
          <PhotoMemoryLinks photo={answer} />
          <div className="text-center"><button type="button" onClick={() => next()} className="btn-primary min-h-11 px-4 text-[12px]">{index + 1 === questions.length ? '查看结果' : '下一题'}</button></div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {question.optionIds.map((id, optionIndex) => {
          const photo = byId.get(id)
          if (!photo) return null
          const isCorrect = revealed && id === answer.id
          const isWrong = revealed && selected === id && id !== answer.id
          return (
            <button
              key={id}
              type="button"
              disabled={revealed}
              onClick={() => choose(id)}
              data-guess-option={id}
              data-answer={isCorrect ? 'correct' : isWrong ? 'wrong' : ''}
              aria-label={`选项 ${optionIndex + 1}${isCorrect ? '，正确答案' : isWrong ? '，你的选择，不是正确答案' : ''}`}
              className={`relative min-h-11 overflow-hidden rounded-xl border-2 bg-cream-100 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep disabled:opacity-100 ${isCorrect ? 'border-emerald-600' : isWrong ? 'border-rose-600' : 'border-cream-200'}`}
            >
              <img src={photo.media.thumb.url} alt="" draggable={false} className="aspect-square w-full rounded-lg object-cover" />
              <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] text-ink-700">{optionIndex + 1}</span>
              {isCorrect && <span className="absolute bottom-2 right-2 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] text-white">正确</span>}
              {isWrong && <span className="absolute bottom-2 right-2 rounded-full bg-rose-700 px-2 py-0.5 text-[10px] text-white">你的选择</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
