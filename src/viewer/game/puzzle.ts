import { shuffleWithSeed } from './memory'

export type PuzzleDifficulty = 'easy' | 'hard'

export const PUZZLE_SIZES: Record<PuzzleDifficulty, { rows: number; cols: number }> = {
  easy: { rows: 2, cols: 3 },
  hard: { rows: 3, cols: 3 },
}

/** 任意两块均可交换，因此所有打乱结果都可还原。 */
export function createPuzzleBoard(pieceCount: number, seed: string): number[] {
  const solved = Array.from({ length: pieceCount }, (_, i) => i)
  if (pieceCount < 2) return solved
  const board = shuffleWithSeed(solved, seed)
  if (isPuzzleSolved(board)) return [...board.slice(1), board[0]]
  return board
}

export function swapPuzzlePieces(board: number[], a: number, b: number): number[] {
  if (a === b || a < 0 || b < 0 || a >= board.length || b >= board.length) return [...board]
  const next = [...board]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}

export function isPuzzleSolved(board: number[]): boolean {
  return board.every((piece, cell) => piece === cell)
}

/** 把当前错位块放回正确位置，一步至少纠正一块。 */
export function hintPuzzle(board: number[]): { board: number[]; from: number; to: number } | null {
  const to = board.findIndex((piece, cell) => piece !== cell)
  if (to < 0) return null
  const from = board.indexOf(to)
  return { board: swapPuzzlePieces(board, from, to), from, to }
}

export interface PuzzleRecord {
  bestMoves: number | null
  bestMs: number | null
  clears: number
}

const keyFor = (publishId: string, difficulty: PuzzleDifficulty) =>
  `heartlog.game.puzzle.v1.${publishId || 'unknown'}.${difficulty}`

export function loadPuzzleRecord(publishId: string, difficulty: PuzzleDifficulty): PuzzleRecord | null {
  try {
    const raw = localStorage.getItem(keyFor(publishId, difficulty))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PuzzleRecord>
    if (value.bestMoves !== null && typeof value.bestMoves !== 'number') return null
    if (value.bestMs !== null && typeof value.bestMs !== 'number') return null
    return { bestMoves: value.bestMoves ?? null, bestMs: value.bestMs ?? null, clears: value.clears ?? 0 }
  } catch {
    return null
  }
}

/** 使用提示的局只累计完成，不进入无提示最佳成绩。 */
export function savePuzzleRecord(
  publishId: string,
  difficulty: PuzzleDifficulty,
  result: { moves: number; ms: number; hints: number },
): { record: PuzzleRecord; isBest: boolean } {
  const previous = loadPuzzleRecord(publishId, difficulty)
  const eligible = result.hints === 0
  const isBest =
    eligible &&
    (!previous || previous.bestMoves === null || previous.bestMs === null ||
      result.moves < previous.bestMoves || (result.moves === previous.bestMoves && result.ms < previous.bestMs))
  const record: PuzzleRecord = {
    bestMoves: isBest ? result.moves : previous?.bestMoves ?? null,
    bestMs: isBest ? result.ms : previous?.bestMs ?? null,
    clears: (previous?.clears ?? 0) + 1,
  }
  try {
    localStorage.setItem(keyFor(publishId, difficulty), JSON.stringify(record))
  } catch {
    // 存储不可用时仍保留本次返回结果，不阻断游戏。
  }
  return { record, isBest }
}
