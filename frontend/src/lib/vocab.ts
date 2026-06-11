// Per-profile saved words / phrases (vocabulary list), in localStorage.

import { SavedWord } from './types'

const KEY = 'mirabook:vocab'

type Store = Record<string, SavedWord[]> // profileId -> words

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

function rid(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function listWords(profileId: string): SavedWord[] {
  return [...(load()[profileId] ?? [])].sort((a, b) => b.at - a.at)
}

export function addWord(profileId: string, w: Omit<SavedWord, 'id' | 'at'>): SavedWord {
  const s = load()
  const list = s[profileId] ?? []
  const word: SavedWord = { ...w, id: rid(), at: Date.now() }
  s[profileId] = [...list, word]
  save(s)
  return word
}

export function removeWord(profileId: string, id: string): void {
  const s = load()
  s[profileId] = (s[profileId] ?? []).filter((w) => w.id !== id)
  save(s)
}

export function countWords(profileId: string): number {
  return (load()[profileId] ?? []).length
}
