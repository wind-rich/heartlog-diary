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
import { cloud } from '../lib/cloud'
import { fetchCloudUser } from '../lib/cloudAuth'

interface AppState {
  person?: Person
  loading: boolean
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
  const [aiConfig, setAIConfigState] = useState<AIConfig>(DEFAULT_AI)
  const [prefs, setPrefsState] = useState<AppPrefs>(DEFAULT_PREFS)
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null)
  const [cloudChecked, setCloudChecked] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const p = await ensurePrimaryPerson()
      const ai = await getMeta<AIConfig>('aiConfig', DEFAULT_AI)
      const pr = await getMeta<AppPrefs>('prefs', DEFAULT_PREFS)
      if (!alive) return
      setPerson(p)
      setAIConfigState(ai)
      setPrefsState(pr)
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

  // 首次读取登录态，并订阅登录态变化
  useEffect(() => {
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
  }, [refreshCloudUser])

  // 人物档案在别处被修改时保持同步
  const livePerson = useLiveQuery(async () => {
    if (!person?.id) return undefined
    return db.persons.get(person.id)
  }, [person?.id])

  useEffect(() => {
    if (livePerson) setPerson(livePerson)
  }, [livePerson])

  const refreshPerson = useCallback(async () => {
    // 重新从库里读一次，避免拿到被缓存的旧对象
    const p = (await getPrimaryPerson()) ?? (await ensurePrimaryPerson())
    setPerson({ ...p })
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
