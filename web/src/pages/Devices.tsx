import { useState } from 'react'
import { Link } from 'react-router-dom'
import { del, getToken, post, type PatientRow } from '../api'
import { Icon, useFmt } from '../components/ui'
import { Kpi, useLive } from './Overview'

/** Clinic rental: the clinic's sensors, who holds which one and until when, electrode stock, loan history, CSV.
 *  Rules live on the server (one box → one patient, one patient → one box); this page only shows and asks. */
type Issue = { id: number; device_id: number; chip_id: string | null; label: string | null; patient_id: number; patient: string
  issued_at: string; due_at: string; returned_at: string | null; overdue: boolean; electrodes_given: number; note: string | null }
type Device = { id: number; chip_id: string; label: string | null; electrodes: number; retired: boolean; issue: Issue | null }

export default function Devices() {
  const f = useFmt()
  const [devices, , reload] = useLive<Device[]>('/api/devices', 30000)
  const [history, , reloadHist] = useLive<Issue[]>('/api/issues?limit=100', 60000)
  const [patients] = useLive<PatientRow[]>('/api/patients', 60000)
  const [add, setAdd] = useState({ chip_id: '', label: '', electrodes: '0' })
  const [issuing, setIssuing] = useState<Device | null>(null)
  const [form, setForm] = useState({ patient_id: '', days: '14', electrodes: '0', note: '' })
  const [msg, setMsg] = useState('')
  const refresh = () => { reload(); reloadHist() }
  const say = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }
  const date = (iso: string) => new Date(iso).toLocaleDateString(f.loc, { day: 'numeric', month: 'short', year: 'numeric' })

  async function addDevice(e: React.FormEvent) {
    e.preventDefault()
    try {
      await post('/api/devices', { chip_id: add.chip_id.trim(), label: add.label.trim() || null, electrodes: Number(add.electrodes) || 0 })
      setAdd({ chip_id: '', label: '', electrodes: '0' }); refresh()
    } catch (e) { say((e as Error).message) }
  }
  async function issue(e: React.FormEvent) {
    e.preventDefault()
    if (!issuing) return
    try {
      await post(`/api/devices/${issuing.id}/issue`, { patient_id: Number(form.patient_id), days: Number(form.days), electrodes: Number(form.electrodes) || 0, note: form.note.trim() || null })
      setIssuing(null); setForm({ patient_id: '', days: '14', electrodes: '0', note: '' }); refresh()
    } catch (e) { say((e as Error).message) }
  }
  async function back(i: Issue) { try { await post(`/api/issues/${i.id}/return`); refresh() } catch (e) { say((e as Error).message) } }
  async function retire(d: Device) {
    if (!confirm(f.tr(`Списать датчик ${d.label || d.chip_id}? История выдач останется.`, `Retire device ${d.label || d.chip_id}? Loan history stays.`, `${d.label || d.chip_id} датчигин эсептен чыгаруу? Берүү тарыхы калат.`))) return
    try { await del(`/api/devices/${d.id}`); refresh() } catch (e) { say((e as Error).message) }
  }
  async function csv() {
    try {
      const r = await fetch('/api/issues.csv', { headers: { Authorization: `Bearer ${getToken()}` } })
      const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'device_issues.csv'; a.click()
    } catch (e) { say((e as Error).message) }
  }

  const free = devices?.filter(d => !d.retired && !d.issue) ?? []
  const out = devices?.filter(d => d.issue) ?? []
  const overdue = out.filter(d => d.issue!.overdue)
  const stock = devices?.reduce((s, d) => s + (d.retired ? 0 : d.electrodes), 0) ?? 0
  const holders = new Set(out.map(d => d.issue!.patient_id))

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{f.tr('Датчики клиники', 'Clinic devices', 'Клиниканын датчиктери')}</h1>
          <p className="muted">{f.tr('Учёт выдачи датчиков пациентам на время. Один датчик — один пациент; сервер не даст выдать дважды.',
            'Lending sensors to patients for a period. One box, one patient; the server refuses a double issue.',
            'Датчиктерди бейтаптарга убактылуу берүүнүн эсеби. Бир датчик — бир бейтап; сервер эки жолу берүүгө жол бербейт.')}</p></div>
        <button className="btn ghost" onClick={csv}>{Icon.check(16)} CSV</button>
      </div>
      {msg && <div className="card" style={{ borderColor: 'var(--af)', color: 'var(--af-ink)' }}>{msg}</div>}

      <div className="kpis five">
        <Kpi label={f.tr('Всего', 'Total', 'Бардыгы')} value={devices?.filter(d => !d.retired).length ?? 0} />
        <Kpi label={f.tr('Выдано', 'Out', 'Берилген')} value={out.length} />
        <Kpi label={f.tr('Просрочено', 'Overdue', 'Мөөнөтү өткөн')} value={overdue.length} tone={overdue.length ? 'af' : undefined} />
        <Kpi label={f.tr('Свободно', 'Free', 'Бош')} value={free.length} />
        <Kpi label={f.tr('Электродов на складе', 'Pads in stock', 'Кампадагы электроддор')} value={stock} />
      </div>

      <div className="card table">
        <div className="tr th dev"><span>{f.tr('Датчик', 'Device', 'Датчик')}</span><span>ID {f.tr('чипа', 'chip', 'чип')}</span><span>{f.tr('Электроды', 'Pads', 'Электроддор')}</span>
          <span>{f.tr('У кого', 'Holder', 'Кимде')}</span><span>{f.tr('Вернуть до', 'Due', 'Кайтаруу')}</span><span /></div>
        {devices?.map((d, i) => (
          <div key={d.id} className={`tr dev${d.retired ? ' muted' : ''}`} style={{ ['--i' as string]: i }}>
            <span><b>{d.label || '—'}</b>{d.retired && <small className="muted"> · {f.tr('списан', 'retired', 'эсептен чыгарылган')}</small>}</span>
            <span className="mono">{d.chip_id}</span>
            <span>{d.electrodes}</span>
            <span>{d.issue ? <Link to={`/app/patients/${d.issue.patient_id}`}>{d.issue.patient}</Link> : <span className="muted">—</span>}</span>
            <span>{d.issue ? <span className={`pill ${d.issue.overdue ? 'st-af' : 'st-ok'}`}>{date(d.issue.due_at)}</span> : <span className="pill st-wait">{f.tr('свободен', 'free', 'бош')}</span>}</span>
            <span className="row-btns" style={{ justifyContent: 'flex-end' }}>
              {d.issue ? <button className="btn ghost tiny" onClick={() => back(d.issue!)}>{f.tr('Вернули', 'Returned', 'Кайтарылды')}</button>
                : !d.retired && <>
                  <button className="btn primary tiny" onClick={() => { setIssuing(d); setForm(fm => ({ ...fm, electrodes: String(Math.min(d.electrodes, 20)) })) }}>{f.tr('Выдать', 'Issue', 'Берүү')}</button>
                  <button className="btn ghost tiny" title={f.tr('Списать', 'Retire', 'Эсептен чыгаруу')} onClick={() => retire(d)}>{Icon.x(14)}</button>
                </>}
            </span>
          </div>
        ))}
        {devices && devices.length === 0 && <div className="tr dev muted"><span>{f.tr('Датчиков пока нет — добавьте первый ниже.', 'No devices yet — add the first one below.', 'Датчиктер азырынча жок — биринчисин төмөндө кошуңуз.')}</span></div>}
      </div>

      {issuing && (
        <form className="card form" onSubmit={issue}>
          <h2>{f.tr('Выдать', 'Issue', 'Берүү')} {issuing.label || issuing.chip_id}</h2>
          <div className="row2">
            <label>{f.t('Пациент')}
              <select value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })} required>
                <option value="">—</option>
                {patients?.filter(p => !holders.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label>{f.tr('На сколько дней', 'For how many days', 'Канча күнгө')}<input type="number" min={1} max={120} value={form.days} onChange={e => setForm({ ...form, days: e.target.value })} required /></label>
          </div>
          <div className="row2">
            <label>{f.tr('Электродов с собой', 'Pads given', 'Берилген электроддор')} (≤ {issuing.electrodes})<input type="number" min={0} max={issuing.electrodes} value={form.electrodes} onChange={e => setForm({ ...form, electrodes: e.target.value })} /></label>
            <label>{f.tr('Заметка', 'Note', 'Эскертүү')}<input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} maxLength={200} /></label>
          </div>
          <div className="form-foot"><button className="btn primary">{f.tr('Выдать', 'Issue', 'Берүү')}</button><button type="button" className="btn ghost" onClick={() => setIssuing(null)}>{f.t('Отмена')}</button></div>
        </form>
      )}

      <form className="card form" onSubmit={addDevice}>
        <h2>{f.tr('Добавить датчик', 'Add a device', 'Датчик кошуу')}</h2>
        <p className="muted">{f.tr('ID чипа — последние шесть знаков MAC-адреса платы; его печатает скрипт прошивки (MAC: 68:ee:8f:d8:40:48 → D84048). Напишите его на наклейке коробки.', 'Chip ID — the last six characters of the board MAC address, printed by the flashing script (MAC: 68:ee:8f:d8:40:48 → D84048). Write it on the box sticker.', 'Чип ID — платанын MAC дарегинин акыркы алты белгиси; аны прошивка скрипти басып чыгарат (MAC: 68:ee:8f:d8:40:48 → D84048). Кутунун стикерине жазыңыз.')}</p>
        <div className="row2">
          <label>ID<input value={add.chip_id} onChange={e => setAdd({ ...add, chip_id: e.target.value.toUpperCase() })} placeholder="A1B2C3" pattern="[A-Za-z0-9:_-]{3,32}" required /></label>
          <label>{f.tr('Наклейка', 'Sticker', 'Стикер')}<input value={add.label} onChange={e => setAdd({ ...add, label: e.target.value })} placeholder="№1" maxLength={60} /></label>
        </div>
        <label>{f.tr('Электродов в комплекте', 'Pads with the box', 'Куту менен электроддор')}<input type="number" min={0} value={add.electrodes} onChange={e => setAdd({ ...add, electrodes: e.target.value })} /></label>
        <div className="form-foot"><button className="btn primary">{f.t('Добавить')}</button></div>
      </form>

      <div className="card table">
        <div className="tr th hist"><span>{f.tr('Датчик', 'Device', 'Датчик')}</span><span>{f.t('Пациент')}</span><span>{f.tr('Выдан', 'Issued', 'Берилген')}</span><span>{f.tr('Срок', 'Due', 'Мөөнөт')}</span><span>{f.tr('Возвращён', 'Returned', 'Кайтарылган')}</span><span>{f.tr('Электроды', 'Pads', 'Электроддор')}</span></div>
        {history?.map((h, i) => (
          <div key={h.id} className="tr hist" style={{ ['--i' as string]: i }}>
            <span>{h.label || h.chip_id}</span>
            <span><Link to={`/app/patients/${h.patient_id}`}>{h.patient}</Link></span>
            <span>{date(h.issued_at)}</span>
            <span>{date(h.due_at)}</span>
            <span>{h.returned_at ? date(h.returned_at) : <span className={`pill ${h.overdue ? 'st-af' : 'st-new'}`}>{h.overdue ? f.tr('просрочен', 'overdue', 'мөөнөтү өткөн') : f.tr('у пациента', 'out', 'бейтапта')}</span>}</span>
            <span>{h.electrodes_given}{h.note && <small className="muted"> · {h.note}</small>}</span>
          </div>
        ))}
        {history && history.length === 0 && <div className="tr hist muted"><span>{f.tr('Выдач пока не было.', 'No loans yet.', 'Берүүлөр азырынча болгон эмес.')}</span></div>}
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>{f.tr('Напоминание о возврате уходит врачу и пациенту в Telegram за день до срока и каждый день просрочки (если Telegram подключён).', 'A return reminder goes to the doctor and the patient in Telegram the day before and on every overdue day (when Telegram is linked).', 'Кайтаруу эскертмеси мөөнөттөн бир күн мурун жана мөөнөтү өткөн ар бир күнү дарыгерге жана бейтапка Telegram аркылуу кетет (Telegram туташтырылса).')}</p>
    </div>
  )
}
