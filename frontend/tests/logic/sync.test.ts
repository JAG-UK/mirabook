// The mirror and the sync client.
//
// Every write lands in the mirror first and is queued; a failed sync is not an
// error, just a queue that is still full. The properties worth holding: a
// queued change is never dropped, a write made while a request is in flight
// survives it, and a removal is a tombstone rather than a hole.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedWord } from '../../src/api/client'

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/client')>()),
  syncReader: vi.fn(),
  saveReaders: vi.fn(),
}))

const client = await import('../../src/api/client')
const syncReader = vi.mocked(client.syncReader)
const saveReaders = vi.mocked(client.saveReaders)

const {
  deleteWord,
  liveFavourites,
  liveWords,
  pendingChanges,
  putFavourite,
  putProgress,
  putWord,
  readerState,
} = await import('../../src/lib/readerStore')
const { hasPendingChanges, legacyWordToSaved, syncNow } = await import('../../src/lib/sync')
const { alreadyMigrated, migrateLocalStorage, profilesToReaders } = await import(
  '../../src/lib/migrate'
)

const JON = 'r1'
const nothing = { now: 'T1', progress: [], favourites: [], words: [] }

const word = (id = 'w1', over: Partial<SavedWord> = {}): SavedWord => ({
  id,
  text: 'no se ande con rodeos',
  context: 'Le rogué…',
  kind: 'idiom',
  explanation: 'A fixed expression.',
  gloss: "don't beat about the bush",
  book_id: 'bk1',
  book_title: 'Don Quijote',
  created_at: '2026-09-01T10:00:00.000Z',
  interval_days: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  ...over,
})

beforeEach(() => {
  syncReader.mockReset()
  saveReaders.mockReset()
  syncReader.mockResolvedValue(nothing)
  saveReaders.mockImplementation(async (readers) => readers)
})

describe('the mirror', () => {
  it('answers immediately, before anything has been synced', () => {
    putProgress(JON, 'bk1', 42)
    expect(readerState(JON).progress.bk1.page).toBe(42)
  })

  it('queues every write for the next sync', () => {
    putProgress(JON, 'bk1', 42)
    putFavourite(JON, 'bk2', true)
    putWord(JON, word())

    const queued = pendingChanges(JON)
    expect(queued.progress).toHaveLength(1)
    expect(queued.favourites).toHaveLength(1)
    expect(queued.words).toHaveLength(1)
    expect(hasPendingChanges(JON)).toBe(true)
  })

  it('has nothing to say when nothing has changed', () => {
    expect(hasPendingChanges(JON)).toBe(false)
  })

  it('keeps one entry per book however often a page turns', () => {
    putProgress(JON, 'bk1', 1)
    putProgress(JON, 'bk1', 2)
    putProgress(JON, 'bk1', 3)
    expect(pendingChanges(JON).progress).toHaveLength(1)
    expect(readerState(JON).progress.bk1.page).toBe(3)
  })

  it('un-starring leaves a tombstone rather than a hole', () => {
    putFavourite(JON, 'bk1', true)
    putFavourite(JON, 'bk1', false)

    expect(liveFavourites(JON)).toEqual([])
    // The record survives, so another device learns of the removal.
    expect(readerState(JON).favourites.bk1.deleted_at).toBeTruthy()
    expect(readerState(JON).favourites.bk1.created_at).toBeTruthy()
  })

  it('deleting a word leaves a tombstone too', () => {
    putWord(JON, word())
    deleteWord(JON, 'w1')
    expect(liveWords(JON)).toEqual([])
    expect(readerState(JON).words.w1.deleted_at).toBeTruthy()
  })

  it('keeps each reader apart', () => {
    putWord(JON, word('mine'))
    putWord('r2', word('theirs'))
    expect(liveWords(JON).map((w) => w.id)).toEqual(['mine'])
    expect(liveWords('r2').map((w) => w.id)).toEqual(['theirs'])
  })
})

describe('syncing', () => {
  it('sends what is queued and reports success', async () => {
    putProgress(JON, 'bk1', 42)
    expect(await syncNow(JON)).toBe(true)

    const [, since, payload] = syncReader.mock.calls[0]
    expect(since).toBeNull() // a device that has never synced asks for everything
    expect(payload.progress[0].page).toBe(42)
  })

  it('empties the queue once the server has it', async () => {
    putProgress(JON, 'bk1', 42)
    await syncNow(JON)
    expect(hasPendingChanges(JON)).toBe(false)
  })

  it('remembers the token and sends it next time', async () => {
    syncReader.mockResolvedValue({ ...nothing, now: 'T2' })
    await syncNow(JON)
    await syncNow(JON)
    expect(syncReader.mock.calls[1][1]).toBe('T2')
  })

  it('folds in what the server sends back', async () => {
    syncReader.mockResolvedValue({
      ...nothing,
      words: [word('from-tablet')],
      progress: [{ book_id: 'bk9', page: 7, updated_at: 'T1' }],
    })
    await syncNow(JON)

    expect(liveWords(JON).map((w) => w.id)).toEqual(['from-tablet'])
    expect(readerState(JON).progress.bk9.page).toBe(7)
  })

  it('applies a deletion that happened on another device', async () => {
    putWord(JON, word())
    await syncNow(JON)
    syncReader.mockResolvedValue({ ...nothing, words: [word('w1', { deleted_at: 'T2' })] })
    await syncNow(JON)

    expect(liveWords(JON)).toEqual([])
  })

  it('keeps the queue when the server cannot be reached', async () => {
    syncReader.mockRejectedValue(new Error('offline'))
    putProgress(JON, 'bk1', 42)

    expect(await syncNow(JON)).toBe(false)
    expect(hasPendingChanges(JON)).toBe(true) // nothing lost, try again later
  })

  it('does not open a second request while one is in flight', async () => {
    let release: (v: typeof nothing) => void = () => {}
    syncReader.mockReturnValue(new Promise((r) => (release = r)))

    const first = syncNow(JON)
    const second = syncNow(JON)
    release(nothing)
    await Promise.all([first, second])

    expect(syncReader).toHaveBeenCalledTimes(1)
  })

  it('keeps a write made while the request was in flight', async () => {
    // The queue is cleared by what was sent, not wholesale — otherwise a page
    // turn during a sync is silently dropped.
    let release: (v: typeof nothing) => void = () => {}
    syncReader.mockReturnValue(new Promise((r) => (release = r)))

    putProgress(JON, 'bk1', 1)
    const pending = syncNow(JON)
    putWord(JON, word('written-during'))
    release(nothing)
    await pending

    expect(pendingChanges(JON).words.map((w) => w.id)).toEqual(['written-during'])
    expect(pendingChanges(JON).progress).toHaveLength(0)
  })
})

describe('migrating from localStorage', () => {
  it('is skipped once it has been done', async () => {
    expect(alreadyMigrated()).toBe(false)
    await migrateLocalStorage()
    expect(alreadyMigrated()).toBe(true)
  })

  it('turns profiles into readers, keeping their ids', () => {
    const readers = profilesToReaders([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'p1', name: 'Jon', avatar: '📖', settings: { theme: 'night' } as any },
    ])
    expect(readers[0].id).toBe('p1') // stable ids are what make this safe
    expect(readers[0].name).toBe('Jon')
    expect(JSON.parse(readers[0].settings_json).theme).toBe('night')
  })

  it('carries bookmarks, favourites and words into the mirror', async () => {
    localStorage.setItem(
      'mirabook:profiles',
      JSON.stringify([{ id: 'p1', name: 'Jon', avatar: '📖', settings: {} }]),
    )
    localStorage.setItem(
      'mirabook:progress',
      JSON.stringify({ p1: { bk1: { page: 42, at: Date.parse('2026-09-01T10:00:00Z') } } }),
    )
    localStorage.setItem('mirabook:favourites', JSON.stringify({ p1: ['bk1', 'bk2'] }))
    localStorage.setItem(
      'mirabook:vocab',
      JSON.stringify({
        p1: [
          {
            id: 'old-word',
            text: 'rodeos',
            context: 'Le rogué…',
            kind: 'idiom',
            explanation: 'A fixed expression.',
            bookId: 'bk1',
            bookTitle: 'Don Quijote',
            at: Date.parse('2026-08-01T10:00:00Z'),
          },
        ],
      }),
    )

    await migrateLocalStorage()

    expect(readerState('p1').progress.bk1.page).toBe(42)
    // The original moment is kept, so a stale device cannot look newer.
    expect(readerState('p1').progress.bk1.updated_at).toBe('2026-09-01T10:00:00.000Z')
    expect(liveFavourites('p1').sort()).toEqual(['bk1', 'bk2'])
    expect(liveWords('p1').map((w) => w.id)).toEqual(['old-word'])
    expect(saveReaders).toHaveBeenCalledWith([expect.objectContaining({ id: 'p1' })])
  })

  it('queues everything it moved, so a migration done offline still arrives', async () => {
    localStorage.setItem('mirabook:favourites', JSON.stringify({ p1: ['bk1'] }))
    await migrateLocalStorage()
    expect(hasPendingChanges('p1')).toBe(true)
  })

  it('copes with nothing to migrate', async () => {
    await expect(migrateLocalStorage()).resolves.toEqual([])
  })

  it('maps an old word onto the new shape', () => {
    const mapped = legacyWordToSaved({
      id: 'w1',
      text: 'rodeos',
      context: 'Le rogué…',
      kind: 'idiom',
      explanation: 'A fixed expression.',
      bookId: 'bk1',
      bookTitle: 'Don Quijote',
      at: Date.parse('2026-08-01T10:00:00Z'),
    })
    expect(mapped.book_id).toBe('bk1')
    expect(mapped.book_title).toBe('Don Quijote')
    expect(mapped.created_at).toBe('2026-08-01T10:00:00.000Z')
    expect(mapped.gloss).toBeNull() // saved before glosses existed
    expect(mapped.ease).toBe(2.5)
  })
})
