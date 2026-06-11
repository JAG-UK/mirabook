import { Route, Routes } from 'react-router-dom'
import Library from './pages/Library'
import Reader from './pages/Reader'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Library />} />
      <Route path="/read/:bookId" element={<Reader />} />
    </Routes>
  )
}
