// Talking to the server about one reader's records.
//
// Every write has already landed in the mirror by the time this runs, so a
// failed sync is not an error the reader needs to see — it just means the
// queue is still full and we will try again. That is the whole of the offline
// story: being offline is a sync that has not happened yet.

import { SavedWord, syncReader } from '../api/client'
import { applyServer, pendingChanges, readerState } from './readerStore'

let inFlight: Promise<boolean> | null = null

/**
 * Push what this device has changed and pull what it has not seen.
 *
 * Returns whether it reached the server. Concurrent calls share one request:
 * a page turn during a sync should not open a second.
 */
export async function syncNow(readerId: string): Promise<boolean> {
  if (inFlight) return inFlight
  inFlight = run(readerId).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function run(readerId: string): Promise<boolean> {
  const payload = pendingChanges(readerId)
  // Remember exactly what we sent: anything written while the request is in
  // flight must stay queued rather than being cleared with the rest.
  const pushed = {
    progress: payload.progress.map((p) => p.book_id),
    favourites: payload.favourites.map((f) => f.book_id),
    words: payload.words.map((w) => w.id),
  }
  try {
    const response = await syncReader(readerId, readerState(readerId).since, payload)
    applyServer(readerId, response, pushed, response.now)
    return true
  } catch {
    return false
  }
}

export const hasPendingChanges = (readerId: string): boolean => {
  const p = pendingChanges(readerId)
  return p.progress.length + p.favourites.length + p.words.length > 0
}

/**
 * Keep a reader in step while the app is open.
 *
 * Syncs on a slow timer, when the browser says the network is back, and when
 * the tab is hidden — the last of these is what catches a reader who closes
 * the lid mid-chapter.
 */
export function startSync(readerId: string, intervalMs = 60_000): () => void {
  const tick = () => void syncNow(readerId)
  tick()

  const timer = setInterval(tick, intervalMs)
  const onHide = () => {
    if (document.visibilityState === 'hidden') tick()
  }
  window.addEventListener('online', tick)
  document.addEventListener('visibilitychange', onHide)

  return () => {
    clearInterval(timer)
    window.removeEventListener('online', tick)
    document.removeEventListener('visibilitychange', onHide)
  }
}

/** The shape the old localStorage vocab list used, before records had ids the server knew. */
interface LegacyWord {
  id: string
  text: string
  context: string
  kind: string
  explanation: string
  bookId: string
  bookTitle: string
  at: number
}

export function legacyWordToSaved(w: LegacyWord): SavedWord {
  return {
    id: w.id,
    text: w.text,
    context: w.context,
    kind: w.kind,
    explanation: w.explanation,
    gloss: null, // saved before glosses existed; the review screen copes
    book_id: w.bookId ?? '',
    book_title: w.bookTitle ?? '',
    created_at: new Date(w.at || Date.now()).toISOString(),
    interval_days: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
  }
}
