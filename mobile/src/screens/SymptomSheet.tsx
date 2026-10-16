import { useState } from 'react'
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native'
import { Button, Icon, Row, Seg, Sheet, T } from '../components/ui'
import { SYMPTOMS } from '../i18n'
import { useApp } from '../store'
import { F } from '../theme'

export const SYM_EMOJI: Record<string, string> = {
  palpitations: '💓', dizziness: '💫', shortness_of_breath: '🫁', chest_pain: '💢', fatigue: '🪫', anxiety: '😟', other: '✏️',
}

export function SymptomForm({ onSaved }: { onSaved?: () => void }) {
  const { theme: tm, t, addSymptom, source, toast } = useApp()
  const [kinds, setKinds] = useState<string[]>([])
  const [sev, setSev] = useState(2)
  const [note, setNote] = useState('')
  const [attach, setAttach] = useState(true)
  const [busy, setBusy] = useState(false)
  const toggle = (k: string) => setKinds(ks => ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k])

  const save = async () => {
    if (!kinds.length) { toast(t('choose_symptom'), 'info'); return }
    setBusy(true)
    await addSymptom(kinds, sev, note, attach && source !== 'none')
    setBusy(false); setKinds([]); setNote(''); setSev(2)
    toast(t('saved'), 'ok')
    onSaved?.()
  }

  return (
    <View style={{ gap: 16 }}>
      <View style={s.chips}>
        {SYMPTOMS.map(k => {
          const on = kinds.includes(k)
          return (
            <Pressable key={k} onPress={() => toggle(k)}
              style={[s.chip, { backgroundColor: on ? tm.ink : tm.bg2, borderColor: on ? tm.ink : tm.line }]}>
              <T style={{ fontSize: 15 }}>{SYM_EMOJI[k]}</T>
              <T v="h3" c={on ? tm.primaryText : tm.ink} style={{ fontSize: 14 }}>{t(k)}</T>
              {on && <Icon name="check" size={14} color={tm.primaryText} width={2.4} />}
            </Pressable>
          )
        })}
      </View>
      <View style={{ gap: 8 }}>
        <T v="label">{t('severity')}</T>
        <Seg value={sev} onChange={setSev} items={[[1, t('sev1')], [2, t('sev2')], [3, t('sev3')]]} />
      </View>
      <View style={{ gap: 8 }}>
        <T v="label">{t('note')}</T>
        <TextInput value={note} onChangeText={setNote} placeholder={t('note_ph')} placeholderTextColor={tm.ink3} multiline
          style={[s.input, { color: tm.ink, backgroundColor: tm.bg2, borderColor: tm.line }]} />
      </View>
      {source !== 'none' && (
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={8} style={{ flex: 1 }}><Icon name="wave" size={18} color={tm.ink2} /><T style={{ flex: 1 }}>{t('attach_ecg')}</T></Row>
          <Switch value={attach} onValueChange={setAttach} trackColor={{ true: tm.af, false: tm.line }} thumbColor="#fff" />
        </Row>
      )}
      <Button title={t('save')} icon="check" onPress={save} loading={busy} />
    </View>
  )
}

export function SymptomSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const { t } = useApp()
  return (
    <Sheet open={open} onClose={onClose} title={t('how_feel')}>
      <SymptomForm onSaved={() => { onClose(); onSaved?.() }} />
    </Sheet>
  )
}

const s = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  input: { minHeight: 84, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14, fontFamily: F.body, fontSize: 15, textAlignVertical: 'top' },
})
