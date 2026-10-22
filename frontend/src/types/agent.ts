import type { Property } from './property'

export type AgentStatus = 'ready' | 'listening' | 'thinking' | 'recommending'

export type TrackedFieldKey =
  | 'purpose'
  | 'location'
  | 'propertyType'
  | 'bhk'
  | 'budget'
  | 'nearMetro'
  | 'beachfront'
  | 'amenities'

export interface UserRequirements {
  purpose: 'Buy' | 'Rent' | null
  location: string | null
  propertyType: 'Apartment' | 'Villa' | 'Townhouse' | 'Penthouse' | null
  bhk: number | null
  budget: number | null
  nearMetro: boolean | null
  beachfront: boolean | null
  amenities: string[]
}

export interface ChatMessage {
  id: string
  sender: 'agent' | 'user'
  text: string
  timestamp: string
  quickActions?: string[]
  showSummary?: boolean
  matchedProperties?: Property[]
  matchExplanations?: Record<string, string>
}
