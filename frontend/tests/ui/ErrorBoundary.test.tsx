import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ErrorBoundary from '../../src/components/ErrorBoundary'

// React logs every caught error itself; the boundary logs one more. Neither is
// a failure, and both would drown the test output.
let consoleError: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

function Boom({ when = true }: { when?: boolean }) {
  if (when) throw new Error('the book exploded')
  return <p>the reader</p>
}

/**
 * A child that throws until something outside it says stop.
 *
 * It cannot simply throw once: React re-invokes a failed render to produce a
 * better stack trace, so a throw-once child succeeds on that second attempt
 * and the boundary never sees an error at all. Nor can the flag be useState —
 * a retry remounts the subtree and resets it. Flipping it from `onReset` is
 * both what works and what the prop is for: drop the stale state that caused
 * the crash, so the retry has a chance.
 */
function makeFlaky() {
  const state = { throwing: true }
  const Flaky = () => {
    if (state.throwing) throw new Error('transient')
    return <p>recovered</p>
  }
  return { Flaky, recover: () => (state.throwing = false) }
}

describe('ErrorBoundary', () => {
  it('stays out of the way when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <p>the reader</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('the reader')).toBeInTheDocument()
  })

  it('shows a way out instead of a blank page', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to library/i })).toHaveAttribute('href', '/')
  })

  it('names the part that broke, when told which it is', () => {
    render(
      <ErrorBoundary label="The reader">
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/the reader stopped working/i)).toBeInTheDocument()
  })

  it('shows the error itself, since the console is the only other place to look', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText('the book exploded')).toBeInTheDocument()
  })

  it('reassures the reader that their books and words are intact', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/bookmarks and saved\s+words are untouched/i)).toBeInTheDocument()
  })

  it('logs the crash for whoever goes looking', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(consoleError).toHaveBeenCalledWith(
      'Mirabook crashed while rendering',
      expect.any(Error),
      expect.anything(),
    )
  })

  it('renders again when the reader tries again', async () => {
    const { Flaky, recover } = makeFlaky()
    const user = userEvent.setup()
    render(
      <ErrorBoundary onReset={recover}>
        <Flaky />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByText('recovered')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the fallback again if trying again does not help', async () => {
    // Nothing cleared the cause, so the crash simply recurs.
    const { Flaky } = makeFlaky()
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('lets the caller drop its own stale state on retry', async () => {
    const { Flaky, recover } = makeFlaky()
    const onReset = vi.fn(recover)
    const user = userEvent.setup()
    render(
      <ErrorBoundary onReset={onReset}>
        <Flaky />
      </ErrorBoundary>,
    )
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('catches a crash from anywhere below it, not just its own child', () => {
    render(
      <ErrorBoundary>
        <div>
          <section>
            <Boom />
          </section>
        </div>
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
