import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Alternative,
  Block,
  BookMeta,
  PageData,
  alternatives,
  explain,
  getBook,
  getPage,
  mediaUrl,
} from '../api/client'
import BlockRow from '../components/BlockRow'
import ChapterDrawer from '../components/ChapterDrawer'
import InfoPopover from '../components/InfoPopover'
import ProfileMenu from '../components/ProfileMenu'
import SelectionMenu, { SelectionState } from '../components/SelectionMenu'
import Spinner from '../components/Spinner'
import { sentenceAround } from '../lib/context'
import { getProgress, saveProgress } from '../lib/progress'
import { useProfile } from '../lib/profiles'
import { OfflineBook, getOfflineBook } from '../lib/offline'
import { addWord } from '../lib/vocab'

interface PopoverState {
  x: number
  y: number
  title: string
  loading: boolean
  content?: ReactNode
}

export default function Reader() {
  const { bookId = '' } = useParams()
  const [params] = useSearchParams()
  const { active } = useProfile()
  const settings = active.settings
  const [meta, setMeta] = useState<BookMeta | null>(null)

  // Arriving with ?page= means something sent you here to look at one place —
  // a saved word, say. That is a peek, not a reading session: it must not
  // move a bookmark four hundred pages away.
  const asked = Number(params.get('page')) || null
  const [mode, setMode] = useState<'reading' | 'peek'>(asked ? 'peek' : 'reading')
  const peeking = mode === 'peek'
  const [page, setPage] = useState(() => asked ?? getProgress(active.id, bookId))
  const [dir, setDir] = useState<'next' | 'prev'>('next')
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [blurEnabled, setBlurEnabled] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [sel, setSel] = useState<SelectionState | null>(null)
  const [popover, setPopover] = useState<PopoverState | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [leafKey, setLeafKey] = useState(0) // bump to replay the page-turn leaf
  const firstPageRef = useRef(true)

  const cache = useRef<Map<number, PageData>>(new Map())
  const offlineRef = useRef<OfflineBook | undefined>(undefined)
  const offlineModeRef = useRef(false)
  const [servingOffline, setServingOffline] = useState(false)

  const goOffline = useCallback(() => {
    offlineModeRef.current = true
    setServingOffline(true)
  }, [])

  // Load metadata. If the backend is unreachable, fall back to a downloaded copy.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      offlineRef.current = await getOfflineBook(bookId)
      try {
        const m = await getBook(bookId)
        if (cancelled) return
        setMeta(m)
        setPage((p) => Math.min(Math.max(1, p), m.page_count))
      } catch (e) {
        if (cancelled) return
        const rec = offlineRef.current
        if (rec) {
          goOffline()
          setMeta(rec.meta)
          setPage((p) => Math.min(Math.max(1, p), rec.meta.page_count))
        } else {
          setError(String(e))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bookId, goOffline])

  // Remember the page (bookmark) for this profile whenever it changes —
  // unless this is a peek, where paging around to check context should leave
  // the reader's real place alone.
  useEffect(() => {
    if (meta && !peeking) saveProgress(active.id, bookId, page)
  }, [active.id, bookId, page, meta, peeking])

  // Replay the page-turn leaf on each turn (flip animation only).
  useEffect(() => {
    if (firstPageRef.current) {
      firstPageRef.current = false
      return
    }
    if (settings.animation === 'flip') setLeafKey((k) => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const localPage = (n: number): PageData =>
    offlineRef.current?.pages.find((p) => p.number === n) ?? {
      number: n,
      blocks: [],
      translations: [],
    }

  const ensurePage = useCallback(
    async (n: number): Promise<PageData> => {
      const hit = cache.current.get(n)
      if (hit) return hit
      if (offlineModeRef.current) {
        const pd = localPage(n)
        cache.current.set(n, pd)
        return pd
      }
      try {
        const d = await getPage(bookId, n)
        cache.current.set(n, d)
        return d
      } catch (e) {
        // Backend went away mid-session — serve from a downloaded copy if we have one.
        if (offlineRef.current) {
          goOffline()
          const pd = localPage(n)
          cache.current.set(n, pd)
          return pd
        }
        throw e
      }
    },
    [bookId, goOffline],
  )

  // When offline, resolve image src paths to cached blob URLs.
  const blobUrls = useMemo(() => {
    const m: Record<string, string> = {}
    if (servingOffline && offlineRef.current) {
      for (const [src, blob] of Object.entries(offlineRef.current.images)) {
        m[src] = URL.createObjectURL(blob)
      }
    }
    return m
  }, [servingOffline])
  useEffect(() => () => Object.values(blobUrls).forEach((u) => URL.revokeObjectURL(u)), [blobUrls])
  const imageSrc = useCallback((src: string) => blobUrls[src] ?? mediaUrl(src), [blobUrls])

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
        // Peeking is a glance, so there is no next page to warm — and warming
        // one costs the model a translation nobody asked for.
        if (!peeking && page < meta.page_count) ensurePage(page + 1).catch(() => {})
      })
      .catch((e) => {
        if (cancelled) return
        setError(String(e))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [meta, page, ensurePage, peeking])

  const go = useCallback(
    (n: number) => {
      if (!meta) return
      const target = Math.min(Math.max(1, n), meta.page_count)
      setPage((p) => {
        if (target !== p) setDir(target > p ? 'next' : 'prev')
        return target
      })
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

  // The chapter whose start is at or before the current page.
  const currentChapter = useMemo(() => {
    if (!meta?.toc?.length) return null
    let cur: string | null = null
    for (const t of meta.toc) {
      if (t.page <= page) cur = t.title
      else break
    }
    return cur
  }, [meta, page])

  // Blocks worth rendering; a page with none is genuinely blank.
  const renderable = useMemo(
    () => data?.blocks.filter((b) => b.type === 'image' || b.text.trim()) ?? [],
    [data],
  )

  function handleSourceMouseUp(block: Block) {
    if (offlineModeRef.current) return // explanations need the backend
    const s = window.getSelection()
    const text = s?.toString().trim() ?? ''
    if (!text || s!.rangeCount === 0) {
      setSel(null)
      return
    }
    const rect = s!.getRangeAt(0).getBoundingClientRect()
    // The block can be a whole title page; the model wants the sentence.
    const context = sentenceAround(block.text, text)
    setSel({ x: rect.left + rect.width / 2, y: rect.top, text, context })
  }

  async function runExplain(kind: 'grammar' | 'idiom') {
    if (!sel) return
    const { x, y, text, context } = sel
    setSel(null)
    setPopover({ x, y, title: kind === 'idiom' ? 'Idiom' : 'Grammar', loading: true })
    try {
      const ex = await explain(text, context, kind)
      const onSave = () =>
        addWord(active.id, {
          text,
          context,
          kind,
          explanation: ex.text,
          gloss: ex.gloss, // the answer side of the review card
          bookId,
          bookTitle: meta?.title ?? '',
          page, // so a review card can offer to show it in place
        })
      setPopover(
        (p) => p && { ...p, loading: false, content: <ExplainBody text={ex.text} onSave={onSave} /> },
      )
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

  // Slide/fade animate the whole content; flip uses a separate page-turn leaf
  // plus a delayed reveal so the new text only appears once the leaf passes
  // the centre of the book.
  const wrapperAnim =
    settings.animation === 'slide'
      ? `pt-slide-${dir}`
      : settings.animation === 'fade'
        ? 'pt-fade'
        : settings.animation === 'flip'
          ? 'pt-reveal'
          : ''

  return (
    <div className="reader-root min-h-full" data-theme={settings.theme} data-font={settings.font}>
      {/* Toolbar */}
      <header
        className="sticky top-0 z-20 border-b backdrop-blur"
        style={{ backgroundColor: 'var(--bar)', borderColor: 'var(--bar-border)' }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 sm:gap-3">
          <Link to="/" className="text-[color:var(--muted)] hover:opacity-80" title="Library">
            ←
          </Link>
          <span
            className="shrink-0 truncate text-lg font-semibold"
            style={{ fontFamily: 'var(--book-font)' }}
          >
            {meta?.title ?? '…'}
          </span>
          {meta && meta.toc.length > 0 && (
            <button
              onClick={() => setTocOpen(true)}
              className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-sm text-[color:var(--muted)] hover:bg-black/5"
              title="Chapters"
            >
              <span className="text-base leading-none">☰</span>
              <span className="hidden sm:inline">Chapters</span>
            </button>
          )}
          {servingOffline && (
            <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
              Offline
            </span>
          )}
          {currentChapter && (
            <span
              className="hidden min-w-0 truncate text-sm text-[color:var(--muted)] lg:inline"
              title={currentChapter}
            >
              — {currentChapter}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                // Switching to reading means "I am reading here now", so the
                // bookmark moves to this page rather than staying behind.
                if (peeking) saveProgress(active.id, bookId, page)
                setMode(peeking ? 'reading' : 'peek')
              }}
              className={`rounded px-2.5 py-1 text-sm ${
                peeking
                  ? 'bg-amber-100 text-amber-900'
                  : 'border border-stone-400 text-[color:var(--ink-soft)]'
              }`}
              title={
                peeking
                  ? 'Peeking — your place in the book is not being moved. Click to read from here.'
                  : 'Reading — your place is saved as you go. Click to peek without moving it.'
              }
            >
              {peeking ? 'Peeking' : 'Reading'}
            </button>
            <button
              onClick={() => setBlurEnabled((b) => !b)}
              className={`rounded px-2.5 py-1 text-sm ${
                blurEnabled
                  ? 'bg-stone-800 text-white'
                  : 'border border-stone-400 text-[color:var(--ink-soft)]'
              }`}
              title="Blur the translation to avoid peeking"
            >
              {blurEnabled ? 'Blur on' : 'Blur off'}
            </button>
            <div className="flex items-center gap-1 text-sm text-[color:var(--ink-soft)]">
              <button
                onClick={() => go(page - 1)}
                disabled={page <= 1}
                className="rounded px-2 py-1 hover:bg-black/5 disabled:opacity-30"
              >
                ‹
              </button>
              <span className="tabular-nums">
                {page} / {meta?.page_count ?? '…'}
              </span>
              <button
                onClick={() => go(page + 1)}
                disabled={!!meta && page >= meta.page_count}
                className="rounded px-2 py-1 hover:bg-black/5 disabled:opacity-30"
              >
                ›
              </button>
            </div>
            <ProfileMenu />
          </div>
        </div>
      </header>

      {/* Page body — styled as an open book resting on a desk */}
      <main className="reader-desk min-h-full px-3 py-6 md:px-6 md:py-10">
        <div className="book-surface mx-auto flex min-h-[60vh] max-w-5xl flex-col px-6 py-8 md:px-12 md:py-12">
          {/* running heads */}
          <div
            className="mb-5 hidden grid-cols-2 gap-x-16 border-b pb-2 text-[11px] font-semibold uppercase tracking-widest text-[color:var(--muted)] md:grid"
            style={{ borderColor: 'var(--bar-border)' }}
          >
            <div>{meta?.source_lang ?? 'Original'}</div>
            <div>{meta?.target_lang ?? 'Translation'}</div>
          </div>

          {/* a single page-leaf that sweeps from the spine (flip animation) */}
          {settings.animation === 'flip' && leafKey > 0 && (
            <div key={leafKey} className={`page-leaf ${dir === 'next' ? 'leaf-next' : 'leaf-prev'}`} aria-hidden />
          )}

          {/* keyed by page so each turn replays slide/fade */}
          <div key={page} className={`flex flex-1 flex-col ${wrapperAnim}`}>
            {loading ? (
              <div className="py-20">
                <Spinner label="Translating this page…" />
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  First visit to a page runs the model; it’s cached after that.
                </p>
              </div>
            ) : renderable.length === 0 ? (
              <div className="flex flex-1 items-center justify-center py-20 text-[color:var(--muted)]">
                <span className="italic">(blank page)</span>
              </div>
            ) : (
              <div
                className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2 md:gap-x-16"
                style={{ fontSize: `${settings.fontScale}rem`, lineHeight: settings.lineSpacing }}
              >
                {renderable.map((b) => (
                  <BlockRow
                    key={b.id}
                    block={b}
                    translation={transMap.get(b.id)}
                    blurEnabled={blurEnabled}
                    hovered={hoveredId === b.id}
                    onHover={setHoveredId}
                    onSourceMouseUp={handleSourceMouseUp}
                    onAlternatives={handleAlternatives}
                    imageSrc={imageSrc}
                  />
                ))}
              </div>
            )}
          </div>
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

      <ChapterDrawer
        open={tocOpen}
        toc={meta?.toc ?? []}
        currentPage={page}
        onSelect={(p) => go(p)}
        onClose={() => setTocOpen(false)}
      />

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

function ExplainBody({ text, onSave }: { text: string; onSave: () => void }) {
  const [saved, setSaved] = useState(false)
  return (
    <div>
      <div className="md">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      </div>
      <button
        onClick={() => {
          onSave()
          setSaved(true)
        }}
        disabled={saved}
        className="mt-3 rounded-md border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-100 disabled:opacity-60"
      >
        {saved ? 'Saved ✓' : '+ Save to words'}
      </button>
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
