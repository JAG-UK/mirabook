// Per-reader saved words and phrases.

import { SavedWord } from '../api/client'
import { deleteWord, liveWords, newId, nowIso, putWord } from './readerStore'

export type { SavedWord }

/** What the reader hands over when saving; the rest is filled in here. */
export interface NewWord {
  text: string
  context: string
  kind: string
  explanation: string
  gloss?: string | null
  bookId: string
  bookTitle: string
}

export function listWords(readerId: string): SavedWord[] {
  return liveWords(readerId).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function addWord(readerId: string, w: NewWord): SavedWord {
  const word: SavedWord = {
    id: newId(),
    text: w.text,
    context: w.context,
    kind: w.kind,
    explanation: w.explanation,
    gloss: w.gloss ?? null,
    book_id: w.bookId,
    book_title: w.bookTitle,
    created_at: nowIso(),
    // Never reviewed, so due immediately — the review screen paces the
    // backlog rather than the data pretending it is spread out.
    due_at: nowIso(),
    interval_days: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
  }
  putWord(readerId, word)
  return word
}

export function removeWord(readerId: string, id: string): void {
  deleteWord(readerId, id)
}

export function countWords(readerId: string): number {
  return liveWords(readerId).length
}
