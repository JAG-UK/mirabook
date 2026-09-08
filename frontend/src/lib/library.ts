// Pure helpers behind the library view: searching, shelving and paging.
//
// These live outside the component so they can be tested directly — they are
// the parts that fail quietly. A search that stops matching accented titles,
// or a grouping that drops a shelf, looks like an empty shelf rather than an
// error.

import { BookMeta, Shelf } from '../api/client'

export const UNSHELVED = 'Unshelved'

/** Strip case and accents, so "quijote" finds "Quijóte" and vice versa. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Does this book match the search box?
 *
 * Every whitespace-separated word must appear somewhere in the title or the
 * author, so "cervantes quijote" finds the book whichever order you type it.
 */
export function matchesBook(book: BookMeta, needle: string): boolean {
  if (!needle.trim()) return true
  const hay = fold(`${book.title} ${book.author ?? ''}`)
  return fold(needle)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

/** Split a list into rows of at most `size` — one wooden shelf per row. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface ShelfGroup {
  name: string
  books: BookMeta[]
}

/**
 * Group books onto their shelves, in the order the server gave.
 *
 * Shelf order is the backend's to decide (see `app/shelves.py`), so it is
 * passed in rather than assumed here. Shelves holding nothing are dropped;
 * books with no shelf collect under "Unshelved".
 */
export function groupByShelf(books: BookMeta[], shelves: Shelf[]): ShelfGroup[] {
  const bucket = new Map<string, BookMeta[]>()
  for (const book of books) {
    const name = book.shelf ?? UNSHELVED
    const list = bucket.get(name)
    list ? list.push(book) : bucket.set(name, [book])
  }

  const order = shelves.map((s) => s.name)
  const groups = order.filter((name) => bucket.has(name)).map((name) => ({
    name,
    books: bucket.get(name)!,
  }))
  // A shelf the server did not list still has to appear, or its books vanish
  // from the library with no way to reach them.
  for (const [name, list] of bucket) {
    if (!order.includes(name)) groups.push({ name, books: list })
  }
  return groups
}
