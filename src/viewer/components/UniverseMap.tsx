import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { StarField } from './StarField'

export interface UniverseNodeSpec {
  key: 'photos' | 'stories' | 'anniversary' | 'wishes' | 'archive'
  label: string
  /** null 表示这一类还没有内容，界面显示「暂无」而不是 0 */
  count: number | null
  icon: LucideIcon
  /** 节点主色，仅用于图标与光点 */
  accent: string
}

interface Props {
  name: string
  avatarUrl: string
  archiveHref: string
  tagline: string
  nodes: UniverseNodeSpec[]
  onSelect: (key: UniverseNodeSpec['key']) => void
  /** 供测试与截图定位 */
  activeKey?: string | null
}

const RADIUS = 36
const NODE_ANGLES = [-90, -18, 54, 126, 198]

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) }
}

export function UniverseMap({ name, avatarUrl, archiveHref, tagline, nodes, onSelect, activeKey }: Props) {
  const points = nodes.map((n, i) => ({ node: n, ...polar(NODE_ANGLES[i] ?? -90 + i * 72, RADIUS) }))

  return (
    <div className="v-universe-map relative mx-auto w-full max-w-[326px] sm:max-w-[380px] lg:max-w-[418px]">
      <div className="v-universe-compact">
        <PersonCore name={name} avatarUrl={avatarUrl} archiveHref={archiveHref} />
        <div className="mt-4 grid grid-cols-2 gap-2">
          {nodes.map((node) => {
            const Icon = node.icon
            return (
              <button key={node.key} type="button" onClick={() => onSelect(node.key)} className="flex min-h-12 items-center gap-2 rounded-xl border border-[#F3D4BE]/20 bg-white/5 px-3 py-2 text-left text-[#F6E4D6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C9A8]">
                <Icon size={17} style={{ color: node.accent }} />
                <span className="text-[12px]">{node.label}</span>
                <span className="ml-auto text-[10px] text-[#F2D9C9]/75">{node.count ?? '暂无'}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="relative aspect-square w-full">
        <StarField />

        {/* 轨道与连接线 */}
        <svg aria-hidden="true" viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          <defs>
            <radialGradient id="v-core-glow">
              <stop offset="0%" stopColor="#F6B48E" stopOpacity="0.42" />
              <stop offset="55%" stopColor="#E0715F" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#E0715F" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="v-link" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#FFD9BE" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#FFD9BE" stopOpacity="0.08" />
            </linearGradient>
          </defs>

          <circle cx="50" cy="50" r="26" fill="url(#v-core-glow)" />
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="rgba(255,232,214,0.16)" strokeWidth="0.25" />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke="rgba(255,220,196,0.32)"
            strokeWidth="0.35"
            strokeDasharray="1.2 2.6"
            className="v-orbit-dash"
          />
          <circle cx="50" cy="50" r="21" fill="none" stroke="rgba(255,232,214,0.09)" strokeWidth="0.22" />

          {points.map(({ node, x, y }) => (
            <line
              key={node.key}
              x1="50"
              y1="50"
              x2={x}
              y2={y}
              stroke="url(#v-link)"
              strokeWidth={activeKey === node.key ? 0.55 : 0.3}
              opacity={activeKey && activeKey !== node.key ? 0.35 : 1}
            />
          ))}

          {/* 环绕光点，纯装饰 */}
          <g className="v-orbit-spin">
            <circle cx="50" cy={50 - RADIUS} r="0.75" fill="#FFD9BE" opacity="0.9" />
            <circle cx={50 + RADIUS * 0.86} cy={50 + RADIUS * 0.5} r="0.55" fill="#F7C9A8" opacity="0.7" />
          </g>
          <g className="v-orbit-spin-rev">
            <circle cx={50 - RADIUS * 0.86} cy={50 + RADIUS * 0.5} r="0.5" fill="#FFE7D2" opacity="0.55" />
          </g>
        </svg>

        {/* 中心人物 */}
        <PersonCore name={name} avatarUrl={avatarUrl} archiveHref={archiveHref} floating />

        {/* 环绕节点 */}
        {points.map(({ node, x, y }) => {
          const Icon = node.icon
          const isActive = activeKey === node.key
          return (
            <button
              key={node.key}
              type="button"
              onClick={() => onSelect(node.key)}
              style={{ left: `${x}%`, top: `${y}%` }}
              className="v-node group absolute flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full focus:outline-none"
              aria-label={`${node.label}${node.count === null ? '，暂无内容' : `，共 ${node.count} 条`}`}
            >
              <span
                className="v-node-body flex h-14 w-14 flex-col items-center justify-center rounded-full border"
                style={{
                  borderColor: isActive ? node.accent : 'rgba(255,232,214,0.18)',
                  background: isActive
                    ? `radial-gradient(circle at 50% 30%, ${node.accent}44, rgba(30,20,28,0.9) 70%)`
                    : 'radial-gradient(circle at 50% 28%, rgba(255,226,204,0.16), rgba(28,18,26,0.86) 72%)',
                }}
              >
                <Icon size={19} strokeWidth={1.7} style={{ color: node.accent }} />
                <span className="mt-0.5 text-[10.5px] leading-none text-[#F2D9C9]/85">
                  {node.count === null ? '暂无' : node.count}
                </span>
              </span>
              <span className="pointer-events-none absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-[#F6E4D6] [text-shadow:0_1px_3px_rgba(18,10,16,0.85)] sm:text-[11.5px]">
                {node.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PersonCore({ name, avatarUrl, archiveHref, floating = false }: Pick<Props, 'name' | 'avatarUrl' | 'archiveHref'> & { floating?: boolean }) {
  return (
    <Link
      to={archiveHref}
      title={`查看${name}的专属档案`}
      aria-label={`查看${name}的专属档案`}
      className={floating
        ? 'group absolute left-1/2 top-1/2 flex max-w-[128px] -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-2xl px-2 py-2 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C9A8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#2A1A26]'
        : 'group mx-auto flex max-w-full flex-col items-center rounded-2xl px-2 py-2 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7C9A8]'}
    >
      <div className="relative mx-auto h-[72px] w-[72px] sm:h-[90px] sm:w-[90px] lg:h-[96px] lg:w-[96px]">
        <div aria-hidden="true" className="absolute -inset-3 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,196,160,0.26), rgba(255,196,160,0) 70%)' }} />
        <img
          src={avatarUrl}
          alt={`${name}的头像`}
          className="relative h-full w-full rounded-full object-cover ring-2 ring-[#FFDCC3]/70 ring-offset-2 ring-offset-[#2A1A26] transition duration-300 group-hover:scale-[1.025]"
          draggable={false}
        />
      </div>
      <div className="v-person-name mt-2 inline-block rounded-full bg-[#221523]/70 px-2.5 py-0.5 text-[13px] font-semibold leading-snug tracking-wide text-[#FDF1E7] backdrop-blur-sm">
        {name}
      </div>
    </Link>
  )
}
