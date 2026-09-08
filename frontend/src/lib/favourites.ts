// Per-reader favourite books.
//
// Favourites are a reader's own — the library is shared, the stars are not —
// so they travel with the reader between devices rather than staying on one.

import { liveFavourites, putFavourite } from './readerStore'

export function listFavourites(readerId: string): Set<string> {
  return new Set(liveFavourites(readerId))
}

/** Star or un-star a book. Returns the resulting set. */
export function toggleFavourite(readerId: string, bookId: string): Set<string> {
  const current = listFavourites(readerId)
  putFavourite(readerId, bookId, !current.has(bookId))
  return listFavourites(readerId)
}

/**
 * Forget a deleted book.
 *
 * This un-stars rather than erasing: the record has to survive as a tombstone
 * or another device will simply tell us about the favourite again.
 */
export function forgetFavourite(readerId: string, bookId: string): void {
  if (listFavourites(readerId).has(bookId)) putFavourite(readerId, bookId, false)
}
