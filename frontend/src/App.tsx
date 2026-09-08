import { Route, Routes } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import ProfileGate from './components/ProfileGate'
import { useProfileManager } from './lib/profiles'
import Library from './pages/Library'
import Reader from './pages/Reader'
import Settings from './pages/Settings'
import SavedWords from './pages/SavedWords'

export default function App() {
  const { active } = useProfileManager()
  // Until a profile is chosen for this session, show the picker.
  if (!active) return <ProfileGate />

  return (
    // The outer boundary is the net for anything unforeseen; the reader gets
    // its own so a crash mid-book leaves the rest of the app reachable.
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route
          path="/read/:bookId"
          element={
            <ErrorBoundary label="The reader">
              <Reader />
            </ErrorBoundary>
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/words" element={<SavedWords />} />
      </Routes>
    </ErrorBoundary>
  )
}
