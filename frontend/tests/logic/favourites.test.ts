import { describe, expect, it } from 'vitest'
import { forgetFavourite, listFavourites, toggleFavourite } from '../../src/lib/favourites'

const JON = 'profile-jon'
const ANA = 'profile-ana'

describe('favourites', () => {
  it('starts empty for a reader who has starred nothing', () => {
    expect(listFavourites(JON)).toEqual(new Set())
  })

  it('stars and un-stars a book', () => {
    expect(toggleFavourite(JON, 'book-1')).toEqual(new Set(['book-1']))
    expect(listFavourites(JON)).toEqual(new Set(['book-1']))

    expect(toggleFavourite(JON, 'book-1')).toEqual(new Set())
    expect(listFavourites(JON)).toEqual(new Set())
  })

  it('keeps several favourites at once', () => {
    toggleFavourite(JON, 'book-1')
    toggleFavourite(JON, 'book-2')
    expect(listFavourites(JON)).toEqual(new Set(['book-1', 'book-2']))
  })

  it('keeps each reader’s favourites to themselves', () => {
    // The whole design rests on this: the library is shared, the stars are not.
    toggleFavourite(JON, 'book-1')
    expect(listFavourites(ANA)).toEqual(new Set())

    toggleFavourite(ANA, 'book-2')
    expect(listFavourites(JON)).toEqual(new Set(['book-1']))
    expect(listFavourites(ANA)).toEqual(new Set(['book-2']))
  })

  it('un-starring one reader’s book leaves the other alone', () => {
    toggleFavourite(JON, 'book-1')
    toggleFavourite(ANA, 'book-1')
    toggleFavourite(JON, 'book-1')
    expect(listFavourites(JON)).toEqual(new Set())
    expect(listFavourites(ANA)).toEqual(new Set(['book-1']))
  })

  it('survives a reload', () => {
    toggleFavourite(JON, 'book-1')
    // A fresh read is what a page load does; nothing is held in memory.
    expect(listFavourites(JON)).toEqual(new Set(['book-1']))
  })

  it('forgets a deleted book so it cannot linger as a phantom', () => {
    toggleFavourite(JON, 'book-1')
    toggleFavourite(JON, 'book-2')
    forgetFavourite(JON, 'book-1')
    expect(listFavourites(JON)).toEqual(new Set(['book-2']))
  })

  it('forgetting something that was never starred is harmless', () => {
    toggleFavourite(JON, 'book-1')
    forgetFavourite(JON, 'never-starred')
    forgetFavourite('nobody', 'book-1')
    expect(listFavourites(JON)).toEqual(new Set(['book-1']))
  })

  it('recovers from corrupt storage instead of breaking the library', () => {
    localStorage.setItem('mirabook:favourites', 'not json{')
    expect(listFavourites(JON)).toEqual(new Set())
    expect(toggleFavourite(JON, 'book-1')).toEqual(new Set(['book-1']))
  })
})
