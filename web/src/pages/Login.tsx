import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { post, setToken, type User } from '../api'
import { Icon } from '../components/ui'
import { LANG_LABEL, nextLang, useT } from '../i18n'

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const { t, lang, setLang } = useT()
  const nav = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [f, setF] = useState({ email: '', password: '', name: '', clinic: '', specialty: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(''); setBusy(true)
    try {
      const body = mode === 'login' ? { email: f.email, password: f.password } : { ...f, role: 'doctor' }
      const r = await post<{ token: string; user: User }>(`/api/auth/${mode}`, body)
      setToken(r.token); onLogin(r.user); nav('/app')
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function demo() { setF({ ...f, email: 'doctor@demo.kg', password: 'demo1234' }); setMode('login') }

  return (
    <div className="auth">
      <aside className="auth-art">
        <Link to="/" className="l-brand">{Icon.pulse(22)}<span>AFib<b>Monitor</b></span></Link>
        <div className="auth-quote">
          <svg viewBox="0 0 400 80" className="auth-ecg" aria-hidden>
            <path d="M0 50 H70 l8 -6 8 6 H110 l6 6 8 -46 8 52 6 -12 H170 q14 -14 28 0 H240 l8 -6 8 6 H280 l6 6 8 -46 8 52 6 -12 H350 q14 -14 28 0 H400" />
          </svg>
          <p>{lang === 'en' ? 'Every AF episode on your screen — the moment it starts.' : lang === 'ky' ? 'Фибрилляциянын ар бир эпизоду — башталган замат экраныңызда.' : 'Каждый эпизод фибрилляции — на вашем экране, в момент когда он начался.'}</p>
        </div>
        <small>Ala-Too International University · 2026</small>
      </aside>
      <main className="auth-main">
        <button className="lang abs" onClick={() => setLang(nextLang(lang))}>{LANG_LABEL[nextLang(lang)]}</button>
        <form className="auth-form" onSubmit={submit}>
          <h1>{mode === 'login' ? t('Кабинет врача') : t('Создать аккаунт')}</h1>
          {mode === 'register' && <>
            <label>{t('Имя')}<input value={f.name} onChange={set('name')} required autoComplete="name" /></label>
            <div className="row2">
              <label>{t('Клиника')}<input value={f.clinic} onChange={set('clinic')} /></label>
              <label>{t('Специальность')}<input value={f.specialty} onChange={set('specialty')} /></label>
            </div>
          </>}
          <label>Email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
          <label>{t('Пароль')}<input type="password" value={f.password} onChange={set('password')} required minLength={6}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>{mode === 'login' ? t('Войти') : t('Создать аккаунт')}</button>
          <button type="button" className="btn link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? t('Нет аккаунта? Регистрация врача') : t('Уже есть аккаунт? Войти')}
          </button>
          <button type="button" className="demo-chip" onClick={demo}>
            <span>{t('Демо-доступ')}</span> doctor@demo.kg · demo1234
          </button>
        </form>
      </main>
    </div>
  )
}
