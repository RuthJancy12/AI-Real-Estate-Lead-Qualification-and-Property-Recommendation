/**
 * Lyka Realty API Service
 * Secure communication helper for FastAPI backend & OpenAI Realtime AI
 */
import type { Property } from '../types/property'
import type { UserRequirements } from '../types/agent'
import { auth } from './firebase'

export const BACKEND_URL =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:8000'

/**
 * Best-effort Firebase ID token for backend verification. Uses the cached
 * token (no refresh) so it never slows the chat down; returns undefined when
 * signed out or unavailable, in which case the request proceeds anonymously.
 */
async function getIdTokenHeader(): Promise<Record<string, string>> {
  try {
    const token = await auth.currentUser?.getIdToken(false)
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

export interface HealthResponse {
  status: string
  provider?: string
  model?: string
  ollama?: {
    status: string
    target_model?: string
    model_available?: boolean
    available_models?: string[]
    detail?: string
  }
  message: string
}

export interface OllamaStatusResponse {
  status: 'online' | 'offline' | 'error'
  base_url: string
  target_model: string
  model_available: boolean
  available_models?: string[]
  detail?: string
}

export interface CommunityInfo {
  location: string
  listings: number
}

/** Fallback chips when the communities endpoint is unreachable. Real
 * dataset names, so nothing invented — live counts simply unavailable. */
export const FALLBACK_COMMUNITIES = [
  'Dubai Marina',
  'Downtown Dubai',
  'Palm Jumeirah',
  'Business Bay',
]

let communitiesCache: string[] | null = null
let communitiesInflight: Promise<string[]> | null = null

/**
 * Real dataset communities for location chips/dropdowns (most stocked
 * first). Public endpoint, cached process-wide, single inflight request —
 * guests and repeated opens never refetch. Falls back to a short real
 * list when the backend is unreachable.
 */
export function fetchAvailableLocations(): Promise<string[]> {
  if (communitiesCache) return Promise.resolve(communitiesCache)
  if (communitiesInflight) return communitiesInflight
  communitiesInflight = fetch(`${BACKEND_URL}/api/communities`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    })
    .then((data: { communities?: CommunityInfo[] }) => {
      const names = (data.communities || [])
        .map((c) => (c.location || '').trim())
        .filter(Boolean)
      communitiesCache = names.length > 0 ? names : [...FALLBACK_COMMUNITIES]
      communitiesInflight = null
      return communitiesCache
    })
    .catch(() => {
      communitiesInflight = null
      communitiesCache = [...FALLBACK_COMMUNITIES]
      return communitiesCache
    })
  return communitiesInflight
}

/** Test hook: resets the communities cache. */
export function __resetCommunitiesCacheForTests(): void {
  communitiesCache = null
  communitiesInflight = null
}

export interface ChatHistoryTurn {
  role: 'user' | 'model'
  text: string
}

export interface ChatApiResponse {
  reply: string
  matched_properties: Property[]
  requirements: UserRequirements
  session_id: string
  provider?: string
  model?: string
  /** Clarification gate from the backend: which question is being asked. */
  need?: 'purpose' | 'property_type' | 'location' | 'bhk' | 'budget' | 'timeline' | 'metro' | 'beach' | 'no_results' | null
  /** Clickable choices for the clarification question. */
  options?: string[]
}

/**
 * Formats a backend error body into a human-readable message.
 *
 * FastAPI validation failures (HTTP 422) arrive as
 * `{ detail: [{ loc, msg, type, ... }] }` — passing that object straight
 * into `new Error(...)` stringifies to "[object Object]", which is what the
 * "Unable to Load Properties" banner displayed. This extractor flattens
 * string, array, and object shapes into plain text.
 */
export function formatApiErrorMessage(errorData: unknown, fallback: string): string {
  try {
    if (typeof errorData === 'string') {
      const t = errorData.trim()
      if (t && t !== '[object Object]') return t
    }
    if (errorData && typeof errorData === 'object') {
      const detail = (errorData as Record<string, unknown>).detail ?? errorData
      if (typeof detail === 'string') {
        const t = detail.trim()
        if (t) return t
      } else if (Array.isArray(detail)) {
        const parts = detail
          .map((d) => {
            if (typeof d === 'string') return d
            if (d && typeof d === 'object') {
              const rec = d as Record<string, unknown>
              const loc = Array.isArray(rec.loc) ? rec.loc.join('.') : ''
              const msg = typeof rec.msg === 'string' ? rec.msg : JSON.stringify(d)
              return loc ? `${loc}: ${msg}` : msg
            }
            return null
          })
          .filter((p): p is string => Boolean(p))
        if (parts.length > 0) return parts.join('; ')
      } else if (detail && typeof detail === 'object') {
        const rec = detail as Record<string, unknown>
        if (typeof rec.message === 'string' && rec.message.trim()) return rec.message
        const s = JSON.stringify(detail)
        if (s && s !== '{}') return s
      }
    }
  } catch {
    // Fall through to the fallback message below.
  }
  return fallback
}

/**
 * Calls GET /api/health on the FastAPI backend.
 */
export async function getBackendHealth(): Promise<HealthResponse> {
  const response = await fetch(`${BACKEND_URL}/api/health`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Backend health check failed with HTTP ${response.status}`)
  }

  const data: HealthResponse = await response.json()
  return data
}

/**
 * Calls GET /api/ollama/status on the FastAPI backend.
 */
export async function getOllamaStatus(): Promise<OllamaStatusResponse> {
  const response = await fetch(`${BACKEND_URL}/api/ollama/status`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Ollama status check failed with HTTP ${response.status}`)
  }

  const data: OllamaStatusResponse = await response.json()
  return data
}

/**
 * Sends a natural language chat message to OpenAI assistant via the FastAPI backend.
 * Passes the complete conversation history and receives real properties & requirements.
 */
export async function sendChatMessage(
  message: string,
  sessionId = 'default',
  history?: ChatHistoryTurn[]
): Promise<ChatApiResponse> {
  const controller = new AbortController()
  // Must exceed the backend Ollama budget (OLLAMA_TIMEOUT default 90s for up
  // to two sequential model calls). Genuine timeouts still surface as errors.
  const timeoutId = setTimeout(() => controller.abort(), 120000)

  try {
    const authHeader = await getIdTokenHeader()
    const response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...authHeader
      },
      body: JSON.stringify({
        message,
        session_id: sessionId,
        history: history || []
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        formatApiErrorMessage(errorData, `Chat request failed with HTTP ${response.status}`)
      )
    }

    const data: ChatApiResponse = await response.json()
    return data
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Chat request timed out. The local AI model is taking longer than expected.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export interface ChatStreamMeta {
  matched_properties: Property[]
  requirements: UserRequirements
  session_id: string
  need?: ChatApiResponse['need']
  options?: string[]
}

export interface ChatStreamEvents {
  /** First event (<10ms): cards, requirements, gate options — render now. */
  onMeta?: (meta: ChatStreamMeta) => void
  /** Each generated token chunk: append to the pending bubble. */
  onToken?: (token: string) => void
}

/**
 * Streams a chat turn from POST /api/chat/stream (SSE: meta → tokens →
 * done). Meta arrives in milliseconds so property cards, requirements,
 * and gate options render while the local model still generates text.
 * Resolves with the final assembled turn. History is intentionally NOT
 * sent: the backend keeps the session server-side and ignores client
 * history, so transmitting it only wastes bytes every turn.
 */
export async function sendChatMessageStream(
  message: string,
  sessionId = 'default',
  events: ChatStreamEvents = {}
): Promise<ChatApiResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)

  try {
    const authHeader = await getIdTokenHeader()
    const response = await fetch(`${BACKEND_URL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeader
      },
      body: JSON.stringify({ message, session_id: sessionId }),
      signal: controller.signal
    })

    if (!response.ok || !response.body) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        formatApiErrorMessage(errorData, `Chat request failed with HTTP ${response.status}`)
      )
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done: ChatApiResponse | null = null

    for (;;) {
      const { value, done: readerDone } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !readerDone })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 2)
        if (chunk.startsWith('data:')) {
          try {
            const evt = JSON.parse(chunk.slice(5).trim())
            if (evt.type === 'meta') {
              events.onMeta?.({
                matched_properties: evt.matched_properties || [],
                requirements: evt.requirements,
                session_id: evt.session_id,
                need: evt.need ?? null,
                options: evt.options,
              })
            } else if (evt.type === 'token') {
              events.onToken?.(evt.token || '')
            } else if (evt.type === 'done') {
              done = {
                reply: evt.reply || '',
                matched_properties: evt.matched_properties || [],
                requirements: evt.requirements,
                session_id: evt.session_id,
                provider: evt.provider,
                model: evt.model,
                need: evt.need ?? null,
                options: evt.options,
              }
            }
          } catch {
            // Ignore malformed SSE frames; later frames still apply.
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (readerDone) break
    }

    if (!done) throw new Error('Chat stream ended without a response.')
    return done
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Chat request timed out. The local AI model is taking longer than expected.')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export interface CustomerPreferences {
  locations: string[]
  propertyType: string | null
  bedrooms: number | null
  budgetMin: number | null
  budgetMax: number | null
  purpose: string | null
  /** Expected buying/renting timeline in days (null = not stated). */
  timeline_days: number | null
}

export interface CustomerProfile {
  firebase_uid: string
  email: string | null
  name: string | null
  phone: string | null
  city: string | null
  country: string | null
  preferences: CustomerPreferences
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer: string | null
  /** Self-reported "How did you hear about LYKA Realty?" (separate from UTM). */
  discovery_source: string | null
  role: string
  created_at: string
  updated_at: string
}

export interface CustomerProfileResponse {
  profile: CustomerProfile | null
  role: string
}

/**
 * Reads my backend customer profile (UID-owned; 401 when signed out).
 * Never throws for missing rows — returns {profile: null}.
 */
export async function getCustomerProfile(): Promise<CustomerProfileResponse> {
  const authHeader = await getIdTokenHeader()
  const response = await fetch(`${BACKEND_URL}/api/customer/profile`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader },
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      formatApiErrorMessage(errorData, `Profile load failed with HTTP ${response.status}`)
    )
  }
  return (await response.json()) as CustomerProfileResponse
}

export interface CustomerProfileInput {
  name: string
  phone?: string
  city?: string
  country?: string
  preferences?: CustomerPreferences
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  referrer?: string | null
  discovery_source?: string | null
}

/**
 * Saves my backend customer profile. Resolves only on HTTP 200 so the UI
 * shows success strictly after the backend confirms the save.
 */
export async function saveCustomerProfile(
  input: CustomerProfileInput
): Promise<CustomerProfileResponse> {
  const authHeader = await getIdTokenHeader()
  const response = await fetch(`${BACKEND_URL}/api/customer/profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      formatApiErrorMessage(errorData, `Profile save failed with HTTP ${response.status}`)
    )
  }
  return (await response.json()) as CustomerProfileResponse
}

export interface PublicEnquiryPayload {
  customer_name: string
  contact_email: string
  contact_phone?: string
  property_ref?: string
  property_title?: string
  location?: string
  lead_type?: 'buyer' | 'renter'
  property_type?: string
  message?: string
  preferred_date?: string
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  referrer?: string | null
  discovery_source?: string | null
}

export interface PublicEnquiryResponse {
  id: number
  status: string
  [key: string]: unknown
}

/**
 * Submits an anonymous customer website enquiry to POST /api/leads/public.
 * Resolves only when the backend confirms the save (HTTP 201); throws a
 * human-readable error otherwise so callers show success ONLY on confirm.
 */
export async function submitPublicEnquiry(
  payload: PublicEnquiryPayload
): Promise<PublicEnquiryResponse> {
  const response = await fetch(`${BACKEND_URL}/api/leads/public`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(
      formatApiErrorMessage(errorData, `Enquiry submission failed with HTTP ${response.status}`)
    )
  }

  const data: PublicEnquiryResponse = await response.json()
  return data
}

export interface PropertySearchParams {
  location?: string
  property_type?: string
  bedrooms?: number
  bathrooms?: number
  min_budget?: number
  max_budget?: number
  purpose?: string
  near_metro?: boolean
  near_beach?: boolean
  main_road_access?: boolean
  availability?: string
  view?: string
  sort_by?: string
  limit?: number
  min_parking?: number
  amenities?: string[]
}

export interface PropertySearchResponse {
  total_found: number
  exact_match: boolean
  top_properties: Property[]
  ai_summary: any[]
  criteria: Record<string, any>
  fallback?: {
    used: boolean
    requested_location?: string | null
    nearby_locations?: string[]
  }
}

/**
 * Searches real Dubai properties from the FastAPI backend GET /api/properties/search.
 */
export async function fetchPropertiesFromApi(
  params: PropertySearchParams = {}
): Promise<PropertySearchResponse> {
  const query = new URLSearchParams()
  if (params.location) query.append('location', params.location)
  if (params.property_type) query.append('property_type', params.property_type)
  if (params.bedrooms !== undefined && params.bedrooms !== null) {
    query.append('bedrooms', String(params.bedrooms))
  }
  if (params.bathrooms !== undefined && params.bathrooms !== null) {
    query.append('bathrooms', String(params.bathrooms))
  }
  if (params.min_budget !== undefined && params.min_budget > 0) {
    query.append('min_budget', String(params.min_budget))
  }
  if (params.max_budget !== undefined && params.max_budget > 0) {
    query.append('max_budget', String(params.max_budget))
  }
  if (params.purpose && params.purpose !== 'All') {
    query.append('purpose', params.purpose)
  }
  if (params.near_metro !== undefined) {
    query.append('near_metro', String(params.near_metro))
  }
  if (params.near_beach !== undefined) {
    query.append('near_beach', String(params.near_beach))
  }
  if (params.main_road_access !== undefined) {
    query.append('main_road_access', String(params.main_road_access))
  }
  if (params.availability) query.append('availability', params.availability)
  if (params.view) query.append('view', params.view)
  if (params.sort_by) query.append('sort_by', params.sort_by)
  if (params.limit !== undefined) query.append('limit', String(params.limit))
  if (params.min_parking !== undefined && params.min_parking !== null) {
    query.append('min_parking', String(params.min_parking))
  }
  for (const am of params.amenities || []) {
    if (am && am.trim()) query.append('amenity', am.trim())
  }

  const qs = query.toString()
  const url = `${BACKEND_URL}/api/properties/search${qs ? `?${qs}` : ''}`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(formatApiErrorMessage(errorData, `Property search failed with HTTP ${response.status}`))
  }

  const data: PropertySearchResponse = await response.json()
  return data
}
