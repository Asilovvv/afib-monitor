import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from 'recharts'
import type { Report as Rep, User } from '../api'
import { Icon, STATE, SYMPTOM_LABEL, useFmt } from '../components/ui'
import { useLive } from './Overview'

type F = ReturnType<typeof useFmt>

export const FACTOR: Record<string, [string, string, string]> = {
  alcohol: ['Алкоголь', 'Alcohol', 'Алкоголь'],
  caffeine: ['Кофе, крепкий чай', 'Coffee, strong tea', 'Кофе, коюу чай'],
  poor_sleep: ['Плохой сон', 'Poor sleep', 'Начар уйку'],
  stress: ['Стресс', 'Stress', 'Стресс'],
  exercise: ['Нагрузка, спорт', 'Exercise', 'Көнүгүү, спорт'],
  missed_meds: ['Пропуск лекарств', 'Missed medication', 'Дары ичилбей калды'],
  heavy_meal: ['Обильная еда', 'Heavy meal', 'Оор тамак'],
}
export const factorLabel = (f: F, k: string) => (FACTOR[k] ? f.tr(...FACTOR[k]) : k)

/** One A4 page a cardiologist can read in a minute: what happened, when, with what symptoms and habits. */
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
  const days = rep.hourly.map(h => ({ ts: new Date(h.t).getTime(), af: h.af_min, ok: Math.max(0, h.monitored_min - h.af_min) }))
  const wear = s.monitored_minutes / (hours * 60)
  const eps = [...rep.episodes].sort((a, b) => b.duration_s - a.duration_s)
  const inAf = (ts: string) => {
    const t = new Date(ts).getTime()
    return rep.episodes.some(e => new Date(e.start).getTime() - 5 * 60e3 <= t && t <= new Date(e.end).getTime() + 5 * 60e3)
  }
  const symAf = rep.symptoms.filter(x => inAf(x.ts)).length
  const hrLow = rep.hr_events?.filter(e => e.kind === 'low') ?? [], hrHigh = rep.hr_events?.filter(e => e.kind === 'high') ?? []
  const tr = rep.triggers
  const day = (iso: string) => new Date(iso).toLocaleDateString(f.loc, { day: 'numeric', month: 'short', year: 'numeric' })
  const tick = (v: number) => new Date(v).toLocaleDateString(f.loc, { day: 'numeric', month: 'short' })

  return (
    <div className="report-wrap">
      <div className="report-tools no-print">
        <Link to={`/app/patients/${id}`} className="btn ghost">{Icon.back()} {f.t('Назад')}</Link>
        <div className="row-gap">
          {[24, 168, 720].map(h => <Link key={h} to={`?hours=${h}`} className={`btn ${h === hours ? 'primary' : 'ghost'}`}>
            {h === 24 ? f.tr('Сутки', 'Day', 'Сутка') : h === 168 ? f.tr('Неделя', 'Week', 'Жума') : f.tr('Месяц', 'Month', 'Ай')}</Link>)}
          <button className="btn primary" onClick={() => window.print()}>{Icon.print()} {f.t('Печать / PDF')}</button>
        </div>
      </div>
      <article className="report one-page">
        <header>
          <div className="r-brand">{Icon.pulse(20)} AFib<b>Monitor</b></div>
          <div className="r-meta">{f.t('Сформирован')}: {f.dt(new Date().toISOString())}</div>
        </header>
        <table className="r-id"><tbody>
          <tr><th>{f.t('Пациент')}</th><td><b>{p.name}</b>{p.birth_year ? `, ${f.age(p.birth_year)}` : ''}</td>
            <th>{f.t('Период')}</th><td>{day(rep.range.from)} — {day(rep.range.to)}</td></tr>
          <tr><th>{f.t('Врач')}</th><td>{me.name}{me.clinic ? `, ${me.clinic}` : ''}</td>
            <th>{f.tr('Ношение', 'Worn', 'Тагынган')}</th><td>{f.dur(s.monitored_minutes * 60)} ({f.pct(Math.min(1, wear))} {f.tr('времени', 'of the time', 'убакыттын')})</td></tr>
        </tbody></table>

        <div className="r-stats">
          {[[f.t('Нагрузка ФП'), f.pct(s.af_burden)], [f.t('Эпизоды'), `${s.episodes_count}`],
            [f.tr('Самый долгий', 'Longest', 'Эң узун'), s.longest_episode_s ? f.dur(s.longest_episode_s) : '—'],
            [f.t('Пульс'), s.hr_mean ? `${Math.round(s.hr_mean)} (${Math.round(s.hr_min!)}–${Math.round(s.hr_max!)})` : '—'],
            [f.tr('Пульс <40 / >150', 'HR <40 / >150', 'Пульс <40 / >150'), `${hrLow.length} / ${hrHigh.length}`],
            [f.t('Симптомы'), rep.symptoms.length ? `${rep.symptoms.length} · ${symAf} ${f.tr('при ФП', 'in AF', 'ФПда')}` : '0']]
            .map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}
        </div>

        <div className="r-charts">
          <div>
            <h2>{hours <= 48 ? f.t('Минуты ФП по часам') : f.t('Минуты ФП по дням')}</h2>
            <BarChart width={340} height={130} data={days} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="ts" tickFormatter={hours <= 48 ? (v => new Date(v).getHours() + ':00') : tick} fontSize={9} minTickGap={8} />
              <YAxis fontSize={9} />
              <Bar dataKey="ok" stackId="a" fill="#cfe9dc" isAnimationActive={false} />
              <Bar dataKey="af" stackId="a" fill="#d33" isAnimationActive={false} />
            </BarChart>
          </div>
          <div>
            <h2>{f.tr('Пульс и эпизоды', 'Heart rate and episodes', 'Пульс жана эпизоддор')}</h2>
            <LineChart width={340} height={130} data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
              <CartesianGrid stroke="#eee" vertical={false} />
              <XAxis dataKey="ts" type="number" domain={dom} scale="time" tickFormatter={tick} fontSize={9} />
              <YAxis domain={[30, 170]} fontSize={9} />
              {rep.episodes.map(e => <ReferenceArea key={e.start} x1={new Date(e.start).getTime()} x2={new Date(e.end).getTime() + 60e3} fill="#d33" fillOpacity={0.25} strokeOpacity={0} />)}
              <Line dataKey="bpm" stroke="#1d4ed8" dot={false} strokeWidth={1} isAnimationActive={false} />
            </LineChart>
          </div>
        </div>

        <div className="r-cols">
          <section>
            <h2>{f.tr('Самые долгие эпизоды', 'Longest episodes', 'Эң узун эпизоддор')}</h2>
            {eps.length === 0 ? <p className="r-muted">{f.tr('Эпизодов нет', 'No episodes', 'Эпизод жок')}</p> :
              <table className="r-table"><tbody>{eps.slice(0, 6).map(e => <tr key={e.start}>
                <td>{f.dt(e.start)}</td><td>{f.dur(e.duration_s)}</td><td>{e.mean_bpm ? `${Math.round(e.mean_bpm)} ${f.t('уд/мин')}` : '—'}</td>
                <td>{e.verdict === 'confirmed' ? '✓' : e.verdict === 'false_alarm' ? f.tr('ложн.', 'false', 'жалган') : ''}</td></tr>)}</tbody></table>}
            {eps.length > 6 && <p className="r-muted">{f.tr(`и ещё ${eps.length - 6}`, `and ${eps.length - 6} more`, `дагы ${eps.length - 6}`)}</p>}
            {(rep.hr_events?.length ?? 0) > 0 && <>
              <h2>{f.tr('Пульс вне границ (> 1 мин)', 'Heart rate out of range (> 1 min)', 'Пульс чектен тышкары (> 1 мүн)')}</h2>
              <table className="r-table"><tbody>{rep.hr_events!.slice(-4).map(e => <tr key={e.start}>
                <td>{f.dt(e.start)}</td><td>{e.kind === 'low' ? '<40' : '>150'}: {e.bpm}</td><td>{f.dur(e.duration_s)}</td></tr>)}</tbody></table>
            </>}
          </section>
          <section>
            <h2>{f.tr('Образ жизни и ФП (дневник)', 'Lifestyle and AF (diary)', 'Жашоо образы жана ФП (күндөлүк)')}</h2>
            {!tr || tr.factors.length === 0 ? <p className="r-muted">{f.tr('Пациент не заполнял дневник за период.', 'No diary entries in this period.', 'Бул мезгилде күндөлүк толтурулган эмес.')}</p> :
              <table className="r-table"><thead><tr><th>{f.tr('Фактор', 'Factor', 'Фактор')}</th><th>{f.tr('Дней', 'Days', 'Күн')}</th>
                <th>{f.tr('Нагрузка ФП: с / без', 'AF burden: with / without', 'ФП жүгү: менен / жок')}</th></tr></thead>
                <tbody>{tr.factors.map(x => <tr key={x.tag}><td>{factorLabel(f, x.tag)}</td><td>{x.days_with} / {x.days_without}</td>
                  <td>{x.enough ? <><b>{f.pct(x.burden_with ?? 0)}</b> / {f.pct(x.burden_without ?? 0)}</> :
                    <span className="r-muted">{f.tr('мало дней', 'too few days', 'күн аз')}</span>}</td></tr>)}</tbody></table>}
            <p className="r-fine">{f.tr(
              `Сравниваются только дни, когда пациент заполнил дневник и носил датчик ≥ ${tr?.min_monitored_h ?? 4} ч (день и следующая ночь, 06:00–06:00). Нужно ≥ ${tr?.min_days ?? 3} дней с фактором и без. Это наблюдение по дневнику одного человека, а не доказательство причины.`,
              `Only days the patient filled in the diary and wore the sensor ≥ ${tr?.min_monitored_h ?? 4} h (day and following night, 06:00–06:00). Needs ≥ ${tr?.min_days ?? 3} days with and without. An observation from one person's diary, not proof of cause.`,
              `Бейтап күндөлүк толтурган жана датчикти ≥ ${tr?.min_monitored_h ?? 4} саат тагынган күндөр гана салыштырылат (06:00–06:00). Фактор менен жана жок ≥ ${tr?.min_days ?? 3} күн керек. Бул бир адамдын күндөлүгү боюнча байкоо, себептин далили эмес.`)}</p>
            {rep.symptoms.length > 0 && <>
              <h2>{f.t('Симптомы')}</h2>
              <table className="r-table"><tbody>{rep.symptoms.slice(0, 5).map(x => <tr key={x.id}><td>{f.dt(x.ts)}</td>
                <td>{x.kinds.map(k => f.t(SYMPTOM_LABEL[k] ?? k)).join(', ')}</td>
                <td>{inAf(x.ts) ? <b className="r-af">{f.tr('во время ФП', 'during AF', 'ФП учурунда')}</b> : f.tr('ритм ровный', 'regular rhythm', 'ритм бирдей')}</td></tr>)}</tbody></table>
            </>}
          </section>
        </div>

        {(rep.notes?.length ?? 0) > 0 && <>
          <h2>{f.t('Заметки')}</h2>
          {rep.notes!.slice(0, 3).map(n => <p key={n.id} className="r-note"><b>{f.dt(n.ts)}</b> — {n.text}</p>)}
        </>}
        <footer>{f.tr(
          'Носимый одноканальный монитор; алгоритм не зарегистрирован как медицинское изделие. Решения о диагнозе и лечении принимает врач по ЭКГ и клинической картине.',
          'Wearable single-lead monitor; the algorithm is not registered as a medical device. Diagnosis and treatment are decided by the physician from the ECG and clinical picture.',
          'Тагынуучу бир каналдуу монитор; алгоритм медициналык буюм катары катталган эмес. Диагноз жана дарылоо боюнча чечимди дарыгер ЭКГ жана клиникалык көрүнүш боюнча кабыл алат.')}
          {' '}{f.tr('Последнее состояние', 'Last state', 'Акыркы абалы')}: {rep.last ? f.t(STATE[rep.last.state].label) : '—'}</footer>
      </article>
    </div>
  )
}
