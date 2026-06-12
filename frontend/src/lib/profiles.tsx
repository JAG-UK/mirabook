import { createContext, ReactNode, useContext, useEffect, useState } from 'react'
import { DEFAULT_SETTINGS, Profile, Settings } from './types'

// Profiles (the list of "readers") persist in localStorage so they're
// remembered. The *active selection* lives in sessionStorage and starts empty,
// so a new visitor is asked to choose rather than landing in someone else's
// profile. It persists across reloads within a browser session.
const PROFILES_KEY = 'mirabook:profiles'
const ACTIVE_KEY = 'mirabook:activeId'

function rid(): string {
  return Math.random().toString(36).slice(2, 9)
}

function loadProfiles(): Profile[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null')
    // Accept both the new array shape and the older { profiles, activeId } shape.
    const list: Profile[] = Array.isArray(raw) ? raw : (raw?.profiles ?? [])
    return list.map((p) => ({ ...p, settings: { ...DEFAULT_SETTINGS, ...p.settings } }))
  } catch {
    return []
  }
}

function loadActiveId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

interface PatchProfile {
  name?: string
  avatar?: string
  settings?: Partial<Settings>
}

interface Ctx {
  profiles: Profile[]
  active: Profile | null
  setActive: (id: string) => void
  signOut: () => void
  addProfile: (name: string, avatar: string) => Profile
  updateActive: (patch: PatchProfile) => void
  removeProfile: (id: string) => void
}

const ProfileContext = createContext<Ctx | null>(null)

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles)
  const [activeId, setActiveId] = useState<string | null>(loadActiveId)

  useEffect(() => {
    try {
      localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
    } catch {
      /* ignore */
    }
  }, [profiles])

  useEffect(() => {
    try {
      if (activeId) sessionStorage.setItem(ACTIVE_KEY, activeId)
      else sessionStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
  }, [activeId])

  const active = profiles.find((p) => p.id === activeId) ?? null

  const setActive = (id: string) => setActiveId(id)
  const signOut = () => setActiveId(null)

  const addProfile = (name: string, avatar: string): Profile => {
    const p: Profile = {
      id: rid(),
      name: name.trim() || 'Reader',
      avatar,
      settings: { ...DEFAULT_SETTINGS },
    }
    setProfiles((ps) => [...ps, p])
    setActiveId(p.id)
    return p
  }

  const updateActive = (patch: PatchProfile) =>
    setProfiles((ps) =>
      ps.map((p) =>
        p.id === activeId
          ? {
              ...p,
              name: patch.name ?? p.name,
              avatar: patch.avatar ?? p.avatar,
              settings: { ...p.settings, ...(patch.settings ?? {}) },
            }
          : p,
      ),
    )

  const removeProfile = (id: string) => {
    setProfiles((ps) => ps.filter((p) => p.id !== id))
    if (activeId === id) setActiveId(null)
  }

  return (
    <ProfileContext.Provider
      value={{ profiles, active, setActive, signOut, addProfile, updateActive, removeProfile }}
    >
      {children}
    </ProfileContext.Provider>
  )
}

// Full context (active may be null) — for the picker, the menu, and App's gate.
export function useProfileManager(): Ctx {
  const c = useContext(ProfileContext)
  if (!c) throw new Error('useProfileManager must be used within ProfileProvider')
  return c
}

// For screens that only render once a profile is chosen — `active` is guaranteed.
export function useProfile(): Omit<Ctx, 'active'> & { active: Profile } {
  const c = useProfileManager()
  if (!c.active) throw new Error('useProfile used without an active profile')
  return { ...c, active: c.active }
}
