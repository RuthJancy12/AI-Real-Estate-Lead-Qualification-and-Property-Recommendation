/**
 * Lyka Realty API Service
 * Secure communication helper for FastAPI backend & OpenAI Realtime AI
 */
import type { Property } from '../types/property'
import type { UserRequirements } from '../types/agent'

export const BACKEND_URL =
  (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:8000'

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
  const timeoutId = setTimeout(() => controller.abort(), 65000)

  try {
    const response = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
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
        errorData.detail || `Chat request failed with HTTP ${response.status}`
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
  view?: string
  sort_by?: string
  limit?: number
}

export interface PropertySearchResponse {
  total_found: number
  exact_match: boolean
  top_properties: Property[]
  ai_summary: any[]
  criteria: Record<string, any>
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
  if (params.view) query.append('view', params.view)
  if (params.sort_by) query.append('sort_by', params.sort_by)
  if (params.limit !== undefined) query.append('limit', String(params.limit))

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
    throw new Error(errorData.detail || `Property search failed with HTTP ${response.status}`)
  }

  const data: PropertySearchResponse = await response.json()
  return data
}
