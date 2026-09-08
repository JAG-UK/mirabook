import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookMeta, Shelf, deleteBook, listBooks, listShelves, uploadBook } from '../api/client'
import BookSpine from '../components/BookSpine'
import EditBookDialog from '../components/EditBookDialog'
import ProfileMenu from '../components/ProfileMenu'
import Spinner from '../components/Spinner'
import { useProfile } from '../lib/profiles'
import { listProgress } from '../lib/progress'
import {
  DownloadIndex,
  DownloadProgress,
  cacheLibrary,
  cacheShelves,
  deleteOfflineBook,
  downloadBook,
  getCachedLibrary,
  getCachedShelves,
  getDownloadIndex,
} from '../lib/offline'
import { useOnline } from '../lib/useOnline'

const PER_SHELF = 12 // books drawn on one wooden shelf
const PAGE = 60 // how many more to draw when "Show more" is clicked
const UNSHELVED = 'Unshelved'

/** Case- and accent-insensitive match on title or author. */
function matches(book: BookMeta, needle: string): boolean {
  if (!needle) return true
  const fold = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const hay = fold(`${book.title} ${book.author ?? ''}`)
  return fold(needle)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

function chunk(books: BookMeta[], size: number): BookMeta[][] {
  const out: BookMeta[][] = []
  for (let i = 0; i < books.length; i += size) out.push(books.slice(i, i + size))
  return out
}

export default function Library() {
  const [books, setBooks] = useState<BookMeta[]>([])
  const [shelves, setShelves] = useState<Shelf[]>([])
  const [loading, setLoading] = useState(true)
  const [reachable, setReachable] = useState(true) // backend reachable?
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadIndex>({})
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const [query, setQuery] = useState('')
  const [activeShelf, setActiveShelf] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [editing, setEditing] = useState<BookMeta | null>(null)
  const [allShelves, setAllShelves] = useState<Shelf[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { active } = useProfile()
  const online = useOnline()

  const load = useCallback(async () => {
    setDownloads(await getDownloadIndex())
    try {
      const [b, s, every] = await Promise.all([listBooks(), listShelves(), listShelves(true)])
      setBooks(b)
      setShelves(s)
      setAllShelves(every)
      setReachable(true)
      cacheLibrary(b)
      cacheShelves(s)
    } catch {
      setBooks(await getCachedLibrary())
      setShelves(await getCachedShelves())
      setReachable(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, online])

  // A new search or shelf starts the list from the top again.
  useEffect(() => setShown(PAGE), [query, activeShelf])

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

  async function removeBook(meta: BookMeta) {
    if (
      !confirm(
        `Remove “${meta.title}” from the library?\n\n` +
          'This permanently deletes its pages and translations on the server.',
      )
    )
      return
    try {
      await deleteBook(meta.id)
      await deleteOfflineBook(meta.id)
      await load()
    } catch (err) {
      setError(`Could not remove book: ${err}`)
    }
  }

  function applyEdit(updated: BookMeta) {
    const shelfMoved = books.find((b) => b.id === updated.id)?.shelf !== updated.shelf
    setBooks((bs) => bs.map((b) => (b.id === updated.id ? updated : b)))
    setEditing(null)
    // Shelf counts live on the server; only re-fetch when one actually moved.
    if (shelfMoved) {
      listShelves()
        .then(setShelves)
        .catch(() => {})
    }
  }

  const progressMap = new Map(listProgress(active.id).map((p) => [p.bookId, p]))
  const isAvailable = (id: string) => reachable || id in downloads

  const byId = new Map(books.map((b) => [b.id, b]))
  const continueList = listProgress(active.id)
    .filter((p) => p.page > 1 && byId.has(p.bookId) && isAvailable(p.bookId))
    .sort((a, b) => b.at - a.at)
    .slice(0, 4)
    .map((p) => ({ ...p, book: byId.get(p.bookId)! }))

  const found = useMemo(() => books.filter((b) => matches(b, query)), [books, query])
  const inShelf = useMemo(
    () => (activeShelf ? found.filter((b) => (b.shelf ?? UNSHELVED) === activeShelf) : found),
    [found, activeShelf],
  )

  // Grouped browse view: every shelf that still has something in it.
  const grouped = useMemo(() => {
    const order = shelves.map((s) => s.name)
    const bucket = new Map<string, BookMeta[]>()
    for (const b of found) {
      const name = b.shelf ?? UNSHELVED
      const list = bucket.get(name)
      list ? list.push(b) : bucket.set(name, [b])
    }
    return order
      .filter((name) => bucket.has(name))
      .map((name) => ({ name, books: bucket.get(name)! }))
  }, [found, shelves])

  // Browse by theme only when there is something to browse and nothing is
  // narrowing the view already.
  const browsing = !activeShelf && !query && grouped.length > 1

  const renderSpine = (b: BookMeta) => (
    <BookSpine
      key={b.id}
      book={b}
      available={isAvailable(b.id)}
      savedPage={progressMap.get(b.id)?.page}
      download={downloads[b.id]}
      progress={progress[b.id]}
      reachable={reachable}
      onOpen={(x) => navigate(`/read/${x.id}`)}
      onDownload={startDownload}
      onRemoveDownload={removeDownload}
      onRemove={removeBook}
      onEdit={setEditing}
    />
  )

  const addSpine = (
    <button
      className="spine-add"
      style={{ height: 150 }}
      onClick={() => fileInput.current?.click()}
      title="Upload a PDF or EPUB"
      aria-label="Upload a PDF or EPUB"
    >
      <span className="text-3xl leading-none">+</span>
    </button>
  )

  const visible = inShelf.slice(0, shown)
  const rows = chunk(visible, PER_SHELF)
  if (rows.length === 0) rows.push([])

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl font-bold tracking-tight">Mirabook</h1>
          <p className="mt-1 text-stone-500">
            {books.length > 0
              ? `${books.length} book${books.length === 1 ? '' : 's'} to read in two languages.`
              : 'Your shelf of books to read in two languages.'}
            {!reachable && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Offline — showing downloaded books
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/JAG-UK/mirabook"
            target="_blank"
            rel="noreferrer"
            className="text-stone-400 transition-colors hover:text-stone-700"
            title="View source on GitHub"
            aria-label="View source on GitHub"
          >
            <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
            </svg>
          </a>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={uploading || !reachable}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
            title={reachable ? 'Upload a PDF or EPUB' : 'Connect to upload'}
          >
            {uploading ? 'Ingesting…' : 'Upload book'}
          </button>
          <ProfileMenu />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf,application/epub+zip,.epub"
          className="hidden"
          onChange={onFile}
        />
      </header>

      {/* Search + themed shelves. Only worth the space once the shelf is big. */}
      {books.length > PER_SHELF && (
        <div className="mb-6 space-y-3">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or author…"
              aria-label="Search the library"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 pl-9 text-sm shadow-sm focus:border-stone-500 focus:outline-none"
            />
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
              ⌕
            </span>
          </div>
          {shelves.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setActiveShelf(null)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  activeShelf === null
                    ? 'bg-stone-800 text-white'
                    : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                }`}
              >
                All {books.length}
              </button>
              {shelves.map((s) => (
                <button
                  key={s.name}
                  onClick={() => setActiveShelf(s.name === activeShelf ? null : s.name)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    activeShelf === s.name
                      ? 'bg-stone-800 text-white'
                      : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                  }`}
                >
                  {s.name} <span className="opacity-60">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {uploading && (
        <div className="mb-4">
          <Spinner label="Extracting pages and structure…" />
        </div>
      )}

      {continueList.length > 0 && !query && !activeShelf && (
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
                  {book.author && (
                    <div className="truncate text-xs text-stone-400">{book.author}</div>
                  )}
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

      {editing && (
        <EditBookDialog
          book={editing}
          shelves={allShelves}
          onSaved={applyEdit}
          onClose={() => setEditing(null)}
        />
      )}

      {loading ? (
        <Spinner label="Loading library…" />
      ) : browsing ? (
        // Browse by theme: one wooden shelf per category, deepest first.
        <div className="space-y-6">
          {grouped.map(({ name, books: shelfBooks }) => (
            <section key={name}>
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="font-serif text-lg font-semibold">{name}</h2>
                {shelfBooks.length > PER_SHELF && (
                  <button
                    onClick={() => setActiveShelf(name)}
                    className="text-xs font-medium text-stone-500 hover:text-stone-800"
                  >
                    See all {shelfBooks.length} →
                  </button>
                )}
              </div>
              <div className="bookcase p-3">
                <div className="shelf">{shelfBooks.slice(0, PER_SHELF).map(renderSpine)}</div>
                <div className="shelf-board" />
              </div>
            </section>
          ))}
        </div>
      ) : (
        <>
          {(activeShelf || query) && (
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="font-serif text-lg font-semibold">
                {activeShelf ?? 'Search results'}
                <span className="ml-2 text-sm font-normal text-stone-400">
                  {inShelf.length} book{inShelf.length === 1 ? '' : 's'}
                </span>
              </h2>
              <button
                onClick={() => {
                  setActiveShelf(null)
                  setQuery('')
                }}
                className="text-xs font-medium text-stone-500 hover:text-stone-800"
              >
                ← All books
              </button>
            </div>
          )}
          <div className="bookcase p-3">
            {rows.map((row, si) => (
              <div key={si}>
                <div className="shelf">
                  {row.map(renderSpine)}
                  {si === rows.length - 1 && reachable && !activeShelf && !query && addSpine}
                  {inShelf.length === 0 && (
                    <span className="ml-3 self-center text-sm italic text-amber-50/70">
                      {query || activeShelf
                        ? 'Nothing here matches.'
                        : reachable
                          ? 'Your shelf is empty — add a Spanish PDF or EPUB.'
                          : 'No downloaded books to read offline.'}
                    </span>
                  )}
                </div>
                <div className="shelf-board" />
              </div>
            ))}
          </div>
          {inShelf.length > shown && (
            <div className="mt-4 text-center">
              <button
                onClick={() => setShown((n) => n + PAGE)}
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Show more ({inShelf.length - shown} left)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
