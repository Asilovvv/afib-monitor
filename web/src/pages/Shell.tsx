import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { api, emitRefresh, getToken, REFRESH, type PatientRow, type User } from '../api'
import { Avatar, Icon } from '../components/ui'
import { useT } from '../i18n'
import { applyTheme, getTheme, type ThemePref } from '../theme'

type Toast = { id: number; kind: 'alert' | 'info'; title: string; body: string; href?: string }

function beep() {
  try {
    const ctx = new AudioContext()
    ;[0, 0.18].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain()
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination)
      g.gain.setValueAtTime(0.0001, ctx.currentTime + d)
      g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + d + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + d + 0.14)
      o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + 0.15)
    })
  } catch { /* audio blocked */ }
}

export default function Shell({ me, onLogout, children }: { me: User; onLogout: () => void; children: ReactNode }) {
  const { t, lang, setLang } = useT()
  const nav = useNavigate()
  const [live, setLive] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [newAlerts, setNewAlerts] = useState(0)
  const [theme, setTheme] = useState<ThemePref>(getTheme())
  const [q, setQ] = useState('')
  const [pts, setPts] = useState<PatientRow[]>([])
  const [menu, setMenu] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const tid = useRef(0)

  const toast = (x: Omit<Toast, 'id'>) => {
    const id = ++tid.current
    setToasts(ts => [...ts.slice(-3), { ...x, id }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), x.kind === 'alert' ? 12000 : 6000)
  }

  // counts for the sidebar badge + list for search
  useEffect(() => {
    const load = () => api<PatientRow[]>('/api/patients').then(r => {
      setPts(r); setNewAlerts(r.reduce((a, p) => a + p.new_alerts, 0))
    }).catch(() => undefined)
    load()
    window.addEventListener(REFRESH, load)
    const iv = setInterval(load, 30000)
    return () => { window.removeEventListener(REFRESH, load); clearInterval(iv) }
  }, [])

  // live events
  useEffect(() => {
    let es: EventSource | null = null, retry: ReturnType<typeof setTimeout>
    const open = () => {
      es = new EventSource(`/api/stream?token=${encodeURIComponent(getToken() ?? '')}`)
      es.addEventListener('hello', () => setLive(true))
      es.onerror = () => { setLive(false); es?.close(); retry = setTimeout(open, 5000) }
      es.addEventListener('alert', e => {
        const d = JSON.parse((e as MessageEvent).data)
        beep()
        toast({ kind: 'alert', title: t('Новая тревога'), body: `${d.patient_name} · ${Math.round(d.bpm)} ${t('уд/мин')} · ${Math.round(d.prob * 100)}%`, href: `/app/patients/${d.patient_id}` })
        emitRefresh(d)
      })
      es.addEventListener('symptom', e => {
        const d = JSON.parse((e as MessageEvent).data)
        toast({ kind: 'info', title: t('Новый симптом'), body: d.patient_name, href: `/app/patients/${d.patient_id}/symptoms` })
        emitRefresh(d)
      })
      es.addEventListener('ecg', e => {
        const d = JSON.parse((e as MessageEvent).data)
        toast({ kind: 'info', title: t('Новая ЭКГ'), body: d.patient_name, href: `/app/patients/${d.patient_id}/ecg` })
        emitRefresh(d)
      })
      es.addEventListener('reading', e => emitRefresh(JSON.parse((e as MessageEvent).data)))
      es.addEventListener('patients', () => emitRefresh())
    }
    open()
    return () => { es?.close(); clearTimeout(retry) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "/" focuses search
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault(); searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const hits = q.trim() ? pts.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.email.includes(q.toLowerCase())).slice(0, 6) : []
  const cycleTheme = () => {
    const next: ThemePref = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system'
    setTheme(next); applyTheme(next)
  }

  return (
    <div className="app">
      <aside className="side">
        <NavLink to="/" className="side-brand">{Icon.pulse(22)}<span>AFib<b>Monitor</b></span></NavLink>
        <nav>
          <NavLink to="/app" end>{Icon.grid()}<span>{t('Обзор')}</span></NavLink>
          <NavLink to="/app/patients">{Icon.users()}<span>{t('Пациенты')}</span></NavLink>
          <NavLink to="/app/alerts">{Icon.bell()}<span>{t('Тревоги')}</span>{newAlerts > 0 && <b className="badge">{newAlerts}</b>}</NavLink>
          <NavLink to="/app/settings">{Icon.cog()}<span>{t('Настройки')}</span></NavLink>
        </nav>
        <div className={`live ${live ? 'on' : ''}`}><i />{live ? 'LIVE' : 'offline'}</div>
        <div className="side-code"><span>{t('Код для пациентов')}</span><b>{me.invite_code}</b></div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="search">
            {Icon.search()}
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder={t('Поиск пациента…')}
              onKeyDown={e => { if (e.key === 'Enter' && hits[0]) { nav(`/app/patients/${hits[0].id}`); setQ('') } if (e.key === 'Escape') setQ('') }} />
            <kbd>/</kbd>
            {hits.length > 0 && (
              <div className="search-pop">
                {hits.map(p => (
                  <button key={p.id} onClick={() => { nav(`/app/patients/${p.id}`); setQ('') }}>
                    <Avatar name={p.name} size={28} alert={p.alert} /><span>{p.name}</span><small>{p.email}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="top-actions">
            <button className="icon-btn" onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} title={t('Язык')}><b className="lang-t">{lang.toUpperCase()}</b></button>
            <button className="icon-btn" onClick={cycleTheme} title={t('Тема')}>{theme === 'dark' ? Icon.moon() : theme === 'light' ? Icon.sun() : <span className="auto-t">A</span>}</button>
            <div className="me" onClick={() => setMenu(!menu)}>
              <Avatar name={me.name} size={34} />
              <div className="me-txt"><b>{me.name}</b><small>{me.specialty || me.email}</small></div>
              {menu && (
                <div className="menu" onMouseLeave={() => setMenu(false)}>
                  <button onClick={() => nav('/app/settings')}>{Icon.cog(16)} {t('Настройки')}</button>
                  <button onClick={onLogout}>{Icon.logout(16)} {t('Выйти')}</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      <div className="toasts" aria-live="polite">
        {toasts.map(x => (
          <div key={x.id} className={`toast ${x.kind}`} onClick={() => { if (x.href) nav(x.href); setToasts(ts => ts.filter(t => t.id !== x.id)) }}>
            <span className="toast-ico">{x.kind === 'alert' ? Icon.heart(20) : Icon.bell(18)}</span>
            <div><b>{x.title}</b><span>{x.body}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
