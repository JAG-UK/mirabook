// A minimal localStorage for the Node environment.
//
// favourites/progress/vocab are thin wrappers over it, and testing them is the
// point of this tier — but pulling in jsdom just for a key/value store would
// make the fast suite slow. Eight lines is cheaper.
import { beforeEach } from 'vitest'
import { __reset } from '../src/lib/readerStore'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}

globalThis.localStorage = new MemoryStorage()

// Each test starts from an empty shelf. The reader mirror is held in a
// module-level map, so clearing storage is no longer enough on its own — it
// has to be dropped too, or one test's words turn up in the next.
beforeEach(() => {
  localStorage.clear()
  __reset()
})
