import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profiles'
import { Animation, AVATARS, Font, Theme } from '../lib/types'

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="inline-flex rounded-lg border border-stone-300 bg-white p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition ${
            value === o.value ? 'bg-stone-800 text-white' : 'text-stone-600 hover:bg-stone-100'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-stone-100 py-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export default function Settings() {
  const { active, profiles, updateActive, removeProfile } = useProfile()
  const navigate = useNavigate()
  const s = active.settings

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <header className="mb-6 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="text-stone-500 hover:text-stone-800"
          title="Back"
        >
          ←
        </button>
        <h1 className="font-serif text-2xl font-bold">Profile &amp; settings</h1>
      </header>

      <Row label="Name">
        <input
          value={active.name}
          onChange={(e) => updateActive({ name: e.target.value })}
          className="w-48 rounded-lg border border-stone-300 px-3 py-1.5 text-sm"
          placeholder="Your name"
        />
      </Row>

      <Row label="Avatar">
        <div className="grid max-w-xs grid-cols-8 gap-1">
          {AVATARS.map((a) => (
            <button
              key={a}
              onClick={() => updateActive({ avatar: a })}
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-lg transition ${
                active.avatar === a ? 'bg-stone-800' : 'hover:bg-stone-200'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Book font">
        <Segmented<Font>
          value={s.font}
          onChange={(font) => updateActive({ settings: { font } })}
          options={[
            { value: 'serif', label: 'Serif' },
            { value: 'sans', label: 'Sans' },
          ]}
        />
      </Row>

      <Row label="Reading theme">
        <Segmented<Theme>
          value={s.theme}
          onChange={(theme) => updateActive({ settings: { theme } })}
          options={[
            { value: 'paper', label: 'Paper' },
            { value: 'sepia', label: 'Sepia' },
            { value: 'night', label: 'Night' },
          ]}
        />
      </Row>

      <Row label="Page-turn animation">
        <Segmented<Animation>
          value={s.animation}
          onChange={(animation) => updateActive({ settings: { animation } })}
          options={[
            { value: 'flip', label: 'Flip' },
            { value: 'slide', label: 'Slide' },
            { value: 'fade', label: 'Fade' },
            { value: 'none', label: 'None' },
          ]}
        />
      </Row>

      <Row label={`Text size (${Math.round(s.fontScale * 100)}%)`}>
        <input
          type="range"
          min={0.85}
          max={1.4}
          step={0.05}
          value={s.fontScale}
          onChange={(e) => updateActive({ settings: { fontScale: Number(e.target.value) } })}
          className="w-48 accent-stone-800"
        />
      </Row>

      <Row label={`Line spacing (${s.lineSpacing.toFixed(1)})`}>
        <input
          type="range"
          min={1.4}
          max={2.1}
          step={0.1}
          value={s.lineSpacing}
          onChange={(e) => updateActive({ settings: { lineSpacing: Number(e.target.value) } })}
          className="w-48 accent-stone-800"
        />
      </Row>

      {profiles.length > 1 && (
        <div className="mt-8">
          <button
            onClick={() => {
              if (confirm(`Delete profile “${active.name}”? Its bookmarks and saved words stay in storage but become inaccessible.`)) {
                removeProfile(active.id)
              }
            }}
            className="text-sm text-red-600 hover:underline"
          >
            Delete this profile
          </button>
        </div>
      )}
    </div>
  )
}
