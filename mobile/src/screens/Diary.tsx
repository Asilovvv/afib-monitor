import { DAY_TAGS, fmtDate } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { api, type Symptom } from '../api'
import { Card, Empty, Row, T } from '../components/ui'
import { useApp } from '../store'
import { SYM_EMOJI, SymptomForm } from './SymptomSheet'

const F_EMOJI: Record<string, string> = {
  alcohol: '🍷', caffeine: '☕', poor_sleep: '😴', stress: '😣', exercise: '🏃', missed_meds: '💊', heavy_meal: '🍽️',
}
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Daily lifestyle factors: big tap targets, saved on every tap; the doctor's report compares AF on days with and without. */
function DayFactors() {
  const { theme: tm, t, user, toast } = useApp()
  const [tags, setTags] = useState<string[] | null>(null)
  useEffect(() => {
    if (!user) return
    api.days(1).then(d => setTags(d.find(x => x.day === localDay())?.tags ?? null)).catch(() => undefined)
  }, [user])
  const save = async (next: string[]) => {
    setTags(next)
    try { await api.setDay(localDay(), next) } catch { toast(t('day_offline'), 'info') }
  }
  const toggle = (k: string) => save((tags ?? []).includes(k) ? (tags ?? []).filter(x => x !== k) : [...(tags ?? []), k])
  const chip = (on: boolean) => [s.chip, { backgroundColor: on ? tm.accentSoft : tm.bg2, borderColor: on ? tm.accent : tm.line }]
  return (
    <Card>
      <T v="h3">{t('day_title')}</T>
      <T v="small" style={{ marginTop: 2, marginBottom: 12 }}>{t('day_sub')}</T>
      <View style={s.chips}>
        {DAY_TAGS.map(k => {
          const on = !!tags?.includes(k)
          return <Pressable key={k} onPress={() => toggle(k)} style={chip(on)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <T style={{ fontSize: 18 }}>{F_EMOJI[k]}</T><T v="h3" style={{ fontSize: 15 }} c={on ? tm.accent : tm.ink}>{t(`f_${k}`)}</T>
          </Pressable>
        })}
        <Pressable onPress={() => save([])} style={chip(tags !== null && tags.length === 0)} accessibilityRole="button">
          <T style={{ fontSize: 18 }}>🙂</T><T v="h3" style={{ fontSize: 15 }}>{t('day_nothing')}</T>
        </Pressable>
      </View>
    </Card>
  )
}

type Item = { key: string; ts: number; kinds: string[]; severity: number; note?: string | null; synced: boolean }

export default function Diary() {
  const { theme: tm, t, user, symptoms, dataVersion, lang } = useApp()
  const [server, setServer] = useState<Symptom[] | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try { setServer((await api.report(24 * 30)).symptoms) } catch { /* offline */ }
    setLoading(false)
  }, [user])
  useEffect(() => { load() }, [load, dataVersion])

  const items: Item[] = [
    ...symptoms.filter(s => !s.synced || !server).map((s, i) => ({ key: `l${i}`, ts: s.ts, kinds: s.kinds, severity: s.severity, note: s.note, synced: s.synced })),
    ...(server ?? []).map(s => ({ key: `s${s.id}`, ts: new Date(s.ts).getTime(), kinds: s.kinds, severity: s.severity, note: s.note, synced: true })),
  ].sort((a, b) => b.ts - a.ts)

  const sevColor = [tm.ok, tm.warn, tm.af]
  let lastDay = ''

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <T v="h1">{t('diary_title')}</T>
      <T v="small" style={{ marginTop: 4, marginBottom: 18 }}>{t('diary_sub')}</T>
      {user && <View style={{ marginBottom: 14 }}><DayFactors /></View>}
      <Card><SymptomForm /></Card>

      <View style={{ marginTop: 22, gap: 10 }}>
        {items.length === 0 && <Empty icon="book" text={t('no_symptoms')} />}
        {items.map(it => {
          const day = fmtDate(lang, it.ts, { weekday: 'long', day: 'numeric', month: 'long' })
          const head = day !== lastDay ? (lastDay = day) : null
          return (
            <View key={it.key}>
              {head && <T v="label" style={{ marginTop: 8, marginBottom: 8 }}>{head}</T>}
              <Card style={{ padding: 14 }}>
                <Row style={{ alignItems: 'flex-start' }} gap={12}>
                  <View style={[s.sev, { backgroundColor: sevColor[it.severity - 1] }]} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <T v="h3">{it.kinds.map(k => `${SYM_EMOJI[k] ?? ''} ${t(k)}`).join('   ')}</T>
                    {it.note ? <T v="small" c={tm.ink2}>{it.note}</T> : null}
                    <T v="mono">{fmtDate(lang, it.ts, { hour: '2-digit', minute: '2-digit' })} · {t(`sev${it.severity}`)}{it.synced ? '' : ' · ⟳'}</T>
                  </View>
                </Row>
              </Card>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

const s = StyleSheet.create({
  sev: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
})
