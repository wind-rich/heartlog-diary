import type { LucideIcon } from 'lucide-react'
import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface UniverseNodeSpec {
  key: 'photos' | 'stories' | 'anniversary' | 'wishes' | 'archive'
  label: string
  /** null 表示这一类还没有内容，界面显示「暂无」而不是 0 */
  count: number | null
  icon: LucideIcon
  /** 条目主色，仅用于图标与色点 */
  accent: string
  /** 目录行下方的一句话说明 */
  note?: string
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

/** 印章外圈的环形文字：写满一圈，随动效缓慢旋转 */
const RING_TEXT = 'ABOUT YOU · 关于你的每一件小事 · HEARTLOG · 心意簿 · '

/**
 * 封面主视觉：人物印章 + 本期目录。
 *
 * 渲染为三个并列子块（印章、窄屏简版、目录），由首页封面用 grid 摆位，
 * 这样印章、文案、目录可以在手机与桌面上各自换位，而不用写两套结构。
 */
export function UniverseMap({ name, avatarUrl, archiveHref, nodes, onSelect, activeKey }: Props) {
  return (
    <>
      <div className="v-cover-portrait v-universe-orbit">
        <svg className="v-seal-ring v-twinkle" viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <path id="v-ring-path" d="M100,100 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0" />
          </defs>
          <text>
            <textPath href="#v-ring-path" textLength="535" lengthAdjust="spacing">
              {RING_TEXT}
            </textPath>
          </text>
        </svg>
        <PersonCore name={name} avatarUrl={avatarUrl} archiveHref={archiveHref} />
      </div>

      <div className="v-universe-compact">
        <PersonCore name={name} avatarUrl={avatarUrl} archiveHref={archiveHref} compact />
      </div>

      <div className="v-cover-index">
        <p className="v-cover-index-title">
          <span>本期目录</span>
          <small>IN THIS ISSUE</small>
        </p>
        <ol>
          {nodes.map((node, i) => {
            const Icon = node.icon
            const isActive = activeKey === node.key
            return (
              <li key={node.key}>
                <button
                  type="button"
                  onClick={() => onSelect(node.key)}
                  className={isActive ? 'v-node v-index-row active' : 'v-node v-index-row'}
                  style={{ ['--node-accent' as string]: node.accent }}
                  aria-label={`${node.label}${node.count === null ? '，暂无内容' : `，共 ${node.count} 条`}`}
                >
                  <span className="v-index-no">{String(i + 1).padStart(2, '0')}</span>
                  <span className="v-index-icon">
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
                  <span className="v-index-label">
                    {node.label}
                    {node.note && <small>{node.note}</small>}
                  </span>
                  <span className="v-index-dots" aria-hidden="true" />
                  <span className={node.count === null ? 'v-index-count empty' : 'v-index-count'}>
                    {node.count === null ? '暂无' : node.count}
                  </span>
                  <ArrowRight size={14} className="v-index-arrow" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    </>
  )
}

function PersonCore({
  name,
  avatarUrl,
  archiveHref,
  compact = false,
}: Pick<Props, 'name' | 'avatarUrl' | 'archiveHref'> & { compact?: boolean }) {
  return (
    <Link
      to={archiveHref}
      title={`查看${name}的专属档案`}
      aria-label={`查看${name}的专属档案`}
      className={compact ? 'v-person v-person-compact' : 'v-person'}
    >
      <span className="v-person-photo">
        <img src={avatarUrl} alt={`${name}的头像`} draggable={false} />
      </span>
      <span className="v-person-name">{name}</span>
    </Link>
  )
}
