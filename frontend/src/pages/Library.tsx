import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookMeta, listBooks, uploadBook } from '../api/client'
import Spinner from '../components/Spinner'

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

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-serif text-4xl font-bold tracking-tight">Mirabook</h1>
          <p className="mt-1 text-stone-500">
            Read in the original, with a translation alongside.
          </p>
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
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white/50 px-6 py-16 text-center text-stone-500">
          No books yet. Upload a Spanish PDF to begin.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {books.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => navigate(`/read/${b.id}`)}
                className="flex w-full flex-col items-start rounded-xl border border-stone-200 bg-white px-5 py-4 text-left shadow-sm transition hover:border-stone-300 hover:shadow"
              >
                <span className="font-serif text-lg font-semibold">{b.title}</span>
                <span className="mt-1 text-sm text-stone-500">
                  {b.source_lang} → {b.target_lang} · {b.page_count} pages
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
