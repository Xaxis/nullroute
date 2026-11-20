import type { GrantStatus } from '@/server/grants'

export function money(n: number | null): string {
  return n === null ? '' : `$${n.toLocaleString('en-US')}`
}

export function statusTone(s: GrantStatus) {
  if (s === 'awarded' || s === 'completed') return 'good' as const
  if (s === 'declined' || s === 'withdrawn') return 'bad' as const
  return 'accent' as const
}
