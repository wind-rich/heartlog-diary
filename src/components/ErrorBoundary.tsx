import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
  info: string
}

/**
 * 错误边界：任何渲染期异常都显示成可读的卡片，而不是白屏。
 * 线上排查必需——白屏拿不到任何信息。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' })
    // 同时打到控制台，方便桌面端 F12 复制
    console.error('[heartlog] 渲染异常', error, info)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="min-h-screen bg-[#FFFCF8] px-4 py-8">
        <div className="mx-auto max-w-[720px] rounded-2xl border border-rose-soft/50 bg-white p-4 shadow-sm">
          <div className="text-[15px] font-semibold text-[#8E4850]">页面出错了</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">
            这不是网络问题，是页面渲染时抛了异常。把下面这段文字发给我就能定位。
          </p>

          <pre className="mt-3 max-h-[220px] overflow-auto rounded-xl bg-[#FFF3F1] p-3 text-[11.5px] leading-relaxed text-[#7A3B42]">
            {error.name}: {error.message}
            {error.stack ? `\n\n${error.stack.split('\n').slice(0, 6).join('\n')}` : ''}
            {info ? `\n\n组件栈:\n${info.split('\n').slice(0, 8).join('\n')}` : ''}
          </pre>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-rose-deep px-3 py-1.5 text-[12.5px] text-white"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
            <button
              type="button"
              className="rounded-full border border-cream-300 bg-white px-3 py-1.5 text-[12.5px] text-ink-700"
              onClick={() => {
                this.setState({ error: null, info: '' })
              }}
            >
              返回上一屏
            </button>
            <a href="./index.html" className="rounded-full border border-cream-300 bg-white px-3 py-1.5 text-[12.5px] text-ink-700">
              回到展示页
            </a>
          </div>
        </div>
      </div>
    )
  }
}
