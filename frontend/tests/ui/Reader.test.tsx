// The reader: the app's most intricate screen, and until now its least
// tested. Page cache, prefetch, bookmarks, keyboard paging and a fallback to a
// downloaded copy when the backend disappears mid-session.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMeta, PageData } from '../../src/api/client'
import { ProfileProvider } from '../../src/lib/profiles'
import { getProgress } from '../../src/lib/progress'
import { listWords } from '../../src/lib/vocab'
import { putProgress } from '../../src/lib/readerStore'
import { DEFAULT_SETTINGS } from '../../src/lib/types'
import Reader from '../../src/pages/Reader'

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/client')>()),
  getBook: vi.fn(),
  getPage: vi.fn(),
  explain: vi.fn(),
  alternatives: vi.fn(),
  mediaUrl: (src: string) => `http://backend${src}`,
  // The provider settles the reader list before it renders anything.
  saveReaders: vi.fn(),
  syncReader: vi.fn(),
}))
vi.mock('../../src/lib/offline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/offline')>()),
  getOfflineBook: vi.fn(),
}))

const client = await import('../../src/api/client')
const offline = await import('../../src/lib/offline')
const getBook = vi.mocked(client.getBook)
const getPage = vi.mocked(client.getPage)
const getOfflineBook = vi.mocked(offline.getOfflineBook)
const saveReaders = vi.mocked(client.saveReaders)
const syncReader = vi.mocked(client.syncReader)

const READER = {
  id: 'p1',
  name: 'Jon',
  avatar: '📖',
  settings_json: JSON.stringify(DEFAULT_SETTINGS),
  updated_at: '2026-09-01T10:00:00Z',
  deleted_at: null,
}

const PROFILE = { id: 'p1', name: 'Jon', avatar: '📖', settings: DEFAULT_SETTINGS }

const META: BookMeta = {
  id: 'bk1',
  title: 'Don Quijote',
  source_lang: 'Spanish',
  target_lang: 'English',
  page_count: 5,
  toc: [
    { title: 'Capítulo I', page: 1, level: 1 },
    { title: 'Capítulo II', page: 4, level: 1 },
  ],
}

/** A page whose text names its own number, so paging is easy to assert on. */
const pageData = (n: number): PageData => ({
  number: n,
  blocks: [{ id: `p${n}-b0`, page: n, order: 0, type: 'paragraph', text: `Página ${n} en español` }],
  translations: [{ id: `p${n}-b0`, text: `Page ${n} in English`, alternatives: [] }],
})

function openReader(search = '') {
  render(
    <MemoryRouter initialEntries={[`/read/bk1${search}`]}>
      <ProfileProvider>
        <Routes>
          <Route path="/read/:bookId" element={<Reader />} />
        </Routes>
      </ProfileProvider>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const onPage = (n: number) => screen.findByText(`Página ${n} en español`)

beforeEach(() => {
  // A reader already chosen on this device, as the picker would have left it.
  localStorage.setItem('mirabook:migrated', '1')
  sessionStorage.setItem('mirabook:activeId', PROFILE.id)
  saveReaders.mockResolvedValue([READER])
  syncReader.mockResolvedValue({ now: '2026-09-01T10:00:00Z', progress: [], favourites: [], words: [] })

  getBook.mockResolvedValue(META)
  getPage.mockImplementation(async (_id, n) => pageData(n))
  getOfflineBook.mockResolvedValue(undefined)
})

describe('opening a book', () => {
  it('shows the book, its first page and both languages side by side', async () => {
    openReader()
    expect(await onPage(1)).toBeInTheDocument()
    expect(screen.getByText('Page 1 in English')).toBeInTheDocument()
    expect(screen.getByText('Don Quijote')).toBeInTheDocument()
  })

  it('shows where you are in the book', async () => {
    openReader()
    await onPage(1)
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
  })

  it('resumes where this reader left off', async () => {
    putProgress('p1', 'bk1', 3)
    openReader()
    expect(await onPage(3)).toBeInTheDocument()
  })

  it('clamps a bookmark that is past the end of the book', async () => {
    // A book re-ingested shorter than it was should not open on nothing.
    putProgress('p1', 'bk1', 99)
    openReader()
    expect(await onPage(5)).toBeInTheDocument()
  })

  it('says so when a page is genuinely blank', async () => {
    getPage.mockImplementation(async (_id, n) => ({ number: n, blocks: [], translations: [] }))
    openReader()
    expect(await screen.findByText('(blank page)')).toBeInTheDocument()
  })
})

describe('turning pages', () => {
  it('goes forward and back with the toolbar', async () => {
    const user = openReader()
    await onPage(1)

    await user.click(screen.getAllByRole('button', { name: '›' })[0])
    expect(await onPage(2)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: '‹' })[0])
    expect(await onPage(1)).toBeInTheDocument()
  })

  it('goes forward and back with the arrow keys', async () => {
    const user = openReader()
    await onPage(1)

    await user.keyboard('{ArrowRight}')
    expect(await onPage(2)).toBeInTheDocument()

    await user.keyboard('{ArrowLeft}')
    expect(await onPage(1)).toBeInTheDocument()
  })

  it('will not go back past the first page', async () => {
    const user = openReader()
    await onPage(1)
    await user.keyboard('{ArrowLeft}')
    expect(await onPage(1)).toBeInTheDocument()
    expect(screen.getByText('1 / 5')).toBeInTheDocument()
  })

  it('will not go past the last page', async () => {
    putProgress('p1', 'bk1', 5)
    const user = openReader()
    await onPage(5)
    await user.keyboard('{ArrowRight}')
    expect(await onPage(5)).toBeInTheDocument()
    expect(screen.getByText('5 / 5')).toBeInTheDocument()
  })

  it('remembers the new page as the bookmark', async () => {
    const user = openReader()
    await onPage(1)
    await user.keyboard('{ArrowRight}')
    await onPage(2)

    await waitFor(() => expect(getProgress('p1', 'bk1')).toBe(2))
  })

  it('fetches each page once, however often you turn back to it', async () => {
    const user = openReader()
    await onPage(1)
    await user.keyboard('{ArrowRight}')
    await onPage(2)
    await user.keyboard('{ArrowLeft}')
    await onPage(1)

    const requested = getPage.mock.calls.map((c) => c[1])
    expect(requested.filter((n) => n === 1)).toHaveLength(1)
  })

  it('fetches the next page ahead of being asked for it', async () => {
    openReader()
    await onPage(1)
    // Page 2 is warmed while page 1 is on screen.
    await waitFor(() => expect(getPage.mock.calls.map((c) => c[1])).toContain(2))
  })

  it('does not prefetch past the end of the book', async () => {
    putProgress('p1', 'bk1', 5)
    openReader()
    await onPage(5)
    await waitFor(() => expect(getPage).toHaveBeenCalled())
    expect(getPage.mock.calls.map((c) => c[1])).not.toContain(6)
  })
})

describe('chapters', () => {
  it('jumps to a chapter', async () => {
    const user = openReader()
    await onPage(1)

    // The drawer's own "Close chapters" button also matches /chapters/i; the
    // toolbar's opener is the one carrying that title.
    await user.click(screen.getByTitle('Chapters'))
    const drawer = screen.getByRole('complementary')
    await user.click(within(drawer).getByRole('button', { name: /Capítulo II/ }))

    expect(await onPage(4)).toBeInTheDocument()
  })

  it('names the chapter you are currently in', async () => {
    const user = openReader()
    await onPage(1)
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    await onPage(4)
    expect(screen.getByTitle('Capítulo II')).toBeInTheDocument()
  })
})

describe('the anti-cheat blur', () => {
  it('starts on and can be turned off', async () => {
    const user = openReader()
    await onPage(1)

    expect(screen.getByRole('button', { name: 'Blur on' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Blur on' }))
    expect(screen.getByRole('button', { name: 'Blur off' })).toBeInTheDocument()
  })
})

describe('peeking', () => {
  const bookmarkedAt = (n: number) => putProgress('p1', 'bk1', n)

  it('opens at the page it was sent to, not the bookmark', async () => {
    bookmarkedAt(2)
    openReader('?page=4')
    expect(await onPage(4)).toBeInTheDocument()
  })

  it('says it is peeking', async () => {
    openReader('?page=4')
    await onPage(4)
    expect(screen.getByRole('button', { name: 'Peeking' })).toBeInTheDocument()
  })

  it('leaves the reader’s place alone', async () => {
    // The whole point: glancing at page 4 must not lose page 200.
    bookmarkedAt(200)
    openReader('?page=4')
    await onPage(4)
    expect(getProgress('p1', 'bk1')).toBe(200)
  })

  it('leaves it alone even when you page around to see the context', async () => {
    bookmarkedAt(200)
    const user = openReader('?page=4')
    await onPage(4)

    await user.keyboard('{ArrowRight}')
    await onPage(5)
    await user.keyboard('{ArrowLeft}')
    await onPage(4)

    expect(getProgress('p1', 'bk1')).toBe(200)
  })

  it('does not warm the next page for a glance', async () => {
    openReader('?page=4')
    await onPage(4)
    await waitFor(() => expect(getPage).toHaveBeenCalled())
    expect(getPage.mock.calls.map((c) => c[1])).not.toContain(5)
  })

  it('starts reading from here when the switch is flipped', async () => {
    bookmarkedAt(200)
    const user = openReader('?page=4')
    await onPage(4)

    await user.click(screen.getByRole('button', { name: 'Peeking' }))

    expect(screen.getByRole('button', { name: 'Reading' })).toBeInTheDocument()
    expect(getProgress('p1', 'bk1')).toBe(4)
  })

  it('can be entered deliberately from a normal reading session', async () => {
    bookmarkedAt(2)
    const user = openReader()
    await onPage(2)
    expect(screen.getByRole('button', { name: 'Reading' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reading' }))
    await user.keyboard('{ArrowRight}')
    await onPage(3)

    expect(getProgress('p1', 'bk1')).toBe(2) // still where it was
  })
})

describe('saving a phrase', () => {
  /**
   * Drive the drag-select path.
   *
   * jsdom has no real selection: getSelection() returns an object whose
   * toString() is always empty and whose ranges have no geometry, so the
   * reader's handler bails before the menu can appear. Standing in a selection
   * is the only way to exercise this from a test.
   */
  function selecting(phrase: string) {
    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => phrase,
      rangeCount: 1,
      getRangeAt: () => ({
        getBoundingClientRect: () => ({ left: 100, width: 40, top: 200 }),
      }),
    } as unknown as Selection)
  }

  it('keeps the gloss, which is what a review card asks first', async () => {
    vi.mocked(client.explain).mockResolvedValue({
      kind: 'idiom',
      text: 'A fixed expression meaning to be indirect.',
      gloss: "don't beat about the bush",
    })
    const user = openReader()
    const source = await onPage(1)

    selecting('Página 1')
    fireEvent.mouseUp(source)

    await user.click(await screen.findByRole('button', { name: /explain idiom/i }))
    await user.click(await screen.findByRole('button', { name: /save to words/i }))

    const saved = listWords('p1')
    expect(saved).toHaveLength(1)
    expect(saved[0].gloss).toBe("don't beat about the bush")
    expect(saved[0].text).toBe('Página 1')
    expect(saved[0].book_title).toBe('Don Quijote')
    expect(saved[0].page).toBe(1) // so the card can link back to it
  })

  it('saves a word even when the model offered no gloss', async () => {
    vi.mocked(client.explain).mockResolvedValue({ kind: 'grammar', text: 'A verb.', gloss: null })
    const user = openReader()
    const source = await onPage(1)

    selecting('Página 1')
    fireEvent.mouseUp(source)

    await user.click(await screen.findByRole('button', { name: /explain grammar/i }))
    await user.click(await screen.findByRole('button', { name: /save to words/i }))

    expect(listWords('p1')[0].gloss).toBeNull()
  })
})

describe('when the backend is unreachable', () => {
  const downloaded = {
    bookId: 'bk1',
    meta: META,
    pages: [pageData(1), pageData(2)],
    images: {},
    at: Date.now(),
    bytes: 1234,
  }

  it('reads from a downloaded copy, and says that it is doing so', async () => {
    getBook.mockRejectedValue(new Error('Failed to fetch'))
    getOfflineBook.mockResolvedValue(downloaded)

    openReader()
    expect(await onPage(1)).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(getPage).not.toHaveBeenCalled()
  })

  it('falls back mid-book when the backend goes away between pages', async () => {
    getOfflineBook.mockResolvedValue(downloaded)
    getPage.mockRejectedValue(new Error('Failed to fetch'))

    openReader()
    expect(await onPage(1)).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('reports the problem when there is no downloaded copy to fall back on', async () => {
    getBook.mockRejectedValue(new Error('Failed to fetch'))
    getOfflineBook.mockResolvedValue(undefined)

    openReader()
    expect(await screen.findByText(/Failed to fetch/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to library/i })).toBeInTheDocument()
  })
})
