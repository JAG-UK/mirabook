export type Font = 'serif' | 'sans'
export type Theme = 'paper' | 'sepia' | 'night'
export type Animation = 'flip' | 'slide' | 'fade' | 'none'

export interface Settings {
  font: Font
  theme: Theme
  fontScale: number // 0.85–1.4 (1 = default)
  lineSpacing: number // 1.4–2.1
  animation: Animation
}

export interface Profile {
  id: string
  name: string
  avatar: string
  settings: Settings
}

export interface SavedWord {
  id: string
  text: string
  context: string
  kind: string // grammar | idiom
  explanation: string
  bookId: string
  bookTitle: string
  at: number
}

export const DEFAULT_SETTINGS: Settings = {
  font: 'serif',
  theme: 'paper',
  fontScale: 1,
  lineSpacing: 1.6,
  animation: 'flip',
}

export const AVATARS = [
  '📖', '📚', '🦊', '🦉', '🐙', '🐢', '🌙', '🌵',
  '🎓', '🍵', '🧭', '🐝', '🦋', '🌟', '🎈', '🐳',
]
