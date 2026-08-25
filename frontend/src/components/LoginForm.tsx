import { useState } from 'react'
import { apiPost, ApiError } from '../lib/api'
import { Button, Callout, Input, PageShell } from './ds'
import styles from './LoginForm.module.css'

interface LoginResponse {
  token: string
}

interface LoginFormProps {
  onLogin: (token: string) => void
}

// Stopgap sign-in so the uploader has a token to work with. The real routed
// auth screens land with the rest of the app.
export function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { token } = await apiPost<LoginResponse>('/auth/login', { email, password })
      onLogin(token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connexion impossible')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <PageShell title="Connexion">
      <form onSubmit={handleSubmit} className={styles.form}>
        {error && <Callout variant="error">{error}</Callout>}
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Mot de passe"
          type="password"
          placeholder="Saisissez le mot de passe…"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" variant="primary" fullWidth disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
    </PageShell>
  )
}
