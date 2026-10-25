import { useEffect, useState } from 'react'
import { api } from '../api'
import { Card, Row, T } from '../components/ui'
import { locOf } from '../i18n'
import { useApp } from '../store'

/** Clinic rental: "device №3 issued until <date>". Shown only while a loan is open; nothing else about it lives on the
 *  phone, the clinic's portal is the record. */
export function LoanCard() {
  const { theme: tm, t, lang, user } = useApp()
  const [loan, setLoan] = useState<Awaited<ReturnType<typeof api.myDevice>>>(null)
  useEffect(() => {
    if (!user) return
    const load = () => api.myDevice().then(setLoan).catch(() => undefined)
    load(); const iv = setInterval(load, 10 * 60e3); return () => clearInterval(iv)
  }, [user])
  if (!loan) return null
  const due = new Date(loan.due_at).toLocaleDateString(locOf(lang), { day: 'numeric', month: 'long' })
  return (
    <Card style={{ marginTop: 14, borderColor: loan.overdue ? tm.warn : undefined }}>
      <Row gap={8}><T style={{ fontSize: 20 }}>📦</T>
        <T style={{ flex: 1, lineHeight: 21 }}>{t(loan.overdue ? 'loan_overdue' : 'loan_until', { d: due, n: loan.label || loan.chip_id || '' })}</T></Row>
      {user?.doctor?.clinic && <T v="small" style={{ marginTop: 6 }}>{t('loan_where', { c: user.doctor.clinic })}</T>}
    </Card>
  )
}
