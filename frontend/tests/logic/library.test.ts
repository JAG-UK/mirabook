import { describe, expect, it } from 'vitest'
import { BookMeta, Shelf } from '../../src/api/client'
import { UNSHELVED, chunk, fold, groupByShelf, matchesBook } from '../../src/lib/library'

function book(partial: Partial<BookMeta> & { id: string }): BookMeta {
  return {
    title: 'Untitled',
    source_lang: 'Spanish',
    target_lang: 'English',
    page_count: 10,
    toc: [],
    ...partial,
  }
}

const shelves = (...names: string[]): Shelf[] => names.map((name) => ({ name, count: 0 }))

describe('fold', () => {
  it('strips case and accents so either spelling finds the other', () => {
    expect(fold('Quijóte')).toBe('quijote')
    expect(fold('LA CRÍA DE CABRAS')).toBe('la cria de cabras')
    expect(fold('Peña')).toBe('pena')
  })

  it('leaves unaccented text alone', () => {
    expect(fold('Platero y yo')).toBe('platero y yo')
  })
})

describe('matchesBook', () => {
  const quijote = book({
    id: '1',
    title: 'Don Quijote de la Mancha',
    author: 'Cervantes Saavedra, Miguel de',
  })

  it('matches on the title', () => {
    expect(matchesBook(quijote, 'quijote')).toBe(true)
  })

  it('matches on the author', () => {
    expect(matchesBook(quijote, 'cervantes')).toBe(true)
  })

  it('ignores accents in either direction', () => {
    expect(matchesBook(book({ id: '2', title: 'La Cría de Cabras' }), 'cria')).toBe(true)
    expect(matchesBook(book({ id: '3', title: 'La Cria de Cabras' }), 'cría')).toBe(true)
  })

  it('requires every word, but in any order and across both fields', () => {
    expect(matchesBook(quijote, 'cervantes quijote')).toBe(true)
    expect(matchesBook(quijote, 'quijote cervantes')).toBe(true)
    expect(matchesBook(quijote, 'quijote unamuno')).toBe(false)
  })

  it('treats an empty or blank query as matching everything', () => {
    expect(matchesBook(quijote, '')).toBe(true)
    expect(matchesBook(quijote, '   ')).toBe(true)
  })

  it('copes with a book that has no author', () => {
    const anon = book({ id: '4', title: 'Lazarillo de Tormes', author: null })
    expect(matchesBook(anon, 'lazarillo')).toBe(true)
    expect(matchesBook(anon, 'cervantes')).toBe(false)
  })
})

describe('chunk', () => {
  it('splits into rows of at most the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns nothing for an empty list', () => {
    expect(chunk([], 12)).toEqual([])
  })

  it('keeps a short list as a single row', () => {
    expect(chunk([1, 2], 12)).toEqual([[1, 2]])
  })

  it('does not spin forever on a nonsense size', () => {
    expect(chunk([1, 2], 0)).toEqual([[1, 2]])
    expect(chunk([], 0)).toEqual([])
  })
})

describe('groupByShelf', () => {
  const books = [
    book({ id: '1', title: 'Novela A', shelf: 'Novels' }),
    book({ id: '2', title: 'Poema', shelf: 'Poetry' }),
    book({ id: '3', title: 'Novela B', shelf: 'Novels' }),
  ]

  it('groups books under their shelf', () => {
    const groups = groupByShelf(books, shelves('Novels', 'Poetry'))
    expect(groups.map((g) => g.name)).toEqual(['Novels', 'Poetry'])
    expect(groups[0].books.map((b) => b.id)).toEqual(['1', '3'])
  })

  it('follows the order the server gave, not insertion order', () => {
    const groups = groupByShelf(books, shelves('Poetry', 'Novels'))
    expect(groups.map((g) => g.name)).toEqual(['Poetry', 'Novels'])
  })

  it('drops shelves that hold nothing', () => {
    const groups = groupByShelf(books, shelves('Novels', 'History', 'Poetry'))
    expect(groups.map((g) => g.name)).toEqual(['Novels', 'Poetry'])
  })

  it('collects unshelved books under Unshelved', () => {
    const groups = groupByShelf([book({ id: '9', shelf: null })], shelves('Novels', UNSHELVED))
    expect(groups).toEqual([{ name: UNSHELVED, books: [expect.objectContaining({ id: '9' })] }])
  })

  it('still shows books on a shelf the server never listed', () => {
    // Otherwise a stale or renamed shelf silently swallows its books.
    const groups = groupByShelf([book({ id: '7', shelf: 'Letters' })], shelves('Novels'))
    expect(groups.map((g) => g.name)).toEqual(['Letters'])
  })

  it('returns nothing for an empty library', () => {
    expect(groupByShelf([], shelves('Novels'))).toEqual([])
  })
})
