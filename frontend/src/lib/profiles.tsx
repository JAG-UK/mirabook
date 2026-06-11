import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { AVATARS, DEFAULT_SETTINGS, Profile, Settings } from './types'

const KEY = 'mirabook:profiles'

interface Stored {
  profiles: Profile[]
  activeId: string
}

function rid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function seed(): Stored {
  const p: Profile = {
    id: rid(),
    name: 'Reader',
    avatar: AVATARS[0],
    settings: { ...DEFAULT_SETTINGS },
  }
  return { profiles: [p], activeId: p.id }
}

function load(): Stored {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Stored | null
    if (s && s.profiles?.length) {
      // Backfill any settings keys added in later versions.
      s.profiles = s.profiles.map((p) => ({
        ...p,
        settings: { ...DEFAULT_SETTINGS, ...p.settings },
      }))
      return s
    }
  } catch {
    /* ignore */
  }
  return seed()
}

interface PatchProfile {
  name?: string
  avatar?: string
  settings?: Partial<Settings>
}

interface Ctx {
  profiles: Profile[]
  active: Profile
  setActive: (id: string) => void
  addProfile: (name: string, avatar: string) => Profile
  updateActive: (patch: PatchProfile) => void
  removeProfile: (id: string) => void
}

const ProfileContext = createContext<Ctx | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Stored>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* ignore */
    }
  }, [state])

  const active = state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0]

  const setActive = (id: string) => setState((s) => ({ ...s, activeId: id }))

  const addProfile = (name: string, avatar: string): Profile => {
    const p: Profile = {
      id: rid(),
      name: name.trim() || 'Reader',
      avatar,
      settings: { ...DEFAULT_SETTINGS },
    }
    setState((s) => ({ profiles: [...s.profiles, p], activeId: p.id }))
    return p
  }

  const updateActive = (patch: PatchProfile) =>
    setState((s) => ({
      ...s,
      profiles: s.profiles.map((p) =>
        p.id === s.activeId
          ? {
              ...p,
              name: patch.name ?? p.name,
              avatar: patch.avatar ?? p.avatar,
              settings: { ...p.settings, ...(patch.settings ?? {}) },
            }
          : p,
      ),
    }))

  const removeProfile = (id: string) =>
    setState((s) => {
      const profiles = s.profiles.filter((p) => p.id !== id)
      if (!profiles.length) return seed()
      const activeId = s.activeId === id ? profiles[0].id : s.activeId
      return { profiles, activeId }
    })

  return (
    <ProfileContext.Provider
      value={{ profiles: state.profiles, active, setActive, addProfile, updateActive, removeProfile }}
    >
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): Ctx {
  const c = useContext(ProfileContext)
  if (!c) throw new Error('useProfile must be used within ProfileProvider')
  return c
}
