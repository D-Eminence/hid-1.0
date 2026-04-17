import React, { useRef } from 'react'

export function OtpInputs({
  value,
  onChange,
  onComplete,
}: {
  value: string
  onChange: (next: string) => void
  onComplete?: (next: string) => void
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([])

  function updateAt(index: number, raw: string) {
    const digit = raw.replace(/\D/g, '').slice(-1)
    if (!digit) {
      const next = value.split('')
      next[index] = ''
      onChange(next.join(''))
      return
    }

    const next = value.padEnd(6, ' ').split('')
    next[index] = digit
    const joined = next.join('').replace(/\s/g, '').slice(0, 6)
    onChange(joined)

    if (index < 5) refs.current[index + 1]?.focus()
    if (joined.length === 6) onComplete?.(joined)
  }

  return (
    <div style={{ display: 'flex', gap: 'clamp(6px, 2vw, 10px)', justifyContent: 'center' }}>
      {Array.from({ length: 6 }).map((_, index) => (
        <input
          key={index}
          ref={element => { refs.current[index] = element }}
          inputMode="numeric"
          maxLength={1}
          value={value[index] ?? ''}
          onChange={event => updateAt(index, event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Backspace' && !value[index] && index > 0) refs.current[index - 1]?.focus()
          }}
          style={{
            width: 'clamp(36px, 9vw, 42px)',
            height: 'clamp(40px, 10vw, 42px)',
            borderRadius: 10,
            border: '1px solid #d6deea',
            textAlign: 'center',
            fontSize: 'clamp(16px, 4vw, 18px)',
            color: '#111827',
            background: '#fff',
          }}
        />
      ))}
    </div>
  )
}
