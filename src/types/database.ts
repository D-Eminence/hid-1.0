export type AccessType = 'standard' | 'emergency'
export type AccessStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type StaffRole = 'doctor'
export type RecordCategory = 'lab_results' | 'drug_prescription' | 'medical_report' | 'other'
export type NotificationType = 'access_request' | 'access_granted' | 'access_rejected' | 'system'
export type VerificationStatus = 'pending_profile' | 'pending_verification' | 'verified'

export type Database = {
  public: {
    Tables: {
      patients: {
        Row: {
          id: string
          first_name: string | null
          last_name: string | null
          full_name: string
          phone: string | null
          email: string | null
          gender: string | null
          auth_password_hash: string | null
          blood_group: string
          nin_verified: boolean | null
          hid_code: string
          pin: string | null
          created_at: string
          nin: string | null
          dob: string | null
          country: string | null
          state: string | null
          genotype: string | null
          allergies: string | null
          chronic_conditions: string | null
          current_medications: string | null
          photo_url: string | null
          emergency_contact_name: string | null
          emergency_contact_relationship: string | null
          emergency_contact_phone: string | null
          emergency_contact_address: string | null
          medical_notes: string | null
          profile_percent: number | null
          notifications_enabled: boolean | null
        }
        Insert: {
          id?: string
          first_name?: string | null
          last_name?: string | null
          full_name: string
          phone?: string | null
          email?: string | null
          gender?: string | null
          auth_password_hash?: string | null
          blood_group?: string
          nin_verified?: boolean | null
          hid_code: string
          pin?: string | null
          created_at?: string
          nin?: string | null
          dob?: string | null
          country?: string | null
          state?: string | null
          genotype?: string | null
          allergies?: string | null
          chronic_conditions?: string | null
          current_medications?: string | null
          photo_url?: string | null
          emergency_contact_name?: string | null
          emergency_contact_relationship?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_address?: string | null
          medical_notes?: string | null
          profile_percent?: number | null
          notifications_enabled?: boolean | null
        }
        Update: Partial<Database['public']['Tables']['patients']['Insert']>
      }
      medical_records: {
        Row: {
          id: string
          hid_code: string
          title: string
          category: RecordCategory
          record: string
          notes: string | null
          attachment_name: string | null
          attachment_type: string | null
          attachment_data_url: string | null
          transcription_text: string | null
          created_by: string
          added_by_role: string | null
          created_at: string
        }
        Insert: {
          id?: string
          hid_code: string
          title: string
          category?: RecordCategory
          record: string
          notes?: string | null
          attachment_name?: string | null
          attachment_type?: string | null
          attachment_data_url?: string | null
          transcription_text?: string | null
          created_by: string
          added_by_role?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['medical_records']['Insert']>
      }
      medical_record_files: {
        Row: {
          id: string
          record_id: string
          file_name: string
          file_type: string | null
          file_data_url: string
          created_at: string
        }
        Insert: {
          id?: string
          record_id: string
          file_name: string
          file_type?: string | null
          file_data_url: string
          created_at?: string
        }
        Update: never
      }
      patient_notes: {
        Row: {
          id: string
          hid_code: string
          note: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          hid_code: string
          note: string
          created_by: string
          created_at?: string
        }
        Update: never
      }
      access_logs: {
        Row: {
          id: string
          hid_code: string
          accessed_by: string
          access_time: string
          reason: string | null
          access_type: AccessType
          request_id: string | null
        }
        Insert: {
          id?: string
          hid_code: string
          accessed_by: string
          access_time?: string
          reason?: string | null
          access_type?: AccessType
          request_id?: string | null
        }
        Update: never
      }
      staff_accounts: {
        Row: {
          id: string
          full_name: string
          hospital_name: string | null
          verification_status: VerificationStatus | null
          email: string
          password_hash: string
          role: StaffRole
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          full_name: string
          hospital_name?: string | null
          verification_status?: VerificationStatus | null
          email: string
          password_hash: string
          role: StaffRole
          active?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['staff_accounts']['Insert']>
      }
      access_requests: {
        Row: {
          id: string
          hid_code: string
          doctor_account_id: string | null
          doctor_name: string
          request_type: AccessType
          status: AccessStatus
          reason: string | null
          pin_verified: boolean
          approved_by: string | null
          approved_at: string | null
          duration_hours: number | null
          access_expires_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          hid_code: string
          doctor_account_id?: string | null
          doctor_name: string
          request_type: AccessType
          status?: AccessStatus
          reason?: string | null
          pin_verified?: boolean
          approved_by?: string | null
          approved_at?: string | null
          duration_hours?: number | null
          access_expires_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['access_requests']['Insert']>
      }
      notifications: {
        Row: {
          id: string
          hid_code: string
          title: string
          message: string
          type: NotificationType
          is_read: boolean
          created_at: string
        }
        Insert: {
          id?: string
          hid_code: string
          title: string
          message: string
          type?: NotificationType
          is_read?: boolean
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['notifications']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Patient = Database['public']['Tables']['patients']['Row'] & {
  access_pin_configured?: boolean | null
}
export type MedicalRecord = Database['public']['Tables']['medical_records']['Row']
export type MedicalRecordFile = Database['public']['Tables']['medical_record_files']['Row']
export type AccessLog = Database['public']['Tables']['access_logs']['Row']
export type StaffAccount = Database['public']['Tables']['staff_accounts']['Row']
export type AccessRequest = Database['public']['Tables']['access_requests']['Row']
export type Notification = Database['public']['Tables']['notifications']['Row']
export type PatientNote = Database['public']['Tables']['patient_notes']['Row']
