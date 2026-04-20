import React from 'react'

type ComponentModule<T extends React.ComponentType<any>> = { default: T }
type LazyWithPreload<T extends React.ComponentType<any>> = React.LazyExoticComponent<T> & {
  preload: () => Promise<ComponentModule<T>>
}

const DYNAMIC_IMPORT_RELOAD_KEY = 'hid:dynamic-import-reload'

function isRecoverableImportError(error: unknown) {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('load failed')
  )
}

async function loadRouteModule<T extends React.ComponentType<any>>(
  loader: () => Promise<ComponentModule<T>>
) {
  try {
    const loaded = await loader()
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(DYNAMIC_IMPORT_RELOAD_KEY)
    }
    return loaded
  } catch (error) {
    if (typeof window !== 'undefined' && isRecoverableImportError(error)) {
      const hasRetried = sessionStorage.getItem(DYNAMIC_IMPORT_RELOAD_KEY) === '1'
      if (!hasRetried) {
        sessionStorage.setItem(DYNAMIC_IMPORT_RELOAD_KEY, '1')
        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.set('v', `${Date.now()}`)
        window.location.replace(nextUrl.toString())
        return new Promise<ComponentModule<T>>(() => undefined)
      }
    }
    throw error
  }
}

function lazyWithPreload<T extends React.ComponentType<any>>(
  loader: () => Promise<ComponentModule<T>>
): LazyWithPreload<T> {
  const wrappedLoader = () => loadRouteModule(loader)
  const LazyComponent = React.lazy(wrappedLoader) as LazyWithPreload<T>
  LazyComponent.preload = wrappedLoader
  return LazyComponent
}

export const LandingPage = lazyWithPreload(() => import('../pages/Landing'))
export const PatientAuthPage = lazyWithPreload(() => import('../pages/patient/PatientAuth'))
export const PatientProfilePage = lazyWithPreload(() => import('../pages/patient/PatientProfile'))
export const PatientRecordsPage = lazyWithPreload(() => import('../pages/patient/PatientRecords'))
export const PatientHistoryPage = lazyWithPreload(() => import('../pages/patient/PatientHistory'))
export const PatientNotificationsPage = lazyWithPreload(() => import('../pages/patient/PatientNotifications'))
export const AdminLoginPage = lazyWithPreload(() => import('../pages/admin/AdminLogin'))
export const AdminDashboardPage = lazyWithPreload(() => import('../pages/admin/AdminDashboard'))
export const DoctorAuthPage = lazyWithPreload(() => import('../pages/doctor/DoctorAuth'))
export const DoctorDashboardPage = lazyWithPreload(() => import('../pages/doctor/HospitalDashboard'))
export const DoctorAccessPage = lazyWithPreload(() => import('../pages/doctor/DoctorPortal'))
export const DoctorHistoryPage = lazyWithPreload(() => import('../pages/doctor/DoctorHistory'))
export const DoctorEmergencyPage = lazyWithPreload(() => import('../pages/doctor/DoctorEmergency'))
export const DoctorPatientRecordsPage = lazyWithPreload(() => import('../pages/doctor/DoctorPatientRecords'))

const routeLoaders = {
  landing: LandingPage.preload,
  patientAuth: PatientAuthPage.preload,
  patientProfile: PatientProfilePage.preload,
  patientRecords: PatientRecordsPage.preload,
  patientHistory: PatientHistoryPage.preload,
  patientNotifications: PatientNotificationsPage.preload,
  adminLogin: AdminLoginPage.preload,
  adminDashboard: AdminDashboardPage.preload,
  doctorAuth: DoctorAuthPage.preload,
  doctorDashboard: DoctorDashboardPage.preload,
  doctorAccess: DoctorAccessPage.preload,
  doctorHistory: DoctorHistoryPage.preload,
  doctorEmergency: DoctorEmergencyPage.preload,
  doctorPatientRecords: DoctorPatientRecordsPage.preload,
}

export type RoutePreloadKey = keyof typeof routeLoaders

export function preloadRoute(key: RoutePreloadKey) {
  void routeLoaders[key]()
}

export function preloadRoutes(keys: RoutePreloadKey[]) {
  keys.forEach(preloadRoute)
}

export function preloadPath(path: string) {
  getRoutePreloadKeys(path).forEach(preloadRoute)
}

export function getRoutePreloadKeys(path: string): RoutePreloadKey[] {
  if (!path) return []
  if (path === '/' || path.startsWith('/#')) return ['landing', 'patientAuth', 'doctorAuth']
  if (path === '/signup' || path === '/login' || path === '/register' || path === '/patient' || path.startsWith('/patient/auth')) {
    return ['patientAuth', 'patientProfile', 'patientRecords', 'patientHistory', 'patientNotifications']
  }
  if (path.startsWith('/patient/profile')) return ['patientProfile', 'patientRecords', 'patientHistory', 'patientNotifications']
  if (path === '/records' || path.startsWith('/patient/records')) return ['patientRecords', 'patientProfile', 'patientHistory', 'patientNotifications']
  if (path === '/logs' || path.startsWith('/patient/history')) return ['patientHistory', 'patientProfile', 'patientRecords', 'patientNotifications']
  if (path.startsWith('/patient/notifications')) return ['patientNotifications', 'patientProfile', 'patientRecords', 'patientHistory']
  if (path === '/eminence' || path.startsWith('/eminence/login')) return ['adminLogin', 'adminDashboard']
  if (path.startsWith('/eminence/')) return ['adminDashboard', 'adminLogin']
  if (path === '/hospital' || path.startsWith('/hospital/auth') || path.startsWith('/doctor/auth')) {
    return ['doctorAuth', 'doctorDashboard', 'doctorAccess', 'doctorHistory', 'doctorEmergency']
  }
  if (path === '/dashboard' || path === '/doctor' || path.startsWith('/hospital/dashboard')) {
    return ['doctorDashboard', 'doctorAccess', 'doctorHistory', 'doctorEmergency', 'doctorPatientRecords']
  }
  if (path.startsWith('/doctor/access') || path.startsWith('/hospital/access')) return ['doctorAccess', 'doctorHistory', 'doctorEmergency', 'doctorPatientRecords']
  if (path.startsWith('/hospital/history') || path.startsWith('/doctor/history')) return ['doctorHistory', 'doctorAccess', 'doctorEmergency', 'doctorPatientRecords']
  if (path.startsWith('/hospital/emergency') || path.startsWith('/doctor/emergency')) return ['doctorEmergency', 'doctorAccess', 'doctorHistory', 'doctorPatientRecords']
  if (path.startsWith('/hospital/patient-records/') || path.startsWith('/doctor/patient-records/')) return ['doctorPatientRecords', 'doctorAccess', 'doctorHistory', 'doctorEmergency']
  return []
}

export function preloadRoutesAfterDelay(keys: RoutePreloadKey[], delayMs = 20) {
  if (typeof window === 'undefined') return () => undefined
  const timer = window.setTimeout(() => {
    preloadRoutes(keys)
  }, delayMs)
  return () => window.clearTimeout(timer)
}
