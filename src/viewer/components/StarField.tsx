import { useMemo } from 'react'
import { hashSeed } from '../data/media'

/**
 * 星点背景：用确定性散列生成，保证每次渲染位置一致。
 * 纯装饰，不进入可访问树。
 */
export function StarField({ count = 72, opacity = 0.7 }: { count?: number; opacity?: number }) {
  const stars = useMemo(() => {
    const out: { x: number; y: number; r: number; o: number; delay: number }[] = []
    for (let i = 0; i < count; i++) {
      const h = hashSeed(`star-${i}`)
      const x = (h % 1000) / 10
      const y = ((h >>> 10) % 1000) / 10
      const r = 0.4 + ((h >>> 20) % 10) / 12
      const o = 0.3 + ((h >>> 5) % 60) / 100
      out.push({ x, y, r, o, delay: ((h >>> 3) % 60) / 10 })
    }
    return out
  }, [count])

  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ opacity }}
    >
      {stars.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={`rgba(var(--v-star), ${s.o})`}
          className="v-twinkle"
          style={{ animationDelay: `${s.delay}s` }}
        />
      ))}
    </svg>
  )
}
