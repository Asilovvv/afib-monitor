import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PatientRow, User } from '../api'
import { Avatar, Empty, Icon, Seg, Spark, StatePill, useFmt } from '../components/ui'
import { useLive } from './Overview'

type Filter = 'all' | 'alert' | 'online' | 'af'
type Sort = 'risk' | 'name' | 'burden' | 'seen'

export default function Patients({ me }: { me: User }) {
  const f = useFmt()
  const nav = useNavigate()
  const [rows] = useLive<PatientRow[]>('/api/patients')
  const [q, setQ] = useState('')
  const [flt, setFlt] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('risk')

  const list = useMemo(() => {
    let r = rows ?? []
    if (q) r = r.filter(p => (p.name + p.email).toLowerCase().includes(q.toLowerCase()))
    if (flt === 'alert') r = r.filter(p => p.alert || p.new_alerts > 0)
    if (flt === 'online') r = r.filter(p => p.online)
    if (flt === 'af') r = r.filter(p => p.last_state === 2)
    const s = [...r]
    if (sort === 'name') s.sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'burden') s.sort((a, b) => b.af_burden_24h - a.af_burden_24h)
    if (sort === 'seen') s.sort((a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? ''))
    return s
  }, [rows, q, flt, sort])

  const th = (k: Sort, label: string) => (
    <button className={`th-btn ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{label}</button>
  )

  return (
    <div className="page">
      <div className="page-head">
        <div><p className="eyebrow">{rows?.length ?? 0} · {f.t('за последние 24 часа')}</p><h1>{f.t('Пациенты')}</h1></div>
        <div className="head-tools">
          <div className="search small">{Icon.search(16)}<input value={q} onChange={e => setQ(e.target.value)} placeholder={f.t('Поиск пациента…')} /></div>
          <Seg value={flt} onChange={setFlt} items={[['all', f.t('Все')], ['alert', f.t('С тревогой')], ['online', f.t('Онлайн')], ['af', f.t('ФП сейчас')]]} />
        </div>
      </div>

      {rows && rows.length === 0 ? (
        <Empty>{f.t('Пока нет пациентов. Дайте пациенту код')} <b className="mono">{me.invite_code}</b></Empty>
      ) : (
        <div className="card table">
          <div className="tr th">
            <span>{th('name', f.t('Пациент'))}</span><span>{f.t('Сейчас')}</span><span>{f.t('Пульс')}</span>
            <span>{f.t('Тренд')}</span><span>{th('burden', f.t('Нагрузка ФП'))}</span><span>{f.tr('Проверки сегодня', 'Checks today', 'Бүгүнкү текшерүүлөр')}</span><span>{f.t('Эпизоды')}</span>
            <span>{th('seen', f.t('Связь'))}</span>
          </div>
          {list.map((r, i) => (
            <div key={r.id} className={`tr row ${r.alert ? 'alert' : ''}`} style={{ ['--i' as string]: i }}
              onClick={() => nav(`/app/patients/${r.id}`)} tabIndex={0} onKeyDown={e => e.key === 'Enter' && nav(`/app/patients/${r.id}`)}>
              <span className="who">
                <Avatar name={r.name} alert={r.alert} />
                <span><b>{r.name}</b><small>{[f.age(r.birth_year), r.email].filter(Boolean).join(' · ')}</small></span>
              </span>
              <span><StatePill state={r.last_state} /></span>
              <span className="num big">{r.last_bpm ? Math.round(r.last_bpm) : '—'}</span>
              <span><Spark data={r.spark} alert={r.alert} /></span>
              <span className="burden"><span className="bar"><span style={{ width: `${Math.min(100, r.af_burden_24h * 100)}%` }} /></span><span className="num">{f.pct(r.af_burden_24h)}</span></span>
              <CheckCell c={r.checks_today} />
              <span className="num">{r.episodes_24h}{r.new_alerts > 0 && <b className="badge sm">{r.new_alerts}</b>}</span>
              <span className={r.online ? 'ok' : 'muted'}>{r.online ? `● ${f.t('онлайн')}` : f.ago(r.last_seen)}</span>
            </div>
          ))}
          {list.length === 0 && <Empty>—</Empty>}
        </div>
      )}
    </div>
  )
}

/** Control mode at a glance: planned checks done today and the last verdict; "irregular" twice in a row is highlighted. */
function CheckCell({ c }: { c: PatientRow['checks_today'] }) {
  const f = useFmt()
  if (!c || (!c.plan && c.checks === 0)) return <span className="muted">—</span>
  const V = { regular: ['ok', f.tr('ровный', 'regular', 'бирдей')], irregular: ['af', f.tr('неровный', 'irregular', 'бирдей эмес')],
    no_verdict: ['muted', f.tr('не прочитано', 'unreadable', 'окулган жок')] } as const
  const behind = c.plan && c.done < c.due
  return (
    <span className="checks-cell">
      <b className={`num ${c.confirmed_irregular ? 'r-af' : behind ? 'warn' : c.plan ? 'ok' : ''}`}>{c.plan ? `${c.done}/${c.due}` : c.checks}</b>
      {c.last && <small className={V[c.last.verdict][0]}>{V[c.last.verdict][1]} · {f.time(c.last.ts)}</small>}
    </span>
  )
}
