// Spaced repetition: intervals, ease, and what a sitting is made of.
//
// `now` is always passed in, so a six-day interval is checked in a
// millisecond rather than a week.

import { describe, expect, it } from 'vitest'
import type { SavedWord } from '../../src/api/client'
import {
  buildSession,
  describeInterval,
  dueCount,
  gradeWord,
  isDue,
  isNew,
} from '../../src/lib/srs'

const NOW = new Date('2026-09-08T10:00:00.000Z')
const daysFrom = (from: Date, days: number) =>
  new Date(from.getTime() + days * 86_400_000).toISOString()

function word(over: Partial<SavedWord> = {}): SavedWord {
  return {
    id: 'w1',
    text: 'no se ande con rodeos',
    context: 'Le rogué que no se ande con rodeos.',
    kind: 'idiom',
    explanation: 'A fixed expression.',
    gloss: "don't beat about the bush",
    book_id: 'bk1',
    book_title: 'Don Quijote',
    created_at: '2026-09-01T10:00:00.000Z',
    due_at: '2026-09-01T10:00:00.000Z',
    interval_days: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    ...over,
  }
}

const daysUntil = (w: SavedWord) =>
  Math.round((Date.parse(w.due_at!) - NOW.getTime()) / 86_400_000)

describe('what counts as due', () => {
  it('treats a never-scheduled word as due', () => {
    expect(isDue(word({ due_at: null }), NOW)).toBe(true)
  })

  it('is due once the date has passed', () => {
    expect(isDue(word({ due_at: daysFrom(NOW, -1) }), NOW)).toBe(true)
  })

  it('is not due before then', () => {
    expect(isDue(word({ due_at: daysFrom(NOW, 3) }), NOW)).toBe(false)
  })

  it('never asks about a deleted word', () => {
    expect(isDue(word({ deleted_at: '2026-09-05T10:00:00Z' }), NOW)).toBe(false)
  })

  it('counts what is waiting', () => {
    const words = [word({ id: 'a' }), word({ id: 'b', due_at: daysFrom(NOW, 5) })]
    expect(dueCount(words, NOW)).toBe(1)
  })

  it('knows a word nobody has answered yet', () => {
    expect(isNew(word({ reps: 0 }))).toBe(true)
    expect(isNew(word({ reps: 1 }))).toBe(false)
  })
})

describe('answering "again"', () => {
  const failed = gradeWord(word({ reps: 4, interval_days: 30, ease: 2.5, lapses: 1 }), 'again', NOW)

  it('starts the word over', () => {
    expect(failed.reps).toBe(0)
    expect(failed.interval_days).toBe(0)
  })

  it('counts the lapse', () => {
    expect(failed.lapses).toBe(2)
  })

  it('makes the word a little harder in future', () => {
    expect(failed.ease).toBeCloseTo(2.3)
  })

  it('brings it round again straight away', () => {
    expect(Date.parse(failed.due_at!)).toBe(NOW.getTime())
  })

  it('will not drive ease below the floor', () => {
    let w = word({ ease: 1.4 })
    for (let i = 0; i < 5; i++) w = gradeWord(w, 'again', NOW)
    expect(w.ease).toBe(1.3)
  })
})

describe('answering "good"', () => {
  it('shows a new word again tomorrow', () => {
    expect(daysUntil(gradeWord(word(), 'good', NOW))).toBe(1)
  })

  it('then in six days', () => {
    expect(daysUntil(gradeWord(word({ reps: 1, interval_days: 1 }), 'good', NOW))).toBe(6)
  })

  it('then stretches by the ease factor', () => {
    const w = gradeWord(word({ reps: 2, interval_days: 6, ease: 2.5 }), 'good', NOW)
    expect(w.interval_days).toBe(15) // 6 × 2.5
    expect(daysUntil(w)).toBe(15)
  })

  it('leaves ease alone', () => {
    expect(gradeWord(word({ reps: 3, ease: 2.5 }), 'good', NOW).ease).toBe(2.5)
  })

  it('counts the repetition', () => {
    expect(gradeWord(word({ reps: 2 }), 'good', NOW).reps).toBe(3)
  })
})

describe('answering "easy"', () => {
  it('waits longer than "good" from the very first answer', () => {
    expect(daysUntil(gradeWord(word(), 'easy', NOW))).toBe(3)
    expect(daysUntil(gradeWord(word({ reps: 1, interval_days: 1 }), 'easy', NOW))).toBe(10)
  })

  it('stretches a mature interval further than "good" would', () => {
    const mature = word({ reps: 3, interval_days: 10, ease: 2.5 })
    const good = gradeWord(mature, 'good', NOW).interval_days
    const easy = gradeWord(mature, 'easy', NOW).interval_days
    expect(easy).toBeGreaterThan(good)
  })

  it('makes the word easier in future, up to a ceiling', () => {
    expect(gradeWord(word({ ease: 2.5 }), 'easy', NOW).ease).toBeCloseTo(2.65)
    expect(gradeWord(word({ ease: 3.0 }), 'easy', NOW).ease).toBe(3.0)
  })
})

describe('every answer', () => {
  it.each(['again', 'good', 'easy'] as const)('records when it happened (%s)', (grade) => {
    expect(gradeWord(word(), grade, NOW).reviewed_at).toBe(NOW.toISOString())
  })

  it.each(['again', 'good', 'easy'] as const)('leaves the word itself alone (%s)', (grade) => {
    const graded = gradeWord(word(), grade, NOW)
    expect(graded.text).toBe('no se ande con rodeos')
    expect(graded.gloss).toBe("don't beat about the bush")
    expect(graded.id).toBe('w1')
  })
})

describe('describeInterval', () => {
  it.each([
    [0, 'again shortly'],
    [1, 'tomorrow'],
    [6, 'in 6 days'],
    [30, 'in a month'],
    [90, 'in 3 months'],
  ])('renders %i days as "%s"', (days, expected) => {
    expect(describeInterval(days)).toBe(expected)
  })
})

describe('building a sitting', () => {
  const returning = (id: string, overdueDays: number) =>
    word({ id, reps: 2, interval_days: 6, due_at: daysFrom(NOW, -overdueDays) })
  const fresh = (id: string, created: string) =>
    word({ id, reps: 0, created_at: created, due_at: created })

  it('offers nothing when nothing is due', () => {
    expect(buildSession([word({ due_at: daysFrom(NOW, 3) })], NOW)).toEqual([])
  })

  it('puts words already in rotation before new ones', () => {
    const session = buildSession([fresh('new', '2026-08-01T10:00:00Z'), returning('old', 1)], NOW)
    expect(session.map((w) => w.id)).toEqual(['old', 'new'])
  })

  it('takes the most overdue first', () => {
    const session = buildSession([returning('a', 1), returning('b', 9), returning('c', 4)], NOW)
    expect(session.map((w) => w.id)).toEqual(['b', 'c', 'a'])
  })

  it('takes the oldest new words first', () => {
    const session = buildSession(
      [fresh('recent', '2026-09-05T10:00:00Z'), fresh('ancient', '2026-01-01T10:00:00Z')],
      NOW,
    )
    expect(session.map((w) => w.id)).toEqual(['ancient', 'recent'])
  })

  it('caps how many new words a first sitting can contain', () => {
    // Saving two hundred phrases must not produce a two-hundred-card session.
    const many = Array.from({ length: 50 }, (_, i) =>
      fresh(`n${i}`, `2026-08-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
    )
    expect(buildSession(many, NOW, { newMax: 10 })).toHaveLength(10)
  })

  it('caps the sitting overall', () => {
    const many = Array.from({ length: 40 }, (_, i) => returning(`r${i}`, i + 1))
    expect(buildSession(many, NOW, { sessionMax: 20 })).toHaveLength(20)
  })

  it('never offers a deleted word', () => {
    expect(buildSession([word({ deleted_at: '2026-09-05T10:00:00Z' })], NOW)).toEqual([])
  })
})
