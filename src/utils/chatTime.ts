/**
 * Chat message time helpers (pure, deterministic, timezone-correct).
 *
 * Every message carries `createdAt` (epoch ms, local clock) assigned once
 * at creation. Streaming token appends never touch it, so each bubble —
 * including streamed replies — keeps exactly one stable timestamp.
 * History restores parse the stored ISO dates back to the same instants.
 */

/** Local wall-clock time in 12-hour form, e.g. "4:10 PM". */
export function formatMessageTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function startOfLocalDay(epochMs: number): number {
  const d = new Date(epochMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Day-group label for a date separator: "Today", "Yesterday", or the
 * actual date (e.g. "Oct 4, 2026") for older conversations. `nowMs` is
 * injectable so tests never depend on the real clock.
 */
export function dayLabel(epochMs: number, nowMs: number = Date.now()): string {
  const diffDays = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(epochMs)) / 86400000)
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return new Date(epochMs).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * True when a date-separator row belongs above `currentMs` — i.e. it is
 * the first message or its local day differs from the previous message's.
 * Pure day comparison (not time), so DST transitions group correctly.
 */
export function shouldShowDateSeparator(prevMs: number | null, currentMs: number): boolean {
  if (prevMs === null || prevMs === undefined) return true
  return startOfLocalDay(prevMs) !== startOfLocalDay(currentMs)
}
