#!/usr/bin/env bash
set -euo pipefail

cd /home/l2e/V1/hid-unified-package

read_env_value() {
  local key="$1"
  grep -E "^${key}=" ./supabase/.env.production | head -n 1 | cut -d '=' -f 2-
}

export SUPABASE_URL="$(read_env_value SUPABASE_URL)"
export SUPABASE_SERVICE_ROLE_KEY="$(read_env_value SUPABASE_SERVICE_ROLE_KEY)"

node --input-type=module <<'EOF'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const keepEmail = 'eminence742@gmail.com'
const bucketName = 'medical-record-files'

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function listAllUsers() {
  const users = []
  let page = 1

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error

    const batch = data?.users ?? []
    users.push(...batch)
    if (batch.length < 200) break
    page += 1
  }

  return users
}

async function selectWhereIn(table, column, values, select) {
  if (!values.length) return []
  const rows = []
  for (const slice of chunk(values, 100)) {
    const { data, error } = await admin.from(table).select(select).in(column, slice)
    if (error) throw error
    rows.push(...(data ?? []))
  }
  return rows
}

const users = await listAllUsers()
const removeUsers = users.filter(user => (user.email ?? '').toLowerCase() !== keepEmail)
const removeUserIds = removeUsers.map(user => user.id)

const profiles = await selectWhereIn('hid_user_profiles', 'auth_user_id', removeUserIds, 'id, auth_user_id')
const profileIds = [...new Set(profiles.map(profile => profile.id).filter(Boolean))]

const patients = await selectWhereIn('hid_patients', 'auth_user_id', removeUserIds, 'id')
const patientIds = [...new Set(patients.map(patient => patient.id).filter(Boolean))]

const staffAccounts = await selectWhereIn('hid_staff_accounts', 'auth_user_id', removeUserIds, 'id')
const staffIds = [...new Set(staffAccounts.map(staff => staff.id).filter(Boolean))]

const orgMemberships = staffIds.length
  ? await selectWhereIn('hid_staff_memberships', 'staff_account_id', staffIds, 'organization_id')
  : []
const organizationIds = [...new Set(orgMemberships.map(item => item.organization_id).filter(Boolean))]

const recordRowsFromPatients = patientIds.length
  ? await selectWhereIn('hid_medical_records', 'patient_id', patientIds, 'id')
  : []
const recordRowsFromProfiles = profileIds.length
  ? await selectWhereIn('hid_medical_records', 'created_by_user_profile_id', profileIds, 'id')
  : []
const recordIds = [...new Set([...recordRowsFromPatients, ...recordRowsFromProfiles].map(item => item.id).filter(Boolean))]

const fileRowsFromPatients = patientIds.length
  ? await selectWhereIn('hid_medical_record_files', 'patient_id', patientIds, 'storage_path')
  : []
const fileRowsFromProfiles = profileIds.length
  ? await selectWhereIn('hid_medical_record_files', 'uploaded_by_user_profile_id', profileIds, 'storage_path')
  : []
const fileRowsFromRecords = recordIds.length
  ? await selectWhereIn('hid_medical_record_files', 'record_id', recordIds, 'storage_path')
  : []

const storagePaths = [...new Set([...fileRowsFromPatients, ...fileRowsFromProfiles, ...fileRowsFromRecords]
  .map(item => item.storage_path)
  .filter(Boolean))]

for (const slice of chunk(storagePaths, 100)) {
  const { error } = await admin.storage.from(bucketName).remove(slice)
  if (error) throw error
}

for (const userId of removeUserIds) {
  const { error } = await admin.rpc('hid_delete_account_by_auth_user_id', {
    p_auth_user_id: userId,
  })
  if (error) throw error
}

console.log(JSON.stringify({
  deletedPatients: patientIds.length,
  deletedStaffAccounts: staffIds.length,
  deletedAuthUsers: removeUserIds.length,
  preservedAdmin: keepEmail,
}, null, 2))
EOF
