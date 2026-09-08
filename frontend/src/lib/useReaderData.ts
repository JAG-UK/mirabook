import { useSyncExternalStore } from 'react'
import { getVersion, subscribe } from './readerStore'

/**
 * Re-render when reader data changes.
 *
 * Without this, a screen reads the mirror once and never hears about the first
 * sync — so a device that has just been opened shows an empty word list while
 * the server is holding plenty.
 */
export function useReaderData(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion)
}
