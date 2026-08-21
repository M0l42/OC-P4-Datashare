import { useState } from 'react'
import { apiPost, ApiError } from '../lib/api'

interface LoginResponse {
  token: string
}

interface LoginFormProps {
  onLogin: (token: string) => void
}

// Formulaire minimal, non stylé selon les maquettes : UI-03 ("Reste de l'app
// React") le remplacera par la vraie page de connexion. Sert uniquement à
// obtenir un JWT pour tester l'uploader (US01-B) avant que le routage et les
// formulaires d'authentification définitifs n'existent.
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
    <form onSubmit={handleSubmit}>
      <h1>Connexion</h1>
      <p>
        <label>
          Email
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
      </p>
      <p>
        <label>
          Mot de passe
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Connexion…' : 'Se connecter'}
      </button>
    </form>
  )
}
