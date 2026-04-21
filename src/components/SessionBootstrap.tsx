import React, { useEffect } from 'react'
import { clearAllPortalSessions, getStaffSession, setPatientSession, setStaffSession } from '../lib/auth'
import { fetchMyPatient, fetchMyStaffAccount } from '../lib/hidApi'
import { clearObservabilityIdentity, identifyObservabilityUser } from '../lib/observability'
import { getSafeSession, safeSignOut, supabase } from '../lib/supabase'

function isAuthFailure(reason: unknown) {
  if (!(reason instanceof Error)) return false
  const lower = reason.message.toLowerCase()
  return (
    lower.includes('please sign in') ||
    lower.includes('jwt') ||
    lower.includes('refresh token') ||
    lower.includes('token has expired') ||
    lower.includes('token is expired') ||
    lower.includes('invalid token')
  )
}

async function hydratePortalSession() {
  const session = await getSafeSession()

  if (!session) {
    clearAllPortalSessions()
    clearObservabilityIdentity()
    return
  }

  const [patient, staff] = await Promise.allSettled([
    fetchMyPatient(),
    fetchMyStaffAccount(),
  ])

  if (patient.status === 'fulfilled') {
    setPatientSession({
      hidCode: patient.value.hid_code,
      phone: patient.value.phone ?? '',
      fullName: patient.value.full_name,
    })
    identifyObservabilityUser({
      appRole: 'patient',
      id: session.user.id,
    })
  }

  if (staff.status === 'fulfilled' && staff.value) {
    const existingStaffSession = getStaffSession()
    setStaffSession({
      id: staff.value.id,
      fullName: staff.value.full_name,
      hospitalName: staff.value.hospital_name ?? existingStaffSession?.hospitalName ?? null,
      email: staff.value.email,
      role: staff.value.role,
    })
    identifyObservabilityUser({
      appRole: 'clinician',
      id: session.user.id,
      staffRole: staff.value.role,
    })
  }

  if (patient.status !== 'fulfilled' && (staff.status !== 'fulfilled' || !staff.value)) {
    clearObservabilityIdentity()
    const patientReason = patient.status === 'rejected' ? patient.reason : null
    const staffReason = staff.status === 'rejected' ? staff.reason : null

    if (isAuthFailure(patientReason) || isAuthFailure(staffReason)) {
      await safeSignOut().catch(() => {})
      clearAllPortalSessions()
    }
  }
}

export function SessionBootstrap() {
  useEffect(() => {
    void hydratePortalSession()

    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        clearAllPortalSessions()
        clearObservabilityIdentity()
        return
      }

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED' || event === 'PASSWORD_RECOVERY') {
        void hydratePortalSession()
      }
    })

    return () => {
      data.subscription.unsubscribe()
    }
  }, [])

  return null
}
