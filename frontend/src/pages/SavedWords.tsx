import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { sentenceAround } from '../lib/context'
import { useProfile } from '../lib/profiles'
import { dueCount } from '../lib/srs'
import { useReaderData } from '../lib/useReaderData'
import { listWords, removeWord } from '../lib/vocab'

export default function SavedWords() {
  const { active } = useProfile()
  const navigate = useNavigate()
  useReaderData()
  const words = listWords(active.id)

  const del = (id: string) => removeWord(active.id, id)

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
        {words.length > 0 && (
          <button
            onClick={() => navigate('/review')}
            className="ml-auto rounded-lg bg-stone-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-700"
          >
            Review
            {dueCount(words) > 0 && (
              <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">
                {dueCount(words)} due
              </span>
            )}
          </button>
        )}
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
                <p className="mt-1 text-sm italic text-stone-500">
                  “{sentenceAround(w.context, w.text)}”
                </p>
              )}
              {w.gloss && <p className="mt-2 text-stone-800">{w.gloss}</p>}
              <div className="md mt-2 text-sm leading-relaxed text-stone-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{w.explanation}</ReactMarkdown>
              </div>
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
