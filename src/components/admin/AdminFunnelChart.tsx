import React from 'react'
import type { AdminFunnelStep } from '../../types/admin'

const barColors = ['#3b82f6', '#0ea5e9', '#22c55e', '#f59e0b']

export function AdminFunnelChart({ steps }: { steps: AdminFunnelStep[] }) {
  const max = Math.max(...steps.map(step => step.value), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {steps.map((step, index) => (
        <div key={step.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 70px', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--admin-text)' }}>{step.label}</div>
          <div style={{ height: 14, borderRadius: 999, background: '#eef3f8', overflow: 'hidden' }}>
            <div
              style={{
                width: `${Math.max((step.value / max) * 100, 6)}%`,
                height: '100%',
                borderRadius: 999,
                background: barColors[index % barColors.length],
              }}
            />
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--admin-muted)', textAlign: 'right' }}>
            <strong style={{ color: 'var(--admin-text)', fontSize: 11.5 }}>{step.value}</strong>
            {step.conversionFromPrevious != null && (
              <div>{step.conversionFromPrevious.toFixed(0)}%</div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
