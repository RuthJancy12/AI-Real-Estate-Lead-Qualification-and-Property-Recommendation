import React from 'react'
import { Heart, Bed, Bath, Maximize2, MapPin, ArrowRight } from 'lucide-react'
import type { Property } from '../types/property'

interface PropertyCardProps {
  property: Property
  isFavorite: boolean
  onToggleFavorite: (id: string) => void
  onSelectProperty: (property: Property) => void
  matchExplanation?: string
}

export function PropertyCard({
  property,
  isFavorite,
  onToggleFavorite,
  onSelectProperty,
  matchExplanation
}: PropertyCardProps) {
  const formattedPrice = new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    maximumFractionDigits: 0
  }).format(property.price_aed)

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleFavorite(property.property_id)
  }

  return (
    <div
      onClick={() => onSelectProperty(property)}
      style={{
        background: '#FFFFFF',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--champagne-border)',
        boxShadow: 'var(--shadow-card)',
        transition: 'all 0.25s ease',
        display: 'flex',
        flexDirection: 'column',
        cursor: 'pointer'
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.transform = 'translateY(-3px)'
        e.currentTarget.style.borderColor = 'var(--gold-primary)'
        e.currentTarget.style.boxShadow = 'var(--shadow-md)'
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.borderColor = 'var(--champagne-border)'
        e.currentTarget.style.boxShadow = 'var(--shadow-card)'
      }}
    >
      {/* Large Property Image */}
      <div style={{ position: 'relative', width: '100%', height: '240px', overflow: 'hidden', background: 'var(--champagne-surface)' }}>
        <img
          src={property.image_url}
          alt={property.title}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 0.4s ease'
          }}
          onError={(e) => {
            e.currentTarget.src = 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80'
          }}
        />

        {/* Status Tag */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          display: 'flex',
          gap: '6px'
        }}>
          <span style={{
            background: 'var(--plum-main)',
            color: 'var(--gold-hover)',
            border: '1px solid var(--gold-border)',
            fontSize: '11px',
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: '4px',
            letterSpacing: '0.04em',
            textTransform: 'uppercase'
          }}>
            For {property.listing_type}
          </span>
          <span style={{
            background: '#FFFFFF',
            color: 'var(--plum-main)',
            fontSize: '11px',
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: '4px',
            border: '1px solid var(--champagne-border)'
          }}>
            {property.property_type}
          </span>
        </div>

        {/* Favorite Button */}
        <button
          type="button"
          onClick={handleFavoriteClick}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: '#FFFFFF',
            border: '1px solid var(--champagne-border)',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: isFavorite ? 'var(--rose-primary)' : 'var(--text-secondary)'
          }}
        >
          <Heart size={16} fill={isFavorite ? 'var(--rose-primary)' : 'none'} />
        </button>
      </div>

      {/* Property Details Body */}
      <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }}>
        <div>
          {/* Price Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
            <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--plum-main)' }}>
              {formattedPrice}
              {property.listing_type === 'Rent' && (
                <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)' }}> / yr</span>
              )}
            </span>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              AED {property.price_per_sqft_aed.toLocaleString()}/sqft
            </span>
          </div>

          {/* Property Name */}
          <h3 style={{
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--text-main)',
            lineHeight: 1.4,
            marginBottom: '6px',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            minHeight: '42px'
          }}>
            {property.title}
          </h3>

          {/* Location */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '14px' }}>
            <MapPin size={14} color="var(--rose-primary)" style={{ flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {property.location} &bull; {property.street}
            </span>
          </div>

          {/* Specs: Bedrooms | Bathrooms | Area */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '8px',
            padding: '10px 0',
            borderTop: '1px solid var(--champagne-border)',
            borderBottom: '1px solid var(--champagne-border)',
            marginBottom: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <Bed size={15} color="var(--gold-dark)" />
              <span>{property.bhk === 0 ? 'Studio' : `${property.bhk} Beds`}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <Bath size={15} color="var(--gold-dark)" />
              <span>{property.bathrooms} Baths</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <Maximize2 size={15} color="var(--gold-dark)" />
              <span>{property.property_size_sqft.toLocaleString()} sqft</span>
            </div>
          </div>

          {matchExplanation && (
            <div style={{
              background: 'var(--champagne-surface)',
              border: '1px solid var(--champagne-border)',
              borderRadius: '6px',
              padding: '8px 10px',
              fontSize: '11px',
              color: 'var(--plum-main)',
              marginBottom: '14px',
              lineHeight: 1.4
            }}>
              <strong>Consultancy Note:</strong> {matchExplanation}
            </div>
          )}
        </div>

        {/* View Property Button */}
        <button
          type="button"
          onClick={() => onSelectProperty(property)}
          className="navy-btn"
          style={{
            width: '100%',
            padding: '10px 16px',
            fontSize: '13px',
            borderRadius: '4px'
          }}
        >
          <span>View Property</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}
