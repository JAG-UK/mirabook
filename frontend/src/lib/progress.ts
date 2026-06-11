// Per-profile reading position (bookmark), persisted in localStorage.

const KEY = 'mirabook:progress'

interface Entry {
  page: number
  at: number
}
// profileId -> bookId -> entry
type Store = Record<string, Record<string, Entry>>

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Store
  } catch {
    return {}
  }
}

function save(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function getProgress(profileId: string, bookId: string): number {
  return load()[profileId]?.[bookId]?.page ?? 1
}

export function saveProgress(profileId: string, bookId: string, page: number): void {
  const s = load()
  const forProfile = s[profileId] ?? {}
  forProfile[bookId] = { page, at: Date.now() }
  s[profileId] = forProfile
  save(s)
}

export interface ProgressItem {
  bookId: string
  page: number
  at: number
}

export function listProgress(profileId: string): ProgressItem[] {
  const forProfile = load()[profileId] ?? {}
  return Object.entries(forProfile).map(([bookId, e]) => ({ bookId, ...e }))
}
