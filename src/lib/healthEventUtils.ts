import type { BadgeColor } from '../components/ui'
import type { MedicalRecord } from '../types/database'
import type { HidHealthEvent } from '../types/hid'
import { formatDate } from './utils'

export interface HealthEventCategoryOption {
  value: string
  label: string
}

export const HEALTH_EVENT_CATEGORIES: HealthEventCategoryOption[] = [
  { value: 'general', label: 'General' },
  { value: 'illness', label: 'Illness' },
  { value: 'injury', label: 'Injury' },
  { value: 'surgery', label: 'Surgery / Procedure' },
  { value: 'pregnancy', label: 'Pregnancy' },
  { value: 'chronic_management', label: 'Chronic condition management' },
  { value: 'other', label: 'Other' },
]

export function getHealthEventCategoryLabel(category: string): string {
  return HEALTH_EVENT_CATEGORIES.find(option => option.value === category)?.label ?? 'General'
}

export function getHealthEventStatusBadge(status: HidHealthEvent['status']): { label: string; color: BadgeColor } {
  return status === 'closed'
    ? { label: 'Closed', color: 'gray' }
    : { label: 'Open', color: 'green' }
}

export function sortHealthEvents(events: HidHealthEvent[]): HidHealthEvent[] {
  return [...events].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'open' ? -1 : 1
    return b.created_at.localeCompare(a.created_at)
  })
}

export function getRecordsForHealthEvent(event: HidHealthEvent, records: MedicalRecord[]): MedicalRecord[] {
  const recordIds = new Set(event.record_ids)
  return records
    .filter(record => recordIds.has(record.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function formatHealthEventDateRange(event: HidHealthEvent): string {
  const start = event.started_at ? formatDate(event.started_at) : formatDate(event.created_at)
  if (!event.ended_at) return event.status === 'closed' ? start : `${start} - ongoing`
  return `${start} - ${formatDate(event.ended_at)}`
}
