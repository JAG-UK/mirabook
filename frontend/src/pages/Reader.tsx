import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Alternative,
  Block,
  BookMeta,
  PageData,
  alternatives,
  explain,
  getBook,
  getPage,
} from '../api/client'
import BlockRow from '../components/BlockRow'
import InfoPopover from '../components/InfoPopover'
import SelectionMenu, { SelectionState } from '../components/SelectionMenu'
import Spinner from '../components/Spinner'

interface PopoverState {
  x: number
  y: number
  title: string
  loading: boolean
  content?: ReactNode
}

export default function Reader() {
  const { bookId = '' } = useParams()
  const [meta, setMeta] = useState<BookMeta | null>(null)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [blurEnabled, setBlurEnabled] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [sel, setSel] = useState<SelectionState | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)

  const cache = useRef<Map<number, PageData>>(new Map())

  useEffect(() => {
    getBook(bookId).then(setMeta).catch((e) => setError(String(e)))
  }, [bookId])

  const ensurePage = useCallback(
    async (n: number): Promise<PageData> => {
      const hit = cache.current.get(n)
      if (hit) return hit
      const d = await getPage(bookId, n)
      cache.current.set(n, d)
      return d
    },
    [bookId],
  )

  // Load the current page, then prefetch the next one.
  useEffect(() => {
    if (!meta) return
    let cancelled = false
    setLoading(true)
    setSel(null)
    ensurePage(page)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setLoading(false)
        if (page < meta.page_count) ensurePage(page + 1).catch(() => {})
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [meta, page, ensurePage])

  const go = useCallback(
    (n: number) => {
      if (!meta) return
      setPage(Math.min(Math.max(1, n), meta.page_count))
    },
    [meta],
  )

  // Keyboard paging.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(page + 1)
      else if (e.key === 'ArrowLeft') go(page - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, page])

  const transMap = useMemo(() => {
    const m = new Map<string, PageData['translations'][number]>()
    data?.translations.forEach((t) => m.set(t.id, t))
    return m
  }, [data])

  function handleSourceMouseUp(block: Block) {
    const s = window.getSelection()
    const text = s?.toString().trim() ?? ''
    if (!text || s!.rangeCount === 0) {
      setSel(null)
      return
    }
    const rect = s!.getRangeAt(0).getBoundingClientRect()
    setSel({ x: rect.left + rect.width / 2, y: rect.top, text, context: block.text })
  }

  async function runExplain(kind: 'grammar' | 'idiom') {
    if (!sel) return
    const { x, y, text, context } = sel
    setSel(null)
    setPopover({ x, y, title: kind === 'idiom' ? 'Idiom' : 'Grammar', loading: true })
    try {
      const ex = await explain(text, context, kind)
      setPopover((p) => p && { ...p, loading: false, content: ex.text })
    } catch {
      setPopover((p) => p && { ...p, loading: false, content: 'Could not load explanation.' })
    }
  }

  async function handleAlternatives(block: Block, anchor: { x: number; y: number }) {
    setPopover({ ...anchor, title: 'Other translations', loading: true })
    try {
      const alts = await alternatives(block.text, block.text)
      setPopover(
        (p) => p && { ...p, loading: false, content: <AlternativesList items={alts} /> },
      )
    } catch {
      setPopover((p) => p && { ...p, loading: false, content: 'Could not load options.' })
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center">
        <p className="text-red-700">{error}</p>
        <Link to="/" className="mt-4 inline-block text-stone-600 underline">
          Back to library
        </Link>
      </div>
    )
  }

  return (
    <div className="min-h-full">
      {/* Toolbar */}
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-stone-50/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
          <Link to="/" className="text-stone-500 hover:text-stone-800" title="Library">
            ←
          </Link>
          <span className="truncate font-serif text-lg font-semibold">{meta?.title ?? '…'}</span>

          {meta && meta.toc.length > 0 && (
            <select
              className="ml-2 max-w-[10rem] truncate rounded border border-stone-300 bg-white px-2 py-1 text-sm"
              value=""
              onChange={(e) => e.target.value && go(Number(e.target.value))}
            >
              <option value="">Chapters…</option>
              {meta.toc.map((t, i) => (
                <option key={i} value={t.page}>
                  {t.title}
                </option>
              ))}
            </select>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setBlurEnabled((b) => !b)}
              className={`rounded px-2.5 py-1 text-sm ${
                blurEnabled
                  ? 'bg-stone-800 text-white'
                  : 'border border-stone-300 text-stone-600'
              }`}
              title="Blur the translation to avoid peeking"
            >
              {blurEnabled ? 'Blur on' : 'Blur off'}
            </button>
            <div className="flex items-center gap-1 text-sm text-stone-600">
              <button
                onClick={() => go(page - 1)}
                disabled={page <= 1}
                className="rounded px-2 py-1 hover:bg-stone-200 disabled:opacity-30"
              >
                ‹
              </button>
              <span className="tabular-nums">
                {page} / {meta?.page_count ?? '…'}
              </span>
              <button
                onClick={() => go(page + 1)}
                disabled={!!meta && page >= meta.page_count}
                className="rounded px-2 py-1 hover:bg-stone-200 disabled:opacity-30"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Page body — styled as an open book resting on a desk */}
      <main className="reader-desk min-h-full px-3 py-6 md:px-6 md:py-10">
        <div className="book-surface mx-auto max-w-5xl px-6 py-8 md:px-12 md:py-12">
          {/* running heads */}
          <div className="mb-5 hidden grid-cols-2 gap-x-16 border-b border-stone-300/60 pb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-400 md:grid">
            <div>{meta?.source_lang ?? 'Original'}</div>
            <div>{meta?.target_lang ?? 'Translation'}</div>
          </div>

          {loading ? (
            <div className="py-20">
              <Spinner label="Translating this page…" />
              <p className="mt-2 text-sm text-stone-400">
                First visit to a page runs the model; it’s cached after that.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2 md:gap-x-16">
              {data?.blocks.map((b) => (
                <BlockRow
                  key={b.id}
                  block={b}
                  translation={transMap.get(b.id)}
                  blurEnabled={blurEnabled}
                  hovered={hoveredId === b.id}
                  onHover={setHoveredId}
                  onSourceMouseUp={handleSourceMouseUp}
                  onAlternatives={handleAlternatives}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Subtle page-turn buttons flanking the book (desktop) */}
      <button
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="fixed left-2 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-stone-300/70 bg-white/70 text-2xl text-stone-500 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-800 disabled:pointer-events-none disabled:opacity-0 md:flex lg:left-6"
      >
        ‹
      </button>
      <button
        onClick={() => go(page + 1)}
        disabled={!!meta && page >= meta.page_count}
        aria-label="Next page"
        className="fixed right-2 top-1/2 z-20 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-stone-300/70 bg-white/70 text-2xl text-stone-500 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-800 disabled:pointer-events-none disabled:opacity-0 md:flex lg:right-6"
      >
        ›
      </button>

      {sel && (
        <SelectionMenu
          sel={sel}
          onGrammar={() => runExplain('grammar')}
          onIdiom={() => runExplain('idiom')}
        />
      )}

      {popover && (
        <InfoPopover
          x={popover.x}
          y={popover.y}
          title={popover.title}
          onClose={() => setPopover(null)}
        >
          {popover.loading ? <Spinner label="Thinking…" /> : popover.content}
        </InfoPopover>
      )}
    </div>
  )
}

function AlternativesList({ items }: { items: Alternative[] }) {
  if (items.length === 0) return <span className="text-stone-500">No alternatives.</span>
  return (
    <ul className="space-y-2">
      {items.map((a, i) => (
        <li key={i} className="border-l-2 border-stone-200 pl-3">
          <div>{a.text}</div>
          {a.note && <div className="mt-0.5 text-xs text-stone-500">{a.note}</div>}
        </li>
      ))}
    </ul>
  )
}
