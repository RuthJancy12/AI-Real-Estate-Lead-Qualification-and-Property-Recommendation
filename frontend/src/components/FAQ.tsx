import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const faqs = [
    {
      q: 'Can foreigners and non-residents buy property in Dubai?',
      a: 'Yes. Under the Dubai Foreign Ownership Law of 2002, foreign nationals of any nationality can purchase 100% freehold property in designated freehold communities across Dubai, with full rights to sell, lease, or bequeath the asset.'
    },
    {
      q: 'Can NRIs (Non-Resident Indians) buy property in Dubai?',
      a: 'Yes, NRIs represent one of the largest buyer groups in Dubai. Indian nationals can invest directly through Indian banking channels under the RBI Liberalised Remittance Scheme (LRS) or using overseas bank accounts, with 0% personal tax on income generated.'
    },
    {
      q: 'Should I buy or rent property in Dubai?',
      a: 'Given current Dubai tenancy inflation and mortgage interest rates, buying typically becomes significantly more economical than renting for stays over 3 years. Furthermore, buyers build direct equity and benefit from potential capital appreciation.'
    },
    {
      q: 'Which communities offer the best investment ROI and rental yields?',
      a: 'High-yield apartment communities such as Jumeirah Village Circle (JVC), Business Bay, and Dubai Creek Harbour frequently deliver net yields between 7.5% and 9.5%. For luxury capital appreciation, Palm Jumeirah, Downtown Dubai, and Dubai Hills Estate lead the market.'
    },
    {
      q: 'How do I start the process of buying a property in Dubai?',
      a: 'The journey begins by defining your budget, financing status, and location preference. Once shortlisted with a Lyka consultant, you make an initial reservation deposit (typically 10%), sign Form F (Unified Sale Contract), and proceed to DLD Trustee transfer.'
    },
    {
      q: 'Can I obtain a mortgage as an overseas or non-resident buyer?',
      a: 'Yes. Commercial banks in the UAE (including Emirates NBD, FAB, and Dubai Islamic Bank) provide mortgages for non-resident buyers, typically offering loan-to-value (LTV) ratios up to 50% - 60% with terms spanning up to 25 years.'
    }
  ]

  const toggle = (idx: number) => {
    setOpenIndex(openIndex === idx ? null : idx)
  }

  return (
    <section style={{
      background: 'var(--champagne-surface)',
      borderBottom: '1px solid var(--champagne-border)',
      padding: '90px 0'
    }}>
      <div className="container" style={{ maxWidth: '880px' }}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <span style={{
            fontSize: '11px',
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            fontWeight: 700,
            color: 'var(--rose-primary)'
          }}>
            Clear Answers
          </span>
          <h2 className="luxury-serif" style={{
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--plum-deep)',
            marginTop: '8px',
            marginBottom: '12px'
          }}>
            Frequently Asked Questions
          </h2>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '15px',
            margin: 0
          }}>
            Essential legal, regulatory, and financial insights for prospective Dubai property owners.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {faqs.map((f, idx) => {
            const isOpen = openIndex === idx
            return (
              <div
                key={idx}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '6px',
                  border: isOpen ? '1px solid var(--gold-primary)' : '1px solid var(--champagne-border)',
                  overflow: 'hidden',
                  boxShadow: isOpen ? '0 4px 15px rgba(26, 13, 24, 0.06)' : 'var(--shadow-sm)',
                  transition: 'all 0.2s ease'
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  style={{
                    width: '100%',
                    padding: '20px 24px',
                    textAlign: 'left',
                    background: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    cursor: 'pointer'
                  }}
                >
                  <span style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    color: isOpen ? 'var(--plum-deep)' : 'var(--text-main)'
                  }}>
                    {f.q}
                  </span>
                  {isOpen ? <ChevronUp size={18} color="var(--gold-dark)" /> : <ChevronDown size={18} color="var(--text-secondary)" />}
                </button>

                {isOpen && (
                  <div style={{
                    padding: '0 24px 20px',
                    fontSize: '14px',
                    color: 'var(--text-secondary)',
                    lineHeight: 1.6,
                    borderTop: '1px solid var(--champagne-border)',
                    paddingTop: '16px'
                  }}>
                    {f.a}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
