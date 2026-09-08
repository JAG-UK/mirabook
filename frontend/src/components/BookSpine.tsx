import { BookMeta } from '../api/client'
import { DownloadInfo, DownloadProgress, formatBytes } from '../lib/offline'

// Muted book-cloth colours; chosen deterministically per book so a given book
// always looks the same on the shelf.
const SPINE_COLORS = [
  '#7d2b2b', '#2f4f3e', '#274472', '#8a6d1f', '#5b2a4a',
  '#356470', '#6b4423', '#3a3f5a', '#704214', '#4a5d23',
]

function hash(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
export const spineColor = (id: string) => SPINE_COLORS[hash(id) % SPINE_COLORS.length]
export const spineHeight = (id: string) => 196 + (hash(id + 'h') % 52) // 196–247px
export const spineWidth = (id: string) => 50 + (hash(id + 'w') % 18) // 50–67px

interface Props {
  book: BookMeta
  available: boolean
  savedPage?: number
  download?: DownloadInfo
  progress?: DownloadProgress
  reachable: boolean
  onOpen: (book: BookMeta) => void
  onDownload: (book: BookMeta) => void
  onRemoveDownload: (book: BookMeta) => void
  onRemove: (book: BookMeta) => void
  onEdit: (book: BookMeta) => void
}

export default function BookSpine({
  book,
  available,
  savedPage,
  download,
  progress,
  reachable,
  onOpen,
  onDownload,
  onRemoveDownload,
  onRemove,
  onEdit,
}: Props) {
  const bookmarked = !!savedPage && savedPage > 1
  const byline = book.author ? ` — ${book.author}` : ''
  const title = !available
    ? `${book.title} — not available offline`
    : bookmarked
      ? `${book.title}${byline} — resume on page ${savedPage} of ${book.page_count}`
      : `${book.title}${byline} — ${book.source_lang} → ${book.target_lang}, ${book.page_count} pages`

  return (
    <div
      className="spine-wrap"
      style={{ height: spineHeight(book.id), opacity: available ? 1 : 0.32 }}
    >
      <button
        className="spine"
        style={{ background: spineColor(book.id), width: spineWidth(book.id) }}
        onClick={() => available && onOpen(book)}
        disabled={!available}
        title={title}
      >
        {bookmarked && <span className="bookmark-ribbon" />}
        <span className="spine-title">{book.title}</span>
      </button>

      {reachable && (
        <button
          className="spine-edit"
          onClick={(e) => {
            e.stopPropagation()
            onEdit(book)
          }}
          title="Edit title, author and shelf"
          aria-label={`Edit ${book.title}`}
        >
          ✎
        </button>
      )}

      {reachable && (
        <button
          className="spine-remove"
          onClick={(e) => {
            e.stopPropagation()
            onRemove(book)
          }}
          title="Remove from library"
          aria-label={`Remove ${book.title} from library`}
        >
          ✕
        </button>
      )}

      <div className="spine-foot" onClick={(e) => e.stopPropagation()}>
        {progress ? (
          <span title={progress.label}>
            {Math.round((progress.done / Math.max(1, progress.total)) * 100)}%
          </span>
        ) : download ? (
          <button
            className="done"
            onClick={() => onRemoveDownload(book)}
            title={`Downloaded (${formatBytes(download.bytes)}) — click to remove`}
          >
            ✓
          </button>
        ) : reachable ? (
          <button onClick={() => onDownload(book)} title="Download for offline">
            ⤓
          </button>
        ) : null}
      </div>
    </div>
  )
}
