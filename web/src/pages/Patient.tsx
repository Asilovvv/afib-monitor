import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, del, emitRefresh, post, put, type CheckPlan, type EcgStrip as Strip, type Report, type Risk } from '../api'
import { Poincare } from '../components/Poincare'
import { EcgStrip, EcgThumb, rrStats } from '../components/Ecg'
import { Avatar, BatteryBadge, Empty, Icon, Modal, Seg, StatePill, SYMPTOM_LABEL, Tabs, useFmt } from '../components/ui'
import { useLive } from './Overview'

type Tab = 'overview' | 'episodes' | 'ecg' | 'analysis' | 'symptoms' | 'notes'

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
          {p.mode === 'wellness' && <span className="tag-research" title={f.tr('Пациент видит только проверку ритма без диагноза: нет согласия на исследование текущей версии.', 'The patient sees only a rhythm check without a diagnosis: no consent to the current study text.', 'Бейтап диагнозсуз текшерүүнү гана көрөт: изилдөөнүн учурдагы текстине макулдук жок.')}>
            {f.tr('не участник исследования', 'not in the study', 'изилдөөгө катышпайт')}</span>}
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
        ['ecg', f.t('ЭКГ'), rep.ecg.length], ['analysis', f.t('Анализ')], ['symptoms', f.t('Симптомы'), rep.symptoms.length], ['notes', f.t('Заметки'), rep.notes?.length],
      ]} />

      {tab === 'overview' && <><CheckPlanCard rep={rep} pid={Number(id)} /><OverviewTab rep={rep} hours={hours} onEcg={setEcgId} /></>}
      {tab === 'episodes' && <EpisodesTab rep={rep} pid={Number(id)} onEcg={setEcgId} reload={reload} />}
      {tab === 'ecg' && <EcgTab rep={rep} onEcg={setEcgId} />}
      {tab === 'analysis' && <AnalysisTab rep={rep} pid={Number(id)} />}
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
  const tickFmt = (v: number) => hours <= 24 ? f.time(new Date(v).toISOString()) : new Date(v).toLocaleDateString(f.loc, { day: 'numeric', month: 'short' })
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

      {!!rep.hr_events?.length && (
        <section className="card hr-events">
          <div className="card-head"><h2>{f.tr('Пульс вне обычных границ', 'Heart rate outside usual limits', 'Пульс адаттагы чектен тышкары')}</h2>
            <span className="muted">{f.tr('< 40 или > 150 уд/мин дольше минуты · не диагноз', '< 40 or > 150 bpm for over a minute · not a diagnosis', '1 мүнөттөн ашык < 40 же > 150 · диагноз эмес')}</span></div>
          <ul className="hr-list">
            {rep.hr_events.slice(-8).reverse().map(e => (
              <li key={e.start} className={e.kind}>
                <b>{e.kind === 'low' ? f.tr('Редкий пульс', 'Slow heart rate', 'Сейрек пульс') : f.tr('Частый пульс', 'Fast heart rate', 'Тез пульс')} · {e.bpm} {f.t('уд/мин')}</b>
                <span>{f.dt(e.start)} · {f.dur(e.duration_s)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
  const reason = (r: string) => r === 'afib_onset' ? f.t('автозапись при ФП') : r === 'symptom' ? f.t('при симптомах') : r === 'check' ? f.tr('проверка 30 с', '30-s check', '30 с текшерүү') : f.t('записано пациентом')
  return (
    <div className="ecg-grid">
      {rep.ecg.map(e => (
        <button key={e.id} className={`card ecg-card ${e.state === 2 ? 'af' : ''}`} onClick={() => onEcg(e.id)}>
          <div className="ecg-card-head"><StatePill state={e.state} /><span className="muted">{f.dt(e.ts)}</span></div>
          <div className="ecg-card-thumb">{cache[e.id] ? <EcgThumb samples={cache[e.id].samples} w={300} h={56} color={e.state === 2 ? 'var(--af)' : 'var(--accent)'} /> : <span className="skeleton" />}</div>
          <div className="ecg-card-foot"><span>{reason(e.reason)}</span><span className="num">{e.duration_s} {f.tr('с', 's', 'сек')} · {Math.round(e.bpm)} {f.t('уд/мин')}</span></div>
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
              <p className="muted">{f.tr(`25 мм/с · 10 мм/мВ · ${s.fs} Гц · ${s.duration_s} с`, `25 mm/s · 10 mm/mV · ${s.fs} Hz · ${s.duration_s} s`, `25 мм/сек · 10 мм/мВ · ${s.fs} Гц · ${s.duration_s} сек`)}</p></div>
            <StatePill state={s.state} />
          </div>
          <div className="ecg-metrics">
            <div><span>{f.t('Пульс')}</span><b>{st ? Math.round(st.hr) : '—'}</b></div>
            <div><span>RR CV</span><b className={st && st.cv > 0.12 ? 'af-t' : ''}>{st ? `${(st.cv * 100).toFixed(0)}%` : '—'}</b></div>
            <div><span>{f.t('Уверенность')}</span><b>{f.pct(s.prob)}</b></div>
            <div><span>{f.tr('Удары', 'Beats', 'Согуулар')}</span><b>{st?.beats ?? '—'}</b></div>
            <Seg value={zoom} onChange={setZoom} items={[[3, '×0.75'], [4, '×1'], [6, '×1.5']]} />
          </div>
          <EcgStrip samples={s.samples} fs={s.fs} pxPerMm={zoom} color={s.state === 2 ? 'var(--af-ink)' : undefined} />
          <div className="ecg-extra">
            <Poincare size={220} data={{ af: s.state === 2 ? s.poincare.points : [], normal: s.state === 2 ? [] : s.poincare.points }} />
            <div className="ecg-extra-txt">
              <QualityBadge q={s.quality} />
              <p><b>SD1</b> {s.poincare.sd1 ?? '—'} ms · <b>SD2</b> {s.poincare.sd2 ?? '—'} ms · <b>SD1/SD2</b> {s.poincare.ratio ?? '—'}</p>
              <p className="muted">{f.tr('Нерегулярность RR', 'RR irregularity', 'RR туруксуздугу')}: <b className={s.irregularity && s.irregularity > 0.1 ? 'af-t' : ''}>{s.irregularity ?? '—'}</b> {f.tr('(> 0,10 — типично для ФП)', '(> 0.10 is typical for AF)', '(> 0,10 — ФП үчүн мүнөздүү)')}</p>
              {s.pvc_estimate && <p className="muted"><span className="tag-research">{f.tr('исследование', 'research', 'изилдөө')}</span>{' '}
                {f.tr('Ранние желудочковые удары (оценка)', 'Early ventricular beats (estimate)', 'Эрте карынча согуулары (баалоо)')}: <b>{s.pvc_estimate.pvc}</b> {f.tr('из', 'of', '/')} {s.pvc_estimate.beats}
                {s.pvc_estimate.pvc > 0 && <> · {s.pvc_estimate.pvc_at_s.slice(0, 6).map(t => `${t} ${f.t('с')}`).join(', ')}</>}
                <br /><span className="fine">{f.tr('Модель проверена на 22 людях MIT-BIH (DS2); не диагноз, сверьте с кривой.', 'Model tested on 22 people of MIT-BIH (DS2); not a diagnosis, check against the trace.', 'Модель MIT-BIH 22 адамда текшерилген (DS2); диагноз эмес, ийри сызык менен салыштырыңыз.')}</span></p>}
            </div>
          </div>
          <p className="fine">RR, ms — {f.tr('интервалы между ударами подписаны под кривой. Нерегулярные RR без зубцов P — главный признак ФП.', 'intervals between beats are printed under the trace. Irregular RR without P waves is the hallmark of AF.', 'согуулардын ортосундагы аралыктар ийри сызыктын астында жазылган. P тиштери жок туруксуз RR — ФПнын негизги белгиси.')}</p>
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
          placeholder={f.tr('Диагноз, назначения, следующий визит…', 'Diagnosis, plan, next visit…', 'Диагноз, дайындоолор, кийинки келүү…')}
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

export function QualityBadge({ q }: { q: { sqi: number; level: 'good' | 'fair' | 'poor' } }) {
  const f = useFmt()
  const lbl = { good: f.t('хорошее'), fair: f.t('среднее'), poor: f.t('плохое') }[q.level]
  return <span className={`pill q-${q.level}`}>{f.t('Качество сигнала')}: {lbl} · {Math.round(q.sqi * 100)}%</span>
}

function AnalysisTab({ rep, pid }: { rep: Report; pid: number }) {
  const f = useFmt()
  const pc = rep.poincare
  const st = (x: { sd1: number | null; sd2: number | null; ratio: number | null }) =>
    x.sd1 == null ? '—' : `${x.sd1} / ${x.sd2} ms · ${x.ratio}`
  return (
    <div className="grid-2 analysis">
      <section className="card">
        <div className="card-head"><h2>{Icon.scatter(18)} {f.t('График Пуанкаре')}</h2>
          <span className="legend"><i className="lg-ok" /> {f.t('Норма')} <i className="lg-af" /> {f.t('Фибрилляция')}</span></div>
        {pc.strips === 0 ? <Empty>{f.t('Нет ЭКГ-записей за период.')}</Empty> : <>
          <Poincare data={pc} />
          <table className="pc-table"><tbody>
            <tr><th /><th>SD1 / SD2 · SD1/SD2</th><th>{f.tr('точек', 'points', 'чекит')}</th></tr>
            <tr><td><i className="lg-ok" /> {f.t('Норма')}</td><td>{st(pc.normal_stats)}</td><td>{pc.normal.length}</td></tr>
            <tr><td><i className="lg-af" /> {f.t('Фибрилляция')}</td><td>{st(pc.af_stats)}</td><td>{pc.af.length}</td></tr>
          </tbody></table>
          <p className="fine">{f.tr(
            `Каждая точка — пара соседних интервалов между ударами (RRₙ, RRₙ₊₁) из ${pc.strips} ЭКГ-записей. При синусовом ритме точки лежат узкой «кометой» вдоль диагонали, при ФП — широким облаком: это и видит нейросеть. Средний индекс качества сигнала: ${pc.mean_sqi != null ? Math.round(pc.mean_sqi * 100) + '%' : '—'}.`,
            `Each dot is a pair of neighbouring beat intervals (RRₙ, RRₙ₊₁) from ${pc.strips} ECG strips. Sinus rhythm forms a narrow comet along the diagonal, AF a wide cloud — this is what the network sees. Mean signal quality: ${pc.mean_sqi != null ? Math.round(pc.mean_sqi * 100) + '%' : '—'}.`,
            `Ар бир чекит — ${pc.strips} ЭКГ жазуусунан алынган коңшу согуу аралыктарынын жуптары (RRₙ, RRₙ₊₁). Синус ритминде чекиттер диагонал боюнча тар «комета» түзөт, ФПда — кең булут. Сигналдын орточо сапаты: ${pc.mean_sqi != null ? Math.round(pc.mean_sqi * 100) + '%' : '—'}.`)}</p>
        </>}
      </section>
      <RiskCard pid={pid} />
    </div>
  )
}

const PLAN_PRESETS: [string, string[]][] = [['2', ['09:00', '21:00']], ['3', ['08:00', '14:00', '20:00']]]

/** "Control" mode: 30-s checks on a schedule. Notebook 15 (ml/WEAR_MODES.md): 2-3 checks a day found AF on 98-100 %
 *  of days when AF burden was >= 50 %, but only 2-7 % when it was < 5 % -- searching for rare episodes needs continuous wear. */
function CheckPlanCard({ rep, pid }: { rep: Report; pid: number }) {
  const f = useFmt()
  const ch = rep.checks
  const [plan, setPlan] = useState<CheckPlan | null>(ch?.plan ?? null)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  async function save(times: string[]) {
    setSaving(true)
    try { setPlan(await put<CheckPlan>(`/api/patients/${pid}/checkplan`, { times })); emitRefresh() } finally { setSaving(false) }
  }
  const active = plan?.active ? plan.times : []
  const V: Record<string, [string, string]> = {
    regular: ['ok', f.tr('ровный', 'regular', 'бирдей')], irregular: ['af', f.tr('неровный', 'irregular', 'бирдей эмес')],
    no_verdict: ['muted', f.tr('не прочитано', 'unreadable', 'окулган жок')] }
  return (
    <section className="card">
      <div className="card-head"><h2>{Icon.pulse(18)} {f.tr('Проверки 30 с по расписанию', 'Scheduled 30-s checks', 'Графиги менен 30 с текшерүү')}</h2>{saving && <span className="muted">…</span>}</div>
      <p className="muted">{active.length
        ? <>{f.tr('План', 'Plan', 'План')}: <b>{active.join(', ')}</b> · {plan?.set_by === 'doctor' ? f.tr('назначил врач', 'set by the doctor', 'дарыгер белгиледи') : f.tr('выбрал пациент', 'set by the patient', 'бейтап тандады')}</>
        : f.tr('Плана нет', 'No plan', 'План жок')}</p>
      <div className="row-btns">
        {PLAN_PRESETS.map(([n, t]) => <button key={n} className={`btn ${active.join() === t.join() ? '' : 'ghost'}`} onClick={() => save(t)}>{f.tr(`${n} раза в день`, `${n} a day`, `күнүнө ${n} жолу`)}</button>)}
        <input className="plan-in" placeholder="07:30, 19:30" value={custom} onChange={e => setCustom(e.target.value)} />
        <button className="btn ghost" disabled={!/^\s*([01]\d|2[0-3]):[0-5]\d(\s*,\s*([01]\d|2[0-3]):[0-5]\d)*\s*$/.test(custom)}
          onClick={() => save(custom.split(',').map(x => x.trim()))}>{f.tr('Задать', 'Set', 'Коюу')}</button>
        {active.length > 0 && <button className="btn ghost" onClick={() => save([])}>{f.tr('Отменить', 'Turn off', 'Өчүрүү')}</button>}
      </div>
      {ch && ch.checks + ch.due > 0 && <table className="pc-table"><tbody>
        <tr><td>{f.tr('Сделано по плану', 'Done as planned', 'План боюнча жасалды')}</td><td><b>{ch.done}</b> / {ch.due}{ch.adherence != null ? ` (${f.pct(ch.adherence)})` : ''}</td></tr>
        <tr><td>{f.tr('Всего проверок', 'All checks', 'Бардык текшерүүлөр')}</td><td>{ch.checks}: {ch.regular} {V.regular[1]}, {ch.irregular} {V.irregular[1]}, {ch.no_verdict} {V.no_verdict[1]}</td></tr>
        <tr><td>{f.tr('Неровный дважды подряд', 'Irregular twice in a row', 'Катары менен эки жолу бирдей эмес')}</td><td><b className={ch.confirmed_irregular ? 'r-af' : ''}>{ch.confirmed_irregular}</b></td></tr>
        {ch.last.map(x => <tr key={x.ts}><td>{f.dt(x.ts)}</td><td className={V[x.verdict][0]}>{V[x.verdict][1]}</td></tr>)}
      </tbody></table>}
      <p className="fine">{f.tr(
        'Режим для контроля уже известной ФП. На записях LTAFDB 2–3 проверки в день находили ФП в 98–100 % дней при нагрузке ≥ 50 %, но лишь в 2–7 % при нагрузке < 5 %. Для поиска редких эпизодов нужен постоянный режим.',
        'For monitoring known AF. On LTAFDB, 2–3 checks a day found AF on 98–100 % of days at burden ≥ 50 %, but on only 2–7 % at burden < 5 %. Searching for rare episodes needs continuous wear.',
        'Белгилүү ФПны көзөмөлдөө үчүн. LTAFDB жазууларында күнүнө 2–3 текшерүү жүк ≥ 50 % болгондо күндөрдүн 98–100 %ында ФПны тапты, бирок жүк < 5 % болгондо 2–7 % гана. Сейрек эпизоддорду издөө үчүн дайыма тагынуу керек.')}</p>
    </section>
  )
}

function RiskCard({ pid }: { pid: number }) {
  const f = useFmt()
  const [r, setR] = useState<Risk | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => { api<Risk>(`/api/patients/${pid}/risk`).then(setR).catch(() => undefined) }, [pid])
  if (!r) return <section className="card"><div className="skeleton tall" /></section>
  async function toggle(key: string) {
    if (!r) return
    const flags = Object.fromEntries(r.items.filter(i => !i.auto).map(i => [i.key, i.key === key ? !i.on : i.on]))
    setSaving(true)
    try { setR(await put<Risk>(`/api/patients/${pid}/risk`, flags)) } finally { setSaving(false) }
  }
  async function setAuto(body: { birth_year?: number; sex?: string }) {
    if (!r) return
    const flags = Object.fromEntries(r.items.filter(i => !i.auto).map(i => [i.key, i.on]))
    setR(await put<Risk>(`/api/patients/${pid}/risk`, { ...flags, ...body }))
  }
  const LBL: Record<string, [string, string]> = {
    chf: ['Heart failure / LV dysfunction', 'Жүрөк жетишсиздиги / СҚ дисфункциясы'],
    hypertension: ['Hypertension', 'Артериялык гипертензия'], age75: ['Age ≥ 75', 'Жашы ≥ 75'],
    diabetes: ['Diabetes', 'Кант диабети'], stroke: ['Prior stroke / TIA / thromboembolism', 'Инсульт / ТИА / тромбоэмболия болгон'],
    vascular: ['Vascular disease (MI, PAD, aortic plaque)', 'Кан тамыр оорусу (МИ, ПАО, аорта бляшкасы)'],
    age65: ['Age 65–74', 'Жашы 65–74'], female: ['Female sex', 'Аял жынысы'],
  }
  return (
    <section className={`card risk lvl-${r.level}`}>
      <div className="card-head"><h2>{Icon.shield(18)} {f.t('Риск инсульта')} · CHA₂DS₂-VASc</h2>{saving && <span className="muted">…</span>}</div>
      <div className="risk-score">
        <div><b>{r.cha2ds2_vasc}</b><span>CHA₂DS₂-VASc</span></div>
        <div><b>{r.cha2ds2_va}</b><span>CHA₂DS₂-VA (ESC 2024)</span></div>
        <div><b>{r.annual_stroke_risk_pct != null ? `${String(r.annual_stroke_risk_pct).replace('.', f.lang === 'en' ? '.' : ',')}%` : '—'}</b><span>{f.t('Годовой риск инсульта без антикоагулянтов')}</span></div>
      </div>
      {/* the score is reference information; the treatment decision is the doctor's (a recommendation here would be a
          clinical decision-support claim the software is not registered for) */}
      <p className={`risk-rec`}>{f.tr('Шкала справочно. Решение об антикоагулянтах принимает врач по клиническим рекомендациям.',
        'Reference only. The anticoagulation decision is the doctor\'s, following clinical guidelines.',
        'Шкала маалымат үчүн. Антикоагулянттар боюнча чечимди дарыгер клиникалык сунуштар боюнча кабыл алат.')}</p>
      <ul className="risk-items">
        {r.items.map(i => (
          <li key={i.key} className={i.on ? 'on' : ''}>
            <label>
              <input type="checkbox" checked={i.on} disabled={i.auto} onChange={() => toggle(i.key)} />
              <span>{f.lang === 'en' ? LBL[i.key][0] : f.lang === 'ky' ? LBL[i.key][1] : i.label}</span>
              <b>+{i.points}</b>
            </label>
          </li>
        ))}
      </ul>
      <div className="risk-auto">
        <label>{f.tr('Год рождения', 'Birth year', 'Туулган жылы')}
          <input type="number" defaultValue={r.age != null ? new Date().getFullYear() - r.age : ''} min={1900} max={2030}
            onBlur={e => e.target.value && setAuto({ birth_year: Number(e.target.value) })} /></label>
        <Seg value={r.sex ?? ''} onChange={v => v && setAuto({ sex: v })} items={[['m', f.tr('Муж.', 'Male', 'Эркек')], ['f', f.tr('Жен.', 'Female', 'Аял')]]} />
      </div>
      <p className="fine">{f.tr(
        'Возраст и пол берутся из профиля. Годовой риск — Friberg et al., 2012. Поддержка решения: назначение терапии — решение врача с учётом риска кровотечения (HAS-BLED).',
        'Age and sex come from the profile. Annual risk: Friberg et al., 2012. Decision support only — weigh bleeding risk (HAS-BLED).',
        'Жашы жана жынысы профилден алынат. Жылдык коркунуч: Friberg et al., 2012. Чечимди дарыгер кан агуу коркунучун (HAS-BLED) эске алып кабыл алат.')}</p>
    </section>
  )
}
