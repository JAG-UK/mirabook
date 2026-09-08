import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { Reader, saveReaders } from '../api/client'
import { cacheReaders, getCachedReaders } from './offline'
import { alreadyMigrated, migrateLocalStorage } from './migrate'
import { hydrate, newId, nowIso } from './readerStore'
import { startSync } from './sync'
import { DEFAULT_SETTINGS, Profile, Settings } from './types'

// Readers live on the server, so a phone and a tablet show the same people and
// carry the same bookmarks and saved words. They are still not accounts: the
// app has one password, and this is the "who's reading?" picker.
//
// The *active selection* stays in sessionStorage, which is right — it is a
// property of this device and this sitting, not of the reader.
const ACTIVE_KEY = 'mirabook:activeId'

function loadActiveId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

const readerToProfile = (r: Reader): Profile => {
  let settings: Partial<Settings> = {}
  try {
    settings = JSON.parse(r.settings_json || '{}') as Partial<Settings>
  } catch {
    /* a reader with unreadable settings still reads, with the defaults */
  }
  return {
    id: r.id,
    name: r.name,
    avatar: r.avatar,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  }
}

const profileToReader = (p: Profile): Reader => ({
  id: p.id,
  name: p.name,
  avatar: p.avatar,
  settings_json: JSON.stringify(p.settings),
  updated_at: nowIso(),
  deleted_at: null,
})

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
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [activeId, setActiveId] = useState<string | null>(loadActiveId)
  const [ready, setReady] = useState(false)
  const tombstones = useRef<Reader[]>([])

  // Load everything this device knows before rendering anything that reads it.
  // A component that asks for a bookmark too early gets page 1 and has no way
  // to correct itself afterwards.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await hydrate()

      let known: Reader[] = await getCachedReaders()
      if (!alreadyMigrated()) {
        try {
          known = await migrateLocalStorage()
        } catch {
          /* offline: the records are queued in the mirror and go up later */
        }
      }

      // Pushing what we hold and taking the answer settles both directions in
      // one call — the server merges by id and hands back the truth.
      try {
        known = await saveReaders(known)
        void cacheReaders(known)
      } catch {
        /* offline: the cached list is what we have, and it is enough to read */
      }

      if (cancelled) return
      setProfiles(known.filter((r) => !r.deleted_at).map(readerToProfile))
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the chosen reader in step for as long as the app is open.
  useEffect(() => {
    if (!ready || !activeId) return
    return startSync(activeId)
  }, [ready, activeId])

  useEffect(() => {
    try {
      if (activeId) sessionStorage.setItem(ACTIVE_KEY, activeId)
      else sessionStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
  }, [activeId])

  const active = profiles.find((p) => p.id === activeId) ?? null

  /** Apply locally, then tell the server. A failed push stays visible here and
   *  goes up whenever the next change succeeds. */
  function commit(next: Profile[]): void {
    setProfiles(next)
    const readers = [...next.map(profileToReader), ...tombstones.current]
    void cacheReaders(readers)
    saveReaders(readers).catch(() => {})
  }

  const addProfile = (name: string, avatar: string): Profile => {
    const p: Profile = {
      id: newId(),
      name: name.trim() || 'Reader',
      avatar,
      settings: { ...DEFAULT_SETTINGS },
    }
    commit([...profiles, p])
    setActiveId(p.id)
    return p
  }

  const updateActive = (patch: PatchProfile) =>
    commit(
      profiles.map((p) =>
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
    const gone = profiles.find((p) => p.id === id)
    // A tombstone, not a deletion: another device has to learn they are gone,
    // or it will simply tell us about them again.
    if (gone) tombstones.current.push({ ...profileToReader(gone), deleted_at: nowIso() })
    commit(profiles.filter((p) => p.id !== id))
    if (activeId === id) setActiveId(null)
  }

  if (!ready) return null

  return (
    <ProfileContext.Provider
      value={{
        profiles,
        active,
        setActive: setActiveId,
        signOut: () => setActiveId(null),
        addProfile,
        updateActive,
        removeProfile,
      }}
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
