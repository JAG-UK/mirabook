import { useEffect, useState } from 'react'

// Reactive wrapper over navigator.onLine. Note: the authoritative "can I reach
// the backend" signal is whether the library fetch succeeds; this just lets the
// UI react to connectivity changes (e.g. re-fetch when coming back online).
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}
