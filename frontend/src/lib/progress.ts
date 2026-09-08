// Per-reader reading position (bookmark).
//
// The shape of these calls has not changed — they are still synchronous — but
// they now read and write the mirror rather than localStorage, so a bookmark
// set on the tablet shows up on the phone.

import { putProgress, readerState } from './readerStore'

export function getProgress(readerId: string, bookId: string): number {
  return readerState(readerId).progress[bookId]?.page ?? 1
}

export function saveProgress(readerId: string, bookId: string, page: number): void {
  putProgress(readerId, bookId, page)
}

export interface ProgressItem {
  bookId: string
  page: number
  at: number
}

export function listProgress(readerId: string): ProgressItem[] {
  return Object.values(readerState(readerId).progress).map((p) => ({
    bookId: p.book_id,
    page: p.page,
    at: Date.parse(p.updated_at) || 0,
  }))
}
