/**
 * Generates a unique HID code in the format: HID-XXXX-XXXX-XXXX
 * Uses a combination of random alphanumeric characters (uppercase, no ambiguous chars)
 */
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0,O,1,I

function randomSegment(len: number): string {
  return Array.from({ length: len }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join('')
}

export function generateHID(): string {
  return `HID-${randomSegment(4)}-${randomSegment(4)}-${randomSegment(4)}`
}

/**
 * Format a date string (YYYY-MM-DD) to a human-readable format
 */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
}

/**
 * Format a datetime string to a readable date+time
 */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

/**
 * Calculate relative time (e.g. "2 hours ago")
 */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
