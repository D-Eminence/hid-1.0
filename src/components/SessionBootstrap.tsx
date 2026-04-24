import React, { useEffect } from 'react'
import { clearAllPortalSessions, getStaffSession, setPatientSession, setStaffSession } from '../lib/auth'
import { prefetchDoctorPortalCache, seedPatientProfileCache, warmPatientExperience } from '../lib/experienceWarmup'
import { fetchMyPatient, fetchMyStaffAccount } from '../lib/hidApi'
import { clearObservabilityIdentity, identifyObservabilityUser } from '../lib/observabilityBridge'
import { getSafeSession, safeSignOut, supabase } from '../lib/supabase'

const HYDRATE_COOLDOWN_MS = 250
let inflightHydration: Promise<void> | null = null
let lastHydratedAt = 0

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
  const now = Date.now()
  if (inflightHydration) {
    return inflightHydration
  }
  if (now - lastHydratedAt < HYDRATE_COOLDOWN_MS) {
    return
  }

  const hydration = (async () => {
    const session = await getSafeSession()

    if (!session) {
      clearAllPortalSessions()
      clearObservabilityIdentity()
      return
    }

    const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'
    const requestedRole = `${session.user.user_metadata.requested_role ?? ''}`.trim().toLowerCase()
    const shouldLoadPatient =
      pathname.startsWith('/patient') ||
      requestedRole === 'patient' ||
      (!pathname.startsWith('/hospital') && !pathname.startsWith('/doctor') && !pathname.startsWith('/eminence'))
    const shouldLoadStaff =
      pathname.startsWith('/hospital') ||
      pathname.startsWith('/doctor') ||
      requestedRole === 'clinician' ||
      requestedRole === 'org_admin'

    const [patient, staff] = await Promise.allSettled([
      shouldLoadPatient ? fetchMyPatient() : Promise.resolve(null),
      shouldLoadStaff ? fetchMyStaffAccount() : Promise.resolve(null),
    ])

    if (patient.status === 'fulfilled' && patient.value) {
      const nextPatientSession = {
        hidCode: patient.value.hid_code,
        phone: patient.value.phone ?? '',
        fullName: patient.value.full_name,
      }
      setPatientSession(nextPatientSession)
      seedPatientProfileCache(patient.value)
      warmPatientExperience(nextPatientSession, patient.value)
      identifyObservabilityUser({
        appRole: 'patient',
        id: session.user.id,
      })
    }

    if (staff.status === 'fulfilled' && staff.value) {
      const existingStaffSession = getStaffSession()
      const nextStaffSession = {
        id: staff.value.id,
        fullName: staff.value.full_name,
        hospitalName: staff.value.hospital_name ?? existingStaffSession?.hospitalName ?? null,
        email: staff.value.email,
        role: staff.value.role,
      }
      setStaffSession(nextStaffSession)
      void prefetchDoctorPortalCache(nextStaffSession)
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
  })()

  inflightHydration = hydration.finally(() => {
    inflightHydration = null
    lastHydratedAt = Date.now()
  })

  return inflightHydration
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
