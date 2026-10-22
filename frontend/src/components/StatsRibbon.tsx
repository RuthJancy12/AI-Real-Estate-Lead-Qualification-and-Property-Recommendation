export function StatsRibbon() {
  const stats = [
    {
      value: '300+',
      label: 'Happy Clients',
      subtext: 'Global and resident investors'
    },
    {
      value: 'AED 3B+',
      label: 'Property Sales',
      subtext: 'Completed transaction volume'
    },
    {
      value: '18+',
      label: 'Prime Communities',
      subtext: 'Exclusive portfolio coverage'
    },
    {
      value: '5.0 ★',
      label: 'Client Experience',
      subtext: 'Accredited advisory rating'
    }
  ]

  return (
    <section id="about" style={{
      background: 'var(--champagne-surface)',
      borderBottom: '1px solid var(--champagne-border)',
      padding: '70px 0'
    }}>
      <div className="container">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '40px',
          textAlign: 'center'
        }}>
          {stats.map((s, idx) => (
            <div key={idx} style={{ padding: '10px 16px' }}>
              <div className="luxury-serif" style={{
                fontSize: 'clamp(36px, 4vw, 52px)',
                fontWeight: 600,
                color: 'var(--primary-navy)',
                lineHeight: 1.1,
                marginBottom: '8px'
              }}>
                {s.value}
              </div>
              <div style={{
                fontSize: '15px',
                fontWeight: 600,
                color: 'var(--text-main)',
                letterSpacing: '0.02em',
                marginBottom: '4px'
              }}>
                {s.label}
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                {s.subtext}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
