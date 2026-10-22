import { Compass, ShieldCheck, Search, TrendingUp, Handshake } from 'lucide-react'

export function WhyLyka() {
  const features = [
    {
      icon: Compass,
      title: 'Local Dubai Expertise',
      description: 'Decades of combined advisory experience across Dubai Land Department procedures, master-developer track records, and upcoming community pipelines.'
    },
    {
      icon: ShieldCheck,
      title: 'Transparent Guidance',
      description: 'Zero hidden fees on off-plan purchases, verified title deed credentials, and objective escrow account verification.'
    },
    {
      icon: Search,
      title: 'Personalized Property Search',
      description: 'Bespoke shortlists tailored to your lifestyle preferences, schools, commuting routes, and financial requirements.'
    },
    {
      icon: TrendingUp,
      title: 'Investment Support',
      description: 'Deep ROI analytics, rental yield benchmarking, capital appreciation forecasts, and UAE Golden Visa qualification guidance.'
    },
    {
      icon: Handshake,
      title: 'End-to-End Assistance',
      description: 'Dedicated support from initial inquiry, viewing logistics, conveyancing, down payments, and key handover.'
    }
  ]

  return (
    <section style={{
      background: 'var(--champagne-surface)',
      borderBottom: '1px solid var(--champagne-border)',
      padding: '90px 0'
    }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '50px' }}>
          <span style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 700,
            color: 'var(--rose-primary)'
          }}>
            The Lyka Standard
          </span>
          <h2 className="luxury-serif" style={{
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--plum-main)',
            marginTop: '8px',
            marginBottom: '12px'
          }}>
            Why Clients Choose Lyka Realty
          </h2>
          <p style={{
            color: 'var(--text-secondary)',
            maxWidth: '580px',
            margin: '0 auto',
            fontSize: '15px'
          }}>
            Our client-first philosophy prioritizes discretion, precision analytics, and unwavering transparency in every property transaction.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '24px'
        }}>
          {features.map((f, idx) => {
            const Icon = f.icon
            return (
              <div
                key={idx}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid var(--champagne-border)',
                  borderRadius: '8px',
                  padding: '28px 22px',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.25s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'var(--gold-primary)'
                  e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'var(--champagne-border)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '6px',
                  background: 'var(--champagne-light)',
                  border: '1px solid var(--gold-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '18px'
                }}>
                  <Icon size={20} color="var(--gold-dark)" strokeWidth={1.75} />
                </div>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--plum-main)',
                  marginBottom: '8px'
                }}>
                  {f.title}
                </h3>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0
                }}>
                  {f.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
