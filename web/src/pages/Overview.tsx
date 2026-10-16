import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, REFRESH, type Overview as Ov, type PatientRow, type User } from '../api'
import { Avatar, Count, Empty, Icon, Spark, StatePill, useFmt } from '../components/ui'

export function useLive<T>(path: string): [T | null, string, () => void] {
  const [d, setD] = useState<T | null>(null)
  const [err, setErr] = useState('')
  const load = () => api<T>(path).then(x => { setD(x); setErr('') }).catch(e => setErr(e.message))
  useEffect(() => {
    load()
    window.addEventListener(REFRESH, load)
    const iv = setInterval(load, 20000)
    return () => { window.removeEventListener(REFRESH, load); clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  return [d, err, load]
}

export default function Overview({ me }: { me: User }) {
  const f = useFmt()
  const [ov] = useLive<Ov>('/api/overview')
  const [rows] = useLive<PatientRow[]>('/api/patients')
  const hour = new Date().getHours()
  const hello = f.lang === 'en'
    ? (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening')
    : (hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер')
  const attention = rows?.filter(r => r.alert || r.new_alerts > 0) ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString(f.lang === 'en' ? 'en-GB' : 'ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1>{hello}, {me.name.replace(/^Др\.\s*/, '').split(' ')[0]}</h1>
        </div>
      </div>

      <div className="kpis">
        <Kpi label={f.t('Пациенты')} value={ov?.patients ?? 0} sub={`${ov?.online ?? 0} ${f.t('онлайн')}`} />
        <Kpi label={f.t('ФП сейчас')} value={ov?.in_afib_now ?? 0} tone={ov?.in_afib_now ? 'af' : undefined} />
        <Kpi label={f.t('Новые тревоги')} value={ov?.new_alerts ?? 0} tone={ov?.new_alerts ? 'af' : undefined} link="/app/alerts" />
        <Kpi label={f.t('Эпизоды за 24 ч')} value={ov?.episodes_24h ?? 0} />
        <Kpi label={f.t('Средняя нагрузка ФП')} value={(ov?.mean_burden_24h ?? 0) * 100} fmt={v => `${v.toFixed(1)}%`} />
        <Kpi label={`${f.t('Симптомы')} · ${f.t('ЭКГ')}`} value={(ov?.symptoms_24h ?? 0)} fmt={v => `${Math.round(v)} · ${ov?.ecg_24h ?? 0}`} />
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>{f.t('Требуют внимания')}</h2><Link to="/app/patients" className="link-sm">{f.t('Все пациенты')} {Icon.arrow(14)}</Link></div>
          {attention.length === 0 ? <Empty>{f.t('Тревог нет — всё спокойно.')}</Empty> : (
            <ul className="attn">
              {attention.map(p => (
                <li key={p.id}>
                  <Link to={`/app/patients/${p.id}`}>
                    <Avatar name={p.name} alert={p.alert} />
                    <div className="attn-main"><b>{p.name}</b><small>{f.age(p.birth_year)} · {f.ago(p.last_seen)}</small></div>
                    <Spark data={p.spark} alert={p.alert} w={100} />
                    <StatePill state={p.last_state} />
                    {p.new_alerts > 0 && <span className="badge">{p.new_alerts}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head"><h2>{f.t('Нагрузка ФП за 24 ч')}</h2></div>
          <div className="hbars">
            {[...(ov?.burden ?? [])].sort((x, y) => y.af_burden_24h - x.af_burden_24h).map((b, i) => {
              const tone = b.af_burden_24h > 0.3 ? 'af' : b.af_burden_24h > 0.02 ? 'warn' : 'ok'
              return (
                <Link key={b.id} to={`/app/patients/${b.id}`} className="hbar" style={{ ['--i' as string]: i }}>
                  <span className="hbar-n">{b.name}</span>
                  <span className="hbar-t"><span className={`hbar-f ${tone}`} style={{ width: `${Math.max(0.6, b.af_burden_24h * 100)}%` }} /></span>
                  <span className="hbar-v num">{f.pct(b.af_burden_24h)}</span>
                </Link>
              )
            })}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>{f.t('Последние тревоги')}</h2><Link to="/app/alerts" className="link-sm">{f.t('Тревоги')} {Icon.arrow(14)}</Link></div>
        {!ov?.recent_alerts.length ? <Empty>{f.t('Тревог нет — всё спокойно.')}</Empty> : (
          <div className="timeline">
            {ov.recent_alerts.map(a => (
              <Link key={a.id} to={`/app/patients/${a.patient_id}`} className={`tl ${a.status}`}>
                <span className="tl-dot" />
                <span className="tl-time">{f.dt(a.ts)}</span>
                <b>{a.patient_name}</b>
                <span className="muted">{f.t('Фибрилляция')} · {Math.round(a.bpm)} {f.t('уд/мин')} · {Math.round(a.prob * 100)}%</span>
                {a.status === 'new' && <span className="pill st-af">{f.t('Новые')}</span>}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, tone, link, fmt }: { label: string; value: number; sub?: string; tone?: 'af'; link?: string; fmt?: (v: number) => string }) {
  const body = (
    <>
      <span className="kpi-l">{label}</span>
      <b className="kpi-v"><Count value={value} format={fmt} /></b>
      {sub && <small>{sub}</small>}
    </>
  )
  return link ? <Link to={link} className={`kpi ${tone ?? ''}`}>{body}</Link> : <div className={`kpi ${tone ?? ''}`}>{body}</div>
}
