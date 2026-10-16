import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from 'recharts'
import type { Report as Rep, User } from '../api'
import { Icon, STATE, SYMPTOM_LABEL, useFmt } from '../components/ui'
import { useLive } from './Overview'

export default function Report({ me }: { me: User }) {
  const { id } = useParams()
  const [sp] = useSearchParams()
  const hours = Number(sp.get('hours') ?? 168)
  const f = useFmt()
  const [rep] = useLive<Rep>(`/api/patients/${id}/report?hours=${hours}`)
  if (!rep) return <div className="page"><div className="skeleton tall" /></div>
  const p = rep.patient, s = rep.stats
  const data = rep.series.map(x => ({ ...x, ts: new Date(x.t).getTime() }))
  const dom = [new Date(rep.range.from).getTime(), new Date(rep.range.to).getTime()]
  return (
    <div className="report-wrap">
      <div className="report-tools no-print">
        <Link to={`/app/patients/${id}`} className="btn ghost">{Icon.back()} {f.t('Назад')}</Link>
        <button className="btn primary" onClick={() => window.print()}>{Icon.print()} {f.t('Печать / PDF')}</button>
      </div>
      <article className="report">
        <header>
          <div className="r-brand">{Icon.pulse(22)} AFib<b>Monitor</b></div>
          <div className="r-meta">{f.t('Сформирован')}: {f.dt(new Date().toISOString())}</div>
        </header>
        <h1>{f.t('Отчёт пациента')}</h1>
        <table className="r-id"><tbody>
          <tr><th>{f.t('Пациент')}</th><td>{p.name}</td><th>{f.t('Период')}</th><td>{f.dt(rep.range.from)} — {f.dt(rep.range.to)}</td></tr>
          <tr><th>{f.lang === 'en' ? 'Age' : 'Возраст'}</th><td>{f.age(p.birth_year)}</td><th>{f.t('Врач')}</th><td>{me.name}{me.clinic ? `, ${me.clinic}` : ''}</td></tr>
        </tbody></table>
        <div className="r-stats">
          {[[f.t('Нагрузка ФП'), f.pct(s.af_burden)], [f.t('Эпизоды'), String(s.episodes_count)], [f.t('Подтверждённые'), String(s.confirmed_episodes)],
            [f.t('Ложные'), String(s.false_alarms)], [f.t('Пульс'), s.hr_mean ? `${Math.round(s.hr_mean)} (${Math.round(s.hr_min!)}–${Math.round(s.hr_max!)})` : '—'],
            [f.t('Мониторинг'), f.dur(s.monitored_minutes * 60)]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>
        <h2>{f.t('Пульс и эпизоды фибрилляции')}</h2>
        <LineChart width={720} height={220} data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="#ddd" vertical={false} />
          <XAxis dataKey="ts" type="number" domain={dom} scale="time" tickFormatter={v => new Date(v).toLocaleDateString(f.lang === 'en' ? 'en-GB' : 'ru-RU', { day: 'numeric', month: 'short' })} fontSize={10} />
          <YAxis domain={[40, 170]} fontSize={10} />
          {rep.episodes.map(e => <ReferenceArea key={e.start} x1={new Date(e.start).getTime()} x2={new Date(e.end).getTime() + 60e3} fill="#d33" fillOpacity={0.2} strokeOpacity={0} />)}
          <Line dataKey="bpm" stroke="#1d4ed8" dot={false} strokeWidth={1} isAnimationActive={false} />
        </LineChart>
        <h2>{f.t('Эпизоды')} ({rep.episodes.length})</h2>
        <table className="r-table"><thead><tr><th>{f.t('Начало')}</th><th>{f.t('Длительность')}</th><th>{f.t('Пульс')}</th><th>{f.t('Уверенность')}</th><th>{f.t('Решение врача')}</th></tr></thead>
          <tbody>{rep.episodes.map(e => <tr key={e.start}><td>{f.dt(e.start)}</td><td>{f.dur(e.duration_s)}</td><td>{e.mean_bpm ? Math.round(e.mean_bpm) : '—'}</td><td>{f.pct(e.max_prob)}</td>
            <td>{e.verdict === 'confirmed' ? f.t('Подтверждено') : e.verdict === 'false_alarm' ? f.t('Ложная тревога') : '—'}</td></tr>)}</tbody></table>
        {rep.symptoms.length > 0 && <>
          <h2>{f.t('Симптомы')}</h2>
          <table className="r-table"><tbody>{rep.symptoms.map(x => <tr key={x.id}><td>{f.dt(x.ts)}</td><td>{x.kinds.map(k => f.t(SYMPTOM_LABEL[k] ?? k)).join(', ')}</td><td>{x.note ?? ''}</td></tr>)}</tbody></table>
        </>}
        {(rep.notes?.length ?? 0) > 0 && <>
          <h2>{f.t('Заметки')}</h2>
          {rep.notes!.map(n => <p key={n.id} className="r-note"><b>{f.dt(n.ts)}</b> — {n.text}</p>)}
        </>}
        <footer>{f.t('Не является медицинским изделием.')} {f.lang === 'en' ? 'Last state' : 'Последнее состояние'}: {rep.last ? f.t(STATE[rep.last.state].label) : '—'}</footer>
      </article>
    </div>
  )
}
