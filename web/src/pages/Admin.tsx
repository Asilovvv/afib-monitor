import { useState } from 'react'
import { Kpi } from './Overview'
import { useFmt } from '../components/ui'

/** Owner's status page: the ADMIN_TOKEN is typed here and kept only in this browser tab (sessionStorage), never sent
 *  anywhere but our own API. Counts and shares only — no patient data on this page by design (server side too). */
type Status = {
  days: number; as_of: string
  users: { patients: number; doctors: number; family: number; new_patients: number }
  activity: { checks: number; patients_who_checked: number; vitals_entries: number; doctor_seen_marks: number }
  pricing_metrics: { share_patients_with_relative: number | null; share_patients_with_doctor: number | null; share_patients_with_telegram: number | null
    trial_active: number; trial_ended: number; paid_family: number; trial_to_paid: number | null; clinic_plans: Record<string, number>; invoice_requests_open: number }
  plans: Record<string, number>
  devices: { active: number; issued: number; overdue: number }
}
const pct = (v: number | null) => v == null ? '—' : `${Math.round(v * 100)}%`

export default function Admin() {
  const f = useFmt()
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem('afib:admin') ?? '' } catch { return '' } })
  const [days, setDays] = useState(30)
  const [st, setSt] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  async function load(e?: React.FormEvent) {
    e?.preventDefault()
    try {
      const r = await fetch(`/api/admin/status?days=${days}`, { headers: { 'X-Admin-Token': token } })
      if (!r.ok) throw new Error(r.status === 403 ? f.tr('Неверный токен', 'Wrong token', 'Туура эмес токен') : r.statusText)
      setSt(await r.json()); setErr('')
      try { sessionStorage.setItem('afib:admin', token) } catch { /* ignore */ }
    } catch (e) { setErr((e as Error).message); setSt(null) }
  }
  const m = st?.pricing_metrics
  const tone = (v: number | null, bad: number) => v == null ? undefined : v < bad ? 'af' as const : undefined
  return (
    <div className="page">
      <div className="page-head"><div><h1>{f.tr('Статус проекта', 'Project status', 'Долбоордун абалы')}</h1>
        <p className="muted">{f.tr('Только счётчики и доли — без данных пациентов. Пороги из docs/PRICING.md §4.', 'Counts and shares only — no patient data. Thresholds from docs/PRICING.md §4.', 'Эсептегичтер жана үлүштөр гана — бейтап маалыматы жок. Чектер docs/PRICING.md §4.')}</p></div></div>
      <form className="card form" onSubmit={load}>
        <div className="row2">
          <label>ADMIN_TOKEN<input type="password" value={token} onChange={e => setToken(e.target.value)} autoComplete="off" /></label>
          <label>{f.tr('Период, дней', 'Period, days', 'Мезгил, күн')}<input type="number" min={1} max={365} value={days} onChange={e => setDays(Number(e.target.value))} /></label>
        </div>
        <div className="form-foot"><button className="btn primary">{f.tr('Показать', 'Show', 'Көрсөтүү')}</button><span className="muted">{err}</span></div>
      </form>
      {st && m && (
        <>
          <div className="kpis">
            <Kpi label={f.t('Пациенты')} value={st.users.patients} sub={`+${st.users.new_patients} ${f.tr('за период', 'in period', 'мезгилде')}`} />
            <Kpi label={f.tr('Врачи', 'Doctors', 'Дарыгерлер')} value={st.users.doctors} />
            <Kpi label={f.tr('Близкие', 'Relatives', 'Жакындар')} value={st.users.family} />
            <Kpi label={f.tr('Проверок', 'Checks', 'Текшерүүлөр')} value={st.activity.checks} sub={`${st.activity.patients_who_checked} ${f.tr('пациентов', 'patients', 'бейтап')}`} />
            <Kpi label={f.tr('Записей давления и др.', 'Vitals entries', 'Кан басымы ж.б.')} value={st.activity.vitals_entries} />
            <Kpi label={f.tr('«Видел» врача', 'Doctor "seen"', 'Дарыгер «көрдү»')} value={st.activity.doctor_seen_marks} />
          </div>
          <h2 style={{ marginTop: 20 }}>{f.tr('Метрики модели оплаты', 'Pricing metrics', 'Төлөм моделинин метрикалары')}</h2>
          <div className="kpis three">
            <Kpi label={f.tr('Пациентов с близким', 'Patients with a relative', 'Жакыны бар бейтаптар')} value={(m.share_patients_with_relative ?? 0) * 100} fmt={() => pct(m.share_patients_with_relative)} sub={f.tr('хорошо ≥ 40 %, плохо < 15 %', 'good ≥ 40%, bad < 15%', 'жакшы ≥ 40 %, начар < 15 %')} tone={tone(m.share_patients_with_relative, 0.15)} />
            <Kpi label={f.tr('С врачом', 'With a doctor', 'Дарыгер менен')} value={(m.share_patients_with_doctor ?? 0) * 100} fmt={() => pct(m.share_patients_with_doctor)} />
            <Kpi label={f.tr('С Telegram', 'With Telegram', 'Telegram менен')} value={(m.share_patients_with_telegram ?? 0) * 100} fmt={() => pct(m.share_patients_with_telegram)} />
            <Kpi label={f.tr('Пробный → платный', 'Trial → paid', 'Сыноо → акылуу')} value={(m.trial_to_paid ?? 0) * 100} fmt={() => pct(m.trial_to_paid)} sub={`${f.tr('хорошо ≥ 10 %, плохо < 3 %', 'good ≥ 10%, bad < 3%', 'жакшы ≥ 10 %, начар < 3 %')} · ${m.trial_active} ${f.tr('в пробном', 'on trial', 'сыноодо')} · ${m.trial_ended} ${f.tr('закончили', 'ended', 'бүттү')} · ${m.paid_family} ${f.tr('платят', 'paying', 'төлөйт')}`} tone={tone(m.trial_to_paid, 0.03)} />
            <Kpi label={f.tr('Клиник на тарифе', 'Clinics on a plan', 'Тарифтеги клиникалар')} value={Object.values(m.clinic_plans).reduce((a, b) => a + b, 0)} sub={`${f.tr('цель ≥ 3 через 6 мес', 'target ≥ 3 in 6 months', 'максат 6 айда ≥ 3')} · ${m.invoice_requests_open} ${f.tr('заявок на счёт', 'invoice requests', 'эсеп өтүнмөсү')}`} />
            <Kpi label={f.tr('Датчиков выдано', 'Devices out', 'Берилген датчиктер')} value={st.devices.issued} fmt={v => String(Math.round(v))} sub={`${st.devices.overdue} ${f.tr('просрочено', 'overdue', 'мөөнөтү өткөн')} · ${st.devices.active} ${f.tr('всего', 'total', 'бардыгы')}`} tone={st.devices.overdue ? 'af' : undefined} />
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>{f.tr('Тарифы', 'Plans', 'Тарифтер')}: {Object.entries(st.plans).map(([k, v]) => `${k} ${v}`).join(' · ')} · {new Date(st.as_of).toLocaleString(f.loc)}</p>
        </>
      )}
    </div>
  )
}
