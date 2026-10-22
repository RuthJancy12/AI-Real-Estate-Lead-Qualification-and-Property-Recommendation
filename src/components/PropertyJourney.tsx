export function PropertyJourney() {
  const steps = [
    {
      num: '01',
      title: 'Understand Your Requirements',
      desc: 'We define your lifestyle needs, budget ceiling, preferred community vibe, and long-term investment priorities.'
    },
    {
      num: '02',
      title: 'Explore & Shortlist',
      desc: 'Review curated, verified properties from our 3,000+ portfolio, comparing floor plans, payment milestones, and expected yields.'
    },
    {
      num: '03',
      title: 'Property Viewing',
      desc: 'Accompanied in-person private viewings or immersive high-definition 4K virtual walk-throughs for international buyers.'
    },
    {
      num: '04',
      title: 'Secure Your Property',
      desc: 'Formal reservation with developer or seller, sales agreement drafting, escrow deposit protection, and title deed registration.'
    }
  ]

  return (
    <section style={{
      background: 'var(--champagne-light)',
      borderBottom: '1px solid var(--champagne-border)',
      padding: '90px 0'
    }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '52px' }}>
          <span style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 700,
            color: 'var(--rose-primary)'
          }}>
            Seamless Process
          </span>
          <h2 className="luxury-serif" style={{
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--plum-deep)',
            marginTop: '8px',
            marginBottom: '12px'
          }}>
            Your Dubai Property Journey
          </h2>
          <p style={{
            color: 'var(--text-secondary)',
            maxWidth: '560px',
            margin: '0 auto',
            fontSize: '15px'
          }}>
            A structured, transparent four-step pathway designed to make acquiring property in Dubai straightforward and secure.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '24px'
        }}>
          {steps.map((st, idx) => (
            <div
              key={idx}
              style={{
                background: '#FFFFFF',
                borderRadius: '8px',
                border: '1px solid var(--champagne-border)',
                padding: '32px 24px',
                boxShadow: 'var(--shadow-card)',
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'all 0.25s ease'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = 'var(--gold-primary)'
                e.currentTarget.style.transform = 'translateY(-3px)'
                e.currentTarget.style.boxShadow = '0 10px 25px rgba(26, 13, 24, 0.08)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = 'var(--champagne-border)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'var(--shadow-card)'
              }}
            >
              <div>
                <div className="luxury-serif" style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--gold-dark)',
                  lineHeight: 1,
                  marginBottom: '18px'
                }}>
                  {st.num}
                </div>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--plum-deep)',
                  marginBottom: '10px'
                }}>
                  {st.title}
                </h3>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.55,
                  margin: 0
                }}>
                  {st.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
