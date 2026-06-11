import { Route, Routes } from 'react-router-dom'
import Library from './pages/Library'
import Reader from './pages/Reader'
import Settings from './pages/Settings'
import SavedWords from './pages/SavedWords'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/read/:bookId" element={<Reader />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/words" element={<SavedWords />} />
    </Routes>
  )
}
