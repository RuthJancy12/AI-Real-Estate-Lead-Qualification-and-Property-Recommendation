import type { Property } from './property'

export type AgentStatus = 'ready' | 'listening' | 'thinking' | 'recommending'

export type TrackedFieldKey =
  | 'purpose'
  | 'location'
  | 'propertyType'
  | 'bhk'
  | 'budget'
  | 'timeline'
  | 'nearMetro'
  | 'beachfront'
  | 'amenities'

export interface UserRequirements {
  purpose: 'Buy' | 'Rent' | null
  location: string | null
  propertyType: 'Apartment' | 'Villa' | 'Townhouse' | 'Penthouse' | null
  bhk: number | null
  budget: number | null
  /** Move-in timeline: 'Immediate' | 'Within 3 months' | '3–6 months' | 'Just browsing' | null */
  timeline: string | null
  nearMetro: boolean | null
  beachfront: boolean | null
  /** Covered parking required (dataset parking_spaces >= 1). Null = no preference. */
  parking?: boolean | null
  /** Explicit "Not sure" budget answer: show all budgets honestly instead
   * of inventing a ceiling. Null/false = not marked flexible. */
  budgetFlexible?: boolean | null
  amenities: string[]
}

export interface ChatMessage {
  id: string
  sender: 'agent' | 'user'
  text: string
  timestamp: string
  /** Epoch ms assigned once at creation; streaming appends never change it. */
  createdAt: number
  quickActions?: string[]
  showSummary?: boolean
  matchedProperties?: Property[]
  matchExplanations?: Record<string, string>
}
