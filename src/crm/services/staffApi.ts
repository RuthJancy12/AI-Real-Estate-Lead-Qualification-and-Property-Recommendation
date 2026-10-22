// Staff role resolution + /api/staff/* client. Role comes ONLY from the
// backend (verified Firebase token -> staff_users row); the frontend never
// assigns or trusts a client-side role.

import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { auth } from '../../services/firebase'
import { crmFetch } from './crmApi'

export type StaffRole = 'admin' | 'manager' | 'sales_manager' | 'salesperson'

export interface StaffMe {
  id: number
  email: string
  name: string
  role: StaffRole
  is_active: boolean
  manager_email: string | null
  last_login_at: string | null
}

async function staffTokenHeader(): Promise<Record<string, string>> {
  try {
    const token = await auth.currentUser?.getIdToken(false)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export async function staffFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return crmFetch<T>(path, {
    ...options,
    headers: {
      ...(await staffTokenHeader()),
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  })
}

export interface StaffRoleState {
  me: StaffMe | null
  role: StaffRole | null
  loading: boolean
  error: string | null
  refresh: () => void
}

// Dedupe + short cache: layout, gates, and pages all resolve the role on
// mount; without this each instance fires its own GET /api/staff/me.
let meCache: { at: number; data: StaffMe } | null = null
let meInflight: Promise<StaffMe> | null = null

export function clearStaffMeCache(): void {
  meCache = null
  meInflight = null
}

export function fetchStaffMe(): Promise<StaffMe> {
  const now = Date.now()
  if (meCache && now - meCache.at < 60000) return Promise.resolve(meCache.data)
  if (meInflight) return meInflight
  meInflight = staffFetch<StaffMe>('/api/staff/me').then((d) => {
    meCache = { at: Date.now(), data: d }
    meInflight = null
    return d
  }).catch((e: unknown) => {
    meInflight = null
    throw e
  })
  return meInflight
}

export interface Assignment {
  id: number
  lead_id: number
  staff_email: string
  assigned_by: string
  status: string
  created_at: string
  updated_at: string
}

export interface FollowUp {
  id: number
  lead_id: number
  staff_email: string
  note: string
  next_action_at: string | null
  created_at: string
}

export interface Viewing {
  id: number
  lead_id: number
  property_ref: string
  staff_email: string
  scheduled_at: string
  status: string
  notes: string | null
  created_at: string
  updated_at: string
}

export const listAssignments = (): Promise<Assignment[]> =>
  staffFetch('/api/staff/assignments')

export const createAssignment = (lead_id: number, staff_email: string): Promise<Assignment> =>
  staffFetch('/api/staff/assignments', {
    method: 'POST',
    body: JSON.stringify({ lead_id, staff_email }),
  })

export const updateAssignment = (id: number, status: string): Promise<Assignment> =>
  staffFetch(`/api/staff/assignments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })

export const listFollowUps = (lead_id?: number): Promise<FollowUp[]> =>
  staffFetch(`/api/staff/followups${lead_id ? `?lead_id=${lead_id}` : ''}`)

export const createFollowUp = (lead_id: number, note: string, next_action_at?: string): Promise<FollowUp> =>
  staffFetch('/api/staff/followups', {
    method: 'POST',
    body: JSON.stringify({ lead_id, note, next_action_at: next_action_at || null }),
  })

export const listViewings = (): Promise<Viewing[]> =>
  staffFetch('/api/staff/viewings')

export const createViewing = (lead_id: number, property_ref: string, scheduled_at: string): Promise<Viewing> =>
  staffFetch('/api/staff/viewings', {
    method: 'POST',
    body: JSON.stringify({ lead_id, property_ref, scheduled_at }),
  })

export const updateViewing = (id: number, data: { status?: string; notes?: string; scheduled_at?: string }): Promise<Viewing> =>
  staffFetch(`/api/staff/viewings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export interface StaffListItem extends StaffMe {
  firebase_uid: string | null
  created_at: string
  updated_at: string
}

export const listStaff = (includeInactive = false): Promise<StaffListItem[]> =>
  staffFetch(`/api/staff?include_inactive=${includeInactive ? 'true' : 'false'}`)

export const createStaff = (email: string, name: string, role: StaffRole, manager_email?: string): Promise<StaffListItem> =>
  staffFetch('/api/staff', {
    method: 'POST',
    body: JSON.stringify({ email, name, role, manager_email: manager_email || null }),
  })

export const updateStaff = (id: number, data: { name?: string; role?: StaffRole; is_active?: boolean; manager_email?: string | null }): Promise<StaffListItem> =>
  staffFetch(`/api/staff/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export interface OverviewFollowUp {
  id: number
  lead_id: number
  staff_email: string
  note: string
  next_action_at: string | null
  created_at: string | null
}

export interface OverviewViewing {
  id: number
  lead_id: number
  property_ref: string
  staff_email: string
  scheduled_at: string | null
  status: string
}

export interface OverviewInquiry {
  id: number
  customer_name: string | null
  contact_email: string | null
  location: string | null
  status: string
  priority_label: string
  created_at: string | null
}

export interface OverviewPerf {
  staff_email: string
  open: number
  in_progress: number
  closed: number
  total: number
}

export interface StaffOverview {
  role: StaffRole
  leads_total: number
  assigned_leads: number
  unassigned_leads: number
  pipeline: Record<string, number>
  channel_breakdown: Record<string, number>
  followups_due_count: number
  followups_due: OverviewFollowUp[]
  upcoming_viewings: OverviewViewing[]
  recent_inquiries: OverviewInquiry[]
  team_performance: OverviewPerf[]
  staff_total?: number
  active_staff?: number
  team_members?: string[]
  team_size?: number
}

export interface StaffCustomer {
  name: string | null
  email: string | null
  phone: string | null
  city: string | null
  country: string | null
  role: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer: string | null
  discovery_source: string | null
  created_at: string | null
  updated_at: string | null
}

export const listCustomers = (): Promise<StaffCustomer[]> =>
  staffFetch('/api/staff/customers')

export const getOverview = (): Promise<StaffOverview> =>
  staffFetch('/api/staff/overview')

/** Resolves the signed-in user's staff role via GET /api/staff/me. Null = customer/guest. */
export function useStaffRole(): StaffRoleState {
  const { user } = useAuth()
  const [me, setMe] = useState<StaffMe | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!user) {
      clearStaffMeCache()
      setMe(null)
      setError(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchStaffMe()
      .then((data) => {
        if (!cancelled) {
          setMe(data)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          // 401/403 = signed in but not staff (a customer) — not an error state.
          setMe(null)
          setError(null)
          setLoading(false)
          void err
        }
      })
    return () => {
      cancelled = true
    }
  }, [user?.uid, nonce])

  return {
    me,
    role: me?.role ?? null,
    loading,
    error,
    refresh: () => {
      clearStaffMeCache()
      setNonce((n) => n + 1)
    },
  }
}
