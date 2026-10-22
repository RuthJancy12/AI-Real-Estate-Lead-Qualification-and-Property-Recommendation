// Customer account dashboard: profile, saved conversations, favorites,
// and inquiries — the customer's OWN records only (local cache first,
// Firebase mirror when signed in; never another user's data).

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Heart, MessageSquareText, Tag, User, Loader2, AlertCircle, Trash2, ShieldCheck, KeyRound, CheckCircle2, Sparkles } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useStaffRole } from '../crm/services/staffApi'
import { authFailureMessage } from '../services/authErrors'
import type { Property } from '../types/property'
import { formatProperty } from '../utils/propertyData'
import { validateCustomerProfile } from '../utils/customerProfile'
import { fetchPropertiesFromApi, getCustomerProfile, saveCustomerProfile, type CustomerProfile } from '../services/api'
import { collectLeadSource } from '../utils/leadSource'
import { normalizeDiscoverySource } from '../utils/leadSource'
import { DiscoverySourceSelect } from '../components/DiscoverySourceSelect'
import { classifyLeadChannel } from '../utils/leadSource'
import { PropertyCard } from '../components/PropertyCard'
import { PropertyModal } from '../components/PropertyModal'
import {
  getLocalUser, getLocalPreferences, saveLocalUser, saveLocalPreferences,
  type PreferencesDoc,
  getInquiries, getLastChatSessionId, getSessionTurns,
  getInteractions, getTrackingConsent, setTrackingConsent,
  ownerKeyFor, favoritesKeyFor,
} from '../services/chatStore'
import type { CustomerPreferences } from '../services/api'
import {
  PURPOSE_OPTIONS, PROPERTY_TYPE_OPTIONS, BEDROOM_OPTIONS, TIMELINE_OPTIONS,
  preferencesToForm, validatePreferencesForm, buildPreferencesPayload,
} from '../utils/customerPreferences'
import {
  personalizedPicks, type FeedSignals,
} from '../utils/personalizedFeed'
import {
  sanitizeFavoriteIds, resolveFavoriteProperties, toggleFavoriteId,
} from '../utils/favorites'
import { cloudSaveFavoritesAll } from '../services/rtdb'

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--champagne-border)',
  borderRadius: '12px', padding: '20px', marginBottom: '18px',
}

/** Local prefs → server payload. Undefined when nothing meaningful is set
 * (so JSON omits it and the backend keeps existing server-side prefs). */
function toServerPrefs(doc: PreferencesDoc | null): CustomerPreferences | undefined {
  if (!doc || doc.skipped) return undefined
  const locs = doc.locations ?? []
  if (locs.length === 0 && !doc.propertyType && doc.bedrooms == null &&
      doc.budgetMin == null && doc.budgetMax == null && !doc.purpose &&
      doc.timelineDays == null) {
    return undefined
  }
  const TYPES = ['Apartment', 'Villa', 'Townhouse', 'Penthouse'] as const
  const PURPOSES = ['Buy', 'Rent', 'Invest'] as const
  const propertyType = TYPES.includes(doc.propertyType as (typeof TYPES)[number])
    ? (doc.propertyType as (typeof TYPES)[number])
    : null
  const purpose = PURPOSES.includes(doc.purpose as (typeof PURPOSES)[number])
    ? (doc.purpose as (typeof PURPOSES)[number])
    : null
  return {
    locations: [...locs],
    propertyType,
    bedrooms: doc.bedrooms ?? null,
    budgetMin: doc.budgetMin ?? null,
    budgetMax: doc.budgetMax ?? null,
    purpose,
    timeline_days: doc.timelineDays ?? null,
  }
}

function prefsEmpty(p: {
  locations?: string[] | null
  propertyType?: string | null
  bedrooms?: number | null
  budgetMin?: number | null
  budgetMax?: number | null
  purpose?: string | null
  timeline_days?: number | null
} | null | undefined): boolean {
  if (!p) return true
  return (p.locations ?? []).length === 0 && !p.propertyType && p.bedrooms == null &&
    p.budgetMin == null && p.budgetMax == null && !p.purpose && p.timeline_days == null
}

/** Personalized picks from the viewer's own signals (preferences,
 * favorites, enquiries, consented views). Real catalogue rows only. */
function Recommendations({
  catalogue, prefs, favorites, inquiries, owner, loading, allowViews,
  onSelectProperty, onToggleFavorite,
}: {
  catalogue: Property[]
  prefs: ReturnType<typeof getLocalPreferences>
  favorites: Property[]
  inquiries: ReturnType<typeof getInquiries>
  owner: string
  loading: boolean
  /** Views feed picks only with explicit consent; saves/enquiries always do. */
  allowViews: boolean
  onSelectProperty: (p: Property) => void
  onToggleFavorite: (id: string) => void
}) {
  const picks = useMemo(() => {
    const favIds = favorites.map((p) => p.property_id)
    const favLocs = [...new Set(favorites.map((p) => p.location))]
    const favTypes = [...new Set(favorites.map((p) => p.property_type))]
    const enqIds = inquiries.map((q) => q.propertyId)
    const views = allowViews
      ? getInteractions(owner).filter((e) => e.kind === 'view')
      : []
    const viewedIds = views.map((v) => v.propertyId).filter((id): id is string => Boolean(id))
    const viewedLocs = [...new Set(views.map((v) => v.location).filter((l): l is string => Boolean(l)))]
    const signals: FeedSignals = {
      preferredLocations: [...(prefs?.locations ?? []), ...favLocs, ...viewedLocs],
      preferredTypes: [...(prefs?.propertyType ? [prefs.propertyType] : []), ...favTypes],
      preferredListing: prefs?.purpose ?? null,
      preferredBedrooms: prefs?.bedrooms ?? null,
      budgetMax: prefs?.budgetMax ?? null,
      favoriteIds: favIds,
      enquiredIds: enqIds,
      viewedIds,
    }
    return personalizedPicks(catalogue, signals, 6)
  }, [catalogue, prefs, favorites, inquiries, owner, allowViews])
  if (loading) {
    return <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Loading…</p>
  }
  if (picks.length === 0) {
    return (
      <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0 }}>
        Nothing picked yet. Save homes, chat about what you like, or set preferences —
        relevant listings will appear here.
      </p>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 270px), 1fr))', gap: '16px' }}>
      {picks.map(({ property, reasons }) => (
        <PropertyCard
          key={property.property_id}
          property={property}
          isFavorite={favorites.some((p) => p.property_id === property.property_id)}
          onToggleFavorite={onToggleFavorite}
          onSelectProperty={onSelectProperty}
          matchExplanation={reasons.length > 0 ? `Picked for you: ${reasons.join(' · ')}` : undefined}
        />
      ))}
    </div>
  )
}

/** Optional behavioral tracking consent (views/searches). Likes, saves,
 * and submitted enquiries are functional records and always stored. */
function PrivacyControls({ checked, onToggle }: { checked: boolean; onToggle: (allow: boolean) => void }) {
  return (
    <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
      <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>
        Browsing views and searches personalize your recommendations only after you
        opt in. Saved homes, favorites, and submitted enquiries are functional
        records tied to this account. Everything stays namespaced to your
        Firebase identity — never shared with other accounts on this device.
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 600, color: 'var(--text-main)' }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          style={{ accentColor: 'var(--gold-dark)', width: '16px', height: '16px' }}
        />
        Allow activity-based recommendations (views & searches)
      </label>
      <p style={{ fontSize: '12px', margin: '8px 0 0' }}>
        Status: {checked ? 'On' : 'Off'}
      </p>
    </div>
  )
}

/** Inline customer-profile editor (name/phone/city). Saves to the
 * viewer's own backend profile first; the UI refreshes only after the
 * backend confirms. When offline, the edit is kept on this device and
 * clearly marked as pending sync. Role is never editable here. */
function ProfileEditor({
  owner, initialName, initialPhone, initialCity, initialCountry, initialDiscoverySource, onSaved,
}: {
  owner: string
  initialName: string
  initialPhone: string
  initialCity: string
  initialCountry: string
  initialDiscoverySource: string
  onSaved: (status: 'saved' | 'pending', detail?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initialName)
  const [phone, setPhone] = useState(initialPhone)
  const [city, setCity] = useState(initialCity)
  const [country, setCountry] = useState(initialCountry)
  const [discoverySource, setDiscoverySource] = useState(initialDiscoverySource)
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setName(initialName)
          setPhone(initialPhone)
          setCity(initialCity)
          setCountry(initialCountry)
          setDiscoverySource(initialDiscoverySource)
          setMsg(null)
          setOpen(true)
        }}
        className="lyka-chat-link-btn"
        style={{ marginTop: '8px', fontSize: '13px' }}
      >
        Edit profile
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const discovery = normalizeDiscoverySource(discoverySource)
        const err = validateCustomerProfile({ name, phone, city, country, discovery_source: discoverySource })
        if (err) {
          setMsg(err)
          return
        }
        setSaving(true)
        setMsg(null)
        const trimmed = {
          name: name.trim(),
          phone: phone.trim() || undefined,
          city: city.trim() || undefined,
          country: country.trim() || undefined,
          discovery_source: discovery || undefined,
        }
        const source = collectLeadSource()
        saveCustomerProfile({
          name: trimmed.name,
          phone: trimmed.phone,
          city: trimmed.city,
          country: trimmed.country,
          discovery_source: trimmed.discovery_source ?? null,
          preferences: toServerPrefs(getLocalPreferences(owner)),
          utm_source: source.utm_source,
          utm_medium: source.utm_medium,
          utm_campaign: source.utm_campaign,
          referrer: source.referrer,
        }).then((res) => {
          // Confirmed by the backend: sync the local cache from the
          // saved server profile, then refresh the UI.
          const saved = res.profile
          const existing = getLocalUser(owner)
          saveLocalUser(
            {
              name: saved?.name || trimmed.name,
              email: saved?.email || existing?.email || '',
              phone: saved?.phone || trimmed.phone,
              city: saved?.city || trimmed.city,
              country: saved?.country || trimmed.country,
              discovery_source: saved?.discovery_source || trimmed.discovery_source,
            },
            owner
          )
          setMsg(null)
          setOpen(false)
          onSaved('saved')
        }).catch((saveErr: unknown) => {
          // Offline/backend failure: keep the edit on this device and say
          // so explicitly instead of pretending it synced.
          const existing = getLocalUser(owner)
          saveLocalUser(
            {
              name: trimmed.name,
              email: existing?.email || '',
              phone: trimmed.phone,
              city: trimmed.city,
              country: trimmed.country || existing?.country,
              discovery_source: trimmed.discovery_source || existing?.discovery_source,
            },
            owner
          )
          setOpen(false)
          onSaved('pending', saveErr instanceof Error ? saveErr.message : 'Could not reach the server.')
        }).finally(() => {
          setSaving(false)
        })
      }}
      style={{ marginTop: '12px', maxWidth: '420px' }}
    >
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }} htmlFor="lyka-profile-name">
        Full name
      </label>
      <input
        id="lyka-profile-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoComplete="name"
        style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--champagne-border)', fontSize: '14px', marginBottom: '10px', boxSizing: 'border-box' }}
      />
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }} htmlFor="lyka-profile-phone">
        Phone / WhatsApp
      </label>
      <input
        id="lyka-profile-phone"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        autoComplete="tel"
        style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--champagne-border)', fontSize: '14px', marginBottom: '10px', boxSizing: 'border-box' }}
      />
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }} htmlFor="lyka-profile-city">
        City / Community
      </label>
      <input
        id="lyka-profile-city"
        type="text"
        placeholder="e.g. Dubai Marina"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        autoComplete="address-level2"
        style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--champagne-border)', fontSize: '14px', marginBottom: '10px', boxSizing: 'border-box' }}
      />
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }} htmlFor="lyka-profile-country">
        Country
      </label>
      <input
        id="lyka-profile-country"
        type="text"
        placeholder="e.g. United Arab Emirates"
        value={country}
        onChange={(e) => setCountry(e.target.value)}
        autoComplete="country-name"
        style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--champagne-border)', fontSize: '14px', marginBottom: '10px', boxSizing: 'border-box' }}
      />
      <div style={{ marginBottom: '12px' }}>
        <DiscoverySourceSelect
          id="lyka-profile-discovery-source"
          value={discoverySource}
          onChange={setDiscoverySource}
          variant="form"
          labelStyle={{ fontWeight: 700, marginBottom: '4px' }}
          selectStyle={{ borderRadius: '6px', padding: '9px 12px', fontSize: '14px' }}
        />
      </div>
      {msg && (
        <p role="alert" style={{ fontSize: '13px', color: '#991B1B', marginBottom: '10px' }}>{msg}</p>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="gold-btn" disabled={saving} style={{ padding: '9px 20px', fontSize: '13px', opacity: saving ? 0.65 : 1 }}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="outline-navy-btn" style={{ padding: '9px 20px', fontSize: '13px' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Property-preferences editor (purpose, type, bedrooms, budget, community,
 * timeline). Saves the viewer's own backend profile with the new prefs;
 * the UI refreshes only after the backend confirms, which also refreshes
 * the personalized recommendations below. */
function PreferencesEditor({
  owner, identity, initialPrefs, onSaved,
}: {
  owner: string
  /** Current identity fields, echoed back so the PUT never wipes them. */
  identity: { name: string; phone?: string; city?: string; country?: string }
  initialPrefs: PreferencesDoc | null
  onSaved: (status: 'saved' | 'pending', detail?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(() => preferencesToForm(initialPrefs))
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setForm(preferencesToForm(getLocalPreferences(owner) ?? initialPrefs))
          setMsg(null)
          setOpen(true)
        }}
        className="lyka-chat-link-btn"
        style={{ marginTop: '8px', fontSize: '13px' }}
      >
        Edit preferences
      </button>
    )
  }
  const inputBox: React.CSSProperties = {
    width: '100%', padding: '9px 12px', borderRadius: '6px',
    border: '1px solid var(--champagne-border)', fontSize: '14px', boxSizing: 'border-box',
  }
  const labelBox: React.CSSProperties = {
    display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px',
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const err = validatePreferencesForm(form)
        if (err) {
          setMsg(err)
          return
        }
        setSaving(true)
        setMsg(null)
        const payload = buildPreferencesPayload(form)
        saveCustomerProfile({
          name: identity.name,
          phone: identity.phone,
          city: identity.city,
          country: identity.country,
          preferences: payload,
        }).then((res) => {
          const saved = res.profile
          const sp = saved?.preferences
          saveLocalPreferences({
            userId: null,
            locations: payload ? [...payload.locations] : [...(sp?.locations ?? [])],
            propertyType: (payload?.propertyType ?? sp?.propertyType ?? null) as PreferencesDoc['propertyType'],
            bedrooms: payload?.bedrooms ?? sp?.bedrooms ?? null,
            budgetMin: payload?.budgetMin ?? sp?.budgetMin ?? null,
            budgetMax: payload?.budgetMax ?? sp?.budgetMax ?? null,
            purpose: (payload?.purpose ?? sp?.purpose ?? null) as PreferencesDoc['purpose'],
            timelineDays: payload?.timeline_days ?? sp?.timeline_days ?? null,
            skipped: false,
          }, owner)
          setMsg(null)
          setOpen(false)
          onSaved('saved')
        }).catch((saveErr: unknown) => {
          setOpen(false)
          onSaved('pending', saveErr instanceof Error ? saveErr.message : 'Could not reach the server.')
        }).finally(() => {
          setSaving(false)
        })
      }}
      style={{ marginTop: '12px', maxWidth: '420px' }}
    >
      <span style={labelBox}>I want to</span>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        {PURPOSE_OPTIONS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => set({ purpose: form.purpose === p ? '' : p })}
            style={{
              flex: 1, padding: '9px 0', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer',
              background: form.purpose === p ? 'var(--plum-main)' : '#fff',
              color: form.purpose === p ? 'var(--gold-hover)' : 'var(--text-secondary)',
              border: `1px solid ${form.purpose === p ? 'var(--gold-primary)' : 'var(--champagne-border)'}`,
            }}
          >
            {p}
          </button>
        ))}
      </div>
      <label style={labelBox} htmlFor="lyka-prefs-type">Property type</label>
      <select
        id="lyka-prefs-type"
        value={form.propertyType}
        onChange={(e) => set({ propertyType: e.target.value })}
        style={{ ...inputBox, marginBottom: '10px', cursor: 'pointer', background: '#fff' }}
      >
        <option value="">No preference</option>
        {PROPERTY_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <label style={labelBox} htmlFor="lyka-prefs-beds">Bedrooms</label>
      <select
        id="lyka-prefs-beds"
        value={form.bedrooms}
        onChange={(e) => set({ bedrooms: e.target.value })}
        style={{ ...inputBox, marginBottom: '10px', cursor: 'pointer', background: '#fff' }}
      >
        <option value="">No preference</option>
        {BEDROOM_OPTIONS.map((b) => (
          <option key={b.value} value={b.value}>{b.label}</option>
        ))}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
        <div>
          <label style={labelBox} htmlFor="lyka-prefs-bmin">Min budget (AED)</label>
          <input
            id="lyka-prefs-bmin"
            type="number"
            min={0}
            placeholder="e.g. 1500000"
            value={form.budgetMin}
            onChange={(e) => set({ budgetMin: e.target.value })}
            style={inputBox}
          />
        </div>
        <div>
          <label style={labelBox} htmlFor="lyka-prefs-bmax">Max budget (AED)</label>
          <input
            id="lyka-prefs-bmax"
            type="number"
            min={0}
            placeholder="e.g. 3000000"
            value={form.budgetMax}
            onChange={(e) => set({ budgetMax: e.target.value })}
            style={inputBox}
          />
        </div>
      </div>
      <label style={labelBox} htmlFor="lyka-prefs-community">Preferred community</label>
      <input
        id="lyka-prefs-community"
        type="text"
        placeholder="e.g. Dubai Marina"
        value={form.community}
        onChange={(e) => set({ community: e.target.value })}
        autoComplete="address-level2"
        style={{ ...inputBox, marginBottom: '10px' }}
      />
      <label style={labelBox} htmlFor="lyka-prefs-timeline">Timeline</label>
      <select
        id="lyka-prefs-timeline"
        value={form.timelineDays}
        onChange={(e) => set({ timelineDays: e.target.value })}
        style={{ ...inputBox, marginBottom: '12px', cursor: 'pointer', background: '#fff' }}
      >
        <option value="">No preference</option>
        {TIMELINE_OPTIONS.map((t) => (
          <option key={t.label} value={t.days === null ? '' : t.days}>{t.label}</option>
        ))}
      </select>
      {msg && (
        <p role="alert" style={{ fontSize: '13px', color: '#991B1B', marginBottom: '10px' }}>{msg}</p>
      )}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" className="gold-btn" disabled={saving} style={{ padding: '9px 20px', fontSize: '13px', opacity: saving ? 0.65 : 1 }}>
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="outline-navy-btn" style={{ padding: '9px 20px', fontSize: '13px' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

export function AccountPage() {
  const { user, linkPassword } = useAuth()
  const navigate = useNavigate()
  // Trusted role comes ONLY from the backend (useStaffRole); a signed-in
  // user without a staff row is a Customer. Never from UI state.
  const { role: staffRole } = useStaffRole()
  const trustedRole = staffRole ?? (user ? 'Customer' : null)
  /** Owner namespace for every cache read/write on this page. */
  const owner = ownerKeyFor(user?.uid)
  const [favorites, setFavorites] = useState<Property[]>([])
  const [catalogue, setCatalogue] = useState<Property[]>([])
  const [trackingOn, setTrackingOn] = useState<boolean>(() => getTrackingConsent(owner) === true)

  // Reload consent with identity switches (never inherit another viewer's opt-in).
  useEffect(() => {
    setTrackingOn(getTrackingConsent(owner) === true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner])
  const [profile, setProfile] = useState(() => getLocalUser(owner))
  const [prefsTick, setPrefsTick] = useState(0)
  // prefsTick re-reads the external localStorage cache after a server
  // adopt — intentional extra dep, same as the owner dep below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prefs = useMemo(() => getLocalPreferences(owner), [owner, prefsTick])

  // Reload this owner's profile when identity changes (sign-in/out/switch).
  useEffect(() => {
    setProfile(getLocalUser(owner))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner])

  // Server profile sync states: 'saved' only after the backend confirms.
  // 'pending'/'offline' mean this device's copy is shown instead.
  const [serverProfile, setServerProfile] = useState<CustomerProfile | null>(null)
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'saved' | 'pending' | 'offline'>('idle')
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Load the saved server profile on login and merge it into the local
  // cache (server values win where set). Never touches another account:
  // the endpoint only ever returns the caller's own UID-owned row.
  useEffect(() => {
    if (!user) {
      setServerProfile(null)
      setSyncState('idle')
      setSyncMsg(null)
      return
    }
    let cancelled = false
    setSyncState('loading')
    getCustomerProfile().then((res) => {
      if (cancelled) return
      if (res.profile) {
        const cur = getLocalUser(owner)
        const mergedName = res.profile.name || cur?.name || user.name
        saveLocalUser({
          name: mergedName,
          email: res.profile.email || cur?.email || user.email,
          phone: res.profile.phone || cur?.phone,
          city: res.profile.city || cur?.city,
          country: res.profile.country || cur?.country,
          discovery_source: res.profile.discovery_source || cur?.discovery_source,
        }, owner)
        setProfile(getLocalUser(owner))
        setServerProfile(res.profile)
        // Two-way preferences sync (server row is UID-owned, no new API):
        // server wins only when this device has nothing; local edits
        // upload quietly when the server row has none.
        const localPrefs = getLocalPreferences(owner)
        if (prefsEmpty(localPrefs) && !prefsEmpty(res.profile.preferences)) {
          const sp = res.profile.preferences
          const adoptType = ['Apartment', 'Villa', 'Townhouse', 'Penthouse'].includes(sp.propertyType ?? '')
            ? (sp.propertyType as 'Apartment' | 'Villa' | 'Townhouse' | 'Penthouse')
            : null
          const adoptPurpose = ['Buy', 'Rent', 'Invest'].includes(sp.purpose ?? '')
            ? (sp.purpose as 'Buy' | 'Rent' | 'Invest')
            : null
          saveLocalPreferences({
            userId: null,
            locations: [...(sp.locations ?? [])],
            propertyType: adoptType,
            bedrooms: sp.bedrooms ?? null,
            budgetMin: sp.budgetMin ?? null,
            budgetMax: sp.budgetMax ?? null,
            purpose: adoptPurpose,
            timelineDays: sp.timeline_days ?? null,
            skipped: false,
          }, owner)
          setPrefsTick((t) => t + 1)
        } else if (!prefsEmpty(localPrefs) && prefsEmpty(res.profile.preferences)) {          const up = toServerPrefs(localPrefs)
          if (up) {
            saveCustomerProfile({
              name: mergedName,
              phone: res.profile.phone || cur?.phone || undefined,
              city: res.profile.city || cur?.city || undefined,
              country: res.profile.country || cur?.country || undefined,
              preferences: up,
            }).then((r2) => {
              if (!cancelled && r2.profile) setServerProfile(r2.profile)
            }).catch(() => {
              // Silent: the next explicit save retries with the same payload.
            })
          }
        }
      }
      setSyncState('saved')
      setSyncMsg(null)
    }).catch(() => {
      if (!cancelled) {
        setSyncState('offline')
        setSyncMsg(null)
      }
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid])

  const handlePrefsSaved = (status: 'saved' | 'pending', detail?: string) => {
    setPrefsTick((t) => t + 1)
    if (status === 'saved') {
      setSyncState('saved')
      setSyncMsg(null)
      getCustomerProfile()
        .then((res) => { if (res.profile) setServerProfile(res.profile) })
        .catch(() => {})
    } else {
      setSyncState('pending')
      setSyncMsg(detail || 'Could not reach the server.')
    }
  }
  const handleProfileSaved = (status: 'saved' | 'pending', detail?: string) => {
    setProfile(getLocalUser(owner))
    if (status === 'saved') {
      setSyncState('saved')
      setSyncMsg(null)
      getCustomerProfile()
        .then((res) => { if (res.profile) setServerProfile(res.profile) })
        .catch(() => {})
    } else {
      setSyncState('pending')
      setSyncMsg(detail || 'Could not reach the server.')
    }
  }
  const [favLoading, setFavLoading] = useState(true)
  const [favError, setFavError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Property | null>(null)

  // Set-password (account linking) state
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const hasPasswordProvider = !!user?.providers.includes('password')
  const hasGoogleProvider = !!user?.providers.includes('google.com')

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwMsg(null)
    if (pw.length < 6) {
      setPwMsg({ kind: 'err', text: 'Password is too weak — please use at least 6 characters.' })
      return
    }
    if (pw !== pw2) {
      setPwMsg({ kind: 'err', text: 'Passwords do not match. Please re-enter them.' })
      return
    }
    setPwSaving(true)
    try {
      await linkPassword(pw)
      setPw('')
      setPw2('')
      setPwMsg({ kind: 'ok', text: 'Password added to this same account — sign in next time with email + password or Google. Nothing else changed.' })
    } catch (err: unknown) {
      setPwMsg({ kind: 'err', text: authFailureMessage(err, 'AccountPage-linkPassword') })
    } finally {
      setPwSaving(false)
    }
  }

  const inquiries = useMemo(() => getInquiries(owner), [owner])
  const convo = useMemo(() => {
    const lastId = getLastChatSessionId(owner)
    const turns = lastId ? getSessionTurns(lastId, owner) : []
    return { count: turns.length, lastAt: turns.length > 0 ? turns[turns.length - 1].createdAt : null }
  }, [owner])

  useEffect(() => {
    let cancelled = false
    setFavLoading(true)
    setFavError(null)
    let ids: string[] = []
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(favoritesKeyFor(owner)) || '[]')
      ids = sanitizeFavoriteIds(parsed)
    } catch {
      ids = []
    }
    fetchPropertiesFromApi({ limit: 250 })
      .then((res) => {
        if (cancelled) return
        const all = (res.top_properties || []).map(formatProperty)
        setCatalogue(all)
        const byId = new Map(all.map((p) => [p.property_id, p]))
        // Same source of truth as the site header/panel: unique saved IDs
        // resolved to real records; unlisted IDs stay stored, uncounted.
        setFavorites(resolveFavoriteProperties(ids, (id) => byId.get(id)))
        setFavLoading(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFavError(err instanceof Error ? err.message : 'Could not load favorites.')
          setFavLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [owner])

  const toggleFavorite = (id: string) => {
    const clean = typeof id === 'string' ? id.trim() : ''
    if (!clean) return
    // Resolve the added property from this page's own catalogue so the
    // card heart, panel, and counts update immediately. IDs with no record
    // here stay stored (never deleted) but uncounted.
    const known = new Map(catalogue.map((p) => [p.property_id, p]))
    const stored = sanitizeFavoriteIds(
      (() => {
        try {
          return JSON.parse(localStorage.getItem(favoritesKeyFor(owner)) || '[]')
        } catch {
          return []
        }
      })()
    )
    const nextIds = toggleFavoriteId(stored, clean)
    try {
      localStorage.setItem(favoritesKeyFor(owner), JSON.stringify(nextIds))
    } catch {/* ignore */}
    if (user) {
      cloudSaveFavoritesAll(user.uid, nextIds).catch(() => {})
    }
    setFavorites(resolveFavoriteProperties(nextIds, (favId) => known.get(favId)))
  }

  const continueInChat = () => {
    navigate('/?chat=1')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--champagne-light)' }}>
      <div className="container" style={{ paddingTop: '28px', paddingBottom: '60px', maxWidth: '1020px' }}>
        <button type="button" onClick={() => navigate('/')} className="lyka-chat-link-btn" style={{ marginBottom: '12px' }}>
          <ArrowLeft size={13} /> Back to site
        </button>
        <h2 className="luxury-serif" style={{ fontSize: '28px', color: 'var(--plum-main)', marginBottom: '4px' }}>My Account</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
          Your profile, conversations, saved homes, and inquiries — visible only to you.
        </p>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={15} /> Profile
          </h3>
          {user ? (
            <div style={{ fontSize: '14px' }}>
              <div><strong>{user.name}</strong></div>
              <div style={{ color: 'var(--text-secondary)' }}>{user.email}</div>
              <div style={{ marginTop: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--champagne-surface)', border: '1px solid var(--champagne-border)', borderRadius: '999px', padding: '4px 12px' }}>
                  <ShieldCheck size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />{' '}
                  Role: {trustedRole === 'Customer' ? 'Customer' : trustedRole?.replace(/_/g, ' ') ?? '…'}
                </span>
              </div>
              {(profile?.phone || profile?.city || profile?.country) && (
                <div style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {[profile?.phone, profile?.city, profile?.country].filter(Boolean).join(' · ')}
                </div>
              )}
              {syncState !== 'idle' && (
                <div style={{ marginTop: '8px', fontSize: '12.5px' }}>
                  {syncState === 'loading' && (
                    <span style={{ color: 'var(--text-secondary)' }}>Syncing profile with your account…</span>
                  )}
                  {syncState === 'saved' && (
                    <span style={{ color: '#2E7D4F', fontWeight: 600 }}>✓ Profile synced with your account.</span>
                  )}
                  {syncState === 'pending' && (
                    <span style={{ color: '#8A6E30', fontWeight: 600 }}>
                      Saved on this device only — pending sync{syncMsg ? `: ${syncMsg}` : '. Try saving again when online.'}
                    </span>
                  )}
                  {syncState === 'offline' && (
                    <span style={{ color: 'var(--text-secondary)' }}>Offline — showing this device’s copy.</span>
                  )}
                </div>
              )}
              {serverProfile && (serverProfile.utm_source || serverProfile.utm_medium || serverProfile.utm_campaign || serverProfile.referrer) && (
                <div style={{ marginTop: '6px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  First found via: <strong>{classifyLeadChannel(serverProfile)}</strong>
                  {serverProfile.utm_campaign ? ` · ${serverProfile.utm_campaign}` : ''}
                </div>
              )}
              {serverProfile?.discovery_source && (
                <div style={{ marginTop: '6px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  You told us you heard via: <strong>{serverProfile.discovery_source}</strong>
                </div>
              )}
              {!serverProfile?.discovery_source && profile?.discovery_source && (
                <div style={{ marginTop: '6px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                  You told us you heard via: <strong>{profile.discovery_source}</strong> (on this device — pending sync)
                </div>
              )}
              {prefs && !prefs.skipped && (
                <div style={{ marginTop: '6px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  Preferences: {[prefs.locations.join(', '), prefs.propertyType, prefs.bedrooms !== null ? `${prefs.bedrooms} BHK` : '', prefs.purpose, prefs.timelineDays !== null ? `Timeline: ${prefs.timelineDays} days` : ''].filter(Boolean).join(' · ') || '—'}
                </div>
              )}
              <ProfileEditor
                owner={owner}
                initialName={profile?.name ?? user.name}
                initialPhone={profile?.phone ?? ''}
                initialCity={profile?.city ?? ''}
                initialCountry={serverProfile?.country || profile?.country || ''}
                initialDiscoverySource={serverProfile?.discovery_source || profile?.discovery_source || ''}
                onSaved={handleProfileSaved}
              />
            </div>
          ) : (
            <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Browsing as a guest{profile ? ` (${profile.name})` : ''}. Chat works without login; saving needs an account.
            </div>
          )}
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Tag size={15} /> Property preferences
          </h3>
          {user ? (
            <div style={{ fontSize: '14px' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px', margin: '0 0 4px', lineHeight: 1.6 }}>
                Your saved preferences power the recommendations below and are
                restored on any device after sign-in.
              </p>
              <PreferencesEditor
                owner={owner}
                identity={{
                  name: serverProfile?.name || profile?.name || user.name,
                  phone: serverProfile?.phone || profile?.phone || undefined,
                  city: serverProfile?.city || profile?.city || undefined,
                  country: serverProfile?.country || profile?.country || undefined,
                }}
                initialPrefs={prefs}
                onSaved={handlePrefsSaved}
              />
            </div>
          ) : (
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Sign in to save property preferences.
            </p>
          )}
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={15} /> Sign-in &amp; security
          </h3>
          {!user ? (
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              Sign in to manage your sign-in methods.
            </p>
          ) : (
            <div style={{ fontSize: '14px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--champagne-surface)', border: '1px solid var(--champagne-border)', borderRadius: '999px', padding: '4px 12px' }}>
                  <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {user.email}
                </span>
                {hasGoogleProvider && (
                  <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--champagne-surface)', border: '1px solid var(--champagne-border)', borderRadius: '999px', padding: '4px 12px' }}>
                    <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> Google linked
                  </span>
                )}
                {hasPasswordProvider && (
                  <span style={{ fontSize: '12px', fontWeight: 700, background: 'var(--champagne-surface)', border: '1px solid var(--champagne-border)', borderRadius: '999px', padding: '4px 12px' }}>
                    <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> Email + password linked
                  </span>
                )}
              </div>
              {hasPasswordProvider ? (
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                  You can sign in with email + password or Google. To change a forgotten password, use “Forgot password?” on the sign-in screen.
                </p>
              ) : (
                <form onSubmit={handleSetPassword} style={{ maxWidth: '420px' }}>
                  <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                    <KeyRound size={13} style={{ display: 'inline', verticalAlign: '-2px' }} />{' '}
                    This account currently signs in with Google only — that is why email + password sign-in says “incorrect”.
                    Set a password below to enable both methods on this <em>same</em> account (no duplicate, same user ID).
                  </p>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }} htmlFor="lyka-new-password">
                    New password (min. 6 characters)
                  </label>
                  <input
                    id="lyka-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--champagne-border)', fontSize: '14px', marginBottom: '10px', boxSizing: 'border-box' }}
                  />
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '4px' }} htmlFor="lyka-new-password-2">
                    Confirm password
                  </label>
                  <input
                    id="lyka-new-password-2"
                    type="password"
                    autoComplete="new-password"
                    value={pw2}
                    onChange={(e) => setPw2(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '6px', border: '1px solid var(--champagne-border)', fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box' }}
                  />
                  {pwMsg && (
                    <p role={pwMsg.kind === 'err' ? 'alert' : 'status'} style={{ fontSize: '13.5px', color: pwMsg.kind === 'err' ? '#991B1B' : '#2E9E6B', marginBottom: '10px' }}>
                      {pwMsg.text}
                    </p>
                  )}
                  <button type="submit" className="gold-btn" disabled={pwSaving} style={{ padding: '9px 20px', fontSize: '13px', opacity: pwSaving ? 0.65 : 1 }}>
                    {pwSaving ? 'Linking…' : 'Set password for this account'}
                  </button>
                </form>
              )}
            </div>
          )}
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={15} /> Privacy & tracking
          </h3>
          <PrivacyControls
            checked={trackingOn}
            onToggle={(allow) => {
              setTrackingConsent(owner, allow)
              setTrackingOn(allow)
            }}
          />
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageSquareText size={15} /> Saved conversations
          </h3>
          {convo.count > 0 ? (
            <div style={{ fontSize: '14px' }}>
              Latest chat holds <strong>{convo.count} messages</strong>
              {convo.lastAt && <span style={{ color: 'var(--text-secondary)' }}> · last activity {new Date(convo.lastAt).toLocaleString()}</span>}.
              <div style={{ marginTop: '10px' }}>
                <button type="button" className="gold-btn" onClick={continueInChat} style={{ padding: '9px 20px', fontSize: '13px' }}>
                  Continue in chatbot
                </button>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              No saved chats yet. <button type="button" className="lyka-chat-link-btn" onClick={() => navigate('/?chat=1')}>Start chatting</button> — history restores here and after sign-in.
            </p>
          )}
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={15} /> Recommended for you
          </h3>
          <Recommendations
            catalogue={catalogue}
            prefs={prefs}
            favorites={favorites}
            inquiries={inquiries}
            owner={owner}
            loading={favLoading}
            allowViews={trackingOn}
            onSelectProperty={setSelected}
            onToggleFavorite={toggleFavorite}
          />
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Heart size={15} /> Favorites ({favorites.length})
          </h3>
          {favLoading && <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}><Loader2 size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Loading…</p>}
          {favError && <p role="alert" style={{ fontSize: '13px', color: '#991B1B' }}><AlertCircle size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> {favError}</p>}
          {!favLoading && !favError && favorites.length === 0 && (
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No saved homes yet. Saving requires sign-in.</p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '20px' }}>
            {favorites.map((p) => (
              <PropertyCard
                key={p.property_id}
                property={p}
                isFavorite
                onToggleFavorite={() => toggleFavorite(p.property_id)}
                onSelectProperty={setSelected}
              />
            ))}
          </div>
        </section>

        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Tag size={15} /> My inquiries ({inquiries.length})
          </h3>
          {inquiries.length === 0 && (
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>No inquiries yet. Inquiries are submitted from chatbot property cards (sign-in required).</p>
          )}
          {inquiries.map((q) => (
            <div key={q._id} style={{ padding: '10px 0', borderTop: '1px solid var(--champagne-border)', fontSize: '13.5px' }}>
              <strong>{q.propertyTitle}</strong>
              <div style={{ color: 'var(--text-secondary)' }}>
                {q.propertyLocation} · {q.bedrooms} BHK · AED {q.priceAed.toLocaleString('en-US')} · {q.status}
              </div>
            </div>
          ))}
        </section>

        <p style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Trash2 size={12} /> Your data lives on this device{user ? ' and in your private Firebase records' : ''}. Signing out on a shared device? Clear browser storage afterwards.
        </p>
      </div>

      <PropertyModal
        property={selected}
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
        isFavorite={selected ? favorites.some((p) => p.property_id === selected.property_id) : false}
        onToggleFavorite={toggleFavorite}
      />
    </div>
  )
}
