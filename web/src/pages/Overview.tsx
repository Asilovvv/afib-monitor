import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, REFRESH, type Overview as Ov, type PatientRow, type User } from '../api'
import { Avatar, Count, Empty, Icon, Spark, StatePill, useFmt } from '../components/ui'

export function useLive<T>(path: string, everyMs = 20000): [T | null, string, () => void] {
  const [d, setD] = useState<T | null>(null)
  const [err, setErr] = useState('')
  const load = () => api<T>(path).then(x => { setD(x); setErr('') }).catch(e => setErr(e.message))
  useEffect(() => {
    load()
    window.addEventListener(REFRESH, load)
    const iv = everyMs > 0 ? setInterval(load, everyMs) : undefined
    return () => { window.removeEventListener(REFRESH, load); if (iv) clearInterval(iv) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  return [d, err, load]
}

export default function Overview({ me }: { me: User }) {
  const f = useFmt()
  const [ov] = useLive<Ov>('/api/overview')
  const [rows] = useLive<PatientRow[]>('/api/patients')
  const hour = new Date().getHours()
  const hello = hour < 12 ? f.tr('Доброе утро', 'Good morning', 'Кутман таң')
    : hour < 18 ? f.tr('Добрый день', 'Good afternoon', 'Кутман күн') : f.tr('Добрый вечер', 'Good evening', 'Кутман кеч')
  const attention = rows?.filter(r => r.alert || r.new_alerts > 0) ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">{new Date().toLocaleDateString(f.loc, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
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

      <QualityCard />
    </div>
  )
}

type Metrics = {
  days: number; mode: string; patients: number; patient_days: number; alerts: number
  alerts_per_patient_day: number | null; reviewed: number; confirmed: number; false_alarms: number
  ppv: number | null; false_alarms_per_patient_day: number | null; acked: number; ack_median_min: number | null
  ack_within_15_min: number | null; family_acks: number; feedback_count: number; feedback_avg: number | null
  feedback: { ts: string; rating: number; text: string | null; who: string; platform: string | null }[]
}

/** Product quality over 30 days: alert load, how many alerts were real (doctor verdicts), how fast they were seen. */
function QualityCard() {
  const f = useFmt()
  const [m] = useLive<Metrics>('/api/metrics?days=30', 300000)
  if (!m) return null
  const num = (v: number | null, d = 1) => (v == null ? '—' : v.toFixed(d).replace('.', f.lang === 'en' ? '.' : ','))
  const tiles: [string, string, string][] = [
    [f.tr('Тревог на пациента в день', 'Alerts per patient-day', 'Бейтапка күнүнө эскертүү'), num(m.alerts_per_patient_day, 2), `${m.alerts} · ${num(m.patient_days, 1)} ${f.tr('пациенто-дней', 'patient-days', 'бейтап-күн')}`],
    [f.tr('Подтверждено врачом', 'Confirmed by doctor', 'Дарыгер ырастады'), m.ppv == null ? '—' : f.pct(m.ppv), `${m.confirmed} ${f.tr('из', 'of', '/')} ${m.reviewed} ${f.tr('размеченных', 'reviewed', 'белгиленген')}`],
    [f.tr('Ложных на пациента в день', 'False alarms per patient-day', 'Бейтапка күнүнө жалган'), num(m.false_alarms_per_patient_day, 2), `${m.false_alarms} ${f.tr('отмечено', 'marked', 'белгиленди')}`],
    [f.tr('Медиана до «Принять»', 'Median time to accept', '«Кабыл алууга» чейин медиана'), m.ack_median_min == null ? '—' : f.dur(m.ack_median_min * 60), `${m.ack_within_15_min == null ? '—' : f.pct(m.ack_within_15_min)} ${f.tr('за 15 мин', 'within 15 min', '15 мүн ичинде')}`],
    [f.tr('Отзывы', 'Feedback', 'Пикирлер'), m.feedback_avg == null ? '—' : `★ ${num(m.feedback_avg, 1)}`, `${m.feedback_count} ${f.tr('за', 'in', '')} ${m.days} ${f.tr('дн.', 'days', 'күн')}`],
  ]
  return (
    <section className="card quality">
      <div className="card-head">
        <h2>{f.tr('Качество системы', 'System quality', 'Системанын сапаты')} · {m.days} {f.tr('дней', 'days', 'күн')}</h2>
        {m.mode === 'wellness' && <span className="pill st-wait">{f.tr('Режим без диагностики', 'No-diagnosis mode', 'Диагностикасыз режим')}</span>}
      </div>
      <div className="q-tiles">
        {tiles.map(([l, v, sub]) => <div key={l}><span className="kpi-l">{l}</span><b>{v}</b><small>{sub}</small></div>)}
      </div>
      {m.feedback.length > 0 && <div className="q-fb">
        {m.feedback.slice(0, 3).map((x, i) => (
          <blockquote key={i}><span className="q-stars">{'★'.repeat(x.rating)}{'☆'.repeat(5 - x.rating)}</span> {x.text ?? ''}
            <small> — {x.who}, {f.dt(x.ts)}</small></blockquote>
        ))}
      </div>}
      <p className="fine">{f.tr(
        '«Подтверждено врачом» — доля размеченных эпизодов, которые врач подтвердил как ФП. Размечайте эпизоды на вкладке «Эпизоды», чтобы видеть реальную точность у ваших пациентов.',
        '“Confirmed by doctor” is the share of reviewed episodes the doctor confirmed as AF. Review episodes to see real-world accuracy for your patients.',
        '«Дарыгер ырастады» — белгиленген эпизоддордун ичинен ФП деп ырасталгандардын үлүшү.')}</p>
    </section>
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
