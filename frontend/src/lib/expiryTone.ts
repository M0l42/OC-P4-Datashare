export type ExpiryTone = 'info' | 'alert' | 'error'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

// Info while there's time, Alert on the last day, Error once past. One
// implementation, shared by every screen that shows an expiry.
export function expiryTone(expiresAt: string | Date): ExpiryTone {
  const msRemaining = new Date(expiresAt).getTime() - Date.now()
  if (msRemaining <= 0) return 'error'
  if (msRemaining <= ONE_DAY_MS) return 'alert'
  return 'info'
}
