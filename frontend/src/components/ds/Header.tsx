import { Button } from './Button'
import styles from './Header.module.css'

interface HeaderProps {
  /** Anonymous shows "Se connecter", logged in shows "Mon espace". */
  loggedIn: boolean
  onAction?: () => void
}

// The mockups vary this by desktop/mobile too, but that axis is pure layout —
// a media query, not a prop, so there's only one thing to render.
export function Header({ loggedIn, onAction }: HeaderProps) {
  return (
    <header className={styles.header}>
      <a className={styles.brand} href="/">
        DataShare
      </a>
      <Button variant="dark" size="medium" onClick={onAction}>
        {loggedIn ? 'Mon espace' : 'Se connecter'}
      </Button>
    </header>
  )
}
