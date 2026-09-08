// Per-profile favourite books, in localStorage.
//
// Favourites are a reader's own, not a property of the shared library — one
// household's shelf of Spanish classics is the same for everyone, but which of
// them you starred is yours. That puts this alongside progress and vocab
// rather than in the database next to `shelf`.

const KEY = 'mirabook:favourites'

type Store = Record<string, string[]> // profileId -> bookIds

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as Store
  } catch {
    return {}
  }
}

function save(s: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export function listFavourites(profileId: string): Set<string> {
  return new Set(load()[profileId] ?? [])
}

/** Star or un-star a book. Returns the resulting set. */
export function toggleFavourite(profileId: string, bookId: string): Set<string> {
  const s = load()
  const current = s[profileId] ?? []
  const next = current.includes(bookId)
    ? current.filter((id) => id !== bookId)
    : [...current, bookId]
  s[profileId] = next
  save(s)
  return new Set(next)
}

/** Forget a deleted book, so it cannot linger as a phantom favourite. */
export function forgetFavourite(profileId: string, bookId: string): void {
  const s = load()
  const current = s[profileId] ?? []
  if (!current.includes(bookId)) return
  s[profileId] = current.filter((id) => id !== bookId)
  save(s)
}
