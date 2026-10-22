// CRM TypeScript types — mirrors backend Pydantic schemas

export interface ScoreBreakdown {
  budget: number
  location: number
  property_type_bedrooms: number
  intent: number
  timeline: number
  preferences: number
  total: number
  label: 'High' | 'Medium' | 'Low'
  reasoning: string[]
}

export interface ExtractedRequirements {
  customer_name: string | null
  contact_email: string | null
  contact_phone: string | null
  lead_type: 'buyer' | 'renter' | null
  property_type: string | null
  location: string | null
  bedrooms: number | null
  budget_min: number | null
  budget_max: number | null
  purpose: string | null
  amenities: string[]
  timeline_days: number | null
  missing_fields: string[]
}

export interface AnalyseResponse {
  requirements: ExtractedRequirements
  score: ScoreBreakdown
  suggestions: string[]
}

export interface CRMProperty {
  id: number
  ref_code: string
  title: string
  property_type: string
  listing_type: 'Sale' | 'Rent'
  location: string
  community: string | null
  bedrooms: number
  bathrooms: number
  size_sqft: number
  price_sale: number | null
  price_rent_monthly: number | null
  description: string | null
  amenities: string[]
  near_metro: boolean
  near_beach: boolean
  view: string | null
  is_available: boolean
  image_url: string | null
  created_at: string
  updated_at: string
}

export interface Recommendation {
  id: number
  property_id: number
  match_score: number
  match_explanation: string
  mismatches: string[]
  /** True for a nearby-community alternative (never the requested location). */
  is_nearby: boolean
  property: CRMProperty
}

export interface Activity {
  id: number
  activity_type: string
  notes: string | null
  created_at: string
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'closed' | 'lost'

export interface Lead {
  id: number
  customer_name: string | null
  contact_email: string | null
  contact_phone: string | null
  lead_type: 'buyer' | 'renter' | null
  property_type: string | null
  location: string | null
  bedrooms: number | null
  budget_min: number | null
  budget_max: number | null
  purpose: string | null
  amenities: string[]
  timeline_days: number | null
  missing_fields: string[]
  priority_score: number
  priority_label: 'High' | 'Medium' | 'Low'
  score_breakdown: ScoreBreakdown
  status: LeadStatus
  raw_enquiry_text: string
  agent_notes: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer: string | null
  /** Self-reported "How did you hear about LYKA Realty?" (separate from UTM). */
  discovery_source: string | null
  created_at: string
  updated_at: string
  recommendations: Recommendation[]
  activities: Activity[]
}

export interface LeadListItem {
  id: number
  customer_name: string | null
  contact_email: string | null
  lead_type: string | null
  location: string | null
  priority_score: number
  priority_label: 'High' | 'Medium' | 'Low'
  status: LeadStatus
  created_at: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  referrer: string | null
  discovery_source: string | null
}

export interface LeadListResponse {
  total: number
  page: number
  per_page: number
  leads: LeadListItem[]
}

export interface DashboardStats {
  total_leads: number
  new_today: number
  high_priority: number
  medium_priority: number
  low_priority: number
  status_counts: Record<string, number>
  recent_activities: Activity[]
}

export interface LeadCreate {
  raw_enquiry_text: string
  customer_name?: string | null
  contact_email?: string | null
  contact_phone?: string | null
  lead_type?: string | null
  property_type?: string | null
  location?: string | null
  bedrooms?: number | null
  budget_min?: number | null
  budget_max?: number | null
  purpose?: string | null
  amenities?: string[]
  timeline_days?: number | null
  missing_fields?: string[]
  priority_score?: number
  priority_label?: string
  score_breakdown?: Record<string, unknown>
}
