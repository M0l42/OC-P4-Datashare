import { useState } from 'react'
import { LoginForm } from './components/LoginForm'
import { Uploader } from './components/Uploader'
import { RecipientPage } from './components/RecipientPage'
import { MonEspace } from './components/MonEspace'

const TOKEN_STORAGE_KEY = 'datashare_token'
const USER_LABEL_STORAGE_KEY = 'datashare_user_label'

// Routage manuel volontairement minimal : une vraie librairie de routage est
// le périmètre de UI-03 (« Reste de l'app React »), pas encore construit.
// /d/:token est la seule route publique (destinataire non authentifié) ; le
// reste de l'app logged-in bascule entre deux vues via un simple state, pas
// une URL.
const RECIPIENT_PATH_PATTERN = /^\/d\/(.+)$/

type View = 'uploader' | 'history'

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [userLabel, setUserLabel] = useState<string | null>(() => localStorage.getItem(USER_LABEL_STORAGE_KEY))
  const [view, setView] = useState<View>('uploader')

  function handleLogin(newToken: string, label: string) {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    localStorage.setItem(USER_LABEL_STORAGE_KEY, label)
    setToken(newToken)
    setUserLabel(label)
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(USER_LABEL_STORAGE_KEY)
    setToken(null)
    setUserLabel(null)
    setView('uploader')
  }

  const recipientMatch = RECIPIENT_PATH_PATTERN.exec(window.location.pathname)
  if (recipientMatch) {
    return <RecipientPage token={recipientMatch[1]} />
  }

  if (!token) {
    return <LoginForm onLogin={handleLogin} />
  }

  return view === 'history' ? (
    <MonEspace
      token={token}
      userLabel={userLabel ?? '?'}
      onUnauthorized={handleLogout}
      onNavigateUpload={() => setView('uploader')}
    />
  ) : (
    <Uploader token={token} onUnauthorized={handleLogout} onNavigateHistory={() => setView('history')} />
  )
}

export default App
