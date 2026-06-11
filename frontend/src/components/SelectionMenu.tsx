// Floating menu shown above a text selection in the source column.
export interface SelectionState {
  x: number
  y: number
  text: string
  context: string
}

export default function SelectionMenu({
  sel,
  onGrammar,
  onIdiom,
}: {
  sel: SelectionState
  onGrammar: () => void
  onIdiom: () => void
}) {
  return (
    <div
      className="fixed z-30 -translate-x-1/2 -translate-y-full"
      style={{ left: sel.x, top: sel.y - 8 }}
      // keep the browser selection alive when clicking a button
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex overflow-hidden rounded-lg border border-stone-700 bg-stone-800 text-sm text-white shadow-lg">
        <button className="px-3 py-2 hover:bg-stone-700" onClick={onGrammar}>
          Explain grammar
        </button>
        <span className="w-px bg-stone-600" />
        <button className="px-3 py-2 hover:bg-stone-700" onClick={onIdiom}>
          Explain idiom
        </button>
      </div>
      <div className="mx-auto h-2 w-2 -translate-y-1 rotate-45 bg-stone-800" />
    </div>
  )
}
