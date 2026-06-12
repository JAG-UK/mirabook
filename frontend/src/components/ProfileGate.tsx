import { useState } from 'react'
import { useProfileManager } from '../lib/profiles'
import { AVATARS } from '../lib/types'

// Shown until a profile is chosen for this session. New visitors create one
// rather than landing in a remembered reader's profile.
export default function ProfileGate() {
  const { profiles, setActive, addProfile } = useProfileManager()
  const [creating, setCreating] = useState(profiles.length === 0)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(AVATARS[0])

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-6 py-16">
      <h1 className="font-serif text-4xl font-bold tracking-tight">Mirabook</h1>
      <p className="mb-10 mt-2 text-stone-500">Who’s reading?</p>

      {!creating ? (
        <div className="flex flex-wrap items-start justify-center gap-6">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => setActive(p.id)}
              className="group flex w-24 flex-col items-center gap-2"
            >
              <span className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-4xl shadow-sm ring-1 ring-stone-200 transition group-hover:shadow group-hover:ring-stone-400">
                {p.avatar}
              </span>
              <span className="max-w-full truncate text-sm font-medium">{p.name}</span>
            </button>
          ))}
          <button
            onClick={() => setCreating(true)}
            className="flex w-24 flex-col items-center gap-2 text-stone-400 hover:text-stone-700"
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 text-3xl">
              +
            </span>
            <span className="text-sm">Add reader</span>
          </button>
        </div>
      ) : (
        <div className="w-full max-w-sm">
          <label className="block text-sm font-medium text-stone-700">Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addProfile(name, avatar)}
            placeholder="Your name"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
          <div className="mt-4 text-sm font-medium text-stone-700">Pick an avatar</div>
          <div className="mt-2 grid grid-cols-8 gap-1">
            {AVATARS.map((a) => (
              <button
                key={a}
                onClick={() => setAvatar(a)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition ${
                  avatar === a ? 'bg-stone-800' : 'hover:bg-stone-200'
                }`}
              >
                {a}
              </button>
            ))}
          </div>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => addProfile(name, avatar)}
              className="rounded-lg bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700"
            >
              Create &amp; start reading
            </button>
            {profiles.length > 0 && (
              <button
                onClick={() => setCreating(false)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-stone-100"
              >
                Back
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
