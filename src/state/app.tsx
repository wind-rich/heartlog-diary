import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { CloudUser } from '@tencent-ai/workbuddy-cloud-sdk'
import {
  DEFAULT_AI,
  DEFAULT_PREFS,
  db,
  ensurePrimaryPerson,
  getMeta,
  getPrimaryPerson,
  savePerson,
  setMeta,
} from '../db/db'
import type { AIConfig, AppPrefs, Person } from '../db/types'
import { aiReady } from '../lib/ai'
import { cloud } from '../lib/cloud'
import { fetchCloudUser } from '../lib/cloudAuth'

type StartupPhase = 'loading' | 'empty' | 'ready'

interface AppState {
  person?: Person
  loading: boolean
  /** loading = 正在读本机库；empty = 本机没有任何记录（显示启动引导）；ready = 可以编辑 */
  phase: StartupPhase
  /** 明确新建空白档案（只在本机，不上传、不发布） */
  startBlank: () => Promise<void>
  /** 导入或恢复之后重新读取人物并进入可编辑状态 */
  markReady: () => Promise<void>
  refreshPerson: () => Promise<void>
  updatePerson: (patch: Partial<Person>) => Promise<void>
  aiConfig: AIConfig
  prefs: AppPrefs
  saveAIConfig: (patch: Partial<AIConfig>) => Promise<void>
  savePrefs: (patch: Partial<AppPrefs>) => Promise<void>
  /** 云服务当前登录用户；null 表示未登录（未登录时本地功能不受影响） */
  cloudUser: CloudUser | null
  /** 登录态是否已完成首次检查 */
  cloudChecked: boolean
  refreshCloudUser: () => Promise<void>
}

const Ctx = createContext<AppState | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [person, setPerson] = useState<Person>()
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<StartupPhase>('loading')
  const [aiConfig, setAIConfigState] = useState<AIConfig>(DEFAULT_AI)
  const [prefs, setPrefsState] = useState<AppPrefs>(DEFAULT_PREFS)
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [cloudChecked, setCloudChecked] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      // 注意：这里只读取，不创建。空设备交给启动引导，避免「打开就自动生成空白档案」。
      const p = await getPrimaryPerson()
      const ai = await getMeta<AIConfig>('aiConfig', DEFAULT_AI)
      const pr = await getMeta<AppPrefs>('prefs', DEFAULT_PREFS)
      if (!alive) return
      setPerson(p)
      setAIConfigState(ai)
      setPrefsState(pr)
      setPhase(p ? 'ready' : 'empty')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [])

  const refreshCloudUser = useCallback(async () => {
    try {
      const u = await fetchCloudUser()
      setCloudUser(u)
    } catch {
      // 网络不可达等情况：按未登录处理，本地功能照常
      setCloudUser(null)
    } finally {
      setCloudChecked(true)
    }
  }, [])

  // 进入可编辑状态后才检查登录态：空白首屏不做认证探测
  useEffect(() => {
    if (phase !== 'ready') return
    void refreshCloudUser()
    const unsubscribe = cloud.auth.onAuthStateChange(() => {
      void refreshCloudUser()
    })
    return () => {
      try {
        unsubscribe()
      } catch {
        // 忽略取消订阅失败
      }
    }
  }, [phase, refreshCloudUser])

  // 人物档案在别处被修改时保持同步
  const livePerson = useLiveQuery(async () => {
    if (!person?.id) return undefined
    return db.persons.get(person.id)
  }, [person?.id])

  useEffect(() => {
    if (livePerson) setPerson(livePerson)
  }, [livePerson])

  const refreshPerson = useCallback(async () => {
    // 重新从库里读一次，避免拿到被缓存的旧对象；空库时回到引导状态
    const p = await getPrimaryPerson()
    if (!p) {
      setPerson(undefined)
      setPhase('empty')
      return
    }
    setPerson({ ...p })
    setPhase('ready')
  }, [])

  const startBlank = useCallback(async () => {
    // 只有用户明确选择「从空白开始」才创建人物
    const p = await ensurePrimaryPerson()
    setPerson(p)
    setPhase('ready')
  }, [])

  const markReady = useCallback(async () => {
    const p = await getPrimaryPerson()
    if (!p) {
      setPhase('empty')
      return
    }
    setPerson({ ...p })
    setPhase('ready')
  }, [])

  const updatePerson = useCallback(
    async (patch: Partial<Person>) => {
      const p = person ?? (await ensurePrimaryPerson())
      const next = await savePerson({ ...patch, id: p.id })
      setPerson(next)
    },
    [person],
  )

  const saveAIConfig = useCallback(async (patch: Partial<AIConfig>) => {
    const next = { ...aiConfig, ...patch }
    setAIConfigState(next)
    await setMeta('aiConfig', next)
  }, [aiConfig])

  const savePrefs = useCallback(
    async (patch: Partial<AppPrefs>) => {
      const next = { ...prefs, ...patch }
      setPrefsState(next)
      await setMeta('prefs', next)
    },
    [prefs],
  )

  const value = useMemo<AppState>(
    () => ({
      person,
      loading,
      phase,
      startBlank,
      markReady,
      refreshPerson,
      updatePerson,
      aiConfig,
      prefs,
      saveAIConfig,
      savePrefs,
      cloudUser,
      cloudChecked,
      refreshCloudUser,
    }),
    [
      person,
      loading,
      phase,
      startBlank,
      markReady,
      refreshPerson,
      updatePerson,
      aiConfig,
      prefs,
      saveAIConfig,
      savePrefs,
      cloudUser,
      cloudChecked,
      refreshCloudUser,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用')
  return v
}

/**
 * AI 是否真的可用。
 *
 * 判断 AI 可用性必须同时看「配置」和「登录态」——云服务模式靠登录态鉴权、
 * 不需要用户自备 Key。**不要在组件里直接调 `aiReady(aiConfig)`**，
 * 那样会漏掉登录态、把已配置好的云服务 AI 误判成「未启用」。
 */
export function useAIReady(): boolean {
  const { aiConfig, cloudUser } = useApp()
  return aiReady(aiConfig, Boolean(cloudUser))
}
