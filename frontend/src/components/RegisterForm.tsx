import { useState } from 'react'
import { apiPost, ApiError } from '../lib/api'
import { Button, Callout, Input, PageShell } from './ds'
import styles from './LoginForm.module.css'

interface RegisterResponse {
  id: string
  email: string
  displayName: string | null
  createdAt: string
}

interface LoginResponse {
  token: string
  user: { email: string; displayName: string | null }
}

interface RegisterFormProps {
  onRegistered: (token: string, label: string) => void
  onNavigateLogin: () => void
}

const MIN_ACCOUNT_PASSWORD_LENGTH = 8 // mirrors backend/src/auth/dto/register.dto.ts

export function RegisterForm({ onRegistered, onNavigateLogin }: RegisterFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_ACCOUNT_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit contenir au moins ${MIN_ACCOUNT_PASSWORD_LENGTH} caractères.`)
      return
    }
    if (password !== passwordConfirm) {
      setError('Les mots de passe ne correspondent pas.')
      return
    }

    setSubmitting(true)
    try {
      const user = await apiPost<RegisterResponse>('/auth/register', { email, password })
      // /auth/register deliberately returns no token — registration and
      // authentication are separate concerns server-side. No mockup shows an
      // intermediate "account created" screen either, so chain a login with
      // the same credentials to land the user straight in the app.
      const { token } = await apiPost<LoginResponse>('/auth/login', { email, password })
      onRegistered(token, user.displayName ?? user.email)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Création du compte impossible')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell title="Créer un compte">
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <Callout variant="error">{error}</Callout>}
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
        <Input
          label="Vérification du mot de passe"
          type="password"
          placeholder="Ressaisissez-le"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          required
        />
        <Button type="button" variant="tertiary" className={styles.switchLink} onClick={onNavigateLogin}>
          J'ai déjà un compte
        </Button>
        <Button type="submit" variant="primary" fullWidth disabled={submitting}>
          {submitting ? 'Création…' : 'Créer mon compte'}
        </Button>
      </form>
    </PageShell>
  )
}
