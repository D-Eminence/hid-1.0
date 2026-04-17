export type Database = {
  public: {
    Tables: {
      patients: {
        Row: {
          id: string
          full_name: string
          dob: string | null
          blood_group: string
          hid_code: string
          pin: string | null
          created_at: string
          nin: string | null
          gender: string | null
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
        }
        Insert: {
          id?: string
          full_name: string
          dob?: string | null
          blood_group: string
          hid_code: string
          pin?: string | null
          created_at?: string
          nin?: string | null
          gender?: string | null
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
        }
        Update: Partial<Database['public']['Tables']['patients']['Insert']>
      }
      medical_records: {
        Row: {
          id: string
          hid_code: string
          title: string
          record: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          hid_code: string
          title: string
          record: string
          created_by: string
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['medical_records']['Insert']>
      }
      access_logs: {
        Row: {
          id: string
          hid_code: string
          accessed_by: string
          access_time: string
          reason: string | null
          access_type: 'standard' | 'emergency'
        }
        Insert: {
          id?: string
          hid_code: string
          accessed_by: string
          access_time?: string
          reason?: string | null
          access_type?: 'standard' | 'emergency'
        }
        Update: never
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type Patient = Database['public']['Tables']['patients']['Row']
export type MedicalRecord = Database['public']['Tables']['medical_records']['Row']
export type AccessLog = Database['public']['Tables']['access_logs']['Row']
