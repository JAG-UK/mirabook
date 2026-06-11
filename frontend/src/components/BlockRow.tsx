import { Block, TranslatedBlock, mediaUrl } from '../api/client'

const headingClass = (level?: number | null) => {
  switch (level) {
    case 1:
      return 'font-serif text-2xl font-bold'
    case 2:
      return 'font-serif text-xl font-bold'
    default:
      return 'font-serif text-lg font-semibold'
  }
}

interface Props {
  block: Block
  translation?: TranslatedBlock
  blurEnabled: boolean
  hovered: boolean
  onHover: (id: string | null) => void
  onSourceMouseUp: (block: Block) => void
  onAlternatives: (block: Block, anchor: { x: number; y: number }) => void
}

export default function BlockRow({
  block,
  translation,
  blurEnabled,
  hovered,
  onHover,
  onSourceMouseUp,
  onAlternatives,
}: Props) {
  // Images are shared between languages — render once, spanning both columns.
  if (block.type === 'image' && block.src) {
    return (
      <figure className="my-4 md:col-span-2">
        <img
          src={mediaUrl(block.src)}
          alt=""
          className="mx-auto max-h-[60vh] rounded-md border border-stone-200 shadow-sm"
        />
      </figure>
    )
  }

  const isHeading = block.type === 'heading'
  const hl = hovered ? 'bg-amber-100/70' : ''
  const enter = () => onHover(block.id)
  const leave = () => onHover(null)

  // Source cell (selectable, original language)
  const source = (
    <div
      onMouseEnter={enter}
      onMouseLeave={leave}
      onMouseUp={() => onSourceMouseUp(block)}
      className={`cursor-text select-text rounded px-2 py-1 transition-colors ${hl} ${
        isHeading ? `${headingClass(block.level)} mt-4` : 'font-serif leading-relaxed'
      }`}
    >
      {block.text}
    </div>
  )

  // Translation cell: blurred by default (headings included), revealed while
  // the pointer is anywhere over the cell.
  const blurred = blurEnabled
  const translation_cell = (
    <div
      onMouseEnter={enter}
      onMouseLeave={leave}
      className={`reveal-cell group relative rounded px-2 py-1 transition-colors ${hl} ${
        isHeading
          ? `${headingClass(block.level)} mt-4 text-stone-700`
          : 'leading-relaxed text-stone-700'
      }`}
    >
      <span
        className={blurred ? 'blur-cheat' : ''}
        title={blurred ? 'Hover to reveal' : undefined}
      >
        {translation ? translation.text : <span className="text-stone-300">…</span>}
      </span>
      {!isHeading && translation && (
        <button
          onClick={(e) =>
            onAlternatives(block, { x: e.clientX, y: e.clientY })
          }
          className="absolute -right-1 top-1 hidden rounded px-1 text-xs text-stone-400 hover:text-stone-700 group-hover:block"
          title="Other translation options"
        >
          ⋯
        </button>
      )}
    </div>
  )

  return (
    <>
      {source}
      {translation_cell}
    </>
  )
}
