import { Check, Circle, Sparkles, Edit3 } from 'lucide-react'
import type { UserRequirements, TrackedFieldKey } from '../../types/agent'

interface RequirementPanelProps {
  requirements: UserRequirements
  activeField: TrackedFieldKey | null
  onEditField?: (field: TrackedFieldKey) => void
}

interface RequirementItem {
  key: TrackedFieldKey
  label: string
  getValue: (req: UserRequirements) => string | null
}

const ITEMS: RequirementItem[] = [
  {
    key: 'purpose',
    label: 'Purpose',
    getValue: (r) => (r.purpose ? (r.purpose.toLowerCase() === 'buy' || r.purpose.toLowerCase() === 'sale' ? 'Buy / Invest' : 'Rent (Annual)') : null)
  },
  {
    key: 'location',
    label: 'Location',
    getValue: (r) => r.location
  },
  {
    key: 'propertyType',
    label: 'Property Type',
    getValue: (r) => r.propertyType
  },
  {
    key: 'bhk',
    label: 'Bedrooms',
    getValue: (r) => (r.bhk !== null && r.bhk !== undefined ? (r.bhk === 0 ? 'Studio' : `${r.bhk} BHK`) : null)
  },
  {
    key: 'budget',
    label: 'Budget Ceiling',
    getValue: (r) => (r.budget ? `AED ${r.budget.toLocaleString()}` : null)
  },
  {
    key: 'nearMetro',
    label: 'Metro Proximity',
    getValue: (r) => (r.nearMetro === true ? 'Walkable (< 1 km)' : null)
  },
  {
    key: 'beachfront',
    label: 'Coastline / View',
    getValue: (r) => (r.beachfront === true ? 'Beachfront & Sea View' : null)
  }
]

export function RequirementPanel({ requirements, activeField, onEditField }: RequirementPanelProps) {
  const completedCount = ITEMS.filter((item) => item.getValue(requirements) !== null).length
  const totalTracked = ITEMS.length

  return (
    <div style={{
      background: '#FFFFFF',
      borderRadius: '8px',
      border: '1px solid var(--champagne-border)',
      boxShadow: 'var(--shadow-card)',
      padding: '20px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '26px',
            height: '26px',
            borderRadius: '4px',
            background: 'var(--plum-deep)',
            border: '1px solid var(--gold-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Sparkles size={13} color="var(--gold-primary)" />
          </div>
          <div>
            <h4 style={{
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--plum-deep)',
              margin: 0
            }}>
              Your Search Criteria
            </h4>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Live requirement tracking
            </span>
          </div>
        </div>

        {/* Progress pill */}
        <div style={{
          background: 'var(--champagne-surface)',
          color: 'var(--plum-deep)',
          fontSize: '11px',
          fontWeight: 600,
          padding: '3px 8px',
          borderRadius: '4px',
          border: '1px solid var(--champagne-border)'
        }}>
          {completedCount} of {totalTracked} defined
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{
        width: '100%',
        height: '4px',
        background: 'var(--champagne-surface)',
        borderRadius: '2px',
        overflow: 'hidden'
      }}>
        <div style={{
          width: `${(completedCount / totalTracked) * 100}%`,
          height: '100%',
          background: 'var(--gold-primary)',
          transition: 'width 0.3s ease'
        }} />
      </div>

      {/* Tracked Fields List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {ITEMS.map((item) => {
          const val = item.getValue(requirements)
          const isCompleted = val !== null
          const isDiscussing = activeField === item.key

          return (
            <div
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: '6px',
                transition: 'all 0.2s ease',
                background: isDiscussing
                  ? 'var(--champagne-surface)'
                  : isCompleted
                  ? '#FFFFFF'
                  : 'var(--champagne-light)',
                border: isDiscussing
                  ? '1.5px solid var(--gold-primary)'
                  : isCompleted
                  ? '1px solid var(--champagne-border)'
                  : '1px dashed var(--champagne-border)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                {isCompleted ? (
                  <div style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'var(--gold-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <Check size={11} color="#FFFFFF" strokeWidth={3} />
                  </div>
                ) : isDiscussing ? (
                  <div style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: '2px solid var(--gold-dark)',
                    background: '#FFFFFF',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold-dark)' }} />
                  </div>
                ) : (
                  <Circle size={16} color="var(--champagne-dark)" strokeWidth={1.5} style={{ flexShrink: 0 }} />
                )}

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: isDiscussing ? 700 : 600,
                    color: isDiscussing ? 'var(--gold-dark)' : 'var(--text-secondary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em'
                  }}>
                    {item.label}
                    {isDiscussing && (
                      <span style={{
                        marginLeft: '6px',
                        fontSize: '9px',
                        background: 'var(--plum-deep)',
                        border: '1px solid var(--gold-border)',
                        color: 'var(--gold-primary)',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        textTransform: 'uppercase'
                      }}>
                        Current
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: isCompleted ? 600 : 400,
                    color: isCompleted ? 'var(--plum-deep)' : 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    {isCompleted ? val : 'Not specified'}
                  </div>
                </div>
              </div>

              {isCompleted && onEditField && (
                <button
                  type="button"
                  onClick={() => onEditField(item.key)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--rose-primary)',
                    cursor: 'pointer',
                    padding: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={`Edit ${item.label}`}
                >
                  <Edit3 size={13} />
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
