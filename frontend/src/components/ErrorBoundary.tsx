import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Named in the fallback, so a reader can tell us what broke. */
  label?: string
  /** Run when the reader chooses to try again — to drop cached state. */
  onReset?: () => void
}

interface State {
  error: Error | null
}

/**
 * Catches a crash during render and shows a way out instead of a blank page.
 *
 * Worth being clear about the limits: React error boundaries catch errors
 * thrown while rendering, in lifecycle methods and in constructors. They do
 * **not** catch errors in event handlers, in promises, or in `setTimeout`. The
 * reader's real failure modes — the backend going away mid-page, a bad
 * response — are already handled by its own error state; this is the net for
 * the ones nobody predicted, such as a malformed book blowing up a render.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept, because the household's copy of this app has no error reporting
    // and the browser console is the only place to look.
    console.error('Mirabook crashed while rendering', error, info.componentStack)
  }

  private reset = () => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="mx-auto max-w-xl px-5 py-16 text-center" role="alert">
        <h1 className="font-serif text-2xl font-bold">
          {this.props.label ? `${this.props.label} stopped working` : 'Something went wrong'}
        </h1>
        <p className="mt-2 text-stone-500">
          This is a bug in Mirabook rather than anything you did. Your books, bookmarks and saved
          words are untouched.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md bg-stone-100 px-3 py-2 text-left text-xs text-stone-600">
          {error.message || String(error)}
        </pre>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={this.reset}
            className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
          >
            Try again
          </button>
          {/* A full page load, not a router link: whatever broke may have left
              the router in a state a soft navigation cannot recover from. */}
          <a
            href="/"
            className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100"
          >
            Back to library
          </a>
        </div>
      </div>
    )
  }
}
