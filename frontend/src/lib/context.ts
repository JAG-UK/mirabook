// Narrowing a selection down to the sentence it sits in.
//
// A selection carries its whole block as context, and a block is whatever the
// ingest produced — often a paragraph, but on a title page or a back cover it
// can be the entire page run together, copyright notice and all. Handing that
// to the model as "the surrounding sentence" is poor input, and showing it on
// a review card buries the phrase completely.

const MAX_CHARS = 320
// Sentence terminators, plus the inverted marks that open one in Spanish.
const ENDS = /[.!?…]/
const OPENS = /[¡¿]/

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * The sentence containing `phrase`, out of a possibly much larger `text`.
 *
 * Falls back to a window around the phrase when the text has no sentence
 * breaks, and to the opening of the text when the phrase cannot be found at
 * all — better a plausible fragment than nothing.
 */
export function sentenceAround(text: string, phrase: string, maxChars = MAX_CHARS): string {
  const flat = flatten(text)
  const needle = flatten(phrase)
  if (!flat) return ''
  if (!needle) return clamp(flat, maxChars)

  const at = flat.toLowerCase().indexOf(needle.toLowerCase())
  if (at < 0) return clamp(flat, maxChars)

  let start = at
  while (start > 0 && !ENDS.test(flat[start - 1]) && !OPENS.test(flat[start - 1])) start--
  let end = at + needle.length
  while (end < flat.length && !ENDS.test(flat[end])) end++
  if (end < flat.length) end++ // keep the full stop

  const sentence = flat.slice(start, end).trim()
  // A sentence still too long to read — a run-on, or no punctuation at all —
  // gets a window centred on the phrase instead.
  if (sentence.length > maxChars) return window(flat, at, needle.length, maxChars)
  return sentence
}

function clamp(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars).trimEnd()}…`
}

function window(text: string, at: number, length: number, maxChars: number): string {
  const spare = Math.max(0, maxChars - length)
  const from = Math.max(0, at - Math.floor(spare / 2))
  const to = Math.min(text.length, from + maxChars)
  const head = from > 0 ? '…' : ''
  const tail = to < text.length ? '…' : ''
  return `${head}${text.slice(from, to).trim()}${tail}`
}
