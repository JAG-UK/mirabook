// A minimal localStorage for the Node environment.
//
// favourites/progress/vocab are thin wrappers over it, and testing them is the
// point of this tier — but pulling in jsdom just for a key/value store would
// make the fast suite slow. Eight lines is cheaper.
import { beforeEach } from 'vitest'

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

// Each test starts from an empty shelf.
beforeEach(() => localStorage.clear())
