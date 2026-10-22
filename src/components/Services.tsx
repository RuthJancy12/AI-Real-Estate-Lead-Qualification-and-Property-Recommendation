import { Home, Key, Tag, TrendingUp, Landmark, ArrowUpRight } from 'lucide-react'

interface ServicesProps {
  onServiceClick?: (service: string) => void
}

export function Services({ onServiceClick }: ServicesProps) {
  const services = [
    {
      icon: Home,
      title: 'Buy Property',
      description: 'Access exclusive off-plan launches and prime secondary villas across prestigious Dubai addresses.',
      action: 'Explore Buying'
    },
    {
      icon: Key,
      title: 'Rent Property',
      description: 'Curated luxury residential leases in high-demand waterfront and golf communities.',
      action: 'Browse Rentals'
    },
    {
      icon: Tag,
      title: 'Sell Property',
      description: 'Comprehensive property valuation, global marketing, and qualified high-net-worth buyer matching.',
      action: 'Request Valuation'
    },
    {
      icon: TrendingUp,
      title: 'Property Investment',
      description: 'Institutional-grade ROI advisory, yield optimization, capital growth mapping, and Golden Visa support.',
      action: 'Investment Advisory'
    },
    {
      icon: Landmark,
      title: 'Mortgage Guidance',
      description: 'Preferred non-resident and resident financing arrangements with premier UAE commercial lenders.',
      action: 'Mortgage Support'
    }
  ]

  return (
    <section id="services" style={{
      background: 'var(--champagne-surface)',
      borderBottom: '1px solid var(--champagne-border)',
      padding: '80px 0'
    }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <span style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 700,
            color: 'var(--rose-primary)'
          }}>
            Comprehensive Advisory
          </span>
          <h2 className="luxury-serif" style={{
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--plum-main)',
            marginTop: '8px',
            marginBottom: '12px'
          }}>
            Our Real Estate Services
          </h2>
          <p style={{
            color: 'var(--text-secondary)',
            maxWidth: '560px',
            margin: '0 auto',
            fontSize: '15px'
          }}>
            Tailored property advisory services designed to simplify every stage of acquiring, leasing, and managing luxury property in Dubai.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '24px'
        }}>
          {services.map((s, idx) => {
            const Icon = s.icon
            return (
              <div
                key={idx}
                onClick={() => onServiceClick && onServiceClick(s.title)}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid var(--champagne-border)',
                  borderRadius: '10px',
                  padding: '28px 24px',
                  boxShadow: 'var(--shadow-card)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.25s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--gold-primary)'
                  e.currentTarget.style.transform = 'translateY(-3px)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--champagne-border)'
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                }}
              >
                <div>
                  <div style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '8px',
                    background: 'var(--champagne-muted)',
                    border: '1px solid var(--gold-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '20px'
                  }}>
                    <Icon size={22} color="var(--gold-dark)" strokeWidth={1.75} />
                  </div>
                  <h3 style={{
                    fontSize: '17px',
                    fontWeight: 700,
                    color: 'var(--plum-main)',
                    marginBottom: '10px'
                  }}>
                    {s.title}
                  </h3>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.5,
                    marginBottom: '24px'
                  }}>
                    {s.description}
                  </p>
                </div>

                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--plum-main)',
                  borderTop: '1px solid var(--champagne-border)',
                  paddingTop: '14px'
                }}>
                  <span>{s.action}</span>
                  <ArrowUpRight size={14} color="var(--gold-dark)" />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
