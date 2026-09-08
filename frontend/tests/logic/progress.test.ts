import { describe, expect, it } from 'vitest'
import { getProgress, listProgress, saveProgress } from '../../src/lib/progress'
import { addWord, countWords, listWords, removeWord } from '../../src/lib/vocab'

const JON = 'profile-jon'
const ANA = 'profile-ana'

describe('reading progress', () => {
  it('starts every book on page 1', () => {
    expect(getProgress(JON, 'book-1')).toBe(1)
  })

  it('remembers where a reader got to', () => {
    saveProgress(JON, 'book-1', 42)
    expect(getProgress(JON, 'book-1')).toBe(42)
  })

  it('keeps a bookmark per book', () => {
    saveProgress(JON, 'book-1', 42)
    saveProgress(JON, 'book-2', 7)
    expect(getProgress(JON, 'book-1')).toBe(42)
    expect(getProgress(JON, 'book-2')).toBe(7)
  })

  it('keeps a bookmark per reader', () => {
    saveProgress(JON, 'book-1', 42)
    saveProgress(ANA, 'book-1', 3)
    expect(getProgress(JON, 'book-1')).toBe(42)
    expect(getProgress(ANA, 'book-1')).toBe(3)
  })

  it('moves the bookmark rather than adding a second one', () => {
    saveProgress(JON, 'book-1', 42)
    saveProgress(JON, 'book-1', 43)
    expect(listProgress(JON)).toHaveLength(1)
    expect(getProgress(JON, 'book-1')).toBe(43)
  })

  it('lists what a reader has open, with a timestamp to sort by', () => {
    saveProgress(JON, 'book-1', 42)
    saveProgress(JON, 'book-2', 7)
    const items = listProgress(JON)
    expect(items.map((i) => i.bookId).sort()).toEqual(['book-1', 'book-2'])
    expect(items.every((i) => typeof i.at === 'number' && i.at > 0)).toBe(true)
  })

  it('reports nothing for a reader who has not started', () => {
    expect(listProgress('nobody')).toEqual([])
  })

  it('recovers from corrupt storage', () => {
    localStorage.setItem('mirabook:progress', '{{{')
    expect(getProgress(JON, 'book-1')).toBe(1)
    saveProgress(JON, 'book-1', 5)
    expect(getProgress(JON, 'book-1')).toBe(5)
  })
})

describe('saved words', () => {
  const entry = {
    text: 'no se ande con rodeos',
    context: 'Le rogué que no se ande con rodeos.',
    kind: 'idiom',
    explanation: 'Means: do not be indirect.',
    bookId: 'book-1',
    bookTitle: 'Don Quijote',
  }

  it('saves a word and gives it an id', () => {
    const saved = addWord(JON, entry)
    expect(saved.id).toBeTruthy()
    expect(saved.text).toBe(entry.text)
    expect(listWords(JON)).toHaveLength(1)
  })

  it('lists newest first', () => {
    const first = addWord(JON, entry)
    const second = addWord(JON, { ...entry, text: 'de la Mancha' })
    // Saves within the same millisecond would tie, so nudge the first back.
    const store = JSON.parse(localStorage.getItem('mirabook:vocab')!)
    store[JON] = store[JON].map((w: { id: string; at: number }) =>
      w.id === first.id ? { ...w, at: w.at - 1000 } : w,
    )
    localStorage.setItem('mirabook:vocab', JSON.stringify(store))

    expect(listWords(JON).map((w) => w.id)).toEqual([second.id, first.id])
  })

  it('keeps each reader’s words to themselves', () => {
    addWord(JON, entry)
    expect(listWords(ANA)).toEqual([])
    expect(countWords(ANA)).toBe(0)
    expect(countWords(JON)).toBe(1)
  })

  it('removes a word without touching the others', () => {
    const doomed = addWord(JON, entry)
    addWord(JON, { ...entry, text: 'de la Mancha' })
    removeWord(JON, doomed.id)
    expect(listWords(JON).map((w) => w.text)).toEqual(['de la Mancha'])
  })

  it('removing an unknown id is harmless', () => {
    addWord(JON, entry)
    removeWord(JON, 'no-such-id')
    expect(countWords(JON)).toBe(1)
  })
})
