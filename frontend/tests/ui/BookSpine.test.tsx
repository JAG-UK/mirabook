import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BookMeta } from '../../src/api/client'
import BookSpine from '../../src/components/BookSpine'

const BOOK: BookMeta = {
  id: 'bk1',
  title: 'Platero y yo',
  source_lang: 'Spanish',
  target_lang: 'English',
  page_count: 120,
  toc: [],
  author: 'Jiménez, Juan Ramón',
  shelf: 'Poetry',
}

function shelve(props: Partial<Parameters<typeof BookSpine>[0]> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onDownload: vi.fn(),
    onRemoveDownload: vi.fn(),
    onRemove: vi.fn(),
    onEdit: vi.fn(),
    onToggleFavourite: vi.fn(),
  }
  render(
    <BookSpine
      book={BOOK}
      available
      reachable
      favourite={false}
      {...handlers}
      {...props}
    />,
  )
  return { user: userEvent.setup(), ...handlers }
}

describe('BookSpine', () => {
  it('shows the book on the shelf', () => {
    shelve()
    expect(screen.getByText('Platero y yo')).toBeInTheDocument()
  })

  it('names the author in the tooltip, so a spine is identifiable', () => {
    shelve()
    expect(screen.getByTitle(/Jiménez, Juan Ramón/)).toBeInTheDocument()
  })

  it('opens the book when the spine is clicked', async () => {
    const s = shelve()
    await s.user.click(screen.getByText('Platero y yo'))
    expect(s.onOpen).toHaveBeenCalledWith(BOOK)
  })

  describe('the favourite star', () => {
    it('offers to star a book that is not starred', async () => {
      const s = shelve({ favourite: false })
      const star = screen.getByRole('button', { name: /^Favourite Platero/ })
      expect(star).toHaveAttribute('aria-pressed', 'false')
      expect(star).toHaveTextContent('☆')

      await s.user.click(star)
      expect(s.onToggleFavourite).toHaveBeenCalledWith(BOOK)
    })

    it('offers to un-star a book that is starred', async () => {
      const s = shelve({ favourite: true })
      const star = screen.getByRole('button', { name: /^Unfavourite Platero/ })
      expect(star).toHaveAttribute('aria-pressed', 'true')
      expect(star).toHaveTextContent('★')

      await s.user.click(star)
      expect(s.onToggleFavourite).toHaveBeenCalledWith(BOOK)
    })

    it('stays visible once set, rather than only on hover', () => {
      // A favourite you can only see by hovering is no use for picking a book.
      shelve({ favourite: true })
      expect(screen.getByRole('button', { name: /^Unfavourite/ })).toHaveClass('on')
    })

    it('can be starred even when the backend is unreachable', async () => {
      // Favourites are local to the reader, so they work offline.
      const s = shelve({ reachable: false })
      await s.user.click(screen.getByRole('button', { name: /^Favourite Platero/ }))
      expect(s.onToggleFavourite).toHaveBeenCalled()
    })

    it('does not open the book', async () => {
      const s = shelve()
      await s.user.click(screen.getByRole('button', { name: /^Favourite Platero/ }))
      expect(s.onOpen).not.toHaveBeenCalled()
    })
  })

  describe('the edit and remove controls', () => {
    it('edits without opening the book', async () => {
      const s = shelve()
      await s.user.click(screen.getByRole('button', { name: /^Edit Platero/ }))
      expect(s.onEdit).toHaveBeenCalledWith(BOOK)
      expect(s.onOpen).not.toHaveBeenCalled()
    })

    it('removes without opening the book', async () => {
      const s = shelve()
      await s.user.click(screen.getByRole('button', { name: /^Remove Platero/ }))
      expect(s.onRemove).toHaveBeenCalledWith(BOOK)
      expect(s.onOpen).not.toHaveBeenCalled()
    })

    it('are hidden when the backend cannot be reached', () => {
      // Editing and deleting need the server; starring does not.
      shelve({ reachable: false })
      expect(screen.queryByRole('button', { name: /^Edit Platero/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Remove Platero/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Favourite Platero/ })).toBeInTheDocument()
    })
  })

  describe('offline availability', () => {
    it('offers a download when the book is not stored locally', async () => {
      const s = shelve()
      await s.user.click(screen.getByTitle(/download for offline/i))
      expect(s.onDownload).toHaveBeenCalledWith(BOOK)
    })

    it('offers to drop a book that is already downloaded', async () => {
      const s = shelve({ download: { bytes: 2_400_000, at: Date.now() } })
      const done = screen.getByTitle(/^Downloaded/)
      expect(done).toHaveAttribute('title', expect.stringContaining('2.3 MB'))
      await s.user.click(done)
      expect(s.onRemoveDownload).toHaveBeenCalledWith(BOOK)
    })

    it('shows progress while a download runs', () => {
      shelve({ progress: { done: 30, total: 120, label: 'Translating' } })
      expect(screen.getByText('25%')).toBeInTheDocument()
    })

    it('cannot be opened when it is unavailable offline', async () => {
      const s = shelve({ available: false })
      const spine = screen.getByTitle(/not available offline/)
      expect(spine).toBeDisabled()
      await s.user.click(spine).catch(() => {})
      expect(s.onOpen).not.toHaveBeenCalled()
    })
  })
})
