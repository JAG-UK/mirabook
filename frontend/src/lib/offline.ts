// Offline storage: downloaded books (pages + image blobs), a cached copy of
// the library list, and a lightweight index of what's downloaded. Backed by
// IndexedDB via `idb`. Every call is guarded so the app still works if
// IndexedDB is unavailable — it just behaves as online-only.

import { DBSchema, IDBPDatabase, openDB } from 'idb'
import { BookMeta, PageData, Shelf, mediaUrl, translatePages } from '../api/client'

export interface OfflineBook {
  bookId: string
  meta: BookMeta
  pages: PageData[]
  images: Record<string, Blob> // src path -> blob
  at: number
  bytes: number
}

export interface DownloadInfo {
  bytes: number
  at: number
}

export type DownloadIndex = Record<string, DownloadInfo>

interface Schema extends DBSchema {
  books: { key: string; value: OfflineBook }
  kv: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>('mirabook', 1, {
      upgrade(d) {
        d.createObjectStore('books')
        d.createObjectStore('kv')
      },
    })
  }
  return dbPromise
}

// --- library list cache (so the whole shelf shows even offline) ---

export async function cacheLibrary(books: BookMeta[]): Promise<void> {
  try {
    await (await db()).put('kv', books, 'library')
  } catch {
    /* ignore */
  }
}

export async function getCachedLibrary(): Promise<BookMeta[]> {
  try {
    return ((await (await db()).get('kv', 'library')) as BookMeta[]) ?? []
  } catch {
    return []
  }
}

export async function cacheShelves(shelves: Shelf[]): Promise<void> {
  try {
    await (await db()).put('kv', shelves, 'shelves')
  } catch {
    /* ignore */
  }
}

export async function getCachedShelves(): Promise<Shelf[]> {
  try {
    return ((await (await db()).get('kv', 'shelves')) as Shelf[]) ?? []
  } catch {
    return []
  }
}

// --- download index ---

export async function getDownloadIndex(): Promise<DownloadIndex> {
  try {
    return ((await (await db()).get('kv', 'downloads')) as DownloadIndex) ?? {}
  } catch {
    return {}
  }
}

async function setDownloadIndex(idx: DownloadIndex): Promise<void> {
  await (await db()).put('kv', idx, 'downloads')
}

// --- downloaded book records ---

export async function getOfflineBook(id: string): Promise<OfflineBook | undefined> {
  try {
    return await (await db()).get('books', id)
  } catch {
    return undefined
  }
}

export async function deleteOfflineBook(id: string): Promise<void> {
  try {
    const d = await db()
    await d.delete('books', id)
    const idx = await getDownloadIndex()
    delete idx[id]
    await setDownloadIndex(idx)
  } catch {
    /* ignore */
  }
}

export interface DownloadProgress {
  done: number
  total: number
  label: string
}

/**
 * Download an entire book (all pages translated + images) for offline reading,
 * reporting progress. Pages are translated in chunks via the batch endpoint,
 * which reuses the server-side cache, so re-downloading is cheap.
 */
export async function downloadBook(
  meta: BookMeta,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const total = meta.page_count
  const CHUNK = 4
  const pages: PageData[] = []

  for (let start = 1; start <= total; start += CHUNK) {
    const nums: number[] = []
    for (let n = start; n < start + CHUNK && n <= total; n++) nums.push(n)
    const got = await translatePages(meta.id, nums)
    pages.push(...got)
    onProgress({ done: Math.min(start + CHUNK - 1, total), total, label: 'Translating' })
  }
  pages.sort((a, b) => a.number - b.number)

  // Collect + fetch image blobs.
  const srcs = new Set<string>()
  for (const p of pages) {
    for (const b of p.blocks) if (b.type === 'image' && b.src) srcs.add(b.src)
  }
  const images: Record<string, Blob> = {}
  let bytes = 0
  let i = 0
  for (const src of srcs) {
    try {
      const blob = await (await fetch(mediaUrl(src))).blob()
      images[src] = blob
      bytes += blob.size
    } catch {
      /* skip a failed image */
    }
    i++
    onProgress({ done: i, total: srcs.size, label: 'Saving images' })
  }

  bytes += new Blob([JSON.stringify(pages)]).size
  const record: OfflineBook = { bookId: meta.id, meta, pages, images, at: Date.now(), bytes }

  const d = await db()
  await d.put('books', record, meta.id)
  const idx = await getDownloadIndex()
  idx[meta.id] = { bytes, at: record.at }
  await setDownloadIndex(idx)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
