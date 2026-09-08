// The reader: the app's most intricate screen, and until now its least
// tested. Page cache, prefetch, bookmarks, keyboard paging and a fallback to a
// downloaded copy when the backend disappears mid-session.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookMeta, PageData } from '../../src/api/client'
import { ProfileProvider } from '../../src/lib/profiles'
import { DEFAULT_SETTINGS } from '../../src/lib/types'
import Reader from '../../src/pages/Reader'

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/client')>()),
  getBook: vi.fn(),
  getPage: vi.fn(),
  explain: vi.fn(),
  alternatives: vi.fn(),
  mediaUrl: (src: string) => `http://backend${src}`,
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

function openReader() {
  render(
    <MemoryRouter initialEntries={['/read/bk1']}>
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
  localStorage.clear()
  sessionStorage.clear()
  // A chosen reader, as the profile gate would have left things.
  localStorage.setItem('mirabook:profiles', JSON.stringify([PROFILE]))
  sessionStorage.setItem('mirabook:activeId', PROFILE.id)

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
    localStorage.setItem(
      'mirabook:progress',
      JSON.stringify({ p1: { bk1: { page: 3, at: Date.now() } } }),
    )
    openReader()
    expect(await onPage(3)).toBeInTheDocument()
  })

  it('clamps a bookmark that is past the end of the book', async () => {
    // A book re-ingested shorter than it was should not open on nothing.
    localStorage.setItem(
      'mirabook:progress',
      JSON.stringify({ p1: { bk1: { page: 99, at: Date.now() } } }),
    )
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
    localStorage.setItem(
      'mirabook:progress',
      JSON.stringify({ p1: { bk1: { page: 5, at: Date.now() } } }),
    )
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

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('mirabook:progress')!)
      expect(stored.p1.bk1.page).toBe(2)
    })
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
    localStorage.setItem(
      'mirabook:progress',
      JSON.stringify({ p1: { bk1: { page: 5, at: Date.now() } } }),
    )
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
