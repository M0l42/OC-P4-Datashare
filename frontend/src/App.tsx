import { useState } from 'react'
import { LoginForm } from './components/LoginForm'
import { Uploader } from './components/Uploader'
import { RecipientPage } from './components/RecipientPage'

const TOKEN_STORAGE_KEY = 'datashare_token'

// Routage manuel volontairement minimal : une vraie librairie de routage est
// le périmètre de UI-03 (« Reste de l'app React »), pas encore construit.
// /d/:token est la seule route publique (destinataire non authentifié) ; le
// reste de l'app reste un shell à deux états (login / uploader) en attendant.
const RECIPIENT_PATH_PATTERN = /^\/d\/(.+)$/

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))

  function handleLogin(newToken: string) {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken(null)
  }

  const recipientMatch = RECIPIENT_PATH_PATTERN.exec(window.location.pathname)
  if (recipientMatch) {
    return <RecipientPage token={recipientMatch[1]} />
  }

  return token ? (
    <Uploader token={token} onUnauthorized={handleLogout} />
  ) : (
    <LoginForm onLogin={handleLogin} />
  )
}

export default App
