import '@fontsource/unbounded/500.css'
import '@fontsource/unbounded/700.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/jetbrains-mono/500.css'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { api, getToken, setToken, type User } from './api'
import { I18nProvider } from './i18n'
import './index.css'
import Alerts from './pages/Alerts'
import Landing from './pages/Landing'
import Legal from './pages/Legal'
import Login from './pages/Login'
import Overview from './pages/Overview'
import PatientPage from './pages/Patient'
import Patients from './pages/Patients'
import Report from './pages/Report'
import Settings from './pages/Settings'
import Shell from './pages/Shell'
import { applyTheme, getTheme } from './theme'

applyTheme(getTheme())

function App() {
  const [me, setMe] = useState<User | null | undefined>(getToken() ? undefined : null)
  useEffect(() => {
    if (me === undefined) api<User>('/api/me').then(setMe).catch(() => setMe(null))
  }, [me])
  const logout = () => { setToken(null); setMe(null) }
  const doctor = me && me.role === 'doctor'

  const app = (el: React.ReactNode) =>
    me === undefined ? <div className="boot"><span className="boot-pulse" /></div>
      : !doctor ? <Navigate to="/login" replace />
        : <Shell me={me} onLogout={logout}>{el}</Shell>

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Legal kind="privacy" />} />
      <Route path="/terms" element={<Legal kind="terms" />} />
      <Route path="/login" element={doctor ? <Navigate to="/app" replace /> : <Login onLogin={setMe} />} />
      <Route path="/app" element={app(doctor && <Overview me={me} />)} />
      <Route path="/app/patients" element={app(doctor && <Patients me={me} />)} />
      <Route path="/app/patients/:id/report" element={me === undefined ? null : doctor ? <Report me={me} /> : <Navigate to="/login" />} />
      <Route path="/app/patients/:id/:tab?" element={app(<PatientPage />)} />
      <Route path="/app/alerts" element={app(<Alerts />)} />
      <Route path="/app/settings" element={app(doctor && <Settings me={me} onUpdate={setMe} />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
