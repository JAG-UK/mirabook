// The mirror: every reader's records, held in memory and persisted locally.
//
// The server is the durable truth, but nothing reads from the network to
// render. This holds the whole picture in memory so the existing synchronous
// calls — getProgress, listFavourites, listWords — keep working exactly as
// they did, and writes land here first and are queued for the next sync.
//
// That is what keeps offline reading working: being offline is no longer a
// mode, it is just a sync that has not happened yet.
//
// It lives in its own IndexedDB database rather than alongside downloaded
// books, so the store holding hundreds of megabytes of page images never has
// to be migrated to add a field here.

import { DBSchema, IDBPDatabase, openDB } from 'idb'
import { Favourite, ReadingProgress, SavedWord } from '../api/client'

export interface ReaderState {
  progress: Record<string, ReadingProgress> // by book id
  favourites: Record<string, Favourite> // by book id
  words: Record<string, SavedWord> // by word id
  /** The sync token: everything the server changed before this is already here. */
  since: string | null
  /** What this device has changed and not yet pushed. */
  dirty: { progress: string[]; favourites: string[]; words: string[] }
}

interface Schema extends DBSchema {
  readers: { key: string; value: ReaderState }
}

const empty = (): ReaderState => ({
  progress: {},
  favourites: {},
  words: {},
  since: null,
  dirty: { progress: [], favourites: [], words: [] },
})

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null
function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>('mirabook-reader', 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains('readers')) d.createObjectStore('readers')
      },
    })
  }
  return dbPromise
}

// --- the in-memory mirror ---

const state = new Map<string, ReaderState>()
const listeners = new Set<() => void>()
let hydrated = false

export const isHydrated = () => hydrated

/** Re-render anything showing this data. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach((fn) => fn())

export function readerState(readerId: string): ReaderState {
  let s = state.get(readerId)
  if (!s) {
    s = empty()
    state.set(readerId, s)
  }
  return s
}

/**
 * Load everything from disk. Nothing that reads reader data should render
 * before this resolves, or it will paint a page-1 bookmark over a real one.
 */
export async function hydrate(): Promise<void> {
  try {
    const d = await db()
    for (const id of await d.getAllKeys('readers')) {
      const value = await d.get('readers', id)
      if (value) state.set(id as string, { ...empty(), ...value })
    }
  } catch {
    // No IndexedDB (a private window, blocked storage). The app still works;
    // it just cannot remember anything between visits on this device.
  }
  hydrated = true
  notify()
}

// Persisting is debounced: a page turn writes a bookmark on every keystroke of
// an impatient reader, and none of them need to hit the disk individually.
const pending = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function persist(readerId: string): void {
  pending.add(readerId)
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const ids = [...pending]
    pending.clear()
    void flush(ids)
  }, 250)
}

async function flush(ids: string[]): Promise<void> {
  try {
    const d = await db()
    for (const id of ids) await d.put('readers', readerState(id), id)
  } catch {
    /* storage unavailable — memory is still correct for this session */
  }
}

/** Write immediately, for when the tab may be about to go away. */
export async function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const ids = [...pending]
  pending.clear()
  await flush(ids.length ? ids : [...state.keys()])
}

function markDirty(s: ReaderState, kind: keyof ReaderState['dirty'], id: string): void {
  if (!s.dirty[kind].includes(id)) s.dirty[kind].push(id)
}

function change(readerId: string, apply: (s: ReaderState) => void): void {
  const s = readerState(readerId)
  apply(s)
  persist(readerId)
  notify()
}

export const nowIso = () => new Date().toISOString()

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// --- writes ---

export function putProgress(readerId: string, bookId: string, page: number): void {
  change(readerId, (s) => {
    s.progress[bookId] = { book_id: bookId, page, updated_at: nowIso() }
    markDirty(s, 'progress', bookId)
  })
}

export function putFavourite(readerId: string, bookId: string, starred: boolean): void {
  change(readerId, (s) => {
    const at = nowIso()
    const existing = s.favourites[bookId]
    s.favourites[bookId] = {
      book_id: bookId,
      created_at: starred ? at : (existing?.created_at ?? at),
      deleted_at: starred ? null : at,
    }
    markDirty(s, 'favourites', bookId)
  })
}

export function putWord(readerId: string, word: SavedWord): void {
  change(readerId, (s) => {
    s.words[word.id] = word
    markDirty(s, 'words', word.id)
  })
}

export function deleteWord(readerId: string, wordId: string): void {
  change(readerId, (s) => {
    const existing = s.words[wordId]
    if (!existing) return
    s.words[wordId] = { ...existing, deleted_at: nowIso() }
    markDirty(s, 'words', wordId)
  })
}

// --- reads ---

export const liveWords = (readerId: string): SavedWord[] =>
  Object.values(readerState(readerId).words).filter((w) => !w.deleted_at)

export const liveFavourites = (readerId: string): string[] =>
  Object.values(readerState(readerId).favourites)
    .filter((f) => !f.deleted_at)
    .map((f) => f.book_id)

// --- what sync needs ---

export function pendingChanges(readerId: string) {
  const s = readerState(readerId)
  return {
    progress: s.dirty.progress.map((id) => s.progress[id]).filter(Boolean),
    favourites: s.dirty.favourites.map((id) => s.favourites[id]).filter(Boolean),
    words: s.dirty.words.map((id) => s.words[id]).filter(Boolean),
  }
}

/**
 * Fold the server's answer in and forget what we pushed.
 *
 * Only the records we sent are cleared from the dirty list, so a write made
 * while the request was in flight survives to the next sync instead of being
 * silently dropped.
 */
export function applyServer(
  readerId: string,
  incoming: { progress: ReadingProgress[]; favourites: Favourite[]; words: SavedWord[] },
  pushed: { progress: string[]; favourites: string[]; words: string[] },
  token: string,
): void {
  change(readerId, (s) => {
    for (const p of incoming.progress) s.progress[p.book_id] = p
    for (const f of incoming.favourites) s.favourites[f.book_id] = f
    for (const w of incoming.words) s.words[w.id] = w
    s.dirty = {
      progress: s.dirty.progress.filter((id) => !pushed.progress.includes(id)),
      favourites: s.dirty.favourites.filter((id) => !pushed.favourites.includes(id)),
      words: s.dirty.words.filter((id) => !pushed.words.includes(id)),
    }
    s.since = token
  })
}

/** Test seam: drop everything held in memory. */
export function __reset(): void {
  state.clear()
  listeners.clear()
  hydrated = false
  dbPromise = null
}
