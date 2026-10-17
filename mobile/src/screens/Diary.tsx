import { locOf } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { api, type Symptom } from '../api'
import { Card, Empty, Row, T } from '../components/ui'
import { useApp } from '../store'
import { SYM_EMOJI, SymptomForm } from './SymptomSheet'

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
  const loc = locOf(lang)
  let lastDay = ''

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <T v="h1">{t('diary_title')}</T>
      <T v="small" style={{ marginTop: 4, marginBottom: 18 }}>{t('diary_sub')}</T>
      <Card><SymptomForm /></Card>

      <View style={{ marginTop: 22, gap: 10 }}>
        {items.length === 0 && <Empty icon="book" text={t('no_symptoms')} />}
        {items.map(it => {
          const day = new Date(it.ts).toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' })
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
                    <T v="mono">{new Date(it.ts).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })} · {t(`sev${it.severity}`)}{it.synced ? '' : ' · ⟳'}</T>
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

const s = StyleSheet.create({ sev: { width: 4, alignSelf: 'stretch', borderRadius: 2 } })
