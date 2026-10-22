// Team management. Anyone with nav access can view; only admins see the
// add/edit controls, and the backend rejects all non-admin writes with 403.

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import {
  listStaff, createStaff, updateStaff,
  useStaffRole, type StaffListItem, type StaffRole,
} from '../services/staffApi'

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid var(--champagne-border)',
  borderRadius: '12px', padding: '18px', marginBottom: '18px',
}

const input: React.CSSProperties = {
  padding: '8px 10px', borderRadius: '6px', border: '1px solid var(--champagne-border)',
  fontSize: '13px', background: '#fff', color: 'var(--text-main)',
}

const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  sales_manager: 'Sales Manager',
  salesperson: 'Salesperson',
}

/**
 * Roles offerable in the UI. `admin` is deliberately excluded: exactly one
 * active Admin exists (created via create_admin.py), it can never be
 * self-assigned at registration (which has no role field at all), and the
 * backend rejects any second admin with 409 regardless.
 */
const ASSIGNABLE_ROLES: StaffRole[] = ['manager', 'sales_manager', 'salesperson']

export function Team() {
  const { role } = useStaffRole()
  const isAdmin = role === 'admin'
  const [staff, setStaff] = useState<StaffListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const [nEmail, setNEmail] = useState('')
  const [nName, setNName] = useState('')
  const [nRole, setNRole] = useState<StaffRole>('salesperson')
  const [nManager, setNManager] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const managerOptions = staff.filter((s) => s.role === 'manager' || s.role === 'sales_manager')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStaff(await listStaff(showInactive))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team.')
    } finally {
      setLoading(false)
    }
  }, [showInactive])

  useEffect(() => { void refresh() }, [refresh])

  const add = async () => {
    if (!nEmail.trim() || !nName.trim()) {
      setFormError('Email and name are required.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createStaff(nEmail.trim(), nName.trim(), nRole, nManager.trim() || undefined)
      setNEmail('')
      setNName('')
      setNRole('salesperson')
      setNManager('')
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not add staff.')
    } finally {
      setSaving(false)
    }
  }

  const changeRole = async (s: StaffListItem, next: StaffRole) => {
    if (next === s.role) return
    setFormError(null)
    try {
      await updateStaff(s.id, { role: next })
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not change role.')
    }
  }

  const changeManager = async (s: StaffListItem, next: string) => {
    setFormError(null)
    try {
      await updateStaff(s.id, { manager_email: next || null })
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not change manager.')
    }
  }

  const toggleActive = async (s: StaffListItem) => {
    setFormError(null)
    try {
      await updateStaff(s.id, { is_active: !s.is_active })
      await refresh()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update staff.')
    }
  }

  return (
    <div>
      <h2 className="luxury-serif" style={{ fontSize: '24px', color: 'var(--plum-main)', marginBottom: '4px' }}>Team</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '18px' }}>
        Staff accounts and roles. Only the Admin can add members or change roles — exactly one active Admin is enforced by the backend.
      </p>

      {isAdmin && (
        <section style={card}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: '0 0 12px' }}>Add team member</h3>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input style={{ ...input, flex: 1, minWidth: '180px' }} placeholder="Email" value={nEmail} onChange={(e) => setNEmail(e.target.value)} type="email" />
            <input style={{ ...input, flex: 1, minWidth: '160px' }} placeholder="Full name" value={nName} onChange={(e) => setNName(e.target.value)} />
            <select style={input} value={nRole} onChange={(e) => setNRole(e.target.value as StaffRole)} aria-label="Role">
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <select style={{ ...input, flex: 1, minWidth: '180px' }} value={nManager} onChange={(e) => setNManager(e.target.value)} aria-label="Reports to (manager)">
              <option value="">No manager (top level)</option>
              {managerOptions.map((m) => (
                <option key={m.id} value={m.email}>{m.name} ({ROLE_LABELS[m.role as StaffRole] ?? m.role})</option>
              ))}
            </select>
            <button type="button" className="gold-btn" disabled={saving} onClick={add} style={{ padding: '8px 16px', fontSize: '12px' }}>
              Add member
            </button>
          </div>
          {formError && <p role="alert" style={{ color: '#991B1B', fontSize: '13px', marginTop: '8px' }}>{formError}</p>}
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '8px' }}>
            Registration always creates a Customer. A new member becomes staff only after being added here and signing in with the same email.
          </p>
        </section>
      )}

      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--plum-main)', margin: 0 }}>Members ({staff.length})</h3>
          <label style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)', display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Include inactive
          </label>
        </div>
        {loading && <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}><Loader2 size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> Loading…</p>}
        {error && <p role="alert" style={{ fontSize: '13px', color: '#991B1B' }}><AlertCircle size={14} style={{ display: 'inline', verticalAlign: '-2px' }} /> {error} <button type="button" className="lyka-chat-chip" onClick={refresh}>Retry</button></p>}
        {!loading && !error && staff.length === 0 && <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>No team members yet. The first Admin is created with <code>python create_admin.py</code>.</p>}
        {staff.map((s) => (
          <div key={s.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--champagne-border)', fontSize: '13px', flexWrap: 'wrap' }}>
            <strong>{s.name}</strong>
            <span style={{ color: 'var(--text-secondary)' }}>{s.email}</span>
            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gold-dark)' }}>{ROLE_LABELS[s.role as StaffRole] ?? s.role}</span>
            {!s.is_active && <span style={{ fontSize: '12px', color: '#991B1B' }}>inactive</span>}
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
              {s.manager_email ? `reports to ${s.manager_email}` : 'top level'}
            </span>
            {isAdmin && (
              <>
                <select
                  style={{ ...input, padding: '5px 8px', fontSize: '12px' }}
                  value={s.role}
                  onChange={(e) => changeRole(s, e.target.value as StaffRole)}
                  aria-label={`Role for ${s.email}`}
                >
                  {s.role === 'admin' ? (
                    <option value="admin">{ROLE_LABELS.admin}</option>
                  ) : (
                    ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))
                  )}
                </select>
                <select
                  style={{ ...input, padding: '5px 8px', fontSize: '12px', maxWidth: '200px' }}
                  value={s.manager_email || ''}
                  onChange={(e) => changeManager(s, e.target.value)}
                  aria-label={`Manager for ${s.email}`}
                >
                  <option value="">Top level</option>
                  {managerOptions.filter((m) => m.id !== s.id).map((m) => (
                    <option key={m.id} value={m.email}>{m.name}</option>
                  ))}
                </select>
              </>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)' }}>
              {s.last_login_at ? `last login ${new Date(s.last_login_at).toLocaleString()}` : 'never logged in'}
            </span>
            {isAdmin && (
              <button type="button" className="lyka-chat-chip" onClick={() => toggleActive(s)}>
                {s.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
