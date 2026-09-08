import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookMeta, Shelf } from '../../src/api/client'
import EditBookDialog from '../../src/components/EditBookDialog'

vi.mock('../../src/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/api/client')>()),
  updateBook: vi.fn(),
}))
const { updateBook } = await import('../../src/api/client')
const mockUpdate = vi.mocked(updateBook)

const BOOK: BookMeta = {
  id: 'bk1',
  title: 'don-quijote-es',
  source_lang: 'Spanish',
  target_lang: 'English',
  page_count: 32,
  toc: [],
  author: 'Cervantes',
  shelf: 'History',
  source: 'gutenberg:2000',
}

const SHELVES: Shelf[] = [
  { name: 'Novels', count: 2 },
  { name: 'Poetry', count: 0 },
  { name: 'History', count: 1 },
  { name: 'Unshelved', count: 0 },
]

function open(book: Partial<BookMeta> = {}) {
  const onSaved = vi.fn()
  const onClose = vi.fn()
  render(
    <EditBookDialog
      book={{ ...BOOK, ...book }}
      shelves={SHELVES}
      onSaved={onSaved}
      onClose={onClose}
    />,
  )
  return {
    user: userEvent.setup(),
    onSaved,
    onClose,
    title: () => screen.getByLabelText(/title/i),
    author: () => screen.getByLabelText(/author/i),
    shelf: () => screen.getByLabelText(/shelf/i),
    save: () => screen.getByRole('button', { name: /save/i }),
    cancel: () => screen.getByRole('button', { name: /cancel/i }),
  }
}

beforeEach(() => mockUpdate.mockResolvedValue({ ...BOOK, title: 'Don Quijote' }))

describe('EditBookDialog', () => {
  it('opens showing the book as it stands', () => {
    const d = open()
    expect(d.title()).toHaveValue('don-quijote-es')
    expect(d.author()).toHaveValue('Cervantes')
    expect(d.shelf()).toHaveValue('History')
    expect(screen.getByText(/gutenberg:2000/)).toBeInTheDocument()
  })

  it('offers every shelf, including ones holding nothing yet', () => {
    // A book has to be able to move somewhere empty.
    open()
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names).toEqual(['Novels', 'Poetry', 'History', 'Unshelved'])
  })

  it('cannot be saved until something actually changes', async () => {
    const d = open()
    expect(d.save()).toBeDisabled()
    await d.user.type(d.title(), '!')
    expect(d.save()).toBeEnabled()
  })

  it('saves a corrected title, trimmed', async () => {
    const d = open()
    await d.user.clear(d.title())
    await d.user.type(d.title(), '  Don Quijote  ')
    await d.user.click(d.save())

    expect(mockUpdate).toHaveBeenCalledWith('bk1', {
      title: 'Don Quijote',
      author: 'Cervantes',
      shelf: 'History',
    })
    expect(d.onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: 'Don Quijote' }))
  })

  it('moves a misfiled book to another shelf', async () => {
    const d = open()
    await d.user.selectOptions(d.shelf(), 'Poetry')
    await d.user.click(d.save())
    expect(mockUpdate).toHaveBeenCalledWith('bk1', expect.objectContaining({ shelf: 'Poetry' }))
  })

  it('sends null rather than "Unshelved" when a book comes off its shelf', async () => {
    const d = open()
    await d.user.selectOptions(d.shelf(), 'Unshelved')
    await d.user.click(d.save())
    expect(mockUpdate).toHaveBeenCalledWith('bk1', expect.objectContaining({ shelf: null }))
  })

  it('sends null rather than an empty string when the author is cleared', async () => {
    const d = open()
    await d.user.clear(d.author())
    await d.user.click(d.save())
    expect(mockUpdate).toHaveBeenCalledWith('bk1', expect.objectContaining({ author: null }))
  })

  it('refuses to save a book with no title, and says why', async () => {
    const d = open()
    await d.user.clear(d.title())
    expect(screen.getByText(/a book needs a title/i)).toBeInTheDocument()
    expect(d.save()).toBeDisabled()

    await d.user.type(d.title(), '   ')
    expect(d.save()).toBeDisabled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('shows what the server said when an edit is refused', async () => {
    // A throwing implementation rather than mockRejectedValue: the latter
    // leaves a rejected promise that nothing consumes, which vitest reports as
    // an unhandled rejection even though the component handles the failure.
    mockUpdate.mockImplementationOnce(async () => {
      throw new Error("'Bangers' is not one of the shelves")
    })
    const d = open()
    await d.user.type(d.title(), '!')
    await d.user.click(d.save())

    expect(await screen.findByText(/not one of the shelves/)).toBeInTheDocument()
    expect(d.onSaved).not.toHaveBeenCalled()
    expect(d.save()).toBeEnabled() // and you can try again
  })

  it('closes on Cancel without saving', async () => {
    const d = open()
    await d.user.type(d.title(), '!')
    await d.user.click(d.cancel())
    expect(d.onClose).toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const d = open()
    await d.user.keyboard('{Escape}')
    expect(d.onClose).toHaveBeenCalled()
  })

  it('saves on Enter from a text field', async () => {
    const d = open()
    await d.user.clear(d.title())
    await d.user.type(d.title(), 'Don Quijote{Enter}')
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('copes with a book that has no author or shelf', () => {
    const d = open({ author: null, shelf: null })
    expect(d.author()).toHaveValue('')
    expect(d.shelf()).toHaveValue('Unshelved')
  })
})
