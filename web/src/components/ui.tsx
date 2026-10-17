import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n'

// ---------------------------------------------------------------- icons (inline, 1.6px stroke)
const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
export const Icon = {
  pulse: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M2 12h4l2.5-6 4 13 3-9 1.5 2H22" /></svg>,
  grid: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  users: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14.8c1.6.8 2.6 2.5 3 5.2" /></svg>,
  bell: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>,
  cog: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  search: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>,
  sun: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>,
  logout: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" /></svg>,
  battery: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="2" y="7" width="17" height="10" rx="2" /><path d="M22 11v2" /></svg>,
  phone: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" /></svg>,
  check: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="m5 12.5 4.5 4.5L19 7" /></svg>,
  x: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M6 6l12 12M18 6 6 18" /></svg>,
  arrow: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  back: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>,
  print: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M7 9V3h10v6M7 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3" /><rect x="7" y="14" width="10" height="7" /></svg>,
  heart: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.6 3.6 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.4 0 5.5 3.1 4.3 6.3C19.5 15.4 12 20 12 20z" /></svg>,
  chip: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /><path d="M9.5 12h1l1-2 1 4 1-2h1" /></svg>,
  mobile: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2" /></svg>,
  doctor: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><circle cx="12" cy="7" r="4" /><path d="M4 21c.6-4 3.8-6.5 8-6.5s7.4 2.5 8 6.5" /><path d="M9 16v2.5a1.5 1.5 0 0 0 3 0" /><circle cx="15.5" cy="18.5" r="1.3" /></svg>,
  bolt: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>,
  shield: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></svg>,
  send: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M21.5 3.5 2.8 10.7c-.9.4-.9 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.7 3.5c.7.5 1.7.1 1.9-.7l3-15.4c.2-.9-.7-1.6-1.6-1.2z" /><path d="m7.5 14 9-6.5-6.5 8" /></svg>,
  scatter: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M3 3v18h18" /><circle cx="8" cy="15" r="1.2" /><circle cx="11" cy="11" r="1.2" /><circle cx="15" cy="13" r="1.2" /><circle cx="17" cy="7" r="1.2" /></svg>,
  note: (s = 18) => <svg width={s} height={s} viewBox="0 0 24 24" {...P}><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v4h4M8 12h8M8 16h6" /></svg>,
}

// ---------------------------------------------------------------- formatting
export const STATE: Record<number, { label: string; cls: string }> = {
  0: { label: 'Сбор данных', cls: 'st-wait' },
  1: { label: 'Норма', cls: 'st-ok' },
  2: { label: 'Фибрилляция', cls: 'st-af' },
  3: { label: 'Нет сигнала', cls: 'st-off' },
}

export const SYMPTOM_LABEL: Record<string, string> = {
  palpitations: 'Сердцебиение', dizziness: 'Головокружение', shortness_of_breath: 'Одышка', chest_pain: 'Боль в груди',
  fatigue: 'Слабость', anxiety: 'Тревожность', other: 'Другое',
}

// Some browsers ship no Kyrgyz date names: fall back to Russian month names then
const KY_OK = (() => { try { return Intl.DateTimeFormat.supportedLocalesOf(['ky']).length > 0 } catch { return false } })()

export function useFmt() {
  const { t, lang } = useT()
  const loc = lang === 'en' ? 'en-GB' : lang === 'ky' && KY_OK ? 'ky-KG' : 'ru-RU'
  const tr = (ru: string, en: string, ky: string) => (lang === 'en' ? en : lang === 'ky' ? ky : ru)
  return {
    t, lang, loc, tr,
    ago(iso: string | null) {
      if (!iso) return t('нет данных')
      const s = (Date.now() - new Date(iso).getTime()) / 1000
      if (s < 90) return t('только что')
      if (s < 3600) return `${Math.round(s / 60)} ${t('мин назад')}`
      if (s < 86400) return `${Math.round(s / 3600)} ${t('ч назад')}`
      return `${Math.round(s / 86400)} ${t('дн назад')}`
    },
    dur(sec: number) {
      const u = lang === 'en' ? ['s', 'min', 'h'] : lang === 'ky' ? ['сек', 'мүн', 'саат'] : ['с', 'мин', 'ч']
      if (sec < 60) return `${Math.round(sec)} ${u[0]}`
      const m = Math.round(sec / 60)
      if (m < 60) return `${m} ${u[1]}`
      return `${Math.floor(m / 60)} ${u[2]} ${m % 60} ${u[1]}`
    },
    pct: (x: number) => `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`,
    time: (iso: string) => new Date(iso).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }),
    dt: (iso: string) => new Date(iso).toLocaleString(loc, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
    date: (iso: string) => new Date(iso).toLocaleDateString(loc, { day: 'numeric', month: 'long', year: 'numeric' }),
    age: (by: number | null) => (by ? `${new Date().getFullYear() - by} ${t('лет')}` : ''),
  }
}

export const initials = (name: string) => name.replace(/^(Др\.|Dr\.)\s*/, '').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()

// ---------------------------------------------------------------- small components
export function StatePill({ state }: { state: number | null }) {
  const { t } = useT()
  if (state == null) return <span className="muted">—</span>
  const s = STATE[state]
  return <span className={`pill ${s.cls}`}><i className="dot" />{t(s.label)}</span>
}

export function Avatar({ name, size = 36, alert }: { name: string; size?: number; alert?: boolean }) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360
  return (
    <span className={`avatar ${alert ? 'ring' : ''}`} style={{ width: size, height: size, fontSize: size * 0.36, ['--h' as string]: h }}>
      {initials(name)}
    </span>
  )
}

export function Spark({ data, w = 120, h = 28, alert }: { data: (number | null)[]; w?: number; h?: number; alert?: boolean }) {
  const pts = data.map((v, i) => [i, v] as const).filter(([, v]) => v != null) as [number, number][]
  if (pts.length < 2) return <svg width={w} height={h} />
  const lo = Math.min(...pts.map(p => p[1])) - 3, hi = Math.max(...pts.map(p => p[1])) + 3
  const x = (i: number) => (i / (data.length - 1)) * (w - 2) + 1
  const y = (v: number) => h - 2 - ((v - lo) / (hi - lo)) * (h - 4)
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg width={w} height={h} className="spark" aria-hidden>
      <path d={d} fill="none" stroke={alert ? 'var(--af)' : 'var(--accent)'} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function BatteryBadge({ level }: { level: number | null }) {
  if (level == null) return null
  const cls = level < 20 ? 'bad' : level < 40 ? 'warn' : ''
  return (
    <span className={`battery ${cls}`} title={`${level}%`}>
      <span className="b-shell"><span className="b-fill" style={{ width: `${level}%` }} /></span>{level}%
    </span>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string, number?][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {label}{n ? <span className="count">{n}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Seg<T extends string | number>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="seg">
      {items.map(([k, l]) => <button key={String(k)} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  )
}

export function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return createPortal(
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal>
        <button className="icon-btn modal-x" onClick={onClose} aria-label="Close">{Icon.x(18)}</button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Animated number that counts up when it changes. */
export function Count({ value, format = (v: number) => String(Math.round(v)) }: { value: number; format?: (v: number) => string }) {
  const [v, setV] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 700)
      const e = 1 - Math.pow(1 - k, 3)
      setV(a + (b - a) * e)
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = b
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <>{format(v)}</>
}
