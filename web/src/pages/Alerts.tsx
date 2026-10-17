import { useState } from 'react'
import { Link } from 'react-router-dom'
import { emitRefresh, post, type Alert } from '../api'
import { Avatar, Empty, Icon, Seg, useFmt } from '../components/ui'
import { useLive } from './Overview'

export default function Alerts() {
  const f = useFmt()
  const [flt, setFlt] = useState<'new' | 'all'>('new')
  const [rows, , reload] = useLive<Alert[]>(`/api/alerts${flt === 'new' ? '?status=new' : ''}`)
  const ack = async (id: number) => { await post(`/api/alerts/${id}/ack`); reload(); emitRefresh() }
  const ackAll = async () => { await post('/api/alerts/ack-all'); reload(); emitRefresh() }
  return (
    <div className="page">
      <div className="page-head">
        <div><p className="eyebrow">{f.t('Фибрилляция')} · {f.tr('начало каждого эпизода', 'onset of each episode', 'ар бир эпизоддун башталышы')}</p><h1>{f.t('Тревоги')}</h1></div>
        <div className="head-tools">
          <Seg value={flt} onChange={setFlt} items={[['new', f.t('Новые')], ['all', f.t('Все')]]} />
          <button className="btn ghost" onClick={ackAll}>{Icon.check()} {f.t('Отметить всё прочитанным')}</button>
        </div>
      </div>
      {rows && rows.length === 0 ? <Empty>{f.t('Тревог нет — всё спокойно.')}</Empty> : (
        <div className="alert-list">
          {rows?.map((a, i) => (
            <div key={a.id} className={`card alert-card ${a.status}`} style={{ ['--i' as string]: i }}>
              <span className="alert-ico">{Icon.heart(22)}</span>
              <Avatar name={a.patient_name ?? '?'} />
              <div className="alert-main">
                <Link to={`/app/patients/${a.patient_id}`}><b>{a.patient_name}</b></Link>
                <span>{f.t('Фибрилляция')} · {Math.round(a.bpm)} {f.t('уд/мин')} · {Math.round(a.prob * 100)}%</span>
              </div>
              <span className="alert-time"><b>{f.time(a.ts)}</b><small>{f.ago(a.ts)}</small></span>
              <div className="alert-act">
                <Link to={`/app/patients/${a.patient_id}/episodes`} className="btn tiny">{f.t('Эпизоды')}</Link>
                {a.status === 'new'
                  ? <button className="btn tiny primary" onClick={() => ack(a.id)}>{Icon.check(14)} {f.t('Принять')}</button>
                  : <span className="muted sm">{f.t('Принято')} {a.ack_at ? f.time(a.ack_at) : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
