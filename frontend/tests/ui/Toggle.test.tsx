import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Toggle from '../../src/components/Toggle'

const setup = (checked: boolean) => {
  const onChange = vi.fn()
  render(<Toggle label="Blur" checked={checked} onChange={onChange} />)
  return { user: userEvent.setup(), onChange, control: screen.getByRole('switch') }
}

describe('Toggle', () => {
  it('is a switch, so its state is readable rather than inferred', () => {
    // The buttons it replaced changed their label with the state — "Blur on"
    // could mean the state or the action, and neither was announced.
    const { control } = setup(true)
    expect(control).toBeChecked()
    expect(control).toHaveAccessibleName('Blur')
  })

  it('reports being off', () => {
    expect(setup(false).control).not.toBeChecked()
  })

  it('keeps the same label whichever way it is set', () => {
    setup(false)
    expect(screen.getByText('Blur')).toBeInTheDocument()
  })

  it('asks for the opposite of what it is', async () => {
    const on = setup(true)
    await on.user.click(on.control)
    expect(on.onChange).toHaveBeenCalledWith(false)
  })

  it('turns on when it is off', async () => {
    const off = setup(false)
    await off.user.click(off.control)
    expect(off.onChange).toHaveBeenCalledWith(true)
  })

  it('answers to the keyboard, being a button underneath', async () => {
    const { user, onChange, control } = setup(false)
    control.focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('carries an explanation for the curious', () => {
    render(<Toggle label="Peek" checked={false} onChange={vi.fn()} title="Look around" />)
    expect(screen.getByRole('switch', { name: 'Peek' })).toHaveAttribute('title', 'Look around')
  })
})
