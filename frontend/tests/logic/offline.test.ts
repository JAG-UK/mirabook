// Offline storage: the IndexedDB layer behind "download for offline".
//
// This is where failures are quietest — every call is wrapped in try/catch so
// the app keeps working without it, which also means a broken store looks
// exactly like an empty one. fake-indexeddb gives us a real IDB to test
// against in Node.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMeta, PageData } from '../../src/api/client'

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/client')>()),
  translatePages: vi.fn(),
  mediaUrl: (src: string) => `http://backend${src}`,
}))

type Offline = typeof import('../../src/lib/offline')

const META: BookMeta = {
  id: 'bk1',
  title: 'Don Quijote',
  source_lang: 'Spanish',
  target_lang: 'English',
  page_count: 10,
  toc: [],
}

const page = (n: number, withImage = false): PageData => ({
  number: n,
  blocks: withImage
    ? [{ id: `p${n}-b0`, page: n, order: 0, type: 'image', text: '', src: `/media/bk1/img${n}.png` }]
    : [{ id: `p${n}-b0`, page: n, order: 0, type: 'paragraph', text: 'En un lugar' }],
  translations: [{ id: `p${n}-b0`, text: 'In a place', alternatives: [] }],
})

/** A fresh module registry and a fresh database for every test. */
async function freshOffline(): Promise<Offline> {
  globalThis.indexedDB = new IDBFactory()
  vi.resetModules()
  return import('../../src/lib/offline')
}

let offline: Offline
let translatePages: ReturnType<typeof vi.fn>

beforeEach(async () => {
  offline = await freshOffline()
  const client = await import('../../src/api/client')
  translatePages = vi.mocked(client.translatePages) as unknown as ReturnType<typeof vi.fn>
  translatePages.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ blob: async () => new Blob(['image-bytes']) })),
  )
})

describe('the library cache', () => {
  it('is empty before anything is cached', async () => {
    expect(await offline.getCachedLibrary()).toEqual([])
    expect(await offline.getCachedShelves()).toEqual([])
  })

  it('round-trips the book list, so the shelf shows up offline', async () => {
    await offline.cacheLibrary([META])
    expect(await offline.getCachedLibrary()).toEqual([META])
  })

  it('round-trips the shelf list', async () => {
    await offline.cacheShelves([{ name: 'Novels', count: 3 }])
    expect(await offline.getCachedShelves()).toEqual([{ name: 'Novels', count: 3 }])
  })

  it('replaces the cache rather than appending to it', async () => {
    await offline.cacheLibrary([META])
    await offline.cacheLibrary([{ ...META, id: 'bk2', title: 'Otro' }])
    expect((await offline.getCachedLibrary()).map((b) => b.id)).toEqual(['bk2'])
  })
})

describe('downloading a book', () => {
  beforeEach(() => {
    translatePages.mockImplementation(async (_id: string, pages: number[]) => pages.map((n) => page(n)))
  })

  it('fetches every page, in chunks, and stores them in order', async () => {
    await offline.downloadBook(META, () => {})

    // 10 pages in chunks of 4.
    expect(translatePages.mock.calls.map((c) => c[1])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10]])
    const record = await offline.getOfflineBook('bk1')
    expect(record?.pages.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(record?.meta).toEqual(META)
  })

  it('sorts pages even if the server answers out of order', async () => {
    translatePages.mockImplementation(async (_id: string, pages: number[]) =>
      [...pages].reverse().map((n) => page(n)),
    )
    await offline.downloadBook(META, () => {})
    const record = await offline.getOfflineBook('bk1')
    expect(record?.pages.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('reports progress as it goes', async () => {
    const seen: string[] = []
    await offline.downloadBook(META, (p) => seen.push(`${p.label} ${p.done}/${p.total}`))
    expect(seen[0]).toBe('Translating 4/10')
    expect(seen).toContain('Translating 10/10')
  })

  it('stores the images a book needs, keyed by source path', async () => {
    translatePages.mockImplementation(async (_id: string, pages: number[]) =>
      pages.map((n) => page(n, true)),
    )
    await offline.downloadBook(META, () => {})

    const record = await offline.getOfflineBook('bk1')
    expect(Object.keys(record!.images)).toHaveLength(10)
    expect(record!.images['/media/bk1/img1.png']).toBeInstanceOf(Blob)
    // Fetched through mediaUrl, not the bare path.
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('http://backend/media/bk1/img1.png')
  })

  it('skips an image it cannot fetch rather than losing the book', async () => {
    translatePages.mockImplementation(async (_id: string, pages: number[]) =>
      pages.map((n) => page(n, true)),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('img3.png')) throw new Error('offline')
        return { blob: async () => new Blob(['image-bytes']) }
      }),
    )
    await offline.downloadBook(META, () => {})

    const record = await offline.getOfflineBook('bk1')
    expect(Object.keys(record!.images)).toHaveLength(9)
    expect(record!.pages).toHaveLength(10) // the book is still complete
  })

  it('records the download in the index, with a size and a timestamp', async () => {
    await offline.downloadBook(META, () => {})
    const index = await offline.getDownloadIndex()
    expect(index.bk1.bytes).toBeGreaterThan(0)
    expect(index.bk1.at).toBeGreaterThan(0)
  })

  it('re-downloading replaces rather than duplicating', async () => {
    await offline.downloadBook(META, () => {})
    await offline.downloadBook(META, () => {})
    expect(Object.keys(await offline.getDownloadIndex())).toEqual(['bk1'])
    expect((await offline.getOfflineBook('bk1'))?.pages).toHaveLength(10)
  })
})

describe('deleting a download', () => {
  it('removes the book and its index entry', async () => {
    translatePages.mockImplementation(async (_id: string, pages: number[]) => pages.map((n) => page(n)))
    await offline.downloadBook(META, () => {})

    await offline.deleteOfflineBook('bk1')
    expect(await offline.getOfflineBook('bk1')).toBeUndefined()
    expect(await offline.getDownloadIndex()).toEqual({})
  })

  it('deleting something never downloaded is harmless', async () => {
    await expect(offline.deleteOfflineBook('nope')).resolves.toBeUndefined()
  })
})

describe('when IndexedDB is unavailable', () => {
  // Private windows, cleared site data, browsers set to block storage. The app
  // has to behave as online-only rather than fall over.
  beforeEach(async () => {
    vi.resetModules()
    // @ts-expect-error deliberately removing the API
    delete globalThis.indexedDB
    offline = await import('../../src/lib/offline')
  })

  it('reads fall back to empty', async () => {
    expect(await offline.getCachedLibrary()).toEqual([])
    expect(await offline.getCachedShelves()).toEqual([])
    expect(await offline.getDownloadIndex()).toEqual({})
    expect(await offline.getOfflineBook('bk1')).toBeUndefined()
  })

  it('writes are swallowed instead of throwing', async () => {
    await expect(offline.cacheLibrary([META])).resolves.toBeUndefined()
    await expect(offline.cacheShelves([])).resolves.toBeUndefined()
    await expect(offline.deleteOfflineBook('bk1')).resolves.toBeUndefined()
  })
})

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [1024 * 1024 * 3.5, '3.5 MB'],
  ])('renders %i as %s', async (bytes, expected) => {
    expect(offline.formatBytes(bytes)).toBe(expected)
  })
})
