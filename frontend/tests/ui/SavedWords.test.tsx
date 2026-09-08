import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SavedWord } from '../../src/api/client'
import { ProfileProvider } from '../../src/lib/profiles'
import { putWord } from '../../src/lib/readerStore'
import { DEFAULT_SETTINGS } from '../../src/lib/types'
import Review from '../../src/pages/Review'
import SavedWords from '../../src/pages/SavedWords'

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
    text: 'aprenderá encantamientos',
    context: 'En esa escuela aprenderá encantamientos.',
    kind: 'grammar',
    explanation: 'Plain prose.',
    gloss: 'he will learn spells',
    book_id: 'bk1',
    book_title: 'Harry Potter',
    created_at: '2026-09-01T10:00:00.000Z',
    due_at: '2026-09-01T10:00:00.000Z',
    interval_days: 0,
    ease: 2.5,
    reps: 0,
    lapses: 0,
    ...over,
  }
}

function openWords(words: SavedWord[] = [word()]) {
  for (const w of words) putWord('p1', w)
  render(
    <MemoryRouter initialEntries={['/', '/words']}>
      <ProfileProvider>
        <Routes>
          <Route path="/" element={<p>the library</p>} />
          <Route path="/words" element={<SavedWords />} />
          <Route path="/review" element={<Review />} />
        </Routes>
      </ProfileProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

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

describe('the saved words list', () => {
  it('shows the phrase, its gloss and where it came from', async () => {
    openWords()
    expect(await screen.findByText('aprenderá encantamientos')).toBeInTheDocument()
    expect(screen.getByText('he will learn spells')).toBeInTheDocument()
    expect(screen.getByText('from Harry Potter')).toBeInTheDocument()
  })

  it('renders the explanation as prose, not raw markdown', async () => {
    // It arrives from the model as markdown; printed literally the reader sees
    // asterisks and stars instead of bold text and bullets.
    openWords([
      word({ explanation: 'The verb **aprenderá** is future tense.\n\n* one\n* two' }),
    ])
    const bold = await screen.findByText('aprenderá', { selector: 'strong' })

    expect(bold).toBeInTheDocument()
    // Each saved word is itself an <li>, so count only the ones the markdown
    // produced rather than every list item on the page.
    const bullets = document.querySelectorAll('.md li')
    expect([...bullets].map((b) => b.textContent)).toEqual(['one', 'two'])
    expect(screen.queryByText(/\*\*aprenderá\*\*/)).not.toBeInTheDocument()
  })

  it('quotes only the sentence, however much the block held', async () => {
    // A title page ingests as one block: blurb, then publication details.
    openWords([
      word({
        context:
          'Una larga descripción del libro. En esa escuela aprenderá encantamientos. ' +
          'Copyright 1999. ISBN 84-7888-445-9. Impreso en España.',
      }),
    ])

    expect(await screen.findByText(/En esa escuela aprenderá encantamientos/)).toBeInTheDocument()
    expect(screen.queryByText(/ISBN|Copyright|Impreso/)).not.toBeInTheDocument()
  })

  it('goes back to the library, not wherever you came from', async () => {
    const user = openWords()
    await screen.findByText('aprenderá encantamientos')
    await user.click(screen.getByRole('button', { name: /back to library/i }))
    expect(screen.getByText('the library')).toBeInTheDocument()
  })

  it('does not trap the reader between words and review', async () => {
    // Review's back is a push, so a Words back button that popped history
    // landed on Review again — an inescapable loop with the library buried.
    const user = openWords()
    await screen.findByText('aprenderá encantamientos')

    await user.click(screen.getByRole('button', { name: /^review/i }))
    await screen.findByRole('button', { name: /show answer/i })

    await user.click(screen.getByRole('button', { name: /back to saved words/i }))
    await screen.findByText('aprenderá encantamientos')

    await user.click(screen.getByRole('button', { name: /back to library/i }))
    expect(screen.getByText('the library')).toBeInTheDocument()
  })

  it('says what to do when nothing has been saved', async () => {
    openWords([])
    expect(await screen.findByText(/no saved words yet/i)).toBeInTheDocument()
  })

  it('offers a review once something is saved', async () => {
    openWords()
    expect(await screen.findByRole('button', { name: /review/i })).toBeInTheDocument()
  })
})
