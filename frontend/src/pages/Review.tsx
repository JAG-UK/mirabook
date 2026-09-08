import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SavedWord } from '../api/client'
import { sentenceAround } from '../lib/context'
import { useProfile } from '../lib/profiles'
import { putWord } from '../lib/readerStore'
import { Grade, buildSession, describeInterval, gradeWord } from '../lib/srs'
import { useReaderData } from '../lib/useReaderData'
import { listWords } from '../lib/vocab'

/** Split a sentence around the phrase, so it can be shown in place. */
export function splitContext(context: string, phrase: string): [string, string, string] {
  const at = context.toLowerCase().indexOf(phrase.toLowerCase())
  if (at < 0) return [context, '', '']
  return [context.slice(0, at), context.slice(at, at + phrase.length), context.slice(at + phrase.length)]
}

const GRADES: { grade: Grade; label: string; key: string; className: string }[] = [
  {
    grade: 'again',
    label: 'Again',
    key: '1',
    className: 'border-red-300 text-red-700 hover:bg-red-50',
  },
  {
    grade: 'good',
    label: 'Good',
    key: '2',
    className: 'border-stone-400 text-stone-700 hover:bg-stone-100',
  },
  {
    grade: 'easy',
    label: 'Easy',
    key: '3',
    className: 'border-green-300 text-green-700 hover:bg-green-50',
  },
]

export default function Review() {
  const { active } = useProfile()
  const navigate = useNavigate()

  useReaderData()

  // Until the first answer the session is derived, so words arriving from the
  // first sync of a freshly-opened device turn up rather than leaving the
  // screen claiming there is nothing to do. From then on it is frozen —
  // rebuilding mid-session would let a card you just failed reshuffle the
  // queue under you.
  const [frozen, setFrozen] = useState<SavedWord[] | null>(null)
  const queue = frozen ?? buildSession(listWords(active.id))
  const [at, setAt] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [answered, setAnswered] = useState(0)
  const [lapsed, setLapsed] = useState(0)
  // Counted as each answer lands rather than while rendering the summary:
  // reading the clock during render is impure, and the count is the same.
  const [waiting, setWaiting] = useState(0)
  const requeued = useRef<Set<string>>(new Set())

  const card = queue[at]
  const total = queue.length

  const answer = useCallback(
    (grade: Grade) => {
      if (!card) return
      const now = Date.now()
      const updated = gradeWord(card, grade)
      putWord(active.id, updated)
      setAnswered((n) => n + 1)
      setWaiting(
        listWords(active.id).filter((w) => w.due_at && Date.parse(w.due_at) > now).length,
      )

      // A word you could not recall comes round once more this sitting, but
      // only once — otherwise a hard card can hold the session open for ever.
      const again = grade === 'again' && !requeued.current.has(card.id)
      if (again) {
        requeued.current.add(card.id)
        setLapsed((n) => n + 1)
      }
      setFrozen(again ? [...queue, updated] : queue)
      setRevealed(false)
      setAt((i) => i + 1)
    },
    [active.id, card, queue],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
        return
      }
      if (!revealed) return
      const hit = GRADES.find((g) => g.key === e.key)
      if (hit) answer(hit.grade)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, revealed, answer])

  const [before, phrase, after] = useMemo(
    () => (card ? splitContext(sentenceAround(card.context, card.text), card.text) : ['', '', '']),
    [card],
  )

  if (total === 0) {
    return (
      <Shell onBack={() => navigate('/words')}>
        <div className="rounded-xl border border-dashed border-stone-300 bg-white/50 px-6 py-16 text-center text-stone-500">
          Nothing to review right now. Save a phrase while reading and it will appear here.
        </div>
      </Shell>
    )
  }

  if (!card) {
    return (
      <Shell onBack={() => navigate('/words')}>
        <div className="rounded-xl border border-stone-200 bg-white px-6 py-12 text-center">
          <h2 className="font-serif text-xl font-semibold">Done for now</h2>
          <p className="mt-2 text-stone-600">
            {answered} answer{answered === 1 ? '' : 's'}
            {lapsed > 0 && `, ${lapsed} to come back to`}.
          </p>
          {waiting > 0 && (
            <p className="mt-1 text-sm text-stone-400">
              {waiting} word{waiting === 1 ? '' : 's'} waiting for later.
            </p>
          )}
          <button
            onClick={() => navigate('/words')}
            className="mt-6 rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            Back to saved words
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell onBack={() => navigate('/words')} progress={`${Math.min(at + 1, total)} of ${total}`}>
      <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
        {card.book_title && (
          <p className="text-xs text-stone-400">
            {card.page ? (
              <Link
                to={`/read/${card.book_id}?page=${card.page}`}
                className="underline decoration-stone-300 underline-offset-2 hover:text-stone-700"
              >
                from {card.book_title}, page {card.page}
              </Link>
            ) : (
              <>from {card.book_title}</>
            )}
          </p>
        )}

        {/* The sentence it came from, with the phrase in place. Reviewing a
            phrase in its own context is the thing a stock deck cannot do. */}
        <p className="mt-3 font-serif text-xl leading-relaxed">
          {phrase ? (
            <>
              {before}
              <span className="rounded bg-amber-100 px-1 font-semibold text-amber-900">
                {phrase}
              </span>
              {after}
            </>
          ) : (
            <span className="font-semibold">{card.text}</span>
          )}
        </p>

        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className="mt-6 w-full rounded-lg border border-stone-300 px-4 py-3 text-sm font-medium text-stone-600 hover:bg-stone-50"
          >
            Show answer <span className="ml-1 text-xs text-stone-400">space</span>
          </button>
        ) : (
          <div className="mt-6 border-t border-stone-100 pt-4">
            {card.gloss ? (
              <p className="font-serif text-lg text-stone-900">{card.gloss}</p>
            ) : (
              <p className="text-sm italic text-stone-400">
                No short answer was saved for this one — the explanation is below.
              </p>
            )}
            <details className="mt-3 group">
              <summary className="cursor-pointer list-none text-xs font-medium text-stone-500 hover:text-stone-800">
                <span className="group-open:hidden">Full explanation</span>
                <span className="hidden group-open:inline">Hide explanation</span>
              </summary>
              <div className="md mt-2 text-sm leading-relaxed text-stone-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{card.explanation}</ReactMarkdown>
              </div>
            </details>

            <div className="mt-6 grid grid-cols-3 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g.grade}
                  onClick={() => answer(g.grade)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition ${g.className}`}
                >
                  {g.label}
                  <span className="ml-1 text-xs opacity-50">{g.key}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-xs text-stone-400">
              Good → {describeInterval(gradeWord(card, 'good').interval_days)}
            </p>
          </div>
        )}
      </div>
    </Shell>
  )
}

function Shell({
  children,
  onBack,
  progress,
}: {
  children: React.ReactNode
  onBack: () => void
  progress?: string
}) {
  return (
    <div className="mx-auto max-w-xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-stone-500 hover:text-stone-800"
          title="Back to saved words"
          aria-label="Back to saved words"
        >
          ←
        </button>
        <h1 className="font-serif text-2xl font-bold">Review</h1>
        {progress && <span className="ml-auto text-sm tabular-nums text-stone-400">{progress}</span>}
      </header>
      {children}
    </div>
  )
}
