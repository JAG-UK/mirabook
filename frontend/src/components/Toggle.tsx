interface Props {
  /** Stays the same whatever the state — the switch shows the state. */
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  title?: string
  /** Colour of the track when on; for a state worth noticing. */
  tone?: 'neutral' | 'amber'
}

/**
 * An on/off switch.
 *
 * These were buttons whose label changed with the state — "Blur on" became
 * "Blur off" — which reads as ambiguous: it could equally be describing the
 * state or the action the click will take. A switch separates the two: the
 * label names the thing, the track shows whether it is on.
 *
 * `role="switch"` with `aria-checked` says the same thing to a screen reader,
 * and being a button it already answers to space and enter.
 */
export default function Toggle({ label, checked, onChange, title, tone = 'neutral' }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      title={title}
      className="toggle"
      style={{ '--toggle-on': tone === 'amber' ? '#b45309' : '#292524' } as React.CSSProperties}
    >
      <span className="toggle-track" aria-hidden>
        <span className="toggle-knob" />
      </span>
      <span>{label}</span>
    </button>
  )
}
