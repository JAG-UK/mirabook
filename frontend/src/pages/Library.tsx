import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookMeta, listBooks, uploadBook } from '../api/client'
import Spinner from '../components/Spinner'

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
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    listBooks()
      .then(setBooks)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

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

  // Split books into shelves; always render at least one (possibly empty) shelf.
  const shelves: BookMeta[][] = []
  for (let i = 0; i < books.length; i += PER_SHELF) {
    shelves.push(books.slice(i, i + PER_SHELF))
  }
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
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-serif text-4xl font-bold tracking-tight">Mirabook</h1>
          <p className="mt-1 text-stone-500">Your shelf of books to read in two languages.</p>
        </div>
        <button
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
        >
          {uploading ? 'Ingesting…' : 'Upload PDF'}
        </button>
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

      {loading ? (
        <Spinner label="Loading library…" />
      ) : (
        <div className="bookcase p-3">
          {shelves.map((shelf, si) => (
            <div key={si}>
              <div className="shelf">
                {shelf.map((b) => (
                  <button
                    key={b.id}
                    className="spine"
                    style={{
                      background: spineColor(b.id),
                      height: spineHeight(b.id),
                      width: spineWidth(b.id),
                    }}
                    onClick={() => navigate(`/read/${b.id}`)}
                    title={`${b.title} — ${b.source_lang} → ${b.target_lang}, ${b.page_count} pages`}
                  >
                    <span className="spine-title">{b.title}</span>
                  </button>
                ))}
                {si === shelves.length - 1 && addSpine}
                {books.length === 0 && (
                  <span className="ml-3 self-center text-sm italic text-amber-50/70">
                    Your shelf is empty — add a Spanish PDF.
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
