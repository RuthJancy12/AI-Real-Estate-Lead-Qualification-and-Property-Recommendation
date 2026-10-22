import { useState } from 'react'
import { Calculator, DollarSign, Percent, Calendar } from 'lucide-react'

export function MortgageCalculator() {
  const [propertyPrice, setPropertyPrice] = useState(3500000)
  const [downPaymentPercent, setDownPaymentPercent] = useState(20)
  const [tenureYears, setTenureYears] = useState(25)
  const [interestRate, setInterestRate] = useState(4.25)

  // Calculations
  const downPaymentAmount = (propertyPrice * downPaymentPercent) / 100
  const loanAmount = propertyPrice - downPaymentAmount
  const monthlyRate = interestRate / 100 / 12
  const totalMonths = tenureYears * 12

  const monthlyPayment =
    monthlyRate > 0
      ? (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalMonths))) /
        (Math.pow(1 + monthlyRate, totalMonths) - 1)
      : loanAmount / totalMonths

  const totalPayment = monthlyPayment * totalMonths
  const totalInterest = totalPayment - loanAmount
  const estimatedAnnualRent = propertyPrice * 0.082
  const estimatedNetYield = ((estimatedAnnualRent - monthlyPayment * 12) / downPaymentAmount) * 100

  return (
    <section id="calculator" style={{
      padding: '90px 0',
      background: 'var(--champagne-surface)',
      borderBottom: '1px solid var(--champagne-border)'
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
            Financial Estimation
          </span>
          <h2 className="luxury-serif" style={{
            fontSize: '34px',
            fontWeight: 600,
            color: 'var(--plum-deep)',
            marginTop: '8px',
            marginBottom: '12px'
          }}>
            Dubai Mortgage &amp; Yield Calculator
          </h2>
          <p style={{
            color: 'var(--text-secondary)',
            maxWidth: '560px',
            margin: '0 auto',
            fontSize: '15px'
          }}>
            Estimate your monthly installments, required equity down payment, and forecast rental yields across UAE lenders.
          </p>
        </div>

        <div className="mortgage-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          gap: '30px',
          alignItems: 'start'
        }}>
          {/* Sliders Input Panel */}
          <div className="mortgage-pad" style={{
            background: '#FFFFFF',
            padding: '32px',
            borderRadius: '8px',
            border: '1px solid var(--champagne-border)',
            boxShadow: 'var(--shadow-sm)'
          }}>
            {/* Property Price */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Property Price (AED)</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--plum-deep)' }}>
                  AED {propertyPrice.toLocaleString('en-US')}
                </span>
              </div>
              <input
                type="range"
                min="500000"
                max="30000000"
                step="250000"
                value={propertyPrice}
                onChange={(e) => setPropertyPrice(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold-dark)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span>AED 500K</span>
                <span>AED 30M+</span>
              </div>
            </div>

            {/* Down Payment */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Down Payment ({downPaymentPercent}%)</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--plum-deep)' }}>
                  AED {Math.round(downPaymentAmount).toLocaleString('en-US')}
                </span>
              </div>
              <input
                type="range"
                min="10"
                max="50"
                step="5"
                value={downPaymentPercent}
                onChange={(e) => setDownPaymentPercent(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold-dark)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span>10% (UAE Min)</span>
                <span>20% (Standard)</span>
                <span>50%</span>
              </div>
            </div>

            {/* Loan Tenure */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Tenure (Years)</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--plum-deep)' }}>
                  {tenureYears} Years
                </span>
              </div>
              <input
                type="range"
                min="5"
                max="25"
                step="1"
                value={tenureYears}
                onChange={(e) => setTenureYears(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold-dark)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span>5 Years</span>
                <span>15 Years</span>
                <span>25 Years</span>
              </div>
            </div>

            {/* Interest Rate */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>Annual Interest Rate</span>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--plum-deep)' }}>
                  {interestRate}%
                </span>
              </div>
              <input
                type="range"
                min="3.0"
                max="8.0"
                step="0.25"
                value={interestRate}
                onChange={(e) => setInterestRate(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--gold-dark)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                <span>3.0%</span>
                <span>4.25% (Benchmark)</span>
                <span>8.0%</span>
              </div>
            </div>
          </div>

          {/* Results Summary Box */}
          <div className="mortgage-pad" style={{
            background: 'var(--plum-deep)',
            color: '#FFFFFF',
            padding: '32px',
            borderRadius: '8px',
            border: '1px solid var(--gold-border)',
            boxShadow: '0 12px 30px rgba(26, 13, 24, 0.35)'
          }}>
            <span style={{ fontSize: '11px', color: 'var(--gold-primary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700 }}>
              Estimated Monthly Installment
            </span>
            <div className="luxury-serif" style={{ fontSize: '36px', fontWeight: 600, margin: '8px 0 20px', color: '#FFFFFF' }}>
              AED {Math.round(monthlyPayment).toLocaleString('en-US')} <span style={{ fontSize: '14px', color: 'var(--champagne-muted)', fontFamily: 'var(--font-sans)', fontWeight: 400 }}>/ month</span>
            </div>

            {/* Breakdown List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: '20px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--champagne-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <DollarSign size={15} color="var(--gold-primary)" /> Financed Loan Amount
                </span>
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>
                  AED {Math.round(loanAmount).toLocaleString('en-US')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--champagne-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Percent size={15} color="var(--gold-primary)" /> Total Interest Payable
                </span>
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>
                  AED {Math.round(totalInterest).toLocaleString('en-US')}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--champagne-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calendar size={15} color="var(--gold-primary)" /> Est. Annual Rental Income
                </span>
                <span style={{ fontWeight: 600, color: '#FFFFFF' }}>
                  ~ AED {Math.round(estimatedAnnualRent).toLocaleString('en-US')} / yr
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                <span style={{ color: 'var(--champagne-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Calculator size={15} color="var(--gold-primary)" /> Est. Cash-on-Cash Return
                </span>
                <span style={{ fontWeight: 600, color: 'var(--gold-primary)' }}>
                  {estimatedNetYield.toFixed(1)}% p.a.
                </span>
              </div>
            </div>

            <div style={{
              background: 'rgba(197, 168, 105, 0.08)',
              border: '1px solid rgba(197, 168, 105, 0.25)',
              borderRadius: '6px',
              padding: '14px',
              fontSize: '12px',
              color: 'var(--champagne-muted)',
              lineHeight: 1.5
            }}>
              Lyka Realty facilitates pre-approved mortgage advisory with leading UAE financial institutions for resident and non-resident investors.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
