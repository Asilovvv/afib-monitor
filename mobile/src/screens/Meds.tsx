import { useCallback, useEffect, useState } from 'react'
import { Alert, Platform, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native'
import { api, type Med, type TodayDose } from '../api'
import { Button, Card, Icon, Row, Sheet, T } from '../components/ui'
import { scheduleMedReminders } from '../meds'
import { useApp } from '../store'
import { F } from '../theme'

const PRESET = ['07:00', '08:00', '09:00', '12:00', '14:00', '18:00', '20:00', '21:00', '22:00']
const nowSlot = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

/** Today's doses with two big answers each. Shown on the main screen; hidden when no medicine is set up. */
export function MedsCard({ big = false }: { big?: boolean }) {
  const { theme: tm, t, user, lang, dataVersion, toast } = useApp()
  const [data, setData] = useState<{ meds: Med[]; today: TodayDose[] } | null>(null)
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    if (!user) return
    try { const d = await api.meds(); setData(d); scheduleMedReminders(d.meds, lang) } catch { /* offline: keep what we had */ }
  }, [user, lang])
  useEffect(() => { load() }, [load, dataVersion])

  const answer = async (d: TodayDose, status: 'taken' | 'skipped') => {
    setData(x => x && { ...x, today: x.today.map(y => y === d ? { ...y, status } : y) })
    try { await api.dose(d.medication_id, d.slot, status) } catch { toast(t('day_offline'), 'info'); load() }
  }
  if (!user) return null
  const now = nowSlot()
  const due = (data?.today ?? []).filter(d => d.status === null && d.slot.slice(11) <= now)
  const later = (data?.today ?? []).filter(d => d.status === null && d.slot.slice(11) > now)
  const done = (data?.today ?? []).filter(d => d.status !== null)
  return (
    <>
      <Card style={{ marginTop: 14 }}>
        <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <Row gap={8}><T style={{ fontSize: 20 }}>💊</T><T v="h3">{t('meds_today')}</T></Row>
          <Pressable onPress={() => setOpen(true)} hitSlop={10}><T v="small" c={tm.accent}>{data?.meds.length ? t('meds_edit') : t('meds_add')}</T></Pressable>
        </Row>
        {!data?.meds.length && <T v="small">{t('meds_empty')}</T>}
        {due.map(d => (
          <View key={d.slot + d.medication_id} style={[s.dose, { backgroundColor: d.anticoagulant ? tm.warnSoft : tm.bg2 }]}>
            <T v={big ? 'h2' : 'h3'}>{d.name}{d.dose ? ` · ${d.dose}` : ''}</T>
            <T v="small">{d.slot.slice(11)}{d.anticoagulant ? ` · ${t('meds_ac')}` : ''}</T>
            <Row gap={10} style={{ marginTop: 10 }}>
              <Button title={t('meds_taken')} icon="check" onPress={() => answer(d, 'taken')} style={{ flex: 1 }} />
              <Button title={t('meds_skip')} kind="ghost" onPress={() => answer(d, 'skipped')} style={{ flex: 1 }} />
            </Row>
          </View>
        ))}
        {later.length > 0 && <T v="small" style={{ marginTop: 6 }}>{t('meds_later')}: {later.map(d => `${d.slot.slice(11)} ${d.name}`).join(', ')}</T>}
        {done.length > 0 && <T v="small" style={{ marginTop: 6 }}>✓ {done.map(d => `${d.slot.slice(11)} ${d.name}${d.status === 'skipped' ? ' ✕' : ''}`).join(', ')}</T>}
      </Card>
      <MedsSheet open={open} onClose={() => { setOpen(false); load() }} meds={data?.meds ?? []} />
    </>
  )
}

function MedsSheet({ open, onClose, meds }: { open: boolean; onClose: () => void; meds: Med[] }) {
  const { theme: tm, t, toast } = useApp()
  const [edit, setEdit] = useState<Med | 'new' | null>(null)
  useEffect(() => { if (open) setEdit(meds.length ? null : 'new') }, [open])  // eslint-disable-line react-hooks/exhaustive-deps
  const stop = (m: Med) => {
    const go = async () => { try { await api.stopMed(m.id); onClose() } catch { toast(t('day_offline'), 'info') } }
    if (Platform.OS === 'web') { go(); return }
    Alert.alert(t('meds_stop_q'), m.name, [{ text: t('cancel'), style: 'cancel' }, { text: t('meds_stop'), style: 'destructive', onPress: go }])
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('meds_title')}>
      {edit ? <MedForm med={edit === 'new' ? null : edit} onDone={onClose} /> : (
        <View style={{ gap: 10 }}>
          {meds.map(m => (
            <Pressable key={m.id} onPress={() => setEdit(m)} style={[s.row, { borderColor: tm.line }]}>
              <View style={{ flex: 1 }}>
                <T v="h3">{m.name}{m.dose ? ` · ${m.dose}` : ''}</T>
                <T v="small">{m.times.join(', ')}{m.anticoagulant ? ` · ${t('meds_ac')}` : ''}</T>
              </View>
              <Pressable onPress={() => stop(m)} hitSlop={10}><Icon name="x" color={tm.ink3} size={18} /></Pressable>
            </Pressable>
          ))}
          <Button title={t('meds_add')} icon="plus" kind="soft" onPress={() => setEdit('new')} />
          <T v="small" style={{ marginTop: 6 }}>{t('meds_note')}</T>
        </View>
      )}
    </Sheet>
  )
}

function MedForm({ med, onDone }: { med: Med | null; onDone: () => void }) {
  const { theme: tm, t, toast } = useApp()
  const [name, setName] = useState(med?.name ?? '')
  const [dose, setDose] = useState(med?.dose ?? '')
  const [times, setTimes] = useState<string[]>(med?.times ?? ['08:00'])
  const [ac, setAc] = useState(med?.anticoagulant ?? false)
  const [busy, setBusy] = useState(false)
  const toggle = (x: string) => setTimes(v => v.includes(x) ? v.filter(y => y !== x) : [...v, x].sort())
  const save = async () => {
    if (!name.trim() || !times.length) { toast(t('meds_need'), 'info'); return }
    setBusy(true)
    try {
      const b = { name: name.trim(), dose: dose.trim() || undefined, times, anticoagulant: ac }
      if (med) await api.editMed(med.id, b); else await api.addMed(b)
      toast(t('saved'), 'ok'); onDone()
    } catch { toast(t('day_offline'), 'info') }
    setBusy(false)
  }
  const input = [s.input, { borderColor: tm.line, color: tm.ink, backgroundColor: tm.bg2 }]
  return (
    <View style={{ gap: 12 }}>
      <TextInput value={name} onChangeText={setName} placeholder={t('meds_name')} placeholderTextColor={tm.ink3} style={input} />
      <TextInput value={dose} onChangeText={setDose} placeholder={t('meds_dose')} placeholderTextColor={tm.ink3} style={input} />
      <T v="label">{t('meds_times')}</T>
      <View style={s.chips}>
        {PRESET.map(x => {
          const on = times.includes(x)
          return <Pressable key={x} onPress={() => toggle(x)} style={[s.chip, { backgroundColor: on ? tm.accentSoft : tm.bg2, borderColor: on ? tm.accent : tm.line }]}>
            <T v="h3" c={on ? tm.accent : tm.ink}>{x}</T></Pressable>
        })}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1, paddingRight: 12 }}><T v="h3">{t('meds_ac_q')}</T><T v="small">{t('meds_ac_hint')}</T></View>
        <Switch value={ac} onValueChange={setAc} />
      </Row>
      <Button title={t('save')} loading={busy} onPress={save} />
    </View>
  )
}

const s = StyleSheet.create({
  dose: { borderRadius: 14, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 14, fontFamily: F.body, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
})
