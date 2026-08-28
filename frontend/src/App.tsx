import { useState } from 'react'
import { LoginForm } from './components/LoginForm'
import { RegisterForm } from './components/RegisterForm'
import { Uploader } from './components/Uploader'
import { RecipientPage } from './components/RecipientPage'
import { MonEspace } from './components/MonEspace'
import type { ResumableUpload } from './lib/resumeStore'

const TOKEN_STORAGE_KEY = 'datashare_token'
const USER_LABEL_STORAGE_KEY = 'datashare_user_label'

// Routage manuel volontairement minimal (UI-03) : /d/:token is the only
// public route (unauthenticated recipient); everything else — including the
// login/register split — is a state toggle, not a URL, so there's nothing
// to bookmark mid-flow that a full router would need to reconstruct.
const RECIPIENT_PATH_PATTERN = /^\/d\/(.+)$/

type View = 'uploader' | 'history'
type AuthView = 'login' | 'register'

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))
  const [userLabel, setUserLabel] = useState<string | null>(() => localStorage.getItem(USER_LABEL_STORAGE_KEY))
  const [view, setView] = useState<View>('uploader')
  const [authView, setAuthView] = useState<AuthView>('login')
  const [resumeTarget, setResumeTarget] = useState<ResumableUpload | null>(null)

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
    setAuthView('login')
    setResumeTarget(null)
  }

  const recipientMatch = RECIPIENT_PATH_PATTERN.exec(window.location.pathname)
  if (recipientMatch) {
    return <RecipientPage token={recipientMatch[1]} />
  }

  if (!token) {
    return authView === 'register' ? (
      <RegisterForm onRegistered={handleLogin} onNavigateLogin={() => setAuthView('login')} />
    ) : (
      <LoginForm onLogin={handleLogin} onNavigateRegister={() => setAuthView('register')} />
    )
  }

  return view === 'history' ? (
    <MonEspace
      token={token}
      userLabel={userLabel ?? '?'}
      onUnauthorized={handleLogout}
      onNavigateUpload={() => setView('uploader')}
      onResume={(entry) => {
        setResumeTarget(entry)
        setView('uploader')
      }}
    />
  ) : (
    <Uploader
      token={token}
      onUnauthorized={handleLogout}
      onNavigateHistory={() => setView('history')}
      resumeTarget={resumeTarget}
      onResumeConsumed={() => setResumeTarget(null)}
    />
  )
}

export default App
