import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedWord } from '../../src/api/client'
import { ProfileProvider } from '../../src/lib/profiles'
import { putWord } from '../../src/lib/readerStore'
import { DEFAULT_SETTINGS } from '../../src/lib/types'
import { listWords } from '../../src/lib/vocab'
import Review from '../../src/pages/Review'

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/client')>()),
  saveReaders: vi.fn(),
  syncReader: vi.fn(),
}))

const client = await import('../../src/api/client')
const READER = {
  id: 'p1',
  name: 'Jon',
  avatar: '📖',
  settings_json: JSON.stringify(DEFAULT_SETTINGS),
  updated_at: '2026-09-01T10:00:00Z',
  deleted_at: null,
}

function word(over: Partial<SavedWord> = {}): SavedWord {
  return {
    id: 'w1',
    text: 'no se ande con rodeos',
    context: 'Le rogué que no se ande con rodeos y me dijera la verdad.',
    kind: 'idiom',
    explanation: 'A fixed expression about being indirect.',
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

function openReview(words: SavedWord[] = [word()]) {
  for (const w of words) putWord('p1', w)
  render(
    <MemoryRouter initialEntries={['/review']}>
      <ProfileProvider>
        <Routes>
          <Route path="/review" element={<Review />} />
          <Route path="/words" element={<p>saved words</p>} />
        </Routes>
      </ProfileProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const reveal = () => screen.findByRole('button', { name: /show answer/i })

beforeEach(() => {
  localStorage.setItem('mirabook:migrated', '1')
  sessionStorage.setItem('mirabook:activeId', 'p1')
  vi.mocked(client.saveReaders).mockResolvedValue([READER])
  vi.mocked(client.syncReader).mockResolvedValue({
    now: 'T1',
    progress: [],
    favourites: [],
    words: [],
  })
})

describe('the card', () => {
  it('shows the phrase inside the sentence it came from', async () => {
    openReview()
    expect(await screen.findByText(/Le rogué que/)).toBeInTheDocument()
    expect(screen.getByText('no se ande con rodeos')).toBeInTheDocument()
    expect(screen.getByText(/y me dijera la verdad/)).toBeInTheDocument()
  })

  it('names the book it came from', async () => {
    openReview()
    expect(await screen.findByText('from Don Quijote')).toBeInTheDocument()
  })

  it('keeps the answer hidden until asked', async () => {
    openReview()
    await reveal()
    expect(screen.queryByText("don't beat about the bush")).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Good/ })).not.toBeInTheDocument()
  })

  it('shows the short answer first, with the explanation behind a disclosure', async () => {
    const user = openReview()
    await user.click(await reveal())

    expect(screen.getByText("don't beat about the bush")).toBeInTheDocument()
    expect(screen.getByText(/full explanation/i)).toBeInTheDocument()
  })

  it('says so when a word was saved before glosses existed', async () => {
    const user = openReview([word({ gloss: null })])
    await user.click(await reveal())
    expect(screen.getByText(/no short answer was saved/i)).toBeInTheDocument()
  })

  it('falls back to the phrase alone when the sentence does not contain it', async () => {
    // Saved from a heading, or the context was trimmed. Showing a sentence
    // the phrase is not in would be worse than showing no sentence.
    openReview([word({ context: 'Something else entirely.' })])
    expect(await screen.findByText('no se ande con rodeos')).toBeInTheDocument()
    expect(screen.queryByText(/Something else entirely/)).not.toBeInTheDocument()
  })

  it('counts through the sitting', async () => {
    openReview([word({ id: 'a' }), word({ id: 'b' })])
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()
  })
})

describe('answering', () => {
  it('moves on to the next card', async () => {
    const user = openReview([
      word({ id: 'a', text: 'primera', context: 'La primera frase.' }),
      word({ id: 'b', text: 'segunda', context: 'La segunda frase.' }),
    ])
    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Good/ }))

    expect(await screen.findByText('segunda')).toBeInTheDocument()
    expect(screen.getByText('2 of 2')).toBeInTheDocument()
  })

  it('saves the new schedule', async () => {
    const user = openReview()
    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Good/ }))

    const saved = listWords('p1')[0]
    expect(saved.reps).toBe(1)
    expect(saved.interval_days).toBe(1)
    expect(saved.reviewed_at).toBeTruthy()
  })

  it('records a lapse when the reader could not recall it', async () => {
    const user = openReview()
    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Again/ }))

    const saved = listWords('p1')[0]
    expect(saved.lapses).toBe(1)
    expect(saved.reps).toBe(0)
  })

  it('brings a failed word round once more in the same sitting', async () => {
    const user = openReview()
    expect(await screen.findByText('1 of 1')).toBeInTheDocument()

    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Again/ }))

    // Re-queued rather than gone.
    expect(await screen.findByText('2 of 2')).toBeInTheDocument()
    expect(screen.getByText('no se ande con rodeos')).toBeInTheDocument()
  })

  it('does not let one hard word hold the sitting open for ever', async () => {
    const user = openReview()
    for (let i = 0; i < 2; i++) {
      await user.click(await reveal())
      await user.click(screen.getByRole('button', { name: /^Again/ }))
    }
    // Failed twice, offered twice, then the sitting ends.
    expect(await screen.findByText(/done for now/i)).toBeInTheDocument()
  })

  it('hides the answer again on the next card', async () => {
    const user = openReview([word({ id: 'a' }), word({ id: 'b' })])
    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Good/ }))
    expect(await reveal()).toBeInTheDocument()
  })
})

describe('the keyboard', () => {
  it('reveals on space', async () => {
    const user = openReview()
    await reveal()
    await user.keyboard(' ')
    expect(await screen.findByText("don't beat about the bush")).toBeInTheDocument()
  })

  it('grades with 1, 2 and 3', async () => {
    const user = openReview()
    await user.click(await reveal())
    await user.keyboard('3') // easy

    expect(listWords('p1')[0].interval_days).toBe(3)
  })

  it('ignores a grade before the answer is showing', async () => {
    const user = openReview()
    await reveal()
    await user.keyboard('2')
    expect(listWords('p1')[0].reps).toBe(0)
    expect(await reveal()).toBeInTheDocument()
  })
})

describe('finishing', () => {
  it('sums up the sitting', async () => {
    const user = openReview()
    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Good/ }))

    expect(await screen.findByText(/done for now/i)).toBeInTheDocument()
    expect(screen.getByText(/1 answer/)).toBeInTheDocument()
  })

  it('offers a way back', async () => {
    const user = openReview()
    await user.click(await reveal())
    await user.click(screen.getByRole('button', { name: /^Good/ }))
    // The header arrow carries the same label, so match the button's own text.
    await user.click(await screen.findByText('Back to saved words'))
    expect(screen.getByText('saved words')).toBeInTheDocument()
  })

  it('says there is nothing to do when nothing is due', async () => {
    openReview([word({ due_at: '2099-01-01T10:00:00Z', reps: 3 })])
    expect(await screen.findByText(/nothing to review right now/i)).toBeInTheDocument()
  })
})
