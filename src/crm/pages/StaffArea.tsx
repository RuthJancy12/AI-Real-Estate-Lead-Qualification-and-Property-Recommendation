// /crm staff area: role-filtered navigation reusing the existing CRM pages
// plus team operations, personal workspace, and team management.
// Every route re-checks the backend-verified role; the backend enforces all
// data permissions regardless of what the nav shows.

import { NavLink, Navigate, Route, Routes, Link } from 'react-router-dom'
import { LayoutDashboard, Users, UserPlus, Building2, ClipboardList, Briefcase, ContactRound, LogOut, Home, ClipboardCheck, HeartHandshake } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { RequireStaff } from '../components/RequireStaff'
import { useStaffRole, clearStaffMeCache, type StaffRole } from '../services/staffApi'
import { clearLocalUser } from '../../services/chatStore'
import { Dashboard } from '../pages/Dashboard'
import { LeadManagement } from '../pages/LeadManagement'
import { LeadAnalysis } from '../pages/LeadAnalysis'
import { NewEnquiry } from '../pages/NewEnquiry'
import { PropertyManagement } from '../pages/PropertyManagement'
import { MyWork } from '../pages/MyWork'
import { TeamOps } from '../pages/TeamOps'
import { Team } from '../pages/Team'
import { ProjectProgress } from '../pages/ProjectProgress'
import { Customers } from '../pages/Customers'

const ALL_STAFF: StaffRole[] = ['admin', 'manager', 'sales_manager', 'salesperson']
const LEAD_ROLES: StaffRole[] = ['admin', 'manager', 'sales_manager']
const PROP_ROLES: StaffRole[] = ['admin', 'manager']

interface NavItem {
  to: string
  label: string
  icon: typeof Home
  roles: StaffRole[]
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/crm', label: 'Dashboard', icon: LayoutDashboard, roles: LEAD_ROLES, end: true },
  { to: '/crm/leads', label: 'Leads', icon: Users, roles: ALL_STAFF },
  { to: '/crm/enquiry', label: 'New Enquiry', icon: UserPlus, roles: LEAD_ROLES },
  { to: '/crm/properties', label: 'Properties', icon: Building2, roles: PROP_ROLES },
  { to: '/crm/ops', label: 'Operations', icon: ClipboardList, roles: LEAD_ROLES },
  { to: '/crm/my', label: 'My Work', icon: Briefcase, roles: ALL_STAFF },
  { to: '/crm/team', label: 'Team', icon: ContactRound, roles: ['admin', 'manager'] },
  { to: '/crm/customers', label: 'Customers', icon: HeartHandshake, roles: ['admin', 'manager'] },
  { to: '/crm/progress', label: 'Progress', icon: ClipboardCheck, roles: LEAD_ROLES },
]

function StaffShell({ children }: { children: React.ReactNode }) {
  const { role } = useStaffRole()
  const { user, logout } = useAuth()
  const items = NAV.filter((n) => role && n.roles.includes(role))
  return (
    <div className="crm-shell" style={{ minHeight: '100vh', background: 'var(--champagne-light)', display: 'flex' }}>
      <aside className="crm-aside" style={{ width: '228px', flexShrink: 0, background: '#fff', borderRight: '1px solid var(--champagne-border)', padding: '20px 14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <Link to="/" style={{ textDecoration: 'none', color: 'var(--plum-main)', fontWeight: 800, fontSize: '17px', padding: '4px 10px 16px' }}>
          LYKA <span style={{ color: 'var(--gold-dark)' }}>CRM</span>
        </Link>
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '9px 12px', borderRadius: '8px', fontSize: '13.5px',
              fontWeight: isActive ? 700 : 500, textDecoration: 'none',
              color: isActive ? 'var(--plum-main)' : 'var(--text-secondary)',
              background: isActive ? 'var(--champagne-surface)' : 'transparent',
            })}
          >
            <n.icon size={15} /> {n.label}
          </NavLink>
        ))}
        <div className="crm-userbox" style={{ marginTop: 'auto', padding: '12px 10px 0', borderTop: '1px solid var(--champagne-border)', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 700, color: 'var(--plum-main)', fontSize: '13px' }}>{user?.name}</div>
          <div style={{ textTransform: 'capitalize' }}>{role?.replace('_', ' ')}</div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <Link to="/" style={{ color: 'var(--rose-primary)', fontSize: '12px' }}>Site</Link>
            <button type="button" onClick={() => { clearStaffMeCache(); clearLocalUser(); logout() }} style={{ background: 'none', border: 'none', color: 'var(--rose-primary)', cursor: 'pointer', fontSize: '12px', padding: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="crm-main" style={{ flex: 1, minWidth: 0, padding: '26px', maxWidth: '1200px' }}>{children}</main>
    </div>
  )
}

function RoleIndex() {
  const { role, loading } = useStaffRole()
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: 'var(--text-secondary)', fontSize: '14px' }}>
        Verifying staff access…
      </div>
    )
  }
  if (!role) {
    return (
      <div style={{ background: '#fff', border: '1px solid var(--champagne-border)', borderRadius: '12px', padding: '36px', textAlign: 'center', maxWidth: '520px', margin: '40px auto' }}>
        <h3 className="luxury-serif" style={{ fontSize: '20px', color: 'var(--plum-main)', marginBottom: '8px' }}>
          Staff access required
        </h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
          This area is reserved for the LYKA team. Customers can use the property search, favorites, and account pages on the main site.
        </p>
        <Link to="/" className="gold-btn" style={{ display: 'inline-block', padding: '10px 22px', textDecoration: 'none' }}>
          Back to site
        </Link>
      </div>
    )
  }
  if (role === 'salesperson') return <Navigate to="/crm/my" replace />
  return <Navigate to="/crm" replace />
}

export function StaffArea() {
  // NOTE: this <Routes> is mounted standalone (App returns <StaffArea/>
  // directly, not as a <Route> child), so its paths are absolute. Relative
  // paths here would resolve against "/" and every /crm/* URL would fall
  // through to "*" — rendering a blank main panel for signed-in staff.
  return (
    <StaffShell>
      <Routes>
        <Route path="/crm" element={<RequireStaff roles={LEAD_ROLES}><Dashboard /></RequireStaff>} />
        <Route path="/crm/leads" element={<RequireStaff roles={ALL_STAFF}><LeadManagement /></RequireStaff>} />
        <Route path="/crm/leads/:id" element={<RequireStaff roles={ALL_STAFF}><LeadAnalysis /></RequireStaff>} />
        <Route path="/crm/enquiry" element={<RequireStaff roles={LEAD_ROLES}><NewEnquiry /></RequireStaff>} />
        <Route path="/crm/properties" element={<RequireStaff roles={ALL_STAFF}><PropertyManagement /></RequireStaff>} />
        <Route path="/crm/ops" element={<RequireStaff roles={LEAD_ROLES}><TeamOps /></RequireStaff>} />
        <Route path="/crm/my" element={<RequireStaff roles={ALL_STAFF}><MyWork /></RequireStaff>} />
        <Route path="/crm/team" element={<RequireStaff roles={['admin', 'manager']}><Team /></RequireStaff>} />
        <Route path="/crm/customers" element={<RequireStaff roles={['admin', 'manager']}><Customers /></RequireStaff>} />
        <Route path="/crm/progress" element={<RequireStaff roles={LEAD_ROLES}><ProjectProgress /></RequireStaff>} />
        <Route path="*" element={<RoleIndex />} />
      </Routes>
    </StaffShell>
  )
}
