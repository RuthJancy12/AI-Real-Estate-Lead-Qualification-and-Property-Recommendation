/**
 * Employee-portal role confirmation (pure, unit-testable).
 *
 * The "Pick Your Role" dropdown only states the employee's INTENDED role.
 * Permissions always come from the backend-verified role (GET
 * /api/staff/me); this helper merely compares the two and produces the
 * user-facing message. It never grants anything.
 */
import type { StaffRole } from '../crm/services/staffApi'

export const STAFF_ROLE_OPTIONS: Array<{ value: StaffRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'sales_manager', label: 'Sales Manager' },
  { value: 'salesperson', label: 'Salesperson' },
]

/** 'sales_manager' -> 'Sales Manager' (for messages). */
export function roleLabel(role: string): string {
  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Compares the BACKEND-verified role against the employee's picked role.
 * Returns an error message when entry must be refused, or null when the
 * account may proceed to its verified dashboard.
 *
 * - verified null/empty: no staff record (customer or unauthorized).
 * - expected empty: no confirmation requested — any verified staff passes.
 * - otherwise the two must be exactly equal.
 */
export function checkEmployeeRole(
  verifiedRole: string | null | undefined,
  expectedRole: string
): string | null {
  if (!verifiedRole) {
    return 'This account has no employee access. Customers should use Customer Login; staff access needs an account created by your Admin.'
  }
  const expected = (expectedRole || '').trim()
  if (!expected) return null
  if (verifiedRole !== expected) {
    return `Role mismatch: this account is verified as ${roleLabel(verifiedRole)}, not ${roleLabel(expected)}. Please pick the matching role or contact your Admin.`
  }
  return null
}
