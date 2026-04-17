import type { PatientSession, StaffSession } from './auth'
import { writePageCache } from './pageCache'
import { supabase } from './supabase'
import type {
  AccessLog,
  AccessRequest,
  MedicalRecord,
  MedicalRecordFile,
  Notification,
  Patient,
  StaffAccount,
} from '../types/database'

type DoctorDashboardCache = {
  account: StaffAccount | null
  requests: AccessRequest[]
  patientNames: Record<string, string>
  accessLogs: AccessLog[]
}

type DoctorPatientRecordsCache = {
  account: StaffAccount | null
  patient: Patient | null
  activeRequest: AccessRequest | null
  records: MedicalRecord[]
  recordFiles: Record<string, MedicalRecordFile[]>
}

function canUseSessionStorage() {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined'
}

function readSessionStorage<T>(key: string): T | null {
  if (!canUseSessionStorage()) return null
  try {
    const raw = window.sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function writeSessionStorage(key: string, value: unknown) {
  if (!canUseSessionStorage()) return
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors.
  }
}

function groupRecordFiles(files: MedicalRecordFile[]) {
  return files.reduce<Record<string, MedicalRecordFile[]>>((acc, item) => {
    acc[item.record_id] = [...(acc[item.record_id] ?? []), item]
    return acc
  }, {})
}

export function seedPatientProfileCache(patient: Patient) {
  writeSessionStorage(`hid_patient_profile_cache_${patient.hid_code}`, patient)
}

export async function prefetchPatientPortalCaches(hidCode: string, knownPatient?: Patient | null) {
  const patientPromise = knownPatient
    ? Promise.resolve(knownPatient)
    : supabase.from('patients').select('*').eq('hid_code', hidCode).single().then(({ data }) => (data as Patient | null) ?? null)

  const [patient, recordsRes, logsRes, requestsRes, notificationsRes] = await Promise.all([
    patientPromise,
    supabase.from('medical_records').select('*').eq('hid_code', hidCode).order('created_at', { ascending: false }),
    supabase.from('access_logs').select('*').eq('hid_code', hidCode).order('access_time', { ascending: false }),
    supabase.from('access_requests').select('*').eq('hid_code', hidCode).eq('status', 'approved').order('created_at', { ascending: false }),
    supabase.from('notifications').select('*').eq('hid_code', hidCode).order('created_at', { ascending: false }),
  ])

  const nextPatient = patient ?? null
  const records = (recordsRes.data as MedicalRecord[] | null) ?? []
  const ids = records.map(item => item.id)
  const { data: fileData } = ids.length > 0
    ? await supabase.from('medical_record_files').select('*').in('record_id', ids).order('created_at', { ascending: true })
    : { data: [] }
  const recordFiles = groupRecordFiles((fileData as MedicalRecordFile[] | null) ?? [])
  const logs = (logsRes.data as AccessLog[] | null) ?? []
  const requests = (requestsRes.data as AccessRequest[] | null) ?? []
  const notifications = (notificationsRes.data as Notification[] | null) ?? []

  if (nextPatient) seedPatientProfileCache(nextPatient)
  writePageCache(`patient-records:${hidCode}`, { patient: nextPatient, records, recordFiles }, 90_000)
  writePageCache(`patient-history:${hidCode}`, { patient: nextPatient, logs, requests }, 90_000)
  writePageCache(`patient-notifications:${hidCode}`, { patient: nextPatient, notifications }, 90_000)
}

export function seedDoctorDashboardCache(sessionId: string, cache: DoctorDashboardCache) {
  writeSessionStorage(`hid_hospital_dashboard_${sessionId}`, cache)
}

export async function prefetchDoctorPortalCache(session: StaffSession, knownAccount?: StaffAccount | null) {
  const [accountRes, requestsRes] = await Promise.all([
    knownAccount
      ? Promise.resolve({ data: knownAccount })
      : supabase.from('staff_accounts').select('*').eq('id', session.id).single(),
    supabase.from('access_requests').select('*').eq('doctor_account_id', session.id).order('created_at', { ascending: false }),
  ])

  const account = (accountRes.data as StaffAccount | null) ?? knownAccount ?? null
  const requests = (requestsRes.data as AccessRequest[] | null) ?? []
  const requestIds = requests.map(item => item.id)
  const { data: accessLogData } = requestIds.length > 0
    ? await supabase.from('access_logs').select('*').in('request_id', requestIds).order('access_time', { ascending: false })
    : { data: [] }
  const accessLogs = (accessLogData as AccessLog[] | null) ?? []
  const hids = Array.from(new Set([...requests.map(item => item.hid_code), ...accessLogs.map(item => item.hid_code)]))
  const { data: patientData } = hids.length > 0
    ? await supabase.from('patients').select('hid_code, full_name').in('hid_code', hids)
    : { data: [] }
  const patientNames = ((patientData as Pick<Patient, 'hid_code' | 'full_name'>[] | null) ?? []).reduce<Record<string, string>>((acc, item) => {
    acc[item.hid_code] = item.full_name
    return acc
  }, {})

  seedDoctorDashboardCache(session.id, { account, requests, patientNames, accessLogs })
}

export function seedDoctorPatientRecordsCache(sessionId: string, hidCode: string, cache: DoctorPatientRecordsCache) {
  writePageCache(`doctor-patient-records:${sessionId}:${hidCode.toUpperCase()}`, cache, 90_000)
}

export async function prefetchDoctorPatientRecordsCache({
  sessionId,
  hidCode,
  knownAccount,
  knownPatient,
  knownRequest,
}: {
  sessionId: string
  hidCode: string
  knownAccount?: StaffAccount | null
  knownPatient?: Patient | null
  knownRequest?: AccessRequest | null
}) {
  const normalizedHidCode = hidCode.trim().toUpperCase()
  const [accountRes, patientRes, accessRes, recordsRes] = await Promise.all([
    knownAccount
      ? Promise.resolve({ data: knownAccount })
      : supabase.from('staff_accounts').select('*').eq('id', sessionId).single(),
    knownPatient
      ? Promise.resolve({ data: knownPatient })
      : supabase.from('patients').select('*').eq('hid_code', normalizedHidCode).single(),
    knownRequest
      ? Promise.resolve({ data: [knownRequest] })
      : supabase
        .from('access_requests')
        .select('*')
        .eq('doctor_account_id', sessionId)
        .eq('hid_code', normalizedHidCode)
        .eq('request_type', 'standard')
        .order('created_at', { ascending: false }),
    supabase.from('medical_records').select('*').eq('hid_code', normalizedHidCode).order('created_at', { ascending: false }),
  ])

  const account = (accountRes.data as StaffAccount | null) ?? knownAccount ?? null
  const patient = (patientRes.data as Patient | null) ?? knownPatient ?? null
  const activeRequest = knownRequest ?? (((accessRes.data as AccessRequest[] | null) ?? [])[0] ?? null)
  const records = (recordsRes.data as MedicalRecord[] | null) ?? []
  const ids = records.map(item => item.id)
  const { data: fileData } = ids.length > 0
    ? await supabase.from('medical_record_files').select('*').in('record_id', ids).order('created_at', { ascending: true })
    : { data: [] }
  const recordFiles = groupRecordFiles((fileData as MedicalRecordFile[] | null) ?? [])

  seedDoctorPatientRecordsCache(sessionId, normalizedHidCode, {
    account,
    patient,
    activeRequest,
    records,
    recordFiles,
  })
}

export function seedDoctorDashboardShellCache(sessionId: string, account: StaffAccount | null) {
  const existing = readSessionStorage<DoctorDashboardCache>(`hid_hospital_dashboard_${sessionId}`)
  seedDoctorDashboardCache(sessionId, {
    account,
    requests: existing?.requests ?? [],
    patientNames: existing?.patientNames ?? {},
    accessLogs: existing?.accessLogs ?? [],
  })
}

export function seedDoctorPortalFromAccount(sessionId: string, account: StaffAccount) {
  seedDoctorDashboardShellCache(sessionId, account)
}

export function warmPatientExperience(session: PatientSession, patient: Patient) {
  seedPatientProfileCache(patient)
  void prefetchPatientPortalCaches(session.hidCode, patient)
}
