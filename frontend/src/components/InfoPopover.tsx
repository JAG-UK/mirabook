import { ReactNode } from 'react'

// A floating card anchored near a point, with a click-away backdrop.
export default function InfoPopover({
  x,
  y,
  title,
  onClose,
  children,
}: {
  x: number
  y: number
  title: string
  onClose: () => void
  children: ReactNode
}) {
  // Size the card generously but keep it on screen.
  const width = Math.min(460, window.innerWidth - 24)
  const maxH = Math.round(window.innerHeight * 0.7)
  const left = Math.min(Math.max(x - width / 2, 12), window.innerWidth - width - 12)
  // Open below the anchor, but lift it up if there isn't room.
  const top = Math.max(12, Math.min(y + 16, window.innerHeight - 12 - maxH))

  return (
    <>
      <div className="fixed inset-0 z-30" onMouseDown={onClose} />
      <div
        className="fixed z-40 flex flex-col rounded-xl border border-stone-200 bg-white shadow-xl"
        style={{ left, top, width, maxHeight: maxH }}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {title}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-[15px] leading-relaxed text-stone-800">
          {children}
        </div>
      </div>
    </>
  )
}
