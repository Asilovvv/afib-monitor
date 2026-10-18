import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { api, type CheckPlan } from '../api'
import { Button, Card, Row, Sheet, T } from '../components/ui'
import { scheduleCheckReminders } from '../meds'
import { useApp } from '../store'

const PRESETS: string[][] = [['09:00', '21:00'], ['08:00', '14:00', '20:00']]
const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** "Control" mode: daily 30-s check reminders. Notebook 15 (ml/WEAR_MODES.md): 2-3 checks a day are enough to follow
 *  known, frequent AF; searching for rare episodes needs the patch worn all the time. The doctor can set the plan. */
export function CheckPlanCard() {
  const { theme: tm, t, user, lang, dataVersion, toast } = useApp()
  const [plan, setPlan] = useState<CheckPlan | null>(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    if (!user) return
    try { const p = await api.checkPlan(); setPlan(p); scheduleCheckReminders(p, lang) } catch { /* offline: keep the last plan */ }
  }, [user, lang])
  useEffect(() => { load() }, [load, dataVersion])
  const choose = async (times: string[]) => {
    setOpen(false)
    try { const p = await api.setCheckPlan(times); setPlan(p); scheduleCheckReminders(p, lang) } catch { toast(t('day_offline'), 'info') }
  }
  if (!user) return null
  const times = plan?.active ? plan.times : []
  const next = times.find(x => x > hhmm()) ?? times[0]
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3">⏰ {t('plan_title')}</T>
          <Pressable onPress={() => setOpen(true)} hitSlop={10}><T v="small" c={tm.accent}>{t('plan_change')}</T></Pressable>
        </Row>
        {times.length ? <>
          <T style={{ marginTop: 6 }}>{times.join(' · ')} — {plan?.set_by === 'doctor' ? t('plan_by_doctor') : t('plan_by_me')}</T>
          {next && <T v="small" style={{ marginTop: 4 }}>{t('plan_next', { t: next })}</T>}
        </> : <T v="small" style={{ marginTop: 6 }}>{t('plan_none')}</T>}
      </Card>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('plan_title')}>
        <View style={{ gap: 10 }}>
          {PRESETS.map(p => <Button key={p.join()} title={`${t('plan_n', { n: p.length })}: ${p.join(', ')}`} kind={times.join() === p.join() ? 'primary' : 'ghost'} onPress={() => choose(p)} />)}
          <Button title={t('plan_off')} kind="ghost" onPress={() => choose([])} />
          <T v="small" style={{ marginTop: 6 }}>{t('plan_hint')}</T>
        </View>
      </Sheet>
    </>
  )
}
