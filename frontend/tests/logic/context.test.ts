import { describe, expect, it } from 'vitest'
import { sentenceAround } from '../../src/lib/context'

describe('sentenceAround', () => {
  it('picks out the sentence the phrase sits in', () => {
    const block = 'Capítulo primero. Que trata de la condición del hidalgo. Y más cosas.'
    expect(sentenceAround(block, 'la condición')).toBe('Que trata de la condición del hidalgo.')
  })

  it('drops everything before and after it', () => {
    // A front page ingested as one block: blurb, then publication details.
    const block =
      'Primera frase larga sobre el libro. En esa escuela aprenderá encantamientos. ' +
      'Copyright 1999. ISBN 84-7888-445-9. Impreso en España.'
    const out = sentenceAround(block, 'aprenderá encantamientos')

    expect(out).toBe('En esa escuela aprenderá encantamientos.')
    expect(out).not.toMatch(/Copyright|ISBN|Impreso/)
  })

  it('keeps a short block exactly as it is', () => {
    expect(sentenceAround('En un lugar de la Mancha.', 'lugar')).toBe('En un lugar de la Mancha.')
  })

  it('collapses the whitespace a PDF leaves behind', () => {
    expect(sentenceAround('En   un  lugar\n de la\tMancha.', 'lugar')).toBe(
      'En un lugar de la Mancha.',
    )
  })

  it('handles a phrase at the very start', () => {
    expect(sentenceAround('Que trata del hidalgo. Y luego más.', 'Que trata')).toBe(
      'Que trata del hidalgo.',
    )
  })

  it('handles a phrase in the final sentence, unterminated', () => {
    expect(sentenceAround('Primera. Segunda sin punto final', 'Segunda')).toBe(
      'Segunda sin punto final',
    )
  })

  it('starts a sentence after an inverted mark', () => {
    expect(sentenceAround('Dijo algo. ¿Qué quieres decir? Nada más.', 'quieres')).toBe(
      'Qué quieres decir?',
    )
  })

  it('matches regardless of case', () => {
    expect(sentenceAround('Uno. EN UN LUGAR de la Mancha. Tres.', 'en un lugar')).toBe(
      'EN UN LUGAR de la Mancha.',
    )
  })

  it('falls back to a window when there is no punctuation at all', () => {
    const runOn = `${'palabra '.repeat(80)}aguja ${'palabra '.repeat(80)}`
    const out = sentenceAround(runOn, 'aguja')

    expect(out.length).toBeLessThanOrEqual(322)
    expect(out).toContain('aguja')
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('falls back to the opening when the phrase is not in the text', () => {
    const out = sentenceAround('Una frase corta.', 'no está aquí')
    expect(out).toBe('Una frase corta.')
  })

  it('truncates a very long text the phrase is missing from', () => {
    const long = 'palabra '.repeat(200)
    const out = sentenceAround(long, 'ausente')
    expect(out.length).toBeLessThanOrEqual(321)
    expect(out.endsWith('…')).toBe(true)
  })

  it('copes with empty input', () => {
    expect(sentenceAround('', 'algo')).toBe('')
    expect(sentenceAround('   ', 'algo')).toBe('')
    expect(sentenceAround('Una frase.', '')).toBe('Una frase.')
  })

  it('respects a caller-supplied limit', () => {
    const runOn = 'palabra '.repeat(100)
    expect(sentenceAround(runOn, 'ausente', 50).length).toBeLessThanOrEqual(51)
  })
})
