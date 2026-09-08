// Thin typed wrapper over the Mirabook backend. In dev, requests are relative
// and proxied by Vite; in production set VITE_API_BASE.

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export type BlockType = 'heading' | 'paragraph' | 'list' | 'image'

export interface Block {
  id: string
  page: number
  order: number
  type: BlockType
  text: string
  level?: number | null
  src?: string | null
  bbox?: number[] | null
}

export interface TranslatedBlock {
  id: string
  text: string
  alternatives: string[]
}

export interface PageData {
  number: number
  blocks: Block[]
  translations: TranslatedBlock[]
}

export interface TocEntry {
  title: string
  page: number
  level: number
}

export interface BookMeta {
  id: string
  title: string
  source_lang: string
  target_lang: string
  page_count: number
  toc: TocEntry[]
  author?: string | null
  shelf?: string | null
  source?: string | null
}

export interface Shelf {
  name: string
  count: number
}

export interface Explanation {
  kind: string
  text: string
  /** A few words for the back of a review card. */
  gloss?: string | null
}

// --- reader-owned records ---------------------------------------------
//
// These mirror the server's shape exactly, snake_case included, so nothing
// has to be translated on the way in or out. Ids are generated here, which is
// what lets a record be created offline and keep its identity.

export interface Reader {
  id: string
  name: string
  avatar: string
  settings_json: string
  updated_at: string
  deleted_at?: string | null
}

export interface ReadingProgress {
  book_id: string
  page: number
  updated_at: string
}

export interface Favourite {
  book_id: string
  created_at: string
  deleted_at?: string | null
}

export interface SavedWord {
  id: string
  text: string
  context: string
  kind: string
  explanation: string
  gloss?: string | null
  book_id: string
  book_title: string
  created_at: string
  deleted_at?: string | null
  due_at?: string | null
  interval_days: number
  ease: number
  reps: number
  lapses: number
  reviewed_at?: string | null
}

export interface SyncPayload {
  progress: ReadingProgress[]
  favourites: Favourite[]
  words: SavedWord[]
}

export interface SyncResponse extends SyncPayload {
  now: string
}

export interface Alternative {
  text: string
  note?: string | null
}

/**
 * Turn a failed response into an error worth showing.
 *
 * The backend explains what went wrong — which model is missing, which shelf
 * does not exist — and "500 Internal Server Error" throws all of that away.
 */
async function failure(r: Response): Promise<Error> {
  const detail = await r.json().catch(() => null)
  return new Error(detail?.detail ?? `${r.status} ${r.statusText}`)
}

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw await failure(r)
  return r.json() as Promise<T>
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await failure(r)
  return r.json() as Promise<T>
}

async function patchJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await failure(r)
  return r.json() as Promise<T>
}

export const mediaUrl = (src: string) => `${BASE}${src}`

export const listBooks = () => getJSON<BookMeta[]>('/api/books')
export const listShelves = (all = false) =>
  getJSON<Shelf[]>(`/api/shelves${all ? '?all=true' : ''}`)

/** Correct a book's labels. Omitted fields are left as they are. */
export interface BookLabels {
  title?: string
  author?: string | null
  shelf?: string | null
}
export const updateBook = (id: string, labels: BookLabels) =>
  patchJSON<BookMeta>(`/api/books/${id}`, labels)
export const getBook = (id: string) => getJSON<BookMeta>(`/api/books/${id}`)
export const getPage = (id: string, n: number) =>
  getJSON<PageData>(`/api/books/${id}/pages/${n}`)

export const translatePages = (id: string, pages: number[]) =>
  postJSON<PageData[]>(`/api/books/${id}/translate`, { pages })

export async function deleteBook(id: string): Promise<void> {
  const r = await fetch(`${BASE}/api/books/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
}

export async function uploadBook(file: File): Promise<BookMeta> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(`${BASE}/api/books`, { method: 'POST', body: form })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<BookMeta>
}

export const listReaders = () => getJSON<Reader[]>('/api/readers')

async function putJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

export const saveReaders = (readers: Reader[]) => putJSON<Reader[]>('/api/readers', readers)

/** One round trip: send what changed, receive everything since `since`. */
export const syncReader = (readerId: string, since: string | null, payload: SyncPayload) =>
  postJSON<SyncResponse>(
    `/api/readers/${readerId}/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`,
    payload,
  )

export const explain = (text: string, context: string, kind: 'grammar' | 'idiom') =>
  postJSON<Explanation>('/api/explain', { text, context, kind })

export const alternatives = (text: string, context: string) =>
  postJSON<Alternative[]>('/api/alternatives', { text, context })
