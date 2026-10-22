// CRM API client — staff-only backend routes on port 8000.
// Authenticates with the signed-in staff member's Firebase ID token
// (never a hardcoded secret). Unauthenticated calls receive HTTP 401.

import { auth } from '../../services/firebase'
import { formatApiErrorMessage } from '../../services/api'
import type {
  AnalyseResponse,
  DashboardStats,
  Lead,
  LeadCreate,
  LeadListResponse,
  CRMProperty,
} from '../types/crm'

const BASE = 'http://localhost:8000'

async function staffAuthHeader(): Promise<Record<string, string>> {
  try {
    const token = await auth.currentUser?.getIdToken(false)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

/** Shared staff-authenticated fetch (reused by staffApi for /api/staff/*). */
export async function crmFetch<T>(path: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>(path, options)
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // NOTE: options are spread FIRST so the merged headers below (default
  // Content-Type + Firebase token + per-call overrides) are never clobbered
  // by a partial headers object. Reversing this order silently drops
  // Content-Type on every staffFetch write, and FastAPI then rejects the
  // JSON body with 422 "Input should be a valid dictionary or object".
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(await staffAuthHeader()),
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  })

  if (!res.ok) {
    let detail: unknown = `HTTP ${res.status}`
    try {
      const body = await res.json()
      detail = body.detail ?? body
    } catch {/* ignore */}
    throw new Error(formatApiErrorMessage(detail, `Request failed with HTTP ${res.status}`))
  }

  return res.json() as Promise<T>
}

// ── Analyse ──────────────────────────────────────────────────────────────────

export const analyseEnquiry = (text: string): Promise<AnalyseResponse> =>
  apiFetch('/api/leads/analyze', {
    method: 'POST',
    body: JSON.stringify({ enquiry_text: text }),
  })

// ── Leads ─────────────────────────────────────────────────────────────────────

export const createLead = (payload: LeadCreate): Promise<Lead> =>
  apiFetch('/api/leads', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const listLeads = (params?: {
  search?: string
  status?: string
  priority?: string
  lead_type?: string
  channel?: string
  page?: number
  per_page?: number
}): Promise<LeadListResponse> => {
  const qs = new URLSearchParams()
  if (params?.search) qs.set('search', params.search)
  if (params?.status) qs.set('status', params.status)
  if (params?.priority) qs.set('priority', params.priority)
  if (params?.lead_type) qs.set('lead_type', params.lead_type)
  if (params?.channel) qs.set('channel', params.channel)
  if (params?.page) qs.set('page', String(params.page))
  if (params?.per_page) qs.set('per_page', String(params.per_page))
  return apiFetch(`/api/leads?${qs}`)
}

export const getLead = (id: number): Promise<Lead> =>
  apiFetch(`/api/leads/${id}`)

export const updateLead = (id: number, data: Partial<Lead>): Promise<Lead> =>
  apiFetch(`/api/leads/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })

export const updateLeadStatus = (
  id: number,
  status: string,
  notes?: string
): Promise<Lead> =>
  apiFetch(`/api/leads/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, notes }),
  })

export const refreshRecommendations = (id: number): Promise<Lead> =>
  apiFetch(`/api/leads/${id}/recommendations`, { method: 'POST' })

// ── Dashboard ─────────────────────────────────────────────────────────────────

export const getDashboardStats = (): Promise<DashboardStats> =>
  apiFetch('/api/leads/stats/dashboard')

// ── Properties ────────────────────────────────────────────────────────────────

export const listProperties = (params?: {
  location?: string
  listing_type?: string
  bedrooms?: number
  available_only?: boolean
}): Promise<CRMProperty[]> => {
  const qs = new URLSearchParams()
  if (params?.location) qs.set('location', params.location)
  if (params?.listing_type) qs.set('listing_type', params.listing_type)
  if (params?.bedrooms !== undefined) qs.set('bedrooms', String(params.bedrooms))
  if (params?.available_only !== undefined) qs.set('available_only', String(params.available_only))
  return apiFetch(`/api/properties?${qs}`)
}

export const createProperty = (data: Omit<CRMProperty, 'id' | 'created_at' | 'updated_at'>): Promise<CRMProperty> =>
  apiFetch('/api/properties', {
    method: 'POST',
    body: JSON.stringify(data),
  })

export const updateProperty = (id: number, data: Partial<CRMProperty>): Promise<CRMProperty> =>
  apiFetch(`/api/properties/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
