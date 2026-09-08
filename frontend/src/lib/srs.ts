// Spaced repetition over saved words.
//
// SM-2, reduced to three grades. Four gives slightly better signal; three is
// meaningfully less to think about at ten at night, which matters more for
// something you are meant to do daily.
//
// Nothing here touches storage or the clock unless told to — `now` is always
// passed in, so intervals are testable without waiting a week.

import { SavedWord } from '../api/client'

export type Grade = 'again' | 'good' | 'easy'

/** How many cards one sitting offers, and how many of those may be new. */
export const SESSION_MAX = 20
export const NEW_MAX = 10

const MIN_EASE = 1.3
const DAY_MS = 24 * 60 * 60 * 1000

const addDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY_MS)

/** A word that has never been answered. */
export const isNew = (w: SavedWord): boolean => w.reps === 0

export function isDue(w: SavedWord, now: Date = new Date()): boolean {
  if (w.deleted_at) return false
  if (!w.due_at) return true // saved before review existed, or never scheduled
  return Date.parse(w.due_at) <= now.getTime()
}

export const dueCount = (words: SavedWord[], now: Date = new Date()): number =>
  words.filter((w) => isDue(w, now)).length

/**
 * Apply an answer and reschedule.
 *
 * Again resets the run and costs ease, so a word you keep failing comes back
 * quickly and stays close. Good follows SM-2's 1 day, 6 days, then
 * interval × ease. Easy takes the same step and stretches it, rather than
 * skipping ahead — a word answered easily once is not necessarily learned.
 */
export function gradeWord(word: SavedWord, grade: Grade, now: Date = new Date()): SavedWord {
  const reviewed_at = now.toISOString()

  if (grade === 'again') {
    return {
      ...word,
      reps: 0,
      lapses: word.lapses + 1,
      ease: Math.max(MIN_EASE, word.ease - 0.2),
      interval_days: 0,
      // Due immediately: it comes round again in this same sitting.
      due_at: now.toISOString(),
      reviewed_at,
    }
  }

  const reps = word.reps + 1
  const ease =
    grade === 'easy' ? Math.min(3.0, word.ease + 0.15) : Math.max(MIN_EASE, word.ease)

  let interval: number
  if (reps === 1) interval = grade === 'easy' ? 3 : 1
  else if (reps === 2) interval = grade === 'easy' ? 10 : 6
  else interval = Math.round(Math.max(1, word.interval_days) * ease * (grade === 'easy' ? 1.3 : 1))

  return {
    ...word,
    reps,
    ease: Math.round(ease * 100) / 100,
    interval_days: interval,
    due_at: addDays(now, interval).toISOString(),
    reviewed_at,
  }
}

/** A plain-language "next in 6 days", for the end-of-session summary. */
export function describeInterval(days: number): string {
  if (days <= 0) return 'again shortly'
  if (days === 1) return 'tomorrow'
  if (days < 30) return `in ${days} days`
  const months = Math.round(days / 30)
  return months === 1 ? 'in a month' : `in ${months} months`
}

/**
 * Choose what to review now.
 *
 * Words already in rotation come first — those are the ones at risk of being
 * forgotten — and new words fill whatever room is left, capped so that saving
 * two hundred phrases does not produce a two-hundred-card first session
 * nobody comes back from.
 */
export function buildSession(
  words: SavedWord[],
  now: Date = new Date(),
  limits: { sessionMax?: number; newMax?: number } = {},
): SavedWord[] {
  const sessionMax = limits.sessionMax ?? SESSION_MAX
  const newMax = limits.newMax ?? NEW_MAX
  const due = words.filter((w) => isDue(w, now))

  const returning = due
    .filter((w) => !isNew(w))
    .sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))
  const fresh = due
    .filter(isNew)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, newMax)

  return [...returning, ...fresh].slice(0, sessionMax)
}
