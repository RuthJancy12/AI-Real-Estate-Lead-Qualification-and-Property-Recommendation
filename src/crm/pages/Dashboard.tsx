import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Users, TrendingUp, AlertCircle, Clock, CheckCircle,
  Building2, Activity, Plus, ArrowRight, RefreshCw, CalendarCheck, UserCheck,
  Inbox, Sparkles, Phone, PenLine, Repeat, Eye, ClipboardCheck
} from 'lucide-react'
import { getDashboardStats } from '../services/crmApi'
import { getOverview, useStaffRole, type StaffOverview } from '../services/staffApi'
import type { DashboardStats } from '../types/crm'

// LYKA luxury tokens (same palette as the public site + CRM detail pages).
const PLUM = 'var(--plum-main)'
const GOLD = 'var(--gold-dark)'
const CARD: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--champagne-border)',
  borderRadius: '14px',
  boxShadow: '0 2px 10px rgba(26, 13, 24, 0.05)',
  padding: '22px',
}
const H2: React.CSSProperties = {
  fontSize: '15px', fontWeight: 800, color: PLUM, margin: '0 0 14px',
  display: 'flex', alignItems: 'center', gap: '8px',
}
const SUB: React.CSSProperties = {
  fontSize: '12.5px', color: 'var(--text-secondary)',
}
const EMPTY: React.CSSProperties = {
  fontSize: '13px', color: '#B9B0A6', fontStyle: 'italic',
  textAlign: 'center', padding: '24px 8px', margin: 0,
}

// Restrained status palette — readable, never neon.
const PRIORITY_TINT: Record<string, { bg: string; fg: string; bar: string }> = {
  High: { bg: '#F7E8E4', fg: '#9C4A3C', bar: '#9C4A3C' },
  Medium: { bg: '#FBF3E3', fg: '#8A6E30', bar: '#B08D3E' },
  Low: { bg: '#EAF3EC', fg: '#2E7D4F', bar: '#5B7A68' },
}

const ACTIVITY_ICONS: Record<string, typeof Inbox> = {
  enquiry_received: Inbox,
  ai_analysed: Sparkles,
  agent_contacted: Phone,
  recommendation_sent: Building2,
  note_added: PenLine,
  status_changed: Repeat,
  property_viewed: Eye,
}

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function Dashboard() {
  const { role } = useStaffRole()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [overview, setOverview] = useState<StaffOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, o] = await Promise.all([getDashboardStats(), getOverview()])
      setStats(s)
      setOverview(o)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: 'var(--text-secondary)', fontSize: '14px' }}>
        <RefreshCw size={20} className="animate-spin" style={{ marginRight: '8px' }} /> Loading dashboard…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ ...CARD, maxWidth: '520px', margin: '40px auto', textAlign: 'center', padding: '40px' }}>
        <AlertCircle size={32} color="#9C4A3C" style={{ margin: '0 auto 12px' }} />
        <p style={{ color: PLUM, fontWeight: 700, marginBottom: '8px' }}>{error}</p>
        <p style={{ ...SUB, marginBottom: '16px' }}>Make sure the backend is running on port 8000</p>
        <button type="button" onClick={load} className="gold-btn" style={{ padding: '9px 20px', fontSize: '13px' }}>
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    )
  }

  const total = stats!.total_leads
  const statusCounts = stats!.status_counts

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <div>
          <h1 className="luxury-serif" style={{ fontSize: '22px', color: PLUM, margin: 0 }}>
            Lead Dashboard
          </h1>
          <p style={{ ...SUB, margin: '2px 0 0' }}>Real-time statistics from the database</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button type="button" onClick={load} className="outline-navy-btn" style={{ padding: '9px 18px', fontSize: '13px' }}>
            <RefreshCw size={14} /> Refresh
          </button>
          <Link to="/crm/enquiry" className="gold-btn" style={{ padding: '9px 18px', fontSize: '13px', textDecoration: 'none' }}>
            <Plus size={14} /> New Enquiry
          </Link>
        </div>
      </div>

      {/* KPI cards — consistent heights, aligned figures */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '18px' }}>
        <StatCard
          icon={<Users size={18} color={PLUM} />}
          label="Total Leads"
          value={total}
          sub={stats!.new_today > 0 ? `${stats!.new_today} new today` : 'No new leads today'}
        />
        <StatCard
          icon={<AlertCircle size={18} color={PRIORITY_TINT.High.fg} />}
          label="High Priority"
          value={stats!.high_priority}
          sub={total > 0 ? `${Math.round(stats!.high_priority / total * 100)}% of leads` : '—'}
          tint={PRIORITY_TINT.High}
        />
        <StatCard
          icon={<TrendingUp size={18} color={PRIORITY_TINT.Medium.fg} />}
          label="Medium Priority"
          value={stats!.medium_priority}
          sub="Score 40–69"
          tint={PRIORITY_TINT.Medium}
        />
        <StatCard
          icon={<CheckCircle size={18} color={PRIORITY_TINT.Low.fg} />}
          label="Low Priority"
          value={stats!.low_priority}
          sub="Score 0–39"
          tint={PRIORITY_TINT.Low}
        />
      </div>

      {/* Status breakdown / priority distribution / quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: '14px', marginBottom: '18px' }}>
        <section style={CARD}>
          <h2 style={H2}><Activity size={15} color={GOLD} /> Status Breakdown</h2>
          {['new', 'contacted', 'qualified', 'closed', 'lost'].map((status) => {
            const count = statusCounts[status] || 0
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={status} style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ textTransform: 'capitalize', fontSize: '13px', color: 'var(--text-secondary)' }}>{status}</span>
                  <span style={{ fontSize: '13.5px', fontWeight: 800, color: PLUM }}>{count}</span>
                </div>
                <div style={{ height: '7px', background: '#F4EEE1', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', background: GOLD, borderRadius: '999px', width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
          <Link to="/crm/leads" className="lyka-chat-link-btn" style={{ fontSize: '12.5px', marginTop: '6px' }}>
            View all leads <ArrowRight size={12} />
          </Link>
        </section>

        <section style={CARD}>
          <h2 style={H2}><TrendingUp size={15} color={GOLD} /> Priority Distribution</h2>
          {total === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 8px' }}>
              <Users size={30} color="#C9BFAE" style={{ margin: '0 auto 8px' }} />
              <p style={EMPTY}>No leads yet</p>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '14px', minHeight: '132px' }}>
              {[
                { label: 'High', count: stats!.high_priority },
                { label: 'Medium', count: stats!.medium_priority },
                { label: 'Low', count: stats!.low_priority },
              ].map(({ label, count }) => {
                const pct = total > 0 ? (count / total) * 100 : 0
                const tint = PRIORITY_TINT[label]
                return (
                  <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: PLUM }}>{count}</span>
                    <div style={{ width: '100%', height: '72px', background: '#F4EEE1', borderRadius: '8px 8px 4px 4px', overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ width: '100%', background: tint.bar, borderRadius: '8px 8px 0 0', height: `${Math.max(pct, count > 0 ? 6 : 0)}%` }} />
                    </div>
                    <span style={{ fontSize: '11.5px', fontWeight: 700, color: tint.fg }}>{label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section style={CARD}>
          <h2 style={H2}><Clock size={15} color={GOLD} /> Quick Actions</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <QuickAction to="/crm/enquiry" icon={<Plus size={14} />} label="New Customer Enquiry" primary />
            <QuickAction to="/crm/leads" icon={<Users size={14} />} label="Manage Leads" />
            <QuickAction to="/crm/properties" icon={<Building2 size={14} />} label="Property Management" />
            <QuickAction to="/crm/progress" icon={<ClipboardCheck size={14} />} label="Project Progress" />
          </div>
          <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--champagne-border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#2E7D4F', flexShrink: 0 }} />
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
              <strong style={{ color: PLUM }}>AI Status:</strong> Local Ollama AI connected — no paid API
            </p>
          </div>
        </section>
      </div>

      {/* Role-scoped operations overview (real backend data) */}
      {overview && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '18px' }}>
            {(overview.staff_total !== undefined) && (
              <StatCard
                icon={<UserCheck size={18} color={PLUM} />}
                label="Total Staff"
                value={overview.staff_total}
                sub={`${overview.active_staff ?? 0} active`}
              />
            )}
            {(overview.team_size !== undefined) && (
              <StatCard
                icon={<UserCheck size={18} color={PLUM} />}
                label="My Team"
                value={overview.team_size}
                sub="members incl. you"
              />
            )}
            <StatCard
              icon={<Users size={18} color={PLUM} />}
              label="Assigned Leads"
              value={overview.assigned_leads}
              sub={`${overview.leads_total} visible total`}
            />
            <StatCard
              icon={<AlertCircle size={18} color={PRIORITY_TINT.Medium.fg} />}
              label="Unassigned Leads"
              value={overview.unassigned_leads}
              sub="need distribution"
            />
            <StatCard
              icon={<Clock size={18} color={PRIORITY_TINT.High.fg} />}
              label="Follow-ups Due"
              value={overview.followups_due_count}
              sub="due within 7 days"
            />
            <StatCard
              icon={<CalendarCheck size={18} color={PRIORITY_TINT.Low.fg} />}
              label="Upcoming Viewings"
              value={overview.upcoming_viewings.length}
              sub="scheduled"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '14px', marginBottom: '18px' }}>
            <section style={CARD}>
              <h2 style={H2}>Lead Pipeline</h2>
              {Object.keys(overview.pipeline).length === 0 ? (
                <p style={EMPTY}>No leads in scope yet.</p>
              ) : (
                Object.entries(overview.pipeline).map(([status, count]) => {
                  const pct = overview.leads_total > 0 ? (count / overview.leads_total) * 100 : 0
                  return (
                    <div key={status} style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ textTransform: 'capitalize', fontSize: '13px', color: 'var(--text-secondary)' }}>{status}</span>
                        <span style={{ fontSize: '13.5px', fontWeight: 800, color: PLUM }}>{count}</span>
                      </div>
                      <div style={{ height: '7px', background: '#F4EEE1', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: GOLD, borderRadius: '999px', width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
              )}
            </section>

            <section style={CARD}>
              <h2 style={H2}>Acquisition Channels</h2>
              {Object.values(overview.channel_breakdown ?? {}).every((c) => c === 0) ? (
                <p style={EMPTY}>No attributed leads yet.</p>
              ) : (
                Object.entries(overview.channel_breakdown ?? {}).map(([ch, count]) => {
                  const pct = overview.leads_total > 0 ? (count / overview.leads_total) * 100 : 0
                  return (
                    <div key={ch} style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{ch}</span>
                        <span style={{ fontSize: '13.5px', fontWeight: 800, color: PLUM }}>{count}</span>
                      </div>
                      <div style={{ height: '7px', background: '#F4EEE1', borderRadius: '999px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', background: GOLD, borderRadius: '999px', width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })
              )}
            </section>

            <section style={CARD}>
              <h2 style={H2}>Follow-ups Due</h2>
              {overview.followups_due.length === 0 ? (
                <p style={EMPTY}>Nothing due in the next 7 days.</p>
              ) : (
                <div style={{ maxHeight: '264px', overflowY: 'auto' }}>
                  {overview.followups_due.map((f) => (
                    <div key={f.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--champagne-border)' }}>
                      <p style={{ fontSize: '13.5px', color: PLUM, margin: 0, overflowWrap: 'anywhere' }}>{f.note}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '3px 0 0' }}>
                        Lead #{f.lead_id} · {f.staff_email}{f.next_action_at ? ` · due ${new Date(f.next_action_at).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={CARD}>
              <h2 style={H2}>Upcoming Viewings</h2>
              {overview.upcoming_viewings.length === 0 ? (
                <p style={EMPTY}>No viewings scheduled.</p>
              ) : (
                <div style={{ maxHeight: '264px', overflowY: 'auto' }}>
                  {overview.upcoming_viewings.map((v) => (
                    <div key={v.id} style={{ padding: '9px 0', borderBottom: '1px solid var(--champagne-border)' }}>
                      <p style={{ fontSize: '13.5px', fontWeight: 700, color: PLUM, margin: 0 }}>Lead #{v.lead_id} · {v.property_ref}</p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '3px 0 0' }}>
                        {v.staff_email}{v.scheduled_at ? ` · ${new Date(v.scheduled_at).toLocaleString()}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: '14px', marginBottom: '18px' }}>
            <section style={{ ...CARD, overflowX: 'auto' }}>
              <h2 style={H2}>
                {role === 'sales_manager' ? 'Team Performance' : 'Workload by Assignee'}
              </h2>
              {overview.team_performance.length === 0 ? (
                <p style={EMPTY}>No assignments yet.</p>
              ) : (
                <table style={{ width: '100%', fontSize: '13.5px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', fontSize: '11px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--champagne-border)' }}>
                      <th style={{ padding: '8px 12px 8px 0', fontWeight: 700 }}>Assignee</th>
                      <th style={{ padding: '8px 12px 8px 0', fontWeight: 700 }}>Open</th>
                      <th style={{ padding: '8px 12px 8px 0', fontWeight: 700 }}>In progress</th>
                      <th style={{ padding: '8px 12px 8px 0', fontWeight: 700 }}>Closed</th>
                      <th style={{ padding: '8px 0', fontWeight: 700 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.team_performance.map((t) => (
                      <tr key={t.staff_email} style={{ borderBottom: '1px solid var(--champagne-border)' }}>
                        <td style={{ padding: '9px 12px 9px 0', color: PLUM, overflowWrap: 'anywhere' }}>{t.staff_email}</td>
                        <td style={{ padding: '9px 12px 9px 0', fontWeight: 700, color: PLUM }}>{t.open}</td>
                        <td style={{ padding: '9px 12px 9px 0', fontWeight: 700, color: PLUM }}>{t.in_progress}</td>
                        <td style={{ padding: '9px 12px 9px 0', fontWeight: 700, color: PLUM }}>{t.closed}</td>
                        <td style={{ padding: '9px 0', fontWeight: 700, color: PLUM }}>{t.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section style={CARD}>
              <h2 style={H2}>Recent Inquiries</h2>
              {overview.recent_inquiries.length === 0 ? (
                <p style={EMPTY}>No inquiries yet.</p>
              ) : (
                <div style={{ maxHeight: '264px', overflowY: 'auto' }}>
                  {overview.recent_inquiries.map((q) => (
                    <Link
                      key={q.id}
                      to={`/crm/leads/${q.id}`}
                      style={{ display: 'block', padding: '9px 0', borderBottom: '1px solid var(--champagne-border)', textDecoration: 'none' }}
                    >
                      <p style={{ fontSize: '13.5px', fontWeight: 700, color: PLUM, margin: 0 }}>
                        #{q.id} · {q.customer_name || q.contact_email || 'Anonymous'}
                      </p>
                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '3px 0 0', textTransform: 'capitalize' }}>
                        {[q.location, q.status, q.priority_label].filter(Boolean).join(' · ')}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {/* Recent Activity */}
      <section style={CARD}>
        <h2 style={H2}><Activity size={15} color={GOLD} /> Recent Activity</h2>
        {stats!.recent_activities.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '28px 8px' }}>
            <Activity size={30} color="#C9BFAE" style={{ margin: '0 auto 8px' }} />
            <p style={EMPTY}>No activity yet. Submit your first enquiry to get started.</p>
          </div>
        ) : (
          <div>
            {stats!.recent_activities.map((act) => {
              const Icon = ACTIVITY_ICONS[act.activity_type] || Activity
              return (
                <div key={act.id} style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: '1px solid var(--champagne-border)' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#FAF5EA', border: '1px solid var(--champagne-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={13} color={GOLD} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '13px', fontWeight: 700, color: PLUM, margin: 0, textTransform: 'capitalize' }}>
                      {act.activity_type.replace(/_/g, ' ')}
                    </p>
                    {act.notes && <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '2px 0 0', overflowWrap: 'anywhere' }}>{act.notes}</p>}
                  </div>
                  <span style={{ fontSize: '11.5px', color: '#B9B0A6', flexShrink: 0 }}>{formatTime(act.created_at)}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({
  icon, label, value, sub, tint
}: {
  icon: React.ReactNode
  label: string
  value: number
  sub: string
  tint?: { bg: string; fg: string; bar: string }
}) {
  return (
    <div style={{ ...CARD, padding: '18px', minHeight: '128px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {label}
        </span>
        <div style={{
          background: tint ? tint.bg : '#FAF5EA',
          border: '1px solid var(--champagne-border)',
          padding: '6px',
          borderRadius: '8px',
          display: 'flex'
        }}>
          {icon}
        </div>
      </div>
      <div style={{ fontSize: '30px', fontWeight: 800, color: PLUM, lineHeight: 1 }}>
        {value.toLocaleString()}
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '6px 0 0' }}>{sub}</p>
    </div>
  )
}

function QuickAction({ to, icon, label, primary }: {
  to: string; icon: React.ReactNode; label: string; primary?: boolean
}) {
  return (
    <Link
      to={to}
      className={primary ? 'gold-btn' : 'outline-navy-btn'}
      style={{ padding: '10px 14px', fontSize: '13px', textDecoration: 'none', justifyContent: 'flex-start' }}
    >
      {icon} {label}
    </Link>
  )
}
