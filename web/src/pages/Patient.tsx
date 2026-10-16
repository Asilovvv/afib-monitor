import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, del, emitRefresh, post, type EcgStrip as Strip, type Report } from '../api'
import { EcgStrip, EcgThumb, rrStats } from '../components/Ecg'
import { Avatar, BatteryBadge, Empty, Icon, Modal, Seg, StatePill, SYMPTOM_LABEL, Tabs, useFmt } from '../components/ui'
import { useLive } from './Overview'

type Tab = 'overview' | 'episodes' | 'ecg' | 'symptoms' | 'notes'

export default function PatientPage() {
  const { id, tab = 'overview' } = useParams()
  const nav = useNavigate()
  const f = useFmt()
  const [hours, setHours] = useState(24)
  const [rep, err, reload] = useLive<Report>(`/api/patients/${id}/report?hours=${hours}`)
  const [ecgId, setEcgId] = useState<number | null>(null)

  if (err) return <div className="page"><div className="error">{err}</div></div>
  if (!rep) return <div className="page"><div className="skeleton tall" /></div>
  const p = rep.patient, s = rep.stats
  const setTab = (t: Tab) => nav(`/app/patients/${id}/${t === 'overview' ? '' : t}`)

  return (
    <div className="page">
      <Link to="/app/patients" className="back">{Icon.back(16)} {f.t('Все пациенты')}</Link>

      <header className={`p-head card ${rep.last?.state === 2 && rep.last.online ? 'is-af' : ''}`}>
        <Avatar name={p.name} size={64} alert={rep.last?.state === 2} />
        <div className="p-id">
          <h1>{p.name}</h1>
          <p className="muted">
            {[f.age(p.birth_year), p.sex === 'f' ? '♀' : p.sex === 'm' ? '♂' : '', p.email].filter(Boolean).join(' · ')}
            {p.phone && <> · <a href={`tel:${p.phone}`} className="tel">{Icon.phone(14)} {p.phone}</a></>}
          </p>
        </div>
        <div className="p-live">
          <StatePill state={rep.last?.state ?? null} />
          {rep.last && <span className="p-bpm"><b>{Math.round(rep.last.bpm) || '—'}</b> {f.t('уд/мин')}</span>}
          <span className={rep.last?.online ? 'ok' : 'muted'}>{rep.last?.online ? `● ${f.t('онлайн')}` : f.ago(rep.last?.ts ?? null)}</span>
          <BatteryBadge level={rep.battery} />
        </div>
        <div className="p-actions">
          <Seg value={hours} onChange={setHours} items={[[24, '24h'], [168, '7d'], [720, '30d']]} />
          <Link to={`/app/patients/${id}/report?hours=${hours}`} className="btn ghost">{Icon.print()} {f.t('Отчёт')}</Link>
        </div>
      </header>

      <Tabs<Tab> value={tab as Tab} onChange={setTab} items={[
        ['overview', f.t('Обзор')], ['episodes', f.t('Эпизоды'), rep.episodes.length],
        ['ecg', f.t('ЭКГ'), rep.ecg.length], ['symptoms', f.t('Симптомы'), rep.symptoms.length], ['notes', f.t('Заметки'), rep.notes?.length],
      ]} />

      {tab === 'overview' && <OverviewTab rep={rep} hours={hours} onEcg={setEcgId} />}
      {tab === 'episodes' && <EpisodesTab rep={rep} pid={Number(id)} onEcg={setEcgId} reload={reload} />}
      {tab === 'ecg' && <EcgTab rep={rep} onEcg={setEcgId} />}
      {tab === 'symptoms' && <SymptomsTab rep={rep} />}
      {tab === 'notes' && <NotesTab rep={rep} pid={Number(id)} reload={reload} />}

      {ecgId != null && <EcgModal id={ecgId} onClose={() => setEcgId(null)} />}
      <p className="fine">{f.t('Не является медицинским изделием.')} Ритм определяет нейросеть int8 TCN на устройстве ESP32-S3.</p>
      {s.readings === 0 && null}
    </div>
  )
}

function OverviewTab({ rep, hours, onEcg }: { rep: Report; hours: number; onEcg: (id: number) => void }) {
  const f = useFmt()
  const s = rep.stats
  const data = rep.series.map(p => ({ ...p, ts: new Date(p.t).getTime() }))
  const dom = [new Date(rep.range.from).getTime(), new Date(rep.range.to).getTime()]
  const step = (hours <= 24 ? 3 : hours <= 168 ? 24 : 24 * 5) * 3600e3
  const ticks: number[] = []
  for (let t = Math.ceil(dom[0] / step) * step; t <= dom[1]; t += step) ticks.push(t)
  const tickFmt = (v: number) => hours <= 24 ? f.time(new Date(v).toISOString()) : new Date(v).toLocaleDateString(f.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short' })
  const hourly = rep.hourly.map(h => ({ ...h, ts: new Date(h.t).getTime(), ok_min: Math.max(0, h.monitored_min - h.af_min) }))
  const tip = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: 'var(--shadow)' }

  return (
    <>
      <div className="kpis five">
        <div className="kpi"><span className="kpi-l">{f.t('Нагрузка ФП')}</span><b className="kpi-v">{f.pct(s.af_burden)}</b><small>{f.t('доля времени в ФП')}</small></div>
        <div className="kpi"><span className="kpi-l">{f.t('Эпизоды')}</span><b className="kpi-v">{s.episodes_count}</b>
          <small>{s.longest_episode_s ? `${f.t('самый длинный')} ${f.dur(s.longest_episode_s)}` : '—'}</small></div>
        <div className="kpi"><span className="kpi-l">{f.t('Решение врача')}</span><b className="kpi-v">{s.confirmed_episodes}<span className="kpi-sub"> / {s.false_alarms}</span></b>
          <small>{f.t('Подтверждённые')} / {f.t('Ложные')}</small></div>
        <div className="kpi"><span className="kpi-l">{f.t('Пульс')}</span><b className="kpi-v">{s.hr_mean ? Math.round(s.hr_mean) : '—'}</b>
          <small>{s.hr_min ? `${f.t('мин')} ${Math.round(s.hr_min)} · ${f.t('макс')} ${Math.round(s.hr_max!)}` : ''}</small></div>
        <div className="kpi"><span className="kpi-l">{f.t('Мониторинг')}</span><b className="kpi-v">{f.dur(s.monitored_minutes * 60)}</b>
          <small>{Math.round((s.monitored_minutes / 60 / hours) * 100)}% · {hours}h</small></div>
      </div>

      <section className="card chart">
        <div className="card-head"><h2>{f.t('Пульс и эпизоды фибрилляции')}</h2>
          <span className="legend"><i className="lg-bpm" /> {f.t('уд/мин')} <i className="lg-af" /> {f.t('Фибрилляция')}</span></div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--grid-line)" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={dom} scale="time" ticks={ticks} tickFormatter={tickFmt} stroke="var(--ink-3)" fontSize={12} />
            <YAxis domain={[40, 170]} stroke="var(--ink-3)" fontSize={12} />
            {rep.episodes.map(e => (
              <ReferenceArea key={e.start} x1={new Date(e.start).getTime()} x2={Math.max(new Date(e.end).getTime(), new Date(e.start).getTime() + (dom[1] - dom[0]) / 400)}
                fill="var(--af)" fillOpacity={e.verdict === 'false_alarm' ? 0.06 : 0.16} strokeOpacity={0}
                onClick={() => e.ecg_id && onEcg(e.ecg_id)} />
            ))}
            <Line dataKey="bpm" stroke="var(--accent)" dot={false} strokeWidth={1.6} isAnimationActive={false} />
            <Tooltip labelFormatter={v => f.dt(new Date(Number(v)).toISOString())} formatter={v => [`${v} ${f.t('уд/мин')}`, f.t('Пульс')]} contentStyle={tip} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      <div className="grid-2">
        <section className="card chart">
          <div className="card-head"><h2>{hours <= 48 ? f.t('Минуты ФП по часам') : f.t('Минуты ФП по дням')}</h2></div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hourly} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
              <XAxis dataKey="ts" tickFormatter={tickFmt} stroke="var(--ink-3)" fontSize={11} minTickGap={24} />
              <YAxis stroke="var(--ink-3)" fontSize={11} />
              <Tooltip labelFormatter={v => f.dt(new Date(Number(v)).toISOString())} contentStyle={tip}
                formatter={(v, n) => [`${v} ${f.t('мин')}`, n === 'af_min' ? f.t('Фибрилляция') : f.t('Норма')]} />
              <Bar dataKey="ok_min" stackId="a" fill="var(--ok-soft)" isAnimationActive={false} />
              <Bar dataKey="af_min" stackId="a" fill="var(--af)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="card">
          <div className="card-head"><h2>{f.t('Последние тревоги')}</h2></div>
          {(rep.alerts ?? []).length === 0 ? <Empty>{f.t('Тревог нет — всё спокойно.')}</Empty> : (
            <div className="timeline compact">
              {rep.alerts!.slice(0, 6).map(a => (
                <div key={a.id} className={`tl ${a.status}`}>
                  <span className="tl-dot" /><span className="tl-time">{f.dt(a.ts)}</span>
                  <span>{Math.round(a.bpm)} {f.t('уд/мин')} · {Math.round(a.prob * 100)}%</span>
                  <span className={`pill ${a.status === 'new' ? 'st-af' : 'st-wait'}`}>{a.status === 'new' ? f.t('Новые') : f.t('Принято')}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function Verdict({ v }: { v: string | null }) {
  const f = useFmt()
  if (v === 'confirmed') return <span className="pill st-af">{Icon.check(14)} {f.t('Подтверждено')}</span>
  if (v === 'false_alarm') return <span className="pill st-wait">{Icon.x(14)} {f.t('Ложная тревога')}</span>
  return <span className="pill st-new">{f.t('Не просмотрено')}</span>
}

function EpisodesTab({ rep, pid, onEcg, reload }: { rep: Report; pid: number; onEcg: (id: number) => void; reload: () => void }) {
  const f = useFmt()
  async function review(start: string, verdict: string) {
    await post(`/api/patients/${pid}/episodes/review`, { episode_start: start, verdict })
    reload(); emitRefresh()
  }
  if (!rep.episodes.length) return <Empty>{f.t('Эпизодов нет.')}</Empty>
  return (
    <div className="card table">
      <div className="tr th ep"><span>{f.t('Начало')}</span><span>{f.t('Длительность')}</span><span>{f.t('Пульс')}</span>
        <span>{f.t('Уверенность')}</span><span>{f.t('ЭКГ')}</span><span>{f.t('Решение врача')}</span><span /></div>
      {rep.episodes.map(e => (
        <div key={e.start} className="tr ep">
          <span><b>{f.dt(e.start)}</b></span>
          <span>{f.dur(e.duration_s)}</span>
          <span className="num">{e.mean_bpm ? Math.round(e.mean_bpm) : '—'}</span>
          <span className="num">{f.pct(e.max_prob)}</span>
          <span>{e.ecg_id ? <button className="btn tiny" onClick={() => onEcg(e.ecg_id!)}>{Icon.pulse(14)} {f.t('ЭКГ')}</button> : <span className="muted">—</span>}</span>
          <span><Verdict v={e.verdict} /></span>
          <span className="ep-act">
            <button className={`btn tiny ${e.verdict === 'confirmed' ? 'on-af' : ''}`} onClick={() => review(e.start, e.verdict === 'confirmed' ? 'clear' : 'confirmed')} title={f.t('Подтвердить ФП')}>{Icon.check(14)}</button>
            <button className={`btn tiny ${e.verdict === 'false_alarm' ? 'on' : ''}`} onClick={() => review(e.start, e.verdict === 'false_alarm' ? 'clear' : 'false_alarm')} title={f.t('Ложная тревога')}>{Icon.x(14)}</button>
          </span>
        </div>
      ))}
    </div>
  )
}

function EcgTab({ rep, onEcg }: { rep: Report; onEcg: (id: number) => void }) {
  const f = useFmt()
  const [cache, setCache] = useState<Record<number, Strip>>({})
  useEffect(() => {
    rep.ecg.slice(0, 12).forEach(e => {
      if (!cache[e.id]) api<Strip>(`/api/ecg/${e.id}`).then(s => setCache(c => ({ ...c, [e.id]: s }))).catch(() => undefined)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rep.ecg])
  if (!rep.ecg.length) return <Empty>{f.t('Записей нет.')}</Empty>
  const reason = (r: string) => r === 'afib_onset' ? f.t('автозапись при ФП') : r === 'symptom' ? f.t('при симптомах') : f.t('записано пациентом')
  return (
    <div className="ecg-grid">
      {rep.ecg.map(e => (
        <button key={e.id} className={`card ecg-card ${e.state === 2 ? 'af' : ''}`} onClick={() => onEcg(e.id)}>
          <div className="ecg-card-head"><StatePill state={e.state} /><span className="muted">{f.dt(e.ts)}</span></div>
          <div className="ecg-card-thumb">{cache[e.id] ? <EcgThumb samples={cache[e.id].samples} w={300} h={56} color={e.state === 2 ? 'var(--af)' : 'var(--accent)'} /> : <span className="skeleton" />}</div>
          <div className="ecg-card-foot"><span>{reason(e.reason)}</span><span className="num">{e.duration_s} {f.lang === 'en' ? 's' : 'с'} · {Math.round(e.bpm)} {f.t('уд/мин')}</span></div>
        </button>
      ))}
    </div>
  )
}

function EcgModal({ id, onClose }: { id: number; onClose: () => void }) {
  const f = useFmt()
  const [s, setS] = useState<Strip | null>(null)
  const [zoom, setZoom] = useState(4)
  useEffect(() => { api<Strip>(`/api/ecg/${id}`).then(setS).catch(() => undefined) }, [id])
  const st = s ? rrStats(s.samples, s.fs) : null
  return (
    <Modal onClose={onClose} wide>
      {!s ? <div className="skeleton tall" /> : (
        <>
          <div className="modal-head">
            <div><h2>{f.t('ЭКГ')} · {f.dt(s.ts)}</h2>
              <p className="muted">{f.lang === 'en' ? `25 mm/s · 10 mm/mV · ${s.fs} Hz · ${s.duration_s} s` : `25 мм/с · 10 мм/мВ · ${s.fs} Гц · ${s.duration_s} с`}</p></div>
            <StatePill state={s.state} />
          </div>
          <div className="ecg-metrics">
            <div><span>{f.t('Пульс')}</span><b>{st ? Math.round(st.hr) : '—'}</b></div>
            <div><span>RR CV</span><b className={st && st.cv > 0.12 ? 'af-t' : ''}>{st ? `${(st.cv * 100).toFixed(0)}%` : '—'}</b></div>
            <div><span>{f.t('Уверенность')}</span><b>{f.pct(s.prob)}</b></div>
            <div><span>{f.lang === 'en' ? 'Beats' : 'Удары'}</span><b>{st?.beats ?? '—'}</b></div>
            <Seg value={zoom} onChange={setZoom} items={[[3, '×0.75'], [4, '×1'], [6, '×1.5']]} />
          </div>
          <EcgStrip samples={s.samples} fs={s.fs} pxPerMm={zoom} color={s.state === 2 ? 'var(--af-ink)' : undefined} />
          <p className="fine">RR, ms — {f.lang === 'en' ? 'intervals between beats are printed under the trace. Irregular RR without P waves is the hallmark of AF.' : 'интервалы между ударами подписаны под кривой. Нерегулярные RR без зубцов P — главный признак ФП.'}</p>
        </>
      )}
    </Modal>
  )
}

function SymptomsTab({ rep }: { rep: Report }) {
  const f = useFmt()
  if (!rep.symptoms.length) return <Empty>{f.t('Симптомов нет.')}</Empty>
  const sev = ['', f.t('лёгкие'), f.t('умеренные'), f.t('сильные')]
  return (
    <div className="card">
      <div className="timeline">
        {rep.symptoms.map(s => {
          const near = rep.episodes.find(e => Math.abs(new Date(e.start).getTime() - new Date(s.ts).getTime()) < 3600e3)
          return (
            <div key={s.id} className={`tl sym sev${s.severity}`}>
              <span className="tl-dot" /><span className="tl-time">{f.dt(s.ts)}</span>
              <span className="chips">{s.kinds.map(k => <span key={k} className="chip">{f.t(SYMPTOM_LABEL[k] ?? k)}</span>)}</span>
              <span className="muted">{sev[s.severity]}{s.note ? ` — «${s.note}»` : ''}</span>
              {near && <span className="pill st-af">± 1h ФП</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NotesTab({ rep, pid, reload }: { rep: Report; pid: number; reload: () => void }) {
  const f = useFmt()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  async function add() {
    if (!text.trim()) return
    setBusy(true)
    try { await post(`/api/patients/${pid}/notes`, { text }); setText(''); reload() } finally { setBusy(false) }
  }
  return (
    <div className="grid-notes">
      <div className="card">
        <h2>{f.t('Добавить заметку')}</h2>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
          placeholder={f.lang === 'en' ? 'Diagnosis, plan, next visit…' : 'Диагноз, назначения, следующий визит…'}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add() }} />
        <button className="btn primary" onClick={add} disabled={busy || !text.trim()}>{f.t('Сохранить')} <kbd>⌘↵</kbd></button>
      </div>
      <div className="card">
        {!rep.notes?.length ? <Empty>{f.t('Заметок нет.')}</Empty> : rep.notes.map(n => (
          <article key={n.id} className="note">
            <header><b>{n.author}</b><span className="muted">{f.dt(n.ts)}</span>
              <button className="icon-btn sm" title={f.t('Удалить')} onClick={async () => { await del(`/api/patients/${pid}/notes/${n.id}`); reload() }}>{Icon.x(14)}</button></header>
            <p>{n.text}</p>
          </article>
        ))}
      </div>
    </div>
  )
}
