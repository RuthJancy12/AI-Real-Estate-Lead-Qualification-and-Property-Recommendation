import { useEffect, useState } from 'react'
import {
  Building2, Edit3, X, Save, AlertCircle, RefreshCw,
  CheckCircle, XCircle, BedDouble, Info
} from 'lucide-react'
import { listProperties, updateProperty } from '../services/crmApi'
import type { CRMProperty } from '../types/crm'

const PLUM = 'var(--plum-main)'
const GOLD = 'var(--gold-dark)'
const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--champagne-border)',
  borderRadius: '14px',
  boxShadow: '0 2px 10px rgba(26, 13, 24, 0.05)',
  padding: '18px',
}

function formatAED(n: number | null) {
  if (n == null) return '—'
  return `AED ${n.toLocaleString('en-US')}`
}

const badge: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  fontSize: '11px', fontWeight: 800, borderRadius: '999px', padding: '3px 10px',
  letterSpacing: '0.02em', whiteSpace: 'nowrap',
}

export function PropertyManagement() {
  const [properties, setProperties] = useState<CRMProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  const [locationFilter, setLocationFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const [editForm, setEditForm] = useState<{
    price_sale: string
    price_rent_monthly: string
    is_available: boolean
    description: string
  }>({ price_sale: '', price_rent_monthly: '', is_available: true, description: '' })

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listProperties({
        location: locationFilter || undefined,
        listing_type: typeFilter || undefined,
        available_only: false,
      })
      setProperties(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load properties')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [locationFilter, typeFilter])

  const startEdit = (prop: CRMProperty) => {
    setEditingId(prop.id)
    setEditForm({
      price_sale: prop.price_sale != null ? String(prop.price_sale) : '',
      price_rent_monthly: prop.price_rent_monthly != null ? String(prop.price_rent_monthly) : '',
      is_available: prop.is_available,
      description: prop.description || '',
    })
  }

  const handleSave = async (id: number) => {
    setSaving(true)
    try {
      await updateProperty(id, {
        price_sale: editForm.price_sale ? Number(editForm.price_sale) : undefined,
        price_rent_monthly: editForm.price_rent_monthly ? Number(editForm.price_rent_monthly) : undefined,
        is_available: editForm.is_available,
        description: editForm.description || undefined,
      })
      setEditingId(null)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save property')
    } finally {
      setSaving(false)
    }
  }

  const LOCATIONS = [...new Set(properties.map(p => p.location))].sort()

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <div>
          <h1 className="luxury-serif" style={{ fontSize: '22px', color: PLUM, margin: 0 }}>
            Property Management
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '12.5px', margin: '2px 0 0' }}>
            {properties.length} CRM seed properties · Authorized agents only
          </p>
        </div>
        <span style={{ ...badge, background: '#FBF3E3', color: '#8A6E30', border: '1px solid #E5D3AC', padding: '6px 14px', fontSize: '12px' }}>
          <Building2 size={13} /> Fictional Demo Properties
        </span>
      </div>

      {/* Demo-data notice — kept clearly separate from the live dataset */}
      <section style={{ ...CARD, background: '#FAF7F0', margin: '14px 0', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
        <Info size={16} color={GOLD} style={{ flexShrink: 0, marginTop: '2px' }} />
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: PLUM }}>Demo dataset notice:</strong> these are 20 clearly-labelled
          fictional properties for CRM demonstration only. They are separate from the real Dubai
          property dataset used in the public search.
        </p>
      </section>

      {/* Filter toolbar */}
      <section style={{ ...CARD, marginBottom: '14px' }} aria-label="Filter properties">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <select
            value={locationFilter}
            onChange={e => setLocationFilter(e.target.value)}
            className="lyka-field"
            style={{ width: 'auto', minWidth: '190px', height: '40px', fontSize: '13px' }}
            aria-label="Filter by location"
          >
            <option value="">All Locations</option>
            {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="lyka-field"
            style={{ width: 'auto', minWidth: '150px', height: '40px', fontSize: '13px' }}
            aria-label="Filter by sale or rent"
          >
            <option value="">Sale & Rent</option>
            <option value="Sale">For Sale</option>
            <option value="Rent">For Rent</option>
          </select>
          {(locationFilter || typeFilter) && (
            <button
              type="button"
              onClick={() => { setLocationFilter(''); setTypeFilter('') }}
              style={{ height: '40px', padding: '0 14px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--champagne-border)', borderRadius: '8px', cursor: 'pointer' }}
            >
              Clear filters
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
            Showing {properties.length} {properties.length === 1 ? 'property' : 'properties'}
          </span>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#FDF1F1', border: '1px solid #E8A0A0', borderRadius: '12px', padding: '14px 16px', marginBottom: '14px' }} role="alert">
          <AlertCircle size={18} color="#9C4A3C" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: '13.5px', color: '#8C2F2F', margin: 0 }}>{error}</p>
        </div>
      )}

      {/* Cards */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '240px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          <RefreshCw size={20} className="animate-spin" style={{ marginRight: '8px' }} /> Loading properties…
        </div>
      ) : properties.length === 0 ? (
        <div style={{ ...CARD, textAlign: 'center', padding: '56px 16px' }}>
          <Building2 size={32} color="#C9BFAE" style={{ margin: '0 auto 10px' }} />
          <p style={{ fontSize: '14px', fontWeight: 700, color: PLUM, margin: '0 0 4px' }}>No properties match</p>
          <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>Try adjusting your filters</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: '16px' }}>
          {properties.map(prop => {
            const editing = editingId === prop.id
            return (
              <article
                key={prop.id}
                style={{
                  ...CARD, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
                  borderColor: editing ? GOLD : 'var(--champagne-border)',
                  boxShadow: editing ? '0 0 0 3px rgba(197, 168, 105, 0.25)' : CARD.boxShadow,
                }}
              >
                {/* Image — fixed crop, no distortion */}
                {prop.image_url ? (
                  <img
                    src={prop.image_url}
                    alt={prop.title}
                    loading="lazy"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    style={{ width: '100%', height: '168px', objectFit: 'cover', display: 'block', background: '#F4EEE1' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: '168px', background: 'linear-gradient(135deg, #F4EEE1, #EADFC8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Building2 size={30} color={GOLD} />
                  </div>
                )}

                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
                  {/* Badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ ...badge, background: '#FAF5EA', color: PLUM, border: '1px solid var(--champagne-border)' }}>
                      {prop.location}
                    </span>
                    <span style={{ ...badge, background: prop.listing_type === 'Sale' ? '#EAF0FA' : '#F1EAF6', color: prop.listing_type === 'Sale' ? '#2F4B8A' : '#6C3FA3', border: '1px solid var(--champagne-border)' }}>
                      For {prop.listing_type}
                    </span>
                    {prop.is_available ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', fontWeight: 700, color: '#2E7D4F' }}>
                        <CheckCircle size={12} /> Available
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', fontWeight: 700, color: '#9C4A3C' }}>
                        <XCircle size={12} /> Unavailable
                      </span>
                    )}
                  </div>

                  {/* Title + ref */}
                  <div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: PLUM, margin: 0, lineHeight: 1.4 }}>
                      {prop.title}
                    </h3>
                    <p style={{ fontSize: '11.5px', color: '#B9B0A6', fontFamily: 'monospace', margin: '3px 0 0' }}>
                      {prop.ref_code}
                    </p>
                  </div>

                  {/* Specs */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
                      <BedDouble size={14} color={GOLD} />
                      {prop.bedrooms === 0 ? 'Studio' : `${prop.bedrooms} Beds`}
                    </span>
                    <span>{prop.size_sqft.toLocaleString()} sqft</span>
                  </div>

                  {/* Price */}
                  <p style={{ fontSize: '17px', fontWeight: 800, color: PLUM, margin: 0 }}>
                    {prop.listing_type === 'Sale'
                      ? formatAED(prop.price_sale)
                      : `${formatAED(prop.price_rent_monthly)}/mo`}
                  </p>

                  {/* Amenities */}
                  {prop.amenities?.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {prop.amenities.slice(0, 3).map(a => (
                        <span key={a} style={{ fontSize: '11.5px', padding: '3px 10px', background: '#FAF5EA', color: 'var(--text-secondary)', borderRadius: '999px', border: '1px solid var(--champagne-border)', textTransform: 'capitalize' }}>{a}</span>
                      ))}
                      {prop.amenities.length > 3 && (
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', alignSelf: 'center' }}>+{prop.amenities.length - 3} more</span>
                      )}
                    </div>
                  )}

                  {/* Edit / Save */}
                  <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
                    {editing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: '#FAF7F0', border: '1px solid var(--champagne-border)', borderRadius: '10px', padding: '12px' }}>
                        {prop.listing_type === 'Sale' && (
                          <div>
                            <label htmlFor={`sale-${prop.id}`} style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                              Sale Price (AED)
                            </label>
                            <input
                              id={`sale-${prop.id}`}
                              type="number"
                              value={editForm.price_sale}
                              onChange={e => setEditForm(prev => ({ ...prev, price_sale: e.target.value }))}
                              className="lyka-field"
                              style={{ height: '38px' }}
                            />
                          </div>
                        )}
                        {prop.listing_type === 'Rent' && (
                          <div>
                            <label htmlFor={`rent-${prop.id}`} style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                              Monthly Rent (AED)
                            </label>
                            <input
                              id={`rent-${prop.id}`}
                              type="number"
                              value={editForm.price_rent_monthly}
                              onChange={e => setEditForm(prev => ({ ...prev, price_rent_monthly: e.target.value }))}
                              className="lyka-field"
                              style={{ height: '38px' }}
                            />
                          </div>
                        )}
                        <label htmlFor={`avail-${prop.id}`} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: 'var(--text-main)', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            id={`avail-${prop.id}`}
                            checked={editForm.is_available}
                            onChange={e => setEditForm(prev => ({ ...prev, is_available: e.target.checked }))}
                            style={{ accentColor: 'var(--gold-dark)', width: '15px', height: '15px' }}
                          />
                          Available for matching
                        </label>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => handleSave(prop.id)}
                            disabled={saving}
                            className="gold-btn"
                            style={{ padding: '8px 16px', fontSize: '12.5px', opacity: saving ? 0.6 : 1 }}
                          >
                            <Save size={13} /> {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="outline-navy-btn"
                            style={{ padding: '8px 16px', fontSize: '12.5px' }}
                          >
                            <X size={13} /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(prop)}
                        className="outline-navy-btn"
                        style={{ width: '100%', padding: '9px', fontSize: '12.5px' }}
                      >
                        <Edit3 size={13} /> Edit Price / Availability
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
