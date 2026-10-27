import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Play, RotateCcw, SkipForward, Sparkles } from 'lucide-react'
import { useSnapshot } from '../../state/SnapshotContext'
import type { PublishedSnapshot } from '../../types'
import { randomSeed } from '../../game/memory'
import {
  buildQuizQuestions,
  loadQuizRecord,
  saveQuizRecord,
  validQuizItems,
  type PublicQuizGameContent,
  type QuizRecord,
} from '../../game/quiz'
import { GameHeader, GameResult } from '../../components/GameShared'

/** 共享类型由主代理补充 gameContent；在此之前页面用临时交叉类型读取。 */
type SnapshotWithQuiz = PublishedSnapshot & { gameContent?: PublicQuizGameContent[] }

export default function QuizGame() {
  const snapshot = useSnapshot() as SnapshotWithQuiz
  const publishId = snapshot.manifest?.publishId ?? ''
  const pool = useMemo(() => validQuizItems(snapshot.gameContent), [snapshot.gameContent])
  const entryIds = useMemo(() => new Set((snapshot.entries ?? []).map((entry) => entry.id)), [snapshot.entries])
  const [started, setStarted] = useState(false)
  const [seed, setSeed] = useState(() => randomSeed())
  const [round, setRound] = useState(0)
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [eliminated, setEliminated] = useState<string[]>([])
  const [correct, setCorrect] = useState(0)
  const [assists, setAssists] = useState(0)
  const [skipped, setSkipped] = useState(0)
  const [record, setRecord] = useState<QuizRecord | null>(null)
  const recordedRound = useRef('')
  const questions = useMemo(() => buildQuizQuestions(snapshot.gameContent, publishId, seed), [snapshot.gameContent, publishId, seed])
  const question = questions[index]
  const revealed = selected !== null
  const done = started && index >= questions.length

  useEffect(() => setStarted(false), [publishId])
  useEffect(() => {
    if (!done || recordedRound.current === `${publishId}|${round}`) return
    recordedRound.current = `${publishId}|${round}`
    setRecord(saveQuizRecord(publishId, questions.length, { correct, assists }))
  }, [done, publishId, round, questions.length, correct, assists])

  const begin = () => {
    setSeed(randomSeed())
    setRound((value) => value + 1)
    setIndex(0)
    setSelected(null)
    setEliminated([])
    setCorrect(0)
    setAssists(0)
    setSkipped(0)
    setRecord(loadQuizRecord(publishId, Math.min(5, pool.length)))
    setStarted(true)
  }

  const next = (skip = false) => {
    if (skip) setSkipped((value) => value + 1)
    setIndex((value) => value + 1)
    setSelected(null)
    setEliminated([])
  }

  const choose = (optionId: string) => {
    if (revealed || !question || eliminated.includes(optionId)) return
    setSelected(optionId)
    if (optionId === question.correctOptionId) setCorrect((value) => value + 1)
  }

  /** 辅助：去掉一个错误选项（不够两个错项时禁用）；每题限用一次，单列计数。 */
  const eliminate = () => {
    if (revealed || !question || eliminated.length) return
    const wrong = question.options.filter((option) => option.id !== question.correctOptionId)
    if (wrong.length < 2) return
    setEliminated([wrong[0].id])
    setAssists((value) => value + 1)
  }

  if (!pool.length) {
    return (
      <div className="mx-auto max-w-[560px]">
        <GameHeader title="关于他的五道题" description="题目来自作者发布的快照内容，答完可以看到说明与来源记录。" />
        <GameResult title="还没有可答的题">作者还没有在这次发布里放题，0 题时不会开局。</GameResult>
      </div>
    )
  }

  if (!started) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <GameHeader
          title="关于他的五道题"
          description={`每局最多 5 题单选。本题库可出 ${Math.min(5, pool.length)} 题${pool.length < 5 ? `（有效题目共 ${pool.length} 道，不足 5 道按实际题数开局）` : ''}。`}
        />
        <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
          <p className="text-[12px] leading-relaxed text-ink-500">答错没关系，作答后会展示说明和来源记录；不确定可以跳过或用一次辅助去掉一个错误选项，跳过与辅助会单独统计。</p>
          <button type="button" onClick={begin} className="btn-primary mt-4 inline-flex min-h-11 items-center gap-2 px-4 text-[13px]"><Play size={15} /> 开始答题</button>
        </section>
      </div>
    )
  }

  if (done) {
    return (
      <div className="mx-auto max-w-[560px] space-y-4">
        <GameHeader title="关于他的五道题" description="这一局的结果只保存在本机，不做任何关系评价。" />
        <GameResult title="这一局完成了">
          <p>答对 {correct} / {questions.length} 题</p>
          <p className="mt-1">跳过 {skipped} 题 · 辅助 {assists} 次</p>
          {record && <p className="mt-1">本题量最佳：答对 {record.bestCorrect} 题 · 最少辅助 {record.bestAssists} 次 · 已完成 {record.rounds} 局</p>}
          <button type="button" onClick={begin} className="btn-primary mt-3 inline-flex min-h-11 items-center gap-2 px-4 text-[12px]"><RotateCcw size={14} /> 再玩一局</button>
        </GameResult>
      </div>
    )
  }

  if (!question) {
    return (
      <div className="mx-auto max-w-[560px]">
        <GameHeader title="关于他的五道题" description="当前题库已经变化。" />
        <GameResult title="这一题无法继续">请重新开始一局，不会把失效题目判为答错。</GameResult>
      </div>
    )
  }

  const sourceEntries = question.sourceEntryIds.filter((id) => entryIds.has(id))

  return (
    <div className="mx-auto max-w-[560px] space-y-4 pb-6">
      <GameHeader title="关于他的五道题" description={`第 ${index + 1} / ${questions.length} 题 · 答对 ${correct} · 跳过 ${skipped} · 辅助 ${assists} 次`} />

      <section className="rounded-2xl border border-cream-200 bg-white/75 p-4">
        <h2 className="text-[15px] font-medium leading-relaxed text-ink-900">{question.prompt}</h2>
        <div className="mt-3 space-y-2">
          {question.options.map((option, optionIndex) => {
            const isEliminated = eliminated.includes(option.id)
            const isCorrect = revealed && option.id === question.correctOptionId
            const isWrong = revealed && selected === option.id && option.id !== question.correctOptionId
            return (
              <button
                key={option.id}
                type="button"
                disabled={revealed || isEliminated}
                onClick={() => choose(option.id)}
                data-quiz-option={option.id}
                data-answer={isCorrect ? 'correct' : isWrong ? 'wrong' : ''}
                aria-label={`选项 ${optionIndex + 1}：${option.text}${isEliminated ? '（已被辅助排除）' : ''}${isCorrect ? '，正确答案' : isWrong ? '，你的选择，不是正确答案' : ''}`}
                className={`flex min-h-11 w-full items-center gap-2 rounded-xl border-2 px-3 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-deep disabled:opacity-100 ${isEliminated ? 'border-cream-200 text-ink-400 line-through opacity-50' : isCorrect ? 'border-emerald-600 bg-[#F2F7EF] text-ink-900' : isWrong ? 'border-rose-600 bg-rose-50 text-ink-900' : 'border-cream-200 bg-white/60 text-ink-700 hover:border-rose-200'}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cream-100 text-[11px] text-ink-500">{optionIndex + 1}</span>
                <span className="flex-1">{option.text}</span>
                {isCorrect && <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] text-white">正确</span>}
                {isWrong && <span className="rounded-full bg-rose-700 px-2 py-0.5 text-[10px] text-white">你的选择</span>}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={revealed || eliminated.length > 0 || question.options.length - 1 < 2}
            onClick={eliminate}
            className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px] disabled:opacity-40"
          >
            <Sparkles size={14} /> 辅助：去掉一个错误选项
          </button>
          <button type="button" onClick={() => next(true)} className="btn-ghost inline-flex min-h-11 items-center gap-1.5 px-3 text-[12px]">
            <SkipForward size={14} /> 不确定，跳过这题
          </button>
        </div>
      </section>

      {revealed && (
        <div className="space-y-3" aria-live="polite">
          <GameResult title={selected === question.correctOptionId ? '答对了' : '正确选项已经标出'}>
            <p>{question.explanation || '这道题没有填写说明。'}</p>
            {sourceEntries.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1"><BookOpen size={12} /> 来源记录：</span>
                {sourceEntries.map((id) => (
                  <Link key={id} to={`/stories/${id}`} className="underline decoration-dotted underline-offset-2 hover:text-rose-deep">
                    查看这条记录
                  </Link>
                ))}
              </p>
            )}
          </GameResult>
          <div className="text-center">
            <button type="button" onClick={() => next()} className="btn-primary min-h-11 px-4 text-[12px]">
              {index + 1 === questions.length ? '查看结果' : '下一题'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
