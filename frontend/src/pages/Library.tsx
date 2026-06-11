import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookMeta, listBooks, uploadBook } from '../api/client'
import ProfileMenu from '../components/ProfileMenu'
import Spinner from '../components/Spinner'
import { useProfile } from '../lib/profiles'
import { listProgress } from '../lib/progress'
import {
  DownloadIndex,
  DownloadProgress,
  cacheLibrary,
  deleteOfflineBook,
  downloadBook,
  formatBytes,
  getCachedLibrary,
  getDownloadIndex,
} from '../lib/offline'
import { useOnline } from '../lib/useOnline'

// Muted book-cloth colours; chosen deterministically per book.
const SPINE_COLORS = [
  '#7d2b2b', '#2f4f3e', '#274472', '#8a6d1f', '#5b2a4a',
  '#356470', '#6b4423', '#3a3f5a', '#704214', '#4a5d23',
]
const PER_SHELF = 12

function hash(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
const spineColor = (id: string) => SPINE_COLORS[hash(id) % SPINE_COLORS.length]
const spineHeight = (id: string) => 196 + (hash(id + 'h') % 52) // 196–247px
const spineWidth = (id: string) => 50 + (hash(id + 'w') % 18) // 50–67px

export default function Library() {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [reachable, setReachable] = useState(true) // backend reachable?
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadIndex>({})
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { active } = useProfile()
  const online = useOnline()

  const load = useCallback(async () => {
    setDownloads(await getDownloadIndex())
    try {
      const b = await listBooks()
      setBooks(b)
      setReachable(true)
      cacheLibrary(b)
    } catch {
      setBooks(await getCachedLibrary())
      setReachable(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, online])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const meta = await uploadBook(file)
      navigate(`/read/${meta.id}`)
    } catch (err) {
      setError(`Upload failed: ${err}`)
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function startDownload(meta: BookMeta) {
    setProgress((p) => ({ ...p, [meta.id]: { done: 0, total: meta.page_count, label: 'Starting' } }))
    try {
      await downloadBook(meta, (pr) => setProgress((p) => ({ ...p, [meta.id]: pr })))
      setDownloads(await getDownloadIndex())
    } catch (err) {
      setError(`Download failed: ${err}`)
    } finally {
      setProgress((p) => {
        const { [meta.id]: _, ...rest } = p
        return rest
      })
    }
  }

  async function removeDownload(meta: BookMeta) {
    if (!confirm(`Remove the offline copy of “${meta.title}”?`)) return
    await deleteOfflineBook(meta.id)
    setDownloads(await getDownloadIndex())
  }

  const progressMap = new Map(listProgress(active.id).map((p) => [p.bookId, p]))
  const isAvailable = (id: string) => reachable || id in downloads

  const byId = new Map(books.map((b) => [b.id, b]))
  const continueList = listProgress(active.id)
    .filter((p) => p.page > 1 && byId.has(p.bookId) && isAvailable(p.bookId))
    .sort((a, b) => b.at - a.at)
    .slice(0, 4)
    .map((p) => ({ ...p, book: byId.get(p.bookId)! }))

  const shelves: BookMeta[][] = []
  for (let i = 0; i < books.length; i += PER_SHELF) shelves.push(books.slice(i, i + PER_SHELF))
  if (shelves.length === 0) shelves.push([])

  const addSpine = (
    <button
      className="spine-add"
      style={{ height: 150 }}
      onClick={() => fileInput.current?.click()}
      title="Upload a PDF"
      aria-label="Upload a PDF"
    >
      <span className="text-3xl leading-none">+</span>
    </button>
  )

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl font-bold tracking-tight">Mirabook</h1>
          <p className="mt-1 text-stone-500">
            Your shelf of books to read in two languages.
            {!reachable && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Offline — showing downloaded books
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading || !reachable}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
            title={reachable ? 'Upload a PDF' : 'Connect to upload'}
          >
            {uploading ? 'Ingesting…' : 'Upload PDF'}
          </button>
          <ProfileMenu />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onFile}
        />
      </header>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {uploading && (
        <div className="mb-4">
          <Spinner label="Extracting pages and structure…" />
        </div>
      )}

      {continueList.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-400">
            Continue reading
          </h2>
          <div className="flex flex-wrap gap-3">
            {continueList.map(({ book, page }) => {
              const pct = Math.round((page / book.page_count) * 100)
              return (
                <button
                  key={book.id}
                  onClick={() => navigate(`/read/${book.id}`)}
                  className="w-56 rounded-xl border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-stone-300 hover:shadow"
                >
                  <div className="truncate font-serif font-semibold">{book.title}</div>
                  <div className="mt-1 text-xs text-stone-500">
                    Page {page} of {book.page_count}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
                    <div className="h-full rounded-full bg-stone-700" style={{ width: `${pct}%` }} />
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {loading ? (
        <Spinner label="Loading library…" />
      ) : (
        <div className="bookcase p-3">
          {shelves.map((shelf, si) => (
            <div key={si}>
              <div className="shelf">
                {shelf.map((b) => {
                  const saved = progressMap.get(b.id)?.page
                  const bookmarked = !!saved && saved > 1
                  const downloaded = b.id in downloads
                  const dl = progress[b.id]
                  const available = isAvailable(b.id)
                  return (
                    <div
                      key={b.id}
                      className="spine-wrap"
                      style={{ height: spineHeight(b.id), opacity: available ? 1 : 0.32 }}
                    >
                      <button
                        className="spine"
                        style={{ background: spineColor(b.id), width: spineWidth(b.id) }}
                        onClick={() => available && navigate(`/read/${b.id}`)}
                        disabled={!available}
                        title={
                          available
                            ? bookmarked
                              ? `${b.title} — resume on page ${saved} of ${b.page_count}`
                              : `${b.title} — ${b.source_lang} → ${b.target_lang}, ${b.page_count} pages`
                            : `${b.title} — not available offline`
                        }
                      >
                        {bookmarked && <span className="bookmark-ribbon" />}
                        <span className="spine-title">{b.title}</span>
                      </button>

                      <div className="spine-foot" onClick={(e) => e.stopPropagation()}>
                        {dl ? (
                          <span title={dl.label}>
                            {Math.round((dl.done / Math.max(1, dl.total)) * 100)}%
                          </span>
                        ) : downloaded ? (
                          <button
                            className="done"
                            onClick={() => removeDownload(b)}
                            title={`Downloaded (${formatBytes(downloads[b.id].bytes)}) — click to remove`}
                          >
                            ✓
                          </button>
                        ) : reachable ? (
                          <button onClick={() => startDownload(b)} title="Download for offline">
                            ⤓
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
                {si === shelves.length - 1 && reachable && addSpine}
                {books.length === 0 && (
                  <span className="ml-3 self-center text-sm italic text-amber-50/70">
                    {reachable
                      ? 'Your shelf is empty — add a Spanish PDF.'
                      : 'No downloaded books to read offline.'}
                  </span>
                )}
              </div>
              <div className="shelf-board" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
