import { supabase } from './supabase'

const PATIENT_SESSION_KEY = 'hid_patient_session'
const STAFF_SESSION_KEY = 'hid_staff_session'

export interface PatientSession {
  hidCode: string
  phone: string
  fullName: string
}

export interface StaffSession {
  id: string
  fullName: string
  hospitalName?: string | null
  email: string
  role: 'doctor' | 'nurse' | 'lab' | 'pharmacist' | 'admin'
}

function readStoredSession<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null

  try {
    return JSON.parse(raw) as T
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

export function getPatientSession(): PatientSession | null {
  return readStoredSession<PatientSession>(PATIENT_SESSION_KEY)
}

export function setPatientSession(session: PatientSession) {
  localStorage.setItem(PATIENT_SESSION_KEY, JSON.stringify(session))
}

export function clearPatientSession() {
  localStorage.removeItem(PATIENT_SESSION_KEY)
}

export function getStaffSession(): StaffSession | null {
  return readStoredSession<StaffSession>(STAFF_SESSION_KEY)
}

export function setStaffSession(session: StaffSession) {
  localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(session))
}

export function clearStaffSession() {
  localStorage.removeItem(STAFF_SESSION_KEY)
}

export function clearAllPortalSessions() {
  clearPatientSession()
  clearStaffSession()
}

export async function signOutAndClearSessions() {
  await supabase.auth.signOut()
  clearAllPortalSessions()
}
