import { useRef, useState } from 'react'
import { apiPost, ApiError } from '../lib/api'
import { useFocusOnChange } from '../lib/useFocusOnChange'
import { Button, Callout, Input, PageShell } from './ds'
import styles from './LoginForm.module.css'

interface LoginResponse {
  token: string
  user: { email: string; displayName: string | null }
}

interface LoginFormProps {
  /** `label` is displayName, falling back to email — Mon espace's avatar needs a name and register.displayName is optional. */
  onLogin: (token: string, label: string) => void
  onNavigateRegister: () => void
}

export function LoginForm({ onLogin, onNavigateRegister }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  useFocusOnChange(errorRef, error)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { token, user } = await apiPost<LoginResponse>('/auth/login', { email, password })
      onLogin(token, user.displayName ?? user.email)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell title="Connexion">
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && (
          <Callout ref={errorRef} variant="error">
            {error}
          </Callout>
        )}
        <Input
          label="Email"
          type="email"
          placeholder="Saisissez votre email…"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Mot de passe"
          type="password"
          placeholder="Saisissez votre mot de passe…"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="button" variant="tertiary" className={styles.switchLink} onClick={onNavigateRegister}>
          Créer un compte
        </Button>
        <Button type="submit" variant="primary" fullWidth disabled={submitting}>
          {submitting ? 'Connexion…' : 'Connexion'}
        </Button>
      </form>
    </PageShell>
  )
}
