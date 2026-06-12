import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profiles'
import { AVATARS } from '../lib/types'
import { countWords } from '../lib/vocab'

export default function ProfileMenu() {
  const { profiles, active, setActive, addProfile, signOut } = useProfile()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const words = countWords(active.id)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-stone-300 bg-white/80 py-1 pl-1 pr-3 text-sm text-stone-800 hover:bg-white"
        title="Profile"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-base">
          {active.avatar}
        </span>
        <span className="max-w-[8rem] truncate font-medium">{active.name}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-xl border border-stone-200 bg-white text-stone-800 shadow-xl">
            <div className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-stone-400">
              Profiles
            </div>
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setActive(p.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50 ${
                  p.id === active.id ? 'font-semibold' : ''
                }`}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-100">
                  {p.avatar}
                </span>
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === active.id && <span className="text-stone-400">✓</span>}
              </button>
            ))}
            <button
              onClick={() => {
                addProfile('Reader', AVATARS[profiles.length % AVATARS.length])
                setOpen(false)
                navigate('/settings')
              }}
              className="w-full px-3 py-2 text-left text-sm text-stone-500 hover:bg-stone-50"
            >
              + Add profile
            </button>
            <div className="my-1 border-t border-stone-100" />
            <button
              onClick={() => {
                setOpen(false)
                navigate('/words')
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
            >
              Saved words{words > 0 ? ` (${words})` : ''}
            </button>
            <button
              onClick={() => {
                setOpen(false)
                navigate('/settings')
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-stone-50"
            >
              Settings
            </button>
            <div className="my-1 border-t border-stone-100" />
            <button
              onClick={() => {
                setOpen(false)
                navigate('/')
                signOut()
              }}
              className="w-full px-3 py-2 text-left text-sm text-stone-500 hover:bg-stone-50"
            >
              Switch profile
            </button>
          </div>
        </>
      )}
    </div>
  )
}
