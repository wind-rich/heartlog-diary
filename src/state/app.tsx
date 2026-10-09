import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
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

interface AppState {
  person?: Person
  loading: boolean
  refreshPerson: () => Promise<void>
  updatePerson: (patch: Partial<Person>) => Promise<void>
  aiConfig: AIConfig
  prefs: AppPrefs
  saveAIConfig: (patch: Partial<AIConfig>) => Promise<void>
  savePrefs: (patch: Partial<AppPrefs>) => Promise<void>
}

const Ctx = createContext<AppState | undefined>(undefined)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [person, setPerson] = useState<Person>()
  const [loading, setLoading] = useState(true)
  const [aiConfig, setAIConfigState] = useState<AIConfig>(DEFAULT_AI)
  const [prefs, setPrefsState] = useState<AppPrefs>(DEFAULT_PREFS)

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
    () => ({ person, loading, refreshPerson, updatePerson, aiConfig, prefs, saveAIConfig, savePrefs }),
    [person, loading, refreshPerson, updatePerson, aiConfig, prefs, saveAIConfig, savePrefs],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用')
  return v
}
