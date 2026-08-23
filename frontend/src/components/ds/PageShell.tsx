import type { ReactNode } from 'react'
import { Header } from './Header'
import styles from './PageShell.module.css'

interface PageShellProps {
  title?: string
  loggedIn?: boolean
  onHeaderAction?: () => void
  children: ReactNode
}

// Not one of the six design-system components, but every mockup repeats this
// frame — warm gradient, centred white card — so it lives here rather than
// being re-derived on each screen.
export function PageShell({ title, loggedIn = false, onHeaderAction, children }: PageShellProps) {
  return (
    <div className={styles.page}>
      <Header loggedIn={loggedIn} onAction={onHeaderAction} />
      <main className={styles.main}>
        <div className={styles.card}>
          {title && <h1 className={styles.title}>{title}</h1>}
          {children}
        </div>
      </main>
      <footer className={styles.footer}>Copyright DataShare© 2026</footer>
    </div>
  )
}
