import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profiles'
import { SavedWord, listWords, removeWord } from '../lib/vocab'

export default function SavedWords() {
  const { active } = useProfile()
  const navigate = useNavigate()
  const [words, setWords] = useState<SavedWord[]>(() => listWords(active.id))

  function del(id: string) {
    removeWord(active.id, id)
    setWords(listWords(active.id))
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-stone-500 hover:text-stone-800"
          title="Back"
        >
          ←
        </button>
        <h1 className="font-serif text-2xl font-bold">Saved words</h1>
        <span className="text-stone-400">· {active.name}</span>
      </header>

      {words.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-300 bg-white/50 px-6 py-16 text-center text-stone-500">
          No saved words yet. While reading, select a phrase and use{' '}
          <span className="font-medium">Explain</span> → <span className="font-medium">Save</span>.
        </div>
      ) : (
        <ul className="space-y-3">
          {words.map((w) => (
            <li key={w.id} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="font-serif text-lg font-semibold">{w.text}</span>
                  <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs uppercase tracking-wide text-stone-500">
                    {w.kind}
                  </span>
                </div>
                <button
                  onClick={() => del(w.id)}
                  className="shrink-0 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-red-600"
                  aria-label="Delete"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
              {w.context && (
                <p className="mt-1 text-sm italic text-stone-500">“{w.context}”</p>
              )}
              {w.gloss && <p className="mt-2 text-stone-800">{w.gloss}</p>}
              <p className="mt-2 text-sm leading-relaxed text-stone-700">{w.explanation}</p>
              {w.book_title && (
                <p className="mt-2 text-xs text-stone-400">from {w.book_title}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
