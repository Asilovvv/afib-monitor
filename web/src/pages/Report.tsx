import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from 'recharts'
import { api, type Report as Rep, type User } from '../api'
import { EcgStrip } from '../components/Ecg'
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
  const simple = sp.get('view') === 'simple'
  const [rep] = useLive<Rep>(`/api/patients/${id}/report?hours=${hours}`)
  if (!rep) return <div className="page"><div className="skeleton tall" /></div>
  if (simple) return <SimpleReport rep={rep} me={me} hours={hours} id={id!} />
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
          <Link to={`?hours=${hours}&view=simple`} className="btn ghost">{f.tr('Для участкового', 'For the local doctor', 'Участок дарыгери үчүн')}</Link>
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
        {rep.checks && (rep.checks.due > 0 || rep.checks.checks > 0) && <p className="r-fine r-pvc">
          {f.tr('Проверки 30 с', '30-s checks', '30 с текшерүү')}{rep.checks.plan?.active ? ` (${f.tr('план', 'plan', 'план')} ${rep.checks.plan.times.join(', ')})` : ''}:{' '}
          {rep.checks.due > 0 && <><b>{rep.checks.done}</b> {f.tr('из', 'of', '/')} {rep.checks.due} {f.tr('по плану', 'as planned', 'план боюнча')}; </>}
          {f.tr('всего', 'total', 'бардыгы')} {rep.checks.checks}: {rep.checks.regular} {f.tr('ровный', 'regular', 'бирдей')}, {rep.checks.irregular} {f.tr('неровный', 'irregular', 'бирдей эмес')}, {rep.checks.no_verdict} {f.tr('не прочитано', 'unreadable', 'окулган жок')};
          {' '}{f.tr('неровный дважды подряд', 'irregular twice in a row', 'катары менен эки жолу бирдей эмес')}: <b className={rep.checks.confirmed_irregular ? 'r-af' : ''}>{rep.checks.confirmed_irregular}</b>.</p>}
        {rep.vitals && rep.vitals.bp && <p className="r-fine r-pvc">
          {f.tr('Давление (введено пациентом с тонометра)', 'Blood pressure (typed in by the patient from a cuff)', 'Кан басымы (бейтап тонометрден киргизген)')}:{' '}
          {f.tr('среднее', 'mean', 'орточо')} <b>{rep.vitals.bp.sys_mean}/{rep.vitals.bp.dia_mean}</b>, {f.tr('диапазон', 'range', 'диапазон')} {rep.vitals.bp.sys_min}–{rep.vitals.bp.sys_max}/{rep.vitals.bp.dia_min}–{rep.vitals.bp.dia_max}, {rep.vitals.bp.n} {f.tr('записей', 'entries', 'жазуу')}
          {rep.vitals.glucose ? `; ${f.tr('сахар', 'glucose', 'кант')} ${rep.vitals.glucose.mean} ${f.tr('ммоль/л (среднее)', 'mmol/L (mean)', 'ммоль/л (орточо)')}` : ''}
          {rep.vitals.weight ? `; ${f.tr('вес', 'weight', 'салмак')} ${rep.vitals.weight.last.value} ${f.tr('кг', 'kg', 'кг')}` : ''}.</p>}
        {rep.pvc && rep.pvc.strips > 0 && <p className="r-fine r-pvc"><span className="tag-research">{f.tr('исследование', 'research', 'изилдөө')}</span>{' '}
          {f.tr('Ранние желудочковые сокращения (оценка алгоритма)', 'Early ventricular beats (algorithm estimate)', 'Эрте карынча согуулары (алгоритмдин баалоосу)')}:{' '}
          <b>{rep.pvc.pvc}</b> {f.tr('из', 'of', '/')} {rep.pvc.beats} {f.tr('ударов', 'beats', 'согуу')} (<b>{f.pct(rep.pvc.share ?? 0)}</b>)
          {' '}{f.tr(`в ${rep.pvc.strips} записях ЭКГ`, `in ${rep.pvc.strips} ECG strips`, `${rep.pvc.strips} ЭКГ жазуусунда`)}
          {rep.pvc.worst && <>; {f.tr('больше всего', 'most', 'эң көп')}: {f.dt(rep.pvc.worst.ts)}, {rep.pvc.worst.pvc}/{rep.pvc.worst.beats}</>}.
          {' '}{f.tr('Записи делаются при событиях и по запросу, это не холтеровская нагрузка. Проверьте по ЭКГ.',
            'Strips are taken at events and on request, so this is not a Holter burden. Check on the ECG.',
            'Жазуулар окуяларда жана суроо боюнча жасалат, бул Холтер жүгү эмес. ЭКГ боюнча текшериңиз.')}</p>}

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
            {(rep.medications?.length ?? 0) > 0 && <>
              <h2>{f.tr('Приём лекарств (по отметкам пациента)', 'Medicines (patient-reported)', 'Дары ичүү (бейтаптын белгилери)')}</h2>
              <table className="r-table"><tbody>{rep.medications!.map(m => <tr key={m.id}>
                <td>{m.anticoagulant ? <b>{m.name}</b> : m.name}{m.dose ? ` ${m.dose}` : ''}{m.anticoagulant ? <span className="r-af"> · {f.tr('антикоагулянт', 'anticoagulant', 'антикоагулянт')}</span> : ''}</td>
                <td>{m.times.join(', ')}</td>
                <td>{m.adherence == null ? '—' : <b className={m.anticoagulant && m.adherence < 0.9 ? 'r-af' : ''}>{f.pct(m.adherence)}</b>} ({m.taken}/{m.due}{m.skipped ? `, ${f.tr('пропущено', 'skipped', 'өткөрүлдү')} ${m.skipped}` : ''})</td></tr>)}</tbody></table>
            </>}
            {rep.symptoms.length > 0 && <>
              <h2>{f.t('Симптомы')}</h2>
              <table className="r-table"><tbody>{rep.symptoms.slice(0, rep.medications?.length ? 3 : 5).map(x => <tr key={x.id}><td>{f.dt(x.ts)}</td>
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


/** One A4 page for a local doctor who has never seen this portal: the plan, what was done, the words the check gave,
 *  typed-in blood pressure, pills, and two or three 30-s strips. No AF probability, no diagnosis, no advice. */
function SimpleReport({ rep, me, hours, id }: { rep: Rep; me: User; hours: number; id: string }) {
  const f = useFmt()
  const p = rep.patient
  const ck = rep.checks, v = rep.vitals
  const [strips, setStrips] = useState<{ id: number; ts: string; samples: number[]; fs: number; verdict: string }[]>([])
  useEffect(() => {
    const picks = rep.ecg.filter(e => e.reason === 'check').slice(0, 3)
    Promise.all(picks.map(e => api<{ samples: number[]; fs: number; irregularity: number | null }>(`/api/ecg/${e.id}`)
      .then(x => ({ id: e.id, ts: e.ts, samples: x.samples, fs: x.fs, verdict: x.irregularity == null ? 'no_verdict' : x.irregularity > 0.1 ? 'irregular' : 'regular' }))))
      .then(setStrips).catch(() => setStrips([]))
  }, [rep])
  const day = (iso: string) => new Date(iso).toLocaleDateString(f.loc, { day: 'numeric', month: 'short', year: 'numeric' })
  const V: Record<string, string> = { regular: f.tr('ровный', 'regular', 'бирдей'), irregular: f.tr('неровный', 'irregular', 'бирдей эмес'), no_verdict: f.tr('не прочитано', 'unreadable', 'окулган жок') }
  // checks per local day
  const byDay = new Map<string, string[]>()
  for (const x of (ck?.last ?? []).slice().reverse()) {
    const d = new Date(x.ts).toLocaleDateString(f.loc, { day: 'numeric', month: 'short' })
    byDay.set(d, [...(byDay.get(d) ?? []), V[x.verdict]])
  }
  return (
    <div className="report-wrap">
      <div className="report-tools no-print">
        <Link to={`/app/patients/${id}/report?hours=${hours}`} className="btn ghost">{Icon.back()} {f.tr('Полный отчёт', 'Full report', 'Толук отчёт')}</Link>
        <div className="row-gap">
          {[168, 336, 720].map(h => <Link key={h} to={`?hours=${h}&view=simple`} className={`btn ${h === hours ? 'primary' : 'ghost'}`}>
            {h === 168 ? f.tr('7 дней', '7 days', '7 күн') : h === 336 ? f.tr('14 дней', '14 days', '14 күн') : f.tr('30 дней', '30 days', '30 күн')}</Link>)}
          <button className="btn primary" onClick={() => window.print()}>{Icon.print()} {f.t('Печать / PDF')}</button>
        </div>
      </div>
      <article className="report one-page simple">
        <header>
          <div className="r-brand">{Icon.pulse(20)} AFib<b>Monitor</b></div>
          <div className="r-meta">{f.t('Сформирован')}: {f.dt(new Date().toISOString())}</div>
        </header>
        <h1>{f.tr('Сводка домашних проверок ритма', 'Summary of home rhythm checks', 'Үйдөгү ритм текшерүүлөрүнүн корутундусу')}</h1>
        <table className="r-head"><tbody>
          <tr><th>{f.t('Пациент')}</th><td><b>{p.name}</b>{p.birth_year ? `, ${f.age(p.birth_year)}` : ''}</td>
            <th>{f.t('Период')}</th><td>{day(rep.range.from)} — {day(rep.range.to)}</td></tr>
          <tr><th>{f.tr('Наблюдающий врач', 'Supervising doctor', 'Байкоочу дарыгер')}</th><td>{me.name}{me.clinic ? `, ${me.clinic}` : ''}</td>
            <th>{f.tr('Прибор', 'Device', 'Прибор')}</th><td>{f.tr('одноканальная ЭКГ 30 с, исследовательский прототип', 'single-lead 30-s ECG, research prototype', 'бир каналдуу 30 с ЭКГ, изилдөө прототиби')}</td></tr>
        </tbody></table>

        <section>
          <h2>{f.tr('Проверки ритма по 30 секунд', '30-second rhythm checks', '30 секунддук ритм текшерүүлөрү')}</h2>
          {ck && (ck.checks > 0 || ck.due > 0) ? (<>
            <p>{ck.plan?.active ? <>{f.tr('План', 'Plan', 'План')}: <b>{ck.plan.times.join(', ')}</b>. </> : null}
              {ck.due > 0 && <>{f.tr('Сделано по плану', 'Done as planned', 'План боюнча жасалды')}: <b>{ck.done} {f.tr('из', 'of', '/')} {ck.due}</b>{ck.adherence != null ? ` (${f.pct(ck.adherence)})` : ''}. </>}
              {f.tr('Всего проверок', 'All checks', 'Бардык текшерүүлөр')}: <b>{ck.checks}</b> — {ck.regular} {V.regular}, <b className={ck.irregular ? 'r-af' : ''}>{ck.irregular} {V.irregular}</b>, {ck.no_verdict} {V.no_verdict}.
              {' '}{f.tr('Неровный дважды подряд (в течение 10 минут)', 'Irregular twice in a row (within 10 minutes)', 'Катары менен эки жолу бирдей эмес (10 мүнөт ичинде)')}: <b className={ck.confirmed_irregular ? 'r-af' : ''}>{ck.confirmed_irregular}</b>.</p>
            {byDay.size > 0 && <table className="r-table"><tbody>
              {[...byDay.entries()].map(([d, vs]) => <tr key={d}><td>{d}</td><td>{vs.join(' · ')}</td></tr>)}
            </tbody></table>}
            <p className="r-fine">{f.tr('«Неровный» — правило: средняя разница соседних интервалов между ударами больше 10 % от среднего интервала. Это повод посмотреть запись, а не диагноз. Последние проверки показаны по дням, не больше шести.',
              '"Irregular" is a rule: mean difference between neighbouring beat intervals above 10 % of the mean interval. A reason to look at the strip, not a diagnosis. The last checks are listed by day, at most six.',
              '«Бирдей эмес» — эреже: коңшу согуу аралыктарынын орточо айырмасы орточо аралыктын 10 %ынан көп. Бул жазууну кароого себеп, диагноз эмес.')}</p>
          </>) : <p className="muted">{f.tr('Проверок за период не было.', 'No checks in this period.', 'Бул мезгилде текшерүү болгон жок.')}</p>}
        </section>

        {strips.length > 0 && <section>
          <h2>{f.tr('Последние записи (25 мм/с, 10 мм/мВ)', 'Latest strips (25 mm/s, 10 mm/mV)', 'Акыркы жазуулар (25 мм/с, 10 мм/мВ)')}</h2>
          {strips.map(st => (
            <div key={st.id} className="r-strip">
              <div className="r-strip-h"><span>{f.dt(st.ts)}</span><b className={st.verdict === 'irregular' ? 'r-af' : ''}>{V[st.verdict]}</b></div>
              <EcgStrip samples={st.samples.slice(0, st.fs * 10)} fs={st.fs} pxPerMm={2.6} height={26} />
            </div>
          ))}
          <p className="r-fine">{f.tr('Показаны первые 10 секунд каждой 30-секундной записи.', 'The first 10 seconds of each 30-second strip are shown.', 'Ар бир 30 секунддук жазуунун биринчи 10 секунду көрсөтүлгөн.')}</p>
        </section>}

        <div className="r-cols">
          <section>
            <h2>{f.tr('Давление (ввёл пациент с тонометра)', 'Blood pressure (typed in by the patient)', 'Кан басымы (бейтап тонометрден киргизген)')}</h2>
            {v?.bp ? <p>{f.tr('Среднее', 'Mean', 'Орточо')} <b>{v.bp.sys_mean}/{v.bp.dia_mean}</b>, {f.tr('от', 'from', 'мин')} {v.bp.sys_min}/{v.bp.dia_min} {f.tr('до', 'to', 'макс')} {v.bp.sys_max}/{v.bp.dia_max}, {v.bp.n} {f.tr('записей', 'entries', 'жазуу')}.
              {v.glucose ? <><br />{f.tr('Сахар', 'Glucose', 'Кант')}: {f.tr('среднее', 'mean', 'орточо')} {v.glucose.mean} {f.tr('ммоль/л', 'mmol/L', 'ммоль/л')}, {v.glucose.n} {f.tr('записей', 'entries', 'жазуу')}.</> : null}
              {v.weight ? <><br />{f.tr('Вес', 'Weight', 'Салмак')}: {v.weight.last.value} {f.tr('кг', 'kg', 'кг')}.</> : null}</p>
              : <p className="muted">{f.tr('Записей нет.', 'No entries.', 'Жазуу жок.')}</p>}
          </section>
          <section>
            <h2>{f.tr('Лекарства (по отметкам пациента)', 'Medicines (patient-reported)', 'Дарылар (бейтаптын белгилери)')}</h2>
            {rep.medications?.length ? <table className="r-table"><tbody>{rep.medications.map(m => <tr key={m.id}>
              <td>{m.name}{m.dose ? ` ${m.dose}` : ''}{m.anticoagulant ? <span className="r-af"> · {f.tr('антикоагулянт', 'anticoagulant', 'антикоагулянт')}</span> : ''}</td>
              <td>{m.adherence == null ? '—' : <b className={m.anticoagulant && m.adherence < 0.9 ? 'r-af' : ''}>{f.pct(m.adherence)}</b>} ({m.taken}/{m.due})</td></tr>)}</tbody></table>
              : <p className="muted">{f.tr('Лекарства в приложении не заведены.', 'No medicines set up in the app.', 'Тиркемеде дарылар киргизилген эмес.')}</p>}
          </section>
        </div>

        <footer>{f.tr('AFib Monitor — учебный исследовательский прототип Международного университета Ала-Тоо, не медицинское изделие. Все значения записаны пациентом дома; результат проверки — правило по интервалам между ударами, не диагноз. Решения принимает врач.',
          'AFib Monitor is a research prototype of Ala-Too International University, not a medical device. All values were recorded by the patient at home; the check result is a beat-interval rule, not a diagnosis. Decisions are the doctor\'s.',
          'AFib Monitor — Ала-Тоо эл аралык университетинин окуу-изилдөө прототиби, медициналык буюм эмес. Бардык маанилерди бейтап үйдө жазган; текшерүүнүн жыйынтыгы — согуу аралыктары боюнча эреже, диагноз эмес. Чечимди дарыгер кабыл алат.')}</footer>
      </article>
    </div>
  )
}
