export function Developers() {
  const developers = [
    { name: 'EMAAR', type: 'Master Developer' },
    { name: 'NAKHEEL', type: 'Palm Jumeirah & Islands' },
    { name: 'DAMAC', type: 'Luxury Living' },
    { name: 'SOBHA REALTY', type: 'Hartland & Beyond' },
    { name: 'MERAAS', type: 'Waterfront & Urban' },
    { name: 'ALDAR', type: 'Iconic Developments' },
    { name: 'ELLINGTON', type: 'Design-Led Properties' },
    { name: 'SELECT GROUP', type: 'Marina Specialists' }
  ]

  return (
    <section style={{
      background: 'var(--champagne-light)',
      borderBottom: '1px solid var(--champagne-border)',
      padding: '50px 0'
    }}>
      <div className="container">
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 700,
            color: 'var(--rose-primary)'
          }}>
            Authorised Agency Partner
          </span>
          <h3 className="luxury-serif" style={{
            fontSize: '24px',
            fontWeight: 600,
            color: 'var(--plum-main)',
            marginTop: '6px'
          }}>
            Leading Dubai Master Developers
          </h3>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '20px',
          alignItems: 'center'
        }}>
          {developers.map((dev, idx) => (
            <div
              key={idx}
              style={{
                background: '#FFFFFF',
                border: '1px solid var(--champagne-border)',
                borderRadius: '6px',
                padding: '16px 12px',
                textAlign: 'center',
                transition: 'all 0.2s ease',
                boxShadow: 'var(--shadow-sm)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = 'var(--gold-primary)'
                e.currentTarget.style.transform = 'translateY(-2px)'
                e.currentTarget.style.boxShadow = 'var(--shadow-gold)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = 'var(--champagne-border)'
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)'
              }}
            >
              <div style={{
                fontSize: '13px',
                fontWeight: 800,
                letterSpacing: '0.08em',
                color: 'var(--plum-main)',
                textTransform: 'uppercase'
              }}>
                {dev.name}
              </div>
              <div style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                marginTop: '4px'
              }}>
                {dev.type}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
