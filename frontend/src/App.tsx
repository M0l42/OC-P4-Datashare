import { useState } from 'react'
import { LoginForm } from './components/LoginForm'
import { Uploader } from './components/Uploader'

const TOKEN_STORAGE_KEY = 'datashare_token'

function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY))

  function handleLogin(newToken: string) {
    localStorage.setItem(TOKEN_STORAGE_KEY, newToken)
    setToken(newToken)
  }

  return token ? <Uploader token={token} /> : <LoginForm onLogin={handleLogin} />
}

export default App
