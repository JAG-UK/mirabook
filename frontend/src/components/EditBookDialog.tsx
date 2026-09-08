import { useEffect, useRef, useState } from 'react'
import { BookMeta, Shelf, updateBook } from '../api/client'

const UNSHELVED = 'Unshelved'

interface Props {
  book: BookMeta
  shelves: Shelf[] // every shelf in the taxonomy, empty ones included
  onSaved: (updated: BookMeta) => void
  onClose: () => void
}

/**
 * Correct a book's title, author and shelf.
 *
 * Ingest guesses all three — from a filename, a Gutenberg catalogue row, or a
 * model — so they need fixing without a re-import.
 */
export default function EditBookDialog({ book, shelves, onSaved, onClose }: Props) {
  const [title, setTitle] = useState(book.title)
  const [author, setAuthor] = useState(book.author ?? '')
  const [shelf, setShelf] = useState(book.shelf ?? UNSHELVED)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.select()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = title.trim()
  const dirty =
    trimmed !== book.title ||
    author.trim() !== (book.author ?? '') ||
    shelf !== (book.shelf ?? UNSHELVED)

  async function save() {
    if (!trimmed || !dirty) return
    setSaving(true)
    setError(null)
    try {
      onSaved(
        await updateBook(book.id, {
          title: trimmed,
          author: author.trim() || null,
          shelf: shelf === UNSHELVED ? null : shelf,
        }),
      )
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${book.title}`}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-lg font-semibold">Edit book</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          {book.page_count} pages · {book.source_lang} → {book.target_lang}
          {book.source && ` · ${book.source}`}
        </p>

        <label className="mt-4 block text-sm font-medium text-stone-700">
          Title
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </label>
        {!trimmed && <p className="mt-1 text-xs text-red-600">A book needs a title.</p>}

        <label className="mt-3 block text-sm font-medium text-stone-700">
          Author
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            placeholder="Unknown"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          />
        </label>

        <label className="mt-3 block text-sm font-medium text-stone-700">
          Shelf
          <select
            value={shelf}
            onChange={(e) => setShelf(e.target.value)}
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
          >
            {shelves.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-600 hover:bg-stone-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !trimmed || !dirty}
            className="rounded-lg bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
