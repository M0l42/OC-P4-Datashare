import { forwardRef, type ReactNode } from 'react'
import styles from './Callout.module.css'

export type CalloutVariant = 'info' | 'alert' | 'error'

interface CalloutProps {
  variant: CalloutVariant
  children: ReactNode
}

// Each variant carries its own icon so colour is never the only signal.
const ICONS: Record<CalloutVariant, ReactNode> = {
  info: (
    <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7.2v4M8 5.1v.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  alert: (
    <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.4 14.2 13H1.8L8 2.4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 6.6v3M8 11.2v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  error: (
    <svg className={styles.icon} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.4 1.8h5.2L14.2 5.4v5.2l-3.6 3.6H5.4L1.8 10.6V5.4L5.4 1.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8 4.9v3.6M8 10.6v.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
}

// The only status-message pattern in the product. `role` separates what
// interrupts from what merely informs: a screen reader should announce an
// error, not an expiry reminder. `tabIndex={-1}` on `error` makes it a valid
// programmatic focus target — `role="alert"` alone gets it announced, but a
// sighted keyboard user still needs focus to actually land there (see
// `useFocusOnChange`, used by every call site that shows one).
export const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout({ variant, children }, ref) {
  return (
    <div
      ref={ref}
      className={`${styles.callout} ${styles[variant]}`}
      role={variant === 'error' ? 'alert' : 'status'}
      tabIndex={variant === 'error' ? -1 : undefined}
    >
      {ICONS[variant]}
      <span>{children}</span>
    </div>
  )
})
