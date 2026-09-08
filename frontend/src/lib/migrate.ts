// A one-time lift of everything that used to live in localStorage.
//
// This is unusually safe: profile ids and saved-word ids were already stable,
// so the server merges by id rather than guessing. Two devices migrating
// independently converge instead of duplicating.
//
// The localStorage copy is deliberately left in place. It costs a few hundred
// kilobytes and it is the only way back if something here is wrong.

import { Reader, saveReaders } from '../api/client'
import { legacyWordToSaved } from './sync'
import { newId, nowIso, putFavourite, putProgress, putWord, readerState } from './readerStore'
import { Profile } from './types'

const DONE = 'mirabook:migrated'
const KEYS = {
  profiles: 'mirabook:profiles',
  progress: 'mirabook:progress',
  vocab: 'mirabook:vocab',
  favourites: 'mirabook:favourites',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export const alreadyMigrated = (): boolean => {
  try {
    return localStorage.getItem(DONE) === '1'
  } catch {
    return true // no storage to migrate from
  }
}

export function profilesToReaders(profiles: Profile[]): Reader[] {
  const at = nowIso()
  return profiles.map((p) => ({
    id: p.id || newId(),
    name: p.name,
    avatar: p.avatar,
    settings_json: JSON.stringify(p.settings ?? {}),
    updated_at: at,
    deleted_at: null,
  }))
}

/**
 * Move whatever this device holds into the mirror, and push the reader list.
 *
 * Records land in the mirror marked dirty, so the next sync carries them up —
 * which also means a migration performed offline is not lost.
 */
export async function migrateLocalStorage(): Promise<Reader[]> {
  const raw = read<Profile[] | { profiles?: Profile[] }>(KEYS.profiles, [])
  const profiles: Profile[] = Array.isArray(raw) ? raw : (raw.profiles ?? [])
  const readers = profilesToReaders(profiles)

  const progress = read<Record<string, Record<string, { page: number; at: number }>>>(
    KEYS.progress,
    {},
  )
  for (const [readerId, byBook] of Object.entries(progress)) {
    for (const [bookId, entry] of Object.entries(byBook)) {
      putProgress(readerId, bookId, entry.page)
      // Keep the original moment rather than stamping everything "now", or a
      // stale device could look newer than a device that read more recently.
      const state = readerState(readerId)
      state.progress[bookId].updated_at = new Date(entry.at || Date.now()).toISOString()
    }
  }

  const favourites = read<Record<string, string[]>>(KEYS.favourites, {})
  for (const [readerId, bookIds] of Object.entries(favourites)) {
    for (const bookId of bookIds) putFavourite(readerId, bookId, true)
  }

  const vocab = read<Record<string, Parameters<typeof legacyWordToSaved>[0][]>>(KEYS.vocab, {})
  for (const [readerId, words] of Object.entries(vocab)) {
    for (const w of words) putWord(readerId, legacyWordToSaved(w))
  }

  // The reader list is the one thing that goes straight up: everything else
  // hangs off a reader id, so the server needs to know they exist first.
  let merged = readers
  if (readers.length) merged = await saveReaders(readers)

  try {
    localStorage.setItem(DONE, '1')
  } catch {
    /* nothing to remember it in; migrating twice is harmless anyway */
  }
  return merged
}
