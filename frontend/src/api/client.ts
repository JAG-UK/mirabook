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
}

export interface Explanation {
  kind: string
  text: string
}

export interface Alternative {
  text: string
  note?: string | null
}

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<T>
}

export const mediaUrl = (src: string) => `${BASE}${src}`

export const listBooks = () => getJSON<BookMeta[]>('/api/books')
export const getBook = (id: string) => getJSON<BookMeta>(`/api/books/${id}`)
export const getPage = (id: string, n: number) =>
  getJSON<PageData>(`/api/books/${id}/pages/${n}`)

export async function uploadBook(file: File): Promise<BookMeta> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(`${BASE}/api/books`, { method: 'POST', body: form })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
  return r.json() as Promise<BookMeta>
}

export const explain = (text: string, context: string, kind: 'grammar' | 'idiom') =>
  postJSON<Explanation>('/api/explain', { text, context, kind })

export const alternatives = (text: string, context: string) =>
  postJSON<Alternative[]>('/api/alternatives', { text, context })
