import type { ReactNode } from 'react'

/**
 * 极简 Markdown 渲染：只处理标题、列表与段落。
 * 展示端不引入第三方解析器，也不使用 dangerouslySetInnerHTML。
 */
export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split('\n')
  const blocks: ReactNode[] = []
  let list: string[] = []

  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-700">
          {list.map((li, i) => (
            <li key={i}>{li}</li>
          ))}
        </ul>,
      )
      list = []
    }
  }

  lines.forEach((raw, i) => {
    const line = raw.trimEnd()
    if (/^###\s+/.test(line)) {
      flush()
      blocks.push(
        <h4 key={i} className="mb-1 mt-3 text-[12.5px] font-semibold text-ink-700">
          {line.replace(/^###\s+/, '')}
        </h4>,
      )
    } else if (/^##\s+/.test(line)) {
      flush()
      blocks.push(
        <h3 key={i} className="mb-1.5 mt-4 text-[13.5px] font-semibold text-ink-900">
          {line.replace(/^##\s+/, '')}
        </h3>,
      )
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''))
    } else if (!line.trim()) {
      flush()
    } else {
      flush()
      blocks.push(
        <p key={i} className="my-1.5 text-[12.5px] leading-relaxed text-ink-700">
          {line}
        </p>,
      )
    }
  })
  flush()

  return <div>{blocks}</div>
}
