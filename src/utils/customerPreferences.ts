/**
 * Customer property-preferences form helpers (pure, unit-testable).
 *
 * Every preference is optional: an untouched form builds `undefined` so the
 * backend keeps whatever the SQL row already holds. Nothing is invented —
 * missing stays missing on both sides.
 */
import type { CustomerPreferences } from '../services/api'

export const PURPOSE_OPTIONS = ['Buy', 'Rent', 'Invest'] as const
export type PurposeOption = (typeof PURPOSE_OPTIONS)[number]

export const PROPERTY_TYPE_OPTIONS = ['Apartment', 'Villa', 'Townhouse', 'Penthouse'] as const
export type PropertyTypeOption = (typeof PROPERTY_TYPE_OPTIONS)[number]

/** Bedroom choices shown in selects (0 = Studio). */
export const BEDROOM_OPTIONS: Array<{ label: string; value: number }> = [
  { label: 'Studio', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5+', value: 5 },
]

/**
 * Expected buying/renting timeline. The customer picks a plain-language
 * label; only the chosen day count is stored (null = not stated).
 */
export const TIMELINE_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: 'As soon as possible', days: 30 },
  { label: 'Within 3 months', days: 90 },
  { label: '3–6 months', days: 180 },
  { label: '6–12 months', days: 365 },
  { label: 'Just exploring', days: null },
]

/** Controlled state for the preferences step/editor. All fields optional. */
export interface PreferencesFormState {
  purpose: string
  propertyType: string
  bedrooms: string
  budgetMin: string
  budgetMax: string
  community: string
  timelineDays: string
}

export function emptyPreferencesForm(): PreferencesFormState {
  return {
    purpose: '',
    propertyType: '',
    bedrooms: '',
    budgetMin: '',
    budgetMax: '',
    community: '',
    timelineDays: '',
  }
}

function toNumberOrNull(raw: string): number | null {
  const t = raw.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Returns an error message, or null when the preferences are valid. */
export function validatePreferencesForm(state: PreferencesFormState): string | null {
  if (state.purpose && !(PURPOSE_OPTIONS as readonly string[]).includes(state.purpose)) {
    return 'Please choose a valid purpose (Buy, Rent, or Invest).'
  }
  if (state.propertyType && !(PROPERTY_TYPE_OPTIONS as readonly string[]).includes(state.propertyType)) {
    return 'Please choose a valid property type.'
  }
  if (state.bedrooms) {
    const b = toNumberOrNull(state.bedrooms)
    if (b === null || !Number.isInteger(b) || b < 0 || b > 20) {
      return 'Bedrooms must be a whole number between 0 and 20.'
    }
  }
  const min = toNumberOrNull(state.budgetMin)
  const max = toNumberOrNull(state.budgetMax)
  if (state.budgetMin.trim() && (min === null || min < 0)) {
    return 'Minimum budget must be a positive amount.'
  }
  if (state.budgetMax.trim() && (max === null || max < 0)) {
    return 'Maximum budget must be a positive amount.'
  }
  if (min !== null && max !== null && min > max) {
    return 'Minimum budget cannot be higher than maximum budget.'
  }
  if (state.community.trim().length > 100) {
    return 'Preferred community is too long (maximum 100 characters).'
  }
  if (state.timelineDays.trim()) {
    const t = toNumberOrNull(state.timelineDays)
    if (t === null || !Number.isInteger(t) || t < 0 || t > 3650) {
      return 'Please choose a valid timeline.'
    }
  }
  return null
}

/**
 * Builds the API payload, or `undefined` when the customer stated nothing
 * (so JSON omits it and the backend keeps existing SQL preferences).
 */
export function buildPreferencesPayload(
  state: PreferencesFormState
): CustomerPreferences | undefined {
  const community = state.community.trim()
  const payload: CustomerPreferences = {
    locations: community ? [community] : [],
    propertyType: (PROPERTY_TYPE_OPTIONS as readonly string[]).includes(state.propertyType)
      ? state.propertyType
      : null,
    bedrooms: state.bedrooms.trim() ? toNumberOrNull(state.bedrooms) : null,
    budgetMin: state.budgetMin.trim() ? toNumberOrNull(state.budgetMin) : null,
    budgetMax: state.budgetMax.trim() ? toNumberOrNull(state.budgetMax) : null,
    purpose: (PURPOSE_OPTIONS as readonly string[]).includes(state.purpose)
      ? state.purpose
      : null,
    timeline_days: state.timelineDays.trim() ? toNumberOrNull(state.timelineDays) : null,
  }
  const empty =
    payload.locations.length === 0 &&
    payload.propertyType === null &&
    payload.bedrooms === null &&
    payload.budgetMin === null &&
    payload.budgetMax === null &&
    payload.purpose === null &&
    payload.timeline_days === null
  return empty ? undefined : payload
}

/** Server/local preferences → editable form state (for the Account editor). */
export function preferencesToForm(p: {
  locations?: string[] | null
  propertyType?: string | null
  bedrooms?: number | null
  budgetMin?: number | null
  budgetMax?: number | null
  purpose?: string | null
  timeline_days?: number | null
} | null | undefined): PreferencesFormState {
  if (!p) return emptyPreferencesForm()
  return {
    purpose: p.purpose ?? '',
    propertyType: p.propertyType ?? '',
    bedrooms: p.bedrooms ?? null ? String(p.bedrooms) : '',
    budgetMin: p.budgetMin ?? null ? String(p.budgetMin) : '',
    budgetMax: p.budgetMax ?? null ? String(p.budgetMax) : '',
    community: (p.locations ?? [])[0] ?? '',
    timelineDays: p.timeline_days ?? null ? String(p.timeline_days) : '',
  }
}
