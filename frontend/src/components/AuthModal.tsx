import { useState } from 'react'
import { X, Lock, Mail, User, Phone, CheckCircle2 } from 'lucide-react'

export type AuthMode = 'login' | 'signup' | 'forgot-password'

interface AuthModalProps {
  isOpen: boolean
  initialMode?: AuthMode
  onClose: () => void
  onSuccess: (user: { name: string; email: string }) => void
}

export function AuthModal({ isOpen, initialMode = 'login', onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitted, setIsSubmitted] = useState(false)

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitted(true)
    setTimeout(() => {
      if (mode === 'forgot-password') {
        setIsSubmitted(false)
        setMode('login')
      } else {
        const userName = name || email.split('@')[0] || 'Investor'
        onSuccess({ name: userName, email })
        onClose()
      }
    }, 1000)
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 1200,
      background: 'rgba(26, 13, 24, 0.75)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        background: '#FFFFFF',
        borderRadius: '10px',
        border: '1px solid var(--champagne-border)',
        boxShadow: '0 20px 50px rgba(26, 13, 24, 0.5)',
        width: '100%',
        maxWidth: '440px',
        padding: '32px',
        position: 'relative'
      }}>
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: 'var(--champagne-surface)',
            border: '1px solid var(--champagne-border)',
            borderRadius: '4px',
            width: '30px',
            height: '30px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--plum-deep)'
          }}
        >
          <X size={16} />
        </button>

        {/* Existing Project Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{
            background: 'var(--plum-deep)',
            border: '1px solid var(--gold-border)',
            padding: '6px 14px',
            borderRadius: '6px',
            display: 'inline-flex',
            alignItems: 'center'
          }}>
            <img
              src="/logo.png"
              alt="Lyka Realty"
              style={{
                height: '26px',
                width: 'auto',
                objectFit: 'contain',
                display: 'block'
              }}
            />
          </div>
          <div>
            <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--rose-primary)', fontWeight: 700, display: 'block' }}>
              Client Portal
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
              Dubai Real Estate
            </span>
          </div>
        </div>

        {/* Modal Title */}
        <h3 className="luxury-serif" style={{ fontSize: '20px', fontWeight: 600, color: 'var(--plum-deep)', marginBottom: '4px' }}>
          {mode === 'login' && 'Sign in to your account'}
          {mode === 'signup' && 'Create your investor profile'}
          {mode === 'forgot-password' && 'Reset your password'}
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '22px' }}>
          {mode === 'login' && 'Access your saved properties, shortlisted brochures, and advisory requests.'}
          {mode === 'signup' && 'Unlock off-plan early access, floor plans, and direct broker contact.'}
          {mode === 'forgot-password' && 'Enter your email address and we will dispatch a secure reset link.'}
        </p>

        {/* Submitted state */}
        {isSubmitted ? (
          <div style={{
            padding: '24px',
            background: 'var(--champagne-surface)',
            border: '1px solid var(--champagne-border)',
            borderRadius: '6px',
            textAlign: 'center',
            color: 'var(--plum-deep)'
          }}>
            <CheckCircle2 size={36} color="var(--gold-primary)" style={{ margin: '0 auto 10px' }} />
            <div style={{ fontWeight: 700, fontSize: '15px' }}>
              {mode === 'forgot-password' ? 'Reset Link Dispatched' : 'Authentication Successful'}
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {mode === 'forgot-password'
                ? `Instructions sent to ${email}.`
                : 'Welcome to Lyka Realty. Loading your portfolio...'}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {mode === 'signup' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Full Name
                </label>
                <div style={{ position: 'relative' }}>
                  <User size={15} color="var(--text-muted)" style={{ position: 'absolute', top: '11px', left: '12px' }} />
                  <input
                    type="text"
                    required
                    placeholder="e.g. Elena Rostova"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 36px',
                      borderRadius: '4px',
                      border: '1px solid var(--champagne-border)',
                      fontSize: '13px',
                      color: 'var(--text-main)',
                      outlineColor: 'var(--gold-primary)'
                    }}
                  />
                </div>
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                Email Address
              </label>
              <div style={{ position: 'relative' }}>
                <Mail size={15} color="var(--text-muted)" style={{ position: 'absolute', top: '11px', left: '12px' }} />
                <input
                  type="email"
                  required
                  placeholder="name@investor.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '9px 12px 9px 36px',
                    borderRadius: '4px',
                    border: '1px solid var(--champagne-border)',
                    fontSize: '13px',
                    color: 'var(--text-main)',
                    outlineColor: 'var(--gold-primary)'
                  }}
                />
              </div>
            </div>

            {mode === 'signup' && (
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Phone / WhatsApp
                </label>
                <div style={{ position: 'relative' }}>
                  <Phone size={15} color="var(--text-muted)" style={{ position: 'absolute', top: '11px', left: '12px' }} />
                  <input
                    type="tel"
                    placeholder="+971 50 000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 36px',
                      borderRadius: '4px',
                      border: '1px solid var(--champagne-border)',
                      fontSize: '13px',
                      color: 'var(--text-main)',
                      outlineColor: 'var(--gold-primary)'
                    }}
                  />
                </div>
              </div>
            )}

            {mode !== 'forgot-password' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-main)' }}>
                    Password
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => setMode('forgot-password')}
                      style={{ background: 'none', border: 'none', fontSize: '11px', color: 'var(--plum-deep)', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div style={{ position: 'relative' }}>
                  <Lock size={15} color="var(--text-muted)" style={{ position: 'absolute', top: '11px', left: '12px' }} />
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px 9px 36px',
                      borderRadius: '4px',
                      border: '1px solid var(--champagne-border)',
                      fontSize: '13px',
                      color: 'var(--text-main)',
                      outlineColor: 'var(--gold-primary)'
                    }}
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              className="gold-btn"
              style={{
                marginTop: '6px',
                padding: '11px',
                fontSize: '13px',
                borderRadius: '4px'
              }}
            >
              {mode === 'login' && 'Sign In'}
              {mode === 'signup' && 'Create Account'}
              {mode === 'forgot-password' && 'Send Reset Link'}
            </button>
          </form>
        )}

        {/* Footer switch tabs */}
        <div style={{ marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--champagne-border)', textAlign: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
          {mode === 'login' && (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                style={{ background: 'none', border: 'none', color: 'var(--plum-deep)', fontWeight: 700, cursor: 'pointer' }}
              >
                Sign up
              </button>
            </>
          )}

          {mode === 'signup' && (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                style={{ background: 'none', border: 'none', color: 'var(--plum-deep)', fontWeight: 700, cursor: 'pointer' }}
              >
                Sign in
              </button>
            </>
          )}

          {mode === 'forgot-password' && (
            <button
              type="button"
              onClick={() => setMode('login')}
              style={{ background: 'none', border: 'none', color: 'var(--plum-deep)', fontWeight: 700, cursor: 'pointer' }}
            >
              Back to Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
