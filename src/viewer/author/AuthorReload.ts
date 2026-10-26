import { createContext, useContext } from 'react'

/**
 * 作者端专用：编辑保存后让外壳重新读取本机数据。
 * 访客端为 null，页面据此隐藏编辑入口。
 */
export const AuthorReloadContext = createContext<null | (() => Promise<void>)>(null)

export function useAuthorReload(): (() => Promise<void>) | null {
  return useContext(AuthorReloadContext)
}
