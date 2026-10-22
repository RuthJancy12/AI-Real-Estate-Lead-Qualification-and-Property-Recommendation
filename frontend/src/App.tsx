import { useState, useEffect, useMemo, useCallback } from 'react'
import type { Property, PropertyFilters } from './types/property'
import type { AgentStatus } from './types/agent'
import { formatProperty } from './utils/propertyData'
import { fetchPropertiesFromApi } from './services/api'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { StatsRibbon } from './components/StatsRibbon'
import { Developers } from './components/Developers'
import { Services } from './components/Services'
import { PropertyFilter } from './components/PropertyFilter'
import { PropertyCard } from './components/PropertyCard'
import { Neighborhoods } from './components/Neighborhoods'
import { WhyLyka } from './components/WhyLyka'
import { DubaiInvestment } from './components/DubaiInvestment'
import { WhoWeHelp } from './components/WhoWeHelp'
import { PropertyJourney } from './components/PropertyJourney'
import { MortgageCalculator } from './components/MortgageCalculator'
import { Testimonials } from './components/Testimonials'
import { FAQ } from './components/FAQ'
import { ContactConsultation } from './components/ContactConsultation'
import { Footer } from './components/Footer'
import { PropertyModal } from './components/PropertyModal'
import { FavoritesDrawer } from './components/FavoritesDrawer'
import { UIAgentModal } from './components/agent/UIAgentModal'
import { VoiceAgentControl } from './components/agent/VoiceAgentControl'
import { AuthModal, type AuthMode } from './components/AuthModal'
import { BackendStatusIndicator } from './components/BackendStatusIndicator'
import { ChevronDown, Building2, AlertCircle } from 'lucide-react'

const DEFAULT_FILTERS: PropertyFilters = {
  searchQuery: '',
  listingType: 'All',
  propertyType: '',
  location: '',
  minPrice: 0,
  maxPrice: 0,
  bhk: '',
  nearMetroOnly: false,
  beachfrontOnly: false,
  sortBy: 'recommended'
}

export function App() {
  const [properties, setProperties] = useState<Property[]>([])
  const [totalCount, setTotalCount] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [apiError, setApiError] = useState<string | null>(null)
  const [propertiesCache, setPropertiesCache] = useState<Record<string, Property>>({})
  const [filters, setFilters] = useState<PropertyFilters>(DEFAULT_FILTERS)
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null)
  const [visibleCount, setVisibleCount] = useState(12)

  // Favorites state
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lyka_favorites')
      return saved ? JSON.parse(saved) : ['LYK-00002', 'LYK-00015']
    } catch {
      return ['LYK-00002', 'LYK-00015']
    }
  })
  const [isFavoritesOpen, setIsFavoritesOpen] = useState(false)

  // UI Agent state
  const [isAgentOpen, setIsAgentOpen] = useState(false)
  const [agentInitialQuery, setAgentInitialQuery] = useState('')
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('ready')

  // Auth state
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [currentUser, setCurrentUser] = useState<{ name: string; email: string } | null>(() => {
    try {
      const saved = localStorage.getItem('lyka_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  // Fetch properties from backend API on port 8000
  const fetchProperties = useCallback(async () => {
    setIsLoading(true)
    setApiError(null)
    try {
      let backendSort: string | undefined
      if (filters.sortBy === 'price-asc') backendSort = 'cheapest'
      else if (filters.sortBy === 'price-desc') backendSort = 'expensive'
      else if (filters.sortBy === 'sqft-desc') backendSort = 'size'

      const loc = filters.location || (filters.searchQuery.trim() ? filters.searchQuery.trim() : undefined)

      let bedrooms: number | undefined
      if (filters.bhk !== '') {
        const parsed = parseInt(filters.bhk, 10)
        if (!isNaN(parsed)) bedrooms = parsed
      }

      const res = await fetchPropertiesFromApi({
        location: loc,
        property_type: filters.propertyType || undefined,
        bedrooms,
        min_budget: filters.minPrice > 0 ? filters.minPrice : undefined,
        max_budget: filters.maxPrice > 0 ? filters.maxPrice : undefined,
        purpose: filters.listingType !== 'All' ? filters.listingType : undefined,
        near_metro: filters.nearMetroOnly ? true : undefined,
        near_beach: filters.beachfrontOnly ? true : undefined,
        sort_by: backendSort,
        limit: 250
      })

      const formatted = (res.top_properties || []).map(formatProperty)
      setProperties(formatted)
      setTotalCount(res.total_found ?? formatted.length)

      // Cache properties for favorites lookup
      setPropertiesCache((prev) => {
        const next = { ...prev }
        formatted.forEach((p) => {
          next[p.property_id] = p
        })
        return next
      })
    } catch (err) {
      console.error('Failed to fetch properties from backend:', err)
      const msg = err instanceof Error ? err.message : 'Unable to connect to property API on port 8000'
      setApiError(msg)
      setProperties([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
    }
  }, [filters])

  useEffect(() => {
    fetchProperties()
  }, [fetchProperties])

  // Sync favorites
  useEffect(() => {
    try {
      localStorage.setItem('lyka_favorites', JSON.stringify(favoriteIds))
    } catch {
      // Ignore
    }
  }, [favoriteIds])

  // Sync user
  useEffect(() => {
    try {
      if (currentUser) {
        localStorage.setItem('lyka_user', JSON.stringify(currentUser))
      } else {
        localStorage.removeItem('lyka_user')
      }
    } catch {
      // Ignore
    }
  }, [currentUser])

  const handleToggleFavorite = (id: string) => {
    setFavoriteIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleUpdateFilters = (newFilters: Partial<PropertyFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }))
    setVisibleCount(12)
  }

  const handleResetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setVisibleCount(12)
  }

  const handleSelectNeighborhood = (location: string) => {
    handleUpdateFilters({ location })
    const el = document.getElementById('properties')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleSearchSubmit = () => {
    const el = document.getElementById('properties')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleOpenAgent = (query?: string) => {
    setAgentInitialQuery(query || '')
    setIsAgentOpen(true)
  }

  const handleVoiceMessage = (text: string) => {
    setAgentStatus('thinking')
    handleOpenAgent(text)
  }

  const handleScrollToContact = () => {
    const el = document.getElementById('contact')
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  // Refined filter & sort
  const filteredProperties = useMemo(() => {
    return properties
      .filter((prop) => {
        if (filters.bhk === '4' && prop.bhk < 4) return false
        if (filters.searchQuery.trim()) {
          const query = filters.searchQuery.toLowerCase()
          const matchTitle = prop.title.toLowerCase().includes(query)
          const matchLocation = prop.location.toLowerCase().includes(query)
          const matchStreet = prop.street.toLowerCase().includes(query)
          const matchView = prop.view.toLowerCase().includes(query)
          const matchId = prop.property_id.toLowerCase().includes(query)
          if (!matchTitle && !matchLocation && !matchStreet && !matchView && !matchId) {
            return false
          }
        }
        return true
      })
      .sort((a, b) => {
        if (filters.sortBy === 'price-asc') return a.price_aed - b.price_aed
        if (filters.sortBy === 'price-desc') return b.price_aed - a.price_aed
        if (filters.sortBy === 'sqft-desc') return b.property_size_sqft - a.property_size_sqft
        if (filters.sortBy === 'newest') return a.listed_days_ago - b.listed_days_ago
        return b.price_aed - a.price_aed
      })
  }, [properties, filters.bhk, filters.searchQuery, filters.sortBy])

  const visibleProperties = useMemo(() => {
    return filteredProperties.slice(0, visibleCount)
  }, [filteredProperties, visibleCount])

  const favoriteProperties = useMemo(() => {
    return favoriteIds
      .map((id) => propertiesCache[id] || properties.find((p) => p.property_id === id))
      .filter(Boolean) as Property[]
  }, [favoriteIds, propertiesCache, properties])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--champagne-light)' }}>
      {/* 1. HEADER */}
      <Navbar
        favoritesCount={favoriteIds.length}
        onOpenFavorites={() => setIsFavoritesOpen(true)}
        onOpenAgent={() => handleOpenAgent()}
        onOpenAuth={() => {
          setAuthMode('login')
          setIsAuthOpen(true)
        }}
        currentUser={currentUser}
        onLogout={() => setCurrentUser(null)}
        onBookCallClick={handleScrollToContact}
      />

      {/* 2. HERO SECTION */}
      <Hero
        filters={filters}
        onFilterChange={handleUpdateFilters}
        onSearchSubmit={handleSearchSubmit}
        totalCount={totalCount || filteredProperties.length}
      />

      {/* 3. TRUST / STATS SECTION */}
      <StatsRibbon />

      {/* 4. DEVELOPERS SECTION */}
      <Developers />

      {/* 5. SERVICES SECTION */}
      <Services onServiceClick={() => handleScrollToContact()} />

      {/* 6. FEATURED PROPERTIES */}
      <section id="properties" style={{ padding: '90px 0', background: 'var(--champagne-light)', borderBottom: '1px solid var(--champagne-border)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', marginBottom: '44px' }}>
            <span style={{
              fontSize: '11px',
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              fontWeight: 700,
              color: 'var(--rose-primary)'
            }}>
              Exclusive Dubai Portfolio
            </span>
            <h2 className="luxury-serif" style={{ fontSize: '34px', color: 'var(--plum-main)', margin: '8px 0 10px', fontWeight: 600 }}>
              Featured Properties in Dubai
            </h2>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '560px', margin: '0 auto', fontSize: '15px' }}>
              Handpicked freehold residences with verified title deeds, direct master-developer pricing, and high yield potential.
            </p>
          </div>

          {/* Filter Bar */}
          <PropertyFilter
            filters={filters}
            onFilterChange={handleUpdateFilters}
            onReset={handleResetFilters}
            totalCount={totalCount || filteredProperties.length}
            showingCount={filteredProperties.length}
          />

          {/* Properties Grid */}
          {isLoading ? (
            <div style={{
              padding: '70px 20px',
              textAlign: 'center',
              borderRadius: '8px',
              border: '1px solid var(--champagne-border)',
              background: 'var(--champagne-surface)',
              margin: '20px 0'
            }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  margin: '0 auto 16px',
                  border: '3px solid var(--champagne-border)',
                  borderTopColor: 'var(--gold-primary)',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite'
                }}
              />
              <h3 className="luxury-serif" style={{ fontSize: '20px', color: 'var(--plum-main)', marginBottom: '6px' }}>
                Loading Verified Dubai Properties...
              </h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '420px', margin: '0 auto', fontSize: '14px' }}>
                Fetching live property records from the backend API on port 8000.
              </p>
            </div>
          ) : apiError ? (
            <div style={{
              padding: '60px 20px',
              textAlign: 'center',
              borderRadius: '8px',
              border: '1px solid #FECACA',
              background: '#FEF2F2',
              margin: '20px 0'
            }}>
              <AlertCircle size={38} color="#DC2626" style={{ margin: '0 auto 14px' }} />
              <h3 className="luxury-serif" style={{ fontSize: '20px', color: '#991B1B', marginBottom: '8px' }}>
                Unable to Load Properties
              </h3>
              <p style={{ color: '#7F1D1D', maxWidth: '480px', margin: '0 auto 20px', fontSize: '14px' }}>
                {apiError}
              </p>
              <button onClick={() => fetchProperties()} className="gold-btn">
                Retry Connection
              </button>
            </div>
          ) : filteredProperties.length === 0 ? (
            <div style={{
              padding: '60px 20px',
              textAlign: 'center',
              borderRadius: '8px',
              border: '1px solid var(--champagne-border)',
              background: 'var(--champagne-surface)',
              margin: '20px 0'
            }}>
              <Building2 size={36} color="var(--gold-dark)" style={{ margin: '0 auto 14px' }} />
              <h3 className="luxury-serif" style={{ fontSize: '20px', color: 'var(--plum-main)', marginBottom: '8px' }}>
                No Properties Found
              </h3>
              <p style={{ color: 'var(--text-secondary)', maxWidth: '420px', margin: '0 auto 20px', fontSize: '14px' }}>
                No listings matched your active filter parameters. Reset your search criteria to explore our full Dubai portfolio.
              </p>
              <button onClick={handleResetFilters} className="gold-btn">
                Clear Filters
              </button>
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))',
              gap: '28px'
            }}>
              {visibleProperties.map((property) => (
                <PropertyCard
                  key={property.property_id}
                  property={property}
                  isFavorite={favoriteIds.includes(property.property_id)}
                  onToggleFavorite={handleToggleFavorite}
                  onSelectProperty={setSelectedProperty}
                />
              ))}
            </div>
          )}

          {/* Load More Button */}
          {!isLoading && !apiError && visibleCount < filteredProperties.length && (
            <div style={{ textAlign: 'center', marginTop: '48px' }}>
              <button
                onClick={() => setVisibleCount((prev) => prev + 12)}
                className="outline-navy-btn"
                style={{ padding: '12px 32px', fontSize: '14px' }}
              >
                <span>Load More Properties ({filteredProperties.length - visibleCount} remaining)</span>
                <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>
      </section>

      {/* 7. DUBAI COMMUNITIES */}
      <Neighborhoods onSelectNeighborhood={handleSelectNeighborhood} />

      {/* 8. WHY LYKA REALTY */}
      <WhyLyka />

      {/* 9. DUBAI INVESTMENT SECTION */}
      <DubaiInvestment onExploreInvestment={handleScrollToContact} />

      {/* 10. WHO WE HELP */}
      <WhoWeHelp onCategoryClick={handleScrollToContact} />

      {/* 11. PROPERTY JOURNEY */}
      <PropertyJourney />

      {/* 12. MORTGAGE CALCULATOR */}
      <MortgageCalculator />

      {/* 13. TESTIMONIALS */}
      <Testimonials />

      {/* 14. FAQ */}
      <FAQ />

      {/* 15. CONTACT / CTA */}
      <ContactConsultation />

      {/* 16. FOOTER */}
      <Footer />

      {/* Property Details Modal */}
      <PropertyModal
        property={selectedProperty}
        isOpen={selectedProperty !== null}
        onClose={() => setSelectedProperty(null)}
        isFavorite={selectedProperty ? favoriteIds.includes(selectedProperty.property_id) : false}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* Saved Properties Drawer */}
      <FavoritesDrawer
        isOpen={isFavoritesOpen}
        onClose={() => setIsFavoritesOpen(false)}
        favoriteProperties={favoriteProperties}
        onRemoveFavorite={handleToggleFavorite}
        onSelectProperty={setSelectedProperty}
      />

      {/* Conversational UI Agent Modal */}
      <UIAgentModal
        isOpen={isAgentOpen}
        onClose={() => setIsAgentOpen(false)}
        properties={properties}
        onSelectProperty={setSelectedProperty}
        initialQuery={agentInitialQuery}
        favoriteIds={favoriteIds}
        onToggleFavorite={handleToggleFavorite}
      />

      {/* Voice UI Assistant Control */}
      <VoiceAgentControl
        status={agentStatus}
        onSendMessage={handleVoiceMessage}
        onOpenAgent={() => handleOpenAgent()}
      />

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthOpen}
        initialMode={authMode}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={(user) => setCurrentUser(user)}
      />

      {/* Backend Status Indicator (Step 2 Dev Connection) */}
      <BackendStatusIndicator />
    </div>
  )
}

export default App
