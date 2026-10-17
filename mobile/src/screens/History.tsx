import { locOf } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { api, type EcgMeta, type Report } from '../api'
import { HourBars, HrLine } from '../components/Charts'
import { EcgStatic } from '../components/Ecg'
import { PoincarePlot, QualityPill } from '../components/Poincare'
import { analyze } from '../rr'
import { Card, Empty, Icon, Pill, Row, Seg, Sheet, Stat, T } from '../components/ui'
import { useApp } from '../store'
import { fmtDur } from './Monitor'

function EcgViewer({ meta, onClose }: { meta: EcgMeta | null; onClose: () => void }) {
  const { theme: tm, t, lang } = useApp()
  const [samples, setSamples] = useState<number[] | null>(null)
  useEffect(() => {
    setSamples(null)
    if (meta) api.ecgGet(meta.id).then(e => setSamples(e.samples)).catch(() => setSamples([]))
  }, [meta])
  const af = meta?.state === 2
  return (
    <Sheet open={!!meta} onClose={onClose} title={meta ? new Date(meta.ts).toLocaleString(locOf(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}>
      {meta && (
        <View style={{ gap: 14 }}>
          <Row gap={8}>
            <Pill text={t(af ? 'st_afib' : 'st_normal')} fg={af ? tm.af : tm.ok} bg={af ? tm.afSoft : tm.okSoft} />
            <T v="mono">{meta.duration_s} {t('s')} · {Math.round(meta.bpm)} {t('bpm')} · 25 mm/s</T>
          </Row>
          {samples == null ? <ActivityIndicator style={{ height: 160 }} /> :
            <EcgStatic samples={samples} fs={meta.fs} color={af ? tm.afInk : tm.ink} height={170} />}
          {samples && samples.length > 250 && (() => {
            const a = analyze(samples, meta.fs)
            return (
              <Row gap={14} style={{ alignItems: 'center' }}>
                <PoincarePlot points={a.poincare.points} color={af ? tm.af : tm.ok} size={150} />
                <View style={{ flex: 1, gap: 8 }}>
                  <QualityPill q={a.quality} />
                  <T v="small">SD1/SD2 {a.poincare.sd1 ?? '—'}/{a.poincare.sd2 ?? '—'} ms</T>
                  <T v="small" c={a.irregularity != null && a.irregularity > 0.1 ? tm.af : undefined}>{t('irregularity')}: {a.irregularity?.toFixed(2) ?? '—'}</T>
                </View>
              </Row>
            )
          })()}
          <T v="small">{t(meta.reason === 'afib_onset' ? 'auto_rec' : meta.reason === 'symptom' ? 'symptom_rec' : 'manual_rec')}</T>
        </View>
      )}
    </Sheet>
  )
}

export default function History() {
  const { theme: tm, t, user, episodes: local, dataVersion, lang } = useApp()
  const [hours, setHours] = useState(24)
  const [rep, setRep] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [ecg, setEcg] = useState<EcgMeta | null>(null)
  const loc = locOf(lang)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try { setRep(await api.report(hours)); setErr('') } catch (e) { setErr((e as Error).message) }
    setLoading(false)
  }, [user, hours])
  useEffect(() => { load() }, [load, dataVersion])

  const dt = (iso: string | number) => new Date(iso).toLocaleString(loc, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  if (!user) {
    return (
      <ScrollView contentContainerStyle={{ padding: 20 }}>
        <T v="h1">{t('tab_history')}</T>
        <T v="small" style={{ marginTop: 4, marginBottom: 18 }}>{t('login_needed')}</T>
        <Card>
          <T v="label" style={{ marginBottom: 6 }}>{t('on_phone')}</T>
          {local.length === 0 ? <Empty icon="heart" text={t('no_episodes')} /> : [...local].reverse().map((e, i) => (
            <Row key={i} style={[s.ep, { borderColor: tm.line }]}>
              <View style={[s.epBar, { backgroundColor: tm.af }]} />
              <View style={{ flex: 1 }}><T v="h3">{dt(e.start)}</T><T v="small">{fmtDur(t, (e.end - e.start) / 1000 + 3)} · {Math.round(e.maxBpm)} {t('bpm')}</T></View>
              <T v="mono">{Math.round(e.maxProb * 100)}%</T>
            </Row>
          ))}
        </Card>
      </ScrollView>
    )
  }

  const st = rep?.stats
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 14 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
        <T v="h1">{t('tab_history')}</T>
        <Seg value={hours} onChange={setHours} items={[[24, t('h24')], [168, t('d7')], [720, t('d30')]]} />
        {err ? <T v="small" c={tm.af}>{err}</T> : null}
        {!rep ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
          <>
            <Card>
              <Row gap={14}>
                <Stat label={t('burden')} value={`${(st!.af_burden * 100).toFixed(st!.af_burden < 0.1 ? 1 : 0)}%`} color={st!.af_burden > 0.05 ? tm.af : undefined} />
                <Stat label={t('episodes')} value={String(st!.episodes_count)} sub={st!.longest_episode_s ? `${t('longest')} ${fmtDur(t, st!.longest_episode_s)}` : undefined} />
              </Row>
              <View style={[s.hr, { backgroundColor: tm.line }]} />
              <Row gap={14}>
                <Stat label={t('pulse')} value={st!.hr_mean ? String(Math.round(st!.hr_mean)) : '—'} sub={st!.hr_min ? `${Math.round(st!.hr_min)}–${Math.round(st!.hr_max!)}` : undefined} />
                <Stat label={t('monitored')} value={fmtDur(t, st!.monitored_minutes * 60)} />
              </Row>
            </Card>

            <Card>
              <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <T v="h3">{t('af_minutes')}</T>
                <Row gap={10}>
                  <Row gap={4}><View style={[s.key, { backgroundColor: tm.okSoft }]} /><T v="small">{t('monitored')}</T></Row>
                  <Row gap={4}><View style={[s.key, { backgroundColor: tm.af }]} /><T v="small">AF</T></Row>
                </Row>
              </Row>
              <HourBars data={rep.hourly} />
            </Card>

            <Card>
              <T v="h3" style={{ marginBottom: 12 }}>{t('pulse')}, {t('bpm')}</T>
              <HrLine data={rep.hourly} />
            </Card>

            <Card>
              <T v="h3" style={{ marginBottom: 6 }}>{t('episodes')}</T>
              {rep.episodes.length === 0 ? <Empty icon="heart" text={t('no_episodes')} /> : rep.episodes.map((e, i) => {
                const strip = e.ecg_id ? rep.ecg.find(x => x.id === e.ecg_id) ?? null : null
                return (
                  <Row key={i} style={[s.ep, { borderColor: tm.line }]}>
                    <View style={[s.epBar, { backgroundColor: e.verdict === 'false_alarm' ? tm.ink3 : tm.af }]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T v="h3">{dt(e.start)}</T>
                      <T v="small">{fmtDur(t, e.duration_s)} · {e.mean_bpm ? Math.round(e.mean_bpm) : '—'} {t('bpm')}</T>
                      {e.verdict && <Pill text={t(e.verdict === 'confirmed' ? 'verdict_confirmed' : 'verdict_false')} fg={e.verdict === 'confirmed' ? tm.af : tm.ink2} bg={e.verdict === 'confirmed' ? tm.afSoft : tm.bg2} />}
                    </View>
                    {strip && (
                      <Card style={s.ecgBtn} onPress={() => setEcg(strip)} tone={tm.bg2}>
                        <Icon name="wave" size={16} color={tm.af} /><T v="mono" c={tm.ink}>ECG</T>
                      </Card>
                    )}
                  </Row>
                )
              })}
            </Card>

            <Card>
              <T v="h3" style={{ marginBottom: 6 }}>{t('ecg_records')}</T>
              {rep.ecg.length === 0 ? <Empty icon="wave" text="—" /> : rep.ecg.map(e => (
                <Row key={e.id} style={[s.ep, { borderColor: tm.line }]}>
                  <View style={[s.ecgIco, { backgroundColor: e.state === 2 ? tm.afSoft : tm.okSoft }]}><Icon name="wave" size={18} color={e.state === 2 ? tm.af : tm.ok} /></View>
                  <View style={{ flex: 1 }}>
                    <T v="h3">{dt(e.ts)}</T>
                    <T v="small">{t(e.reason === 'afib_onset' ? 'auto_rec' : e.reason === 'symptom' ? 'symptom_rec' : 'manual_rec')} · {Math.round(e.bpm)} {t('bpm')}</T>
                  </View>
                  <Card style={s.ecgBtn} onPress={() => setEcg(e)} tone={tm.bg2}><Icon name="chev" size={16} color={tm.ink2} /></Card>
                </Row>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
      <EcgViewer meta={ecg} onClose={() => setEcg(null)} />
    </View>
  )
}

const s = StyleSheet.create({
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 14 },
  key: { width: 10, height: 10, borderRadius: 3 },
  ep: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  epBar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  ecgBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  ecgIco: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
