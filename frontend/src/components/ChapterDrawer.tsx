import { TocEntry } from '../api/client'

export default function ChapterDrawer({
  open,
  toc,
  currentPage,
  onSelect,
  onClose,
}: {
  open: boolean
  toc: TocEntry[]
  currentPage: number
  onSelect: (page: number) => void
  onClose: () => void
}) {
  // The chapter whose start is at or before the current page is "current".
  let activeIdx = -1
  toc.forEach((t, i) => {
    if (t.page <= currentPage) activeIdx = i
  })

  return (
    <>
      {/* backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      {/* panel */}
      <aside
        className={`fixed left-0 top-0 z-50 flex h-full w-80 max-w-[80vw] flex-col border-r border-stone-200 bg-[#f8f4ea] shadow-2xl transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="font-serif text-lg font-semibold">Chapters</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
            aria-label="Close chapters"
          >
            ✕
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {toc.length === 0 ? (
            <p className="px-4 py-6 text-sm italic text-stone-400">
              No chapters detected for this book.
            </p>
          ) : (
            <ul>
              {toc.map((t, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      onSelect(t.page)
                      onClose()
                    }}
                    className={`flex w-full items-baseline gap-2 px-4 py-2 text-left text-sm hover:bg-stone-200/60 ${
                      i === activeIdx ? 'bg-stone-200/70 font-semibold' : ''
                    }`}
                    style={{ paddingLeft: 16 + (Math.max(1, t.level) - 1) * 14 }}
                  >
                    <span className="flex-1 font-serif leading-snug">{t.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-stone-400">{t.page}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
      </aside>
    </>
  )
}
