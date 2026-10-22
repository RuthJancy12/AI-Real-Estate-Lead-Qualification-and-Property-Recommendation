import { RotateCcw, SlidersHorizontal, Train, Waves } from 'lucide-react'
import type { PropertyFilters } from '../types/property'

interface PropertyFilterProps {
  filters: PropertyFilters
  onFilterChange: (newFilters: Partial<PropertyFilters>) => void
  onReset: () => void
  totalCount: number
  showingCount: number
}

export function PropertyFilter({ filters, onFilterChange, onReset, totalCount, showingCount }: PropertyFilterProps) {
  return (
    <div style={{ marginBottom: '32px' }}>
      {/* Category Tabs */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={() => onFilterChange({ propertyType: '', beachfrontOnly: false, nearMetroOnly: false })}
            style={{
              padding: '7px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              background: !filters.propertyType && !filters.beachfrontOnly && !filters.nearMetroOnly
                ? 'var(--plum-main)'
                : '#FFFFFF',
              color: !filters.propertyType && !filters.beachfrontOnly && !filters.nearMetroOnly
                ? 'var(--gold-hover)'
                : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: !filters.propertyType && !filters.beachfrontOnly && !filters.nearMetroOnly
                ? 'var(--gold-primary)'
                : 'var(--champagne-border)',
              transition: 'all 0.2s'
            }}
          >
            All Listings
          </button>

          <button
            onClick={() => onFilterChange({ propertyType: 'Villa', beachfrontOnly: false, nearMetroOnly: false })}
            style={{
              padding: '7px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              background: filters.propertyType === 'Villa' ? 'var(--plum-main)' : '#FFFFFF',
              color: filters.propertyType === 'Villa' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: filters.propertyType === 'Villa' ? 'var(--gold-primary)' : 'var(--champagne-border)',
              transition: 'all 0.2s'
            }}
          >
            Luxury Villas
          </button>

          <button
            onClick={() => onFilterChange({ propertyType: 'Penthouse', beachfrontOnly: false, nearMetroOnly: false })}
            style={{
              padding: '7px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              background: filters.propertyType === 'Penthouse' ? 'var(--plum-main)' : '#FFFFFF',
              color: filters.propertyType === 'Penthouse' ? 'var(--gold-hover)' : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: filters.propertyType === 'Penthouse' ? 'var(--gold-primary)' : 'var(--champagne-border)',
              transition: 'all 0.2s'
            }}
          >
            Penthouses
          </button>

          <button
            onClick={() => onFilterChange({ beachfrontOnly: !filters.beachfrontOnly })}
            style={{
              padding: '7px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: filters.beachfrontOnly ? 'var(--plum-main)' : '#FFFFFF',
              color: filters.beachfrontOnly ? 'var(--gold-hover)' : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: filters.beachfrontOnly ? 'var(--gold-primary)' : 'var(--champagne-border)',
              transition: 'all 0.2s'
            }}
          >
            <Waves size={14} /> Beachfront
          </button>

          <button
            onClick={() => onFilterChange({ nearMetroOnly: !filters.nearMetroOnly })}
            style={{
              padding: '7px 16px',
              borderRadius: '4px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: filters.nearMetroOnly ? 'var(--plum-main)' : '#FFFFFF',
              color: filters.nearMetroOnly ? 'var(--gold-hover)' : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: filters.nearMetroOnly ? 'var(--gold-primary)' : 'var(--champagne-border)',
              transition: 'all 0.2s'
            }}
          >
            <Train size={14} /> Metro Walkable
          </button>
        </div>

        {/* Counter and Reset */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            Showing <strong style={{ color: 'var(--plum-main)' }}>{showingCount}</strong> of {totalCount} properties
          </span>
          <button
            onClick={onReset}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--rose-primary)',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RotateCcw size={13} /> Reset Filters
          </button>
        </div>
      </div>

      {/* Advanced Filter Bar */}
      <div style={{
        background: 'var(--champagne-surface)',
        border: '1px solid var(--champagne-border)',
        padding: '14px 20px',
        borderRadius: '6px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '14px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--plum-main)', fontSize: '13px', fontWeight: 600 }}>
          <SlidersHorizontal size={15} color="var(--gold-dark)" /> Filter &amp; Sort
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
          {/* Max Price Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Budget:</span>
            <select
              value={filters.maxPrice || ''}
              onChange={(e) => onFilterChange({ maxPrice: Number(e.target.value) || 0 })}
              style={{
                background: '#FFFFFF',
                color: 'var(--plum-main)',
                border: '1px solid var(--champagne-border)',
                borderRadius: '4px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              <option value="">Any Budget</option>
              <option value="1500000">Up to AED 1.5M</option>
              <option value="3000000">Up to AED 3.0M</option>
              <option value="6000000">Up to AED 6.0M</option>
              <option value="15000000">Up to AED 15M</option>
              <option value="30000000">Up to AED 30M+</option>
            </select>
          </div>

          {/* Sort Order */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Sort by:</span>
            <select
              value={filters.sortBy}
              onChange={(e) => onFilterChange({ sortBy: e.target.value as PropertyFilters['sortBy'] })}
              style={{
                background: '#FFFFFF',
                color: 'var(--plum-main)',
                border: '1px solid var(--champagne-border)',
                borderRadius: '4px',
                padding: '6px 10px',
                fontSize: '12px',
                fontWeight: 500
              }}
            >
              <option value="recommended">Featured / Recommended</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="sqft-desc">Size: Largest Sqft</option>
              <option value="newest">Newest Listed</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
