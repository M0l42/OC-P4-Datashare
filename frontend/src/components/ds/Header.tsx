import { Button } from './Button'
import styles from './Header.module.css'

interface HeaderProps {
  /** Anonymous shows "Se connecter", logged in shows "Mon espace". */
  loggedIn: boolean
  onAction?: () => void
}

// The mockups vary this by desktop/mobile too, but that axis is pure layout —
// a media query, not a prop, so there's only one thing to render.
//
// No onAction means there's genuinely nowhere to send the click yet (e.g.
// "Mon espace" before that page exists) — disabled rather than a silent
// no-op, so it doesn't read as broken.
export function Header({ loggedIn, onAction }: HeaderProps) {
  return (
    <header className={styles.header}>
      <a className={styles.brand} href="/">
        DataShare
      </a>
      <Button variant="dark" size="medium" onClick={onAction} disabled={!onAction}>
        {loggedIn ? 'Mon espace' : 'Se connecter'}
      </Button>
    </header>
  )
}
