// Per-book reading position, persisted in localStorage so the library
// remembers (bookmarks) the page you were last on.

const KEY = 'mirabook:lastPage'

type ProgressMap = Record<string, number>

export function loadProgress(): ProgressMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as ProgressMap
  } catch {
    return {}
  }
}

export function getProgress(bookId: string): number {
  return loadProgress()[bookId] ?? 1
}

export function saveProgress(bookId: string, page: number): void {
  const m = loadProgress()
  m[bookId] = page
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* ignore quota/availability errors */
  }
}
