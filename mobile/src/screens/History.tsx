import { locOf } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { api, type EcgMeta, type Report } from '../api'
import { HourBars, HrLine } from '../components/Charts'
import { EcgStatic } from '../components/Ecg'
import { PoincarePlot, QualityPill } from '../components/Poincare'
import { analyze } from '../rr'
import { Button, Card, Empty, Icon, Pill, Row, Seg, Sheet, Stat, T } from '../components/ui'
import { useApp } from '../store'
import { shareEcgPdf } from '../ecgshare'
import { check } from '../rr'
import { F } from '../theme'
import { fmtDur } from './Monitor'

function EcgViewer({ meta, onClose }: { meta: EcgMeta | null; onClose: () => void }) {
  const { theme: tm, t, lang, user, toast } = useApp()
  const [samples, setSamples] = useState<number[] | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
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
          {samples && samples.length > 0 && (
            <Button title={t('pdf_share')} kind="soft" icon="send" loading={pdfBusy} onPress={async () => {
              setPdfBusy(true)
              const v = meta.reason === 'check' ? check(samples, meta.fs).verdict : null
              const ok = await shareEcgPdf({ samples, fs: meta.fs, ts: new Date(meta.ts).getTime(), bpm: meta.bpm, verdict: v, name: user?.name, device: 'AFib Monitor' }, lang, !!user)
              setPdfBusy(false)
              if (!ok) toast(t('pdf_fail'), 'info')
            }} />
          )}
          <T v="small" c={tm.ink3} style={{ lineHeight: 17 }}>{t('pdf_hint')}</T>
        </View>
      )}
    </Sheet>
  )
}

export default function History() {
  const { theme: tm, t, user, episodes: local, dataVersion, lang, mode } = useApp()
  const wellness = mode === 'wellness'
  const [hours, setHours] = useState(24)
  const [rep, setRep] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [ecg, setEcg] = useState<EcgMeta | null>(null)
  const loc = locOf(lang)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try { setRep(await api.report(hours)); setErr('') } catch (e) { setErr(t((e as Error).message)) }
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
        {hours === 168 && rep && <WeekCard rep={rep} />}
        {err ? <T v="small" c={tm.af}>{err}</T> : null}
        {!rep ? <ActivityIndicator style={{ marginTop: 40 }} /> : (
          <>
            {!wellness && <Card>
              <Row gap={14}>
                <Stat label={t('burden')} value={`${(st!.af_burden * 100).toFixed(st!.af_burden < 0.1 ? 1 : 0)}%`} color={st!.af_burden > 0.05 ? tm.af : undefined} />
                <Stat label={t('episodes')} value={String(st!.episodes_count)} sub={st!.longest_episode_s ? `${t('longest')} ${fmtDur(t, st!.longest_episode_s)}` : undefined} />
              </Row>
              <View style={[s.hr, { backgroundColor: tm.line }]} />
              <Row gap={14}>
                <Stat label={t('pulse')} value={st!.hr_mean ? String(Math.round(st!.hr_mean)) : '—'} sub={st!.hr_min ? `${Math.round(st!.hr_min)}–${Math.round(st!.hr_max!)}` : undefined} />
                <Stat label={t('monitored')} value={fmtDur(t, st!.monitored_minutes * 60)} />
              </Row>
            </Card>}
            {wellness && <Card><Row gap={14}>
              <Stat label={t('pulse')} value={st!.hr_mean ? String(Math.round(st!.hr_mean)) : '—'} sub={st!.hr_min ? `${Math.round(st!.hr_min)}–${Math.round(st!.hr_max!)}` : undefined} />
              <Stat label={t('monitored')} value={fmtDur(t, st!.monitored_minutes * 60)} />
            </Row></Card>}

            {!wellness && <Card>
              <Row style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                <T v="h3">{t('af_minutes')}</T>
                <Row gap={10}>
                  <Row gap={4}><View style={[s.key, { backgroundColor: tm.okSoft }]} /><T v="small">{t('monitored')}</T></Row>
                  <Row gap={4}><View style={[s.key, { backgroundColor: tm.af }]} /><T v="small">{t('af_abbr')}</T></Row>
                </Row>
              </Row>
              <HourBars data={rep.hourly} />
            </Card>}

            {!!rep.hr_events?.length && <Card>
              <T v="h3" style={{ marginBottom: 4 }}>{t('hr_events')}</T>
              <T v="small" style={{ marginBottom: 10 }}>{t('hr_note')}</T>
              {rep.hr_events.slice(-5).reverse().map(e => (
                <Row key={e.start} gap={10} style={{ paddingVertical: 8 }}>
                  <View style={[s.key, { backgroundColor: e.kind === 'low' ? '#5B8DEF' : tm.af, width: 10, height: 10, borderRadius: 5 }]} />
                  <View style={{ flex: 1 }}>
                    <T v="h3">{e.kind === 'low' ? t('hr_low') : t('hr_high')} · {e.bpm} {t('bpm')}</T>
                    <T v="small">{new Date(e.start).toLocaleString(locOf(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {fmtDur(t, e.duration_s)}</T>
                  </View>
                </Row>
              ))}
            </Card>}

            <Card>
              <T v="h3" style={{ marginBottom: 12 }}>{t('pulse')}, {t('bpm')}</T>
              <HrLine data={rep.hourly} />
            </Card>

            {!wellness && <Card>
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
                        <Icon name="wave" size={16} color={tm.af} /><T v="mono" c={tm.ink}>{t('ecg_abbr')}</T>
                      </Card>
                    )}
                  </Row>
                )
              })}
            </Card>}

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


/** "My week" in plain words: checks and their words, typed-in blood pressure, pills. No AF figures, no conclusions. */
function WeekCard({ rep }: { rep: Report }) {
  const { theme: tm, t } = useApp()
  const ck = rep.checks, v = rep.vitals, meds = rep.medications ?? []
  const empty = !ck?.checks && !v?.bp && !meds.some(m => m.due)
  return (
    <Card>
      <Row gap={8}><T style={{ fontSize: 20 }}>📅</T><T v="h3">{t('week_title')}</T></Row>
      <T v="small" style={{ marginTop: 4, marginBottom: 10 }}>{t('week_sub')}</T>
      {empty ? <T v="small" c={tm.ink3}>{t('week_none')}</T> : (
        <View style={{ gap: 10 }}>
          {ck && ck.checks + ck.due > 0 && (
            <View>
              <T v="label">{t('week_checks')}</T>
              <T style={{ fontSize: 17, lineHeight: 24 }}>
                <T style={{ fontFamily: F.displayBold, fontSize: 22 }}>{ck.checks}</T>
                {ck.due > 0 ? ` · ${ck.done} ${t('week_of')} ${ck.due} ${t('week_plan')}` : ''}
              </T>
              <T v="small">{ck.regular} {t('week_regular')} · {ck.irregular} {t('week_irregular')} · {ck.no_verdict} {t('week_unread')}
                {ck.confirmed_irregular ? ` · ${t('week_twice')}: ${ck.confirmed_irregular}` : ''}</T>
              {ck.due > 0 && <T v="small" c={ck.done >= ck.due ? tm.ok : tm.warn} style={{ marginTop: 4 }}>{ck.done >= ck.due ? t('week_good') : t('week_some')}</T>}
            </View>
          )}
          {v?.bp && (
            <View>
              <T v="label">{t('week_bp')}</T>
              <T style={{ fontSize: 17 }}><T style={{ fontFamily: F.displayBold, fontSize: 22 }}>{v.bp.sys_mean}/{v.bp.dia_mean}</T> {t('week_bp_mean')} · {v.bp.sys_min}–{v.bp.sys_max}/{v.bp.dia_min}–{v.bp.dia_max} · {v.bp.n} {t('vit_entries')}</T>
            </View>
          )}
          {meds.filter(m => m.due).length > 0 && (
            <View>
              <T v="label">{t('week_meds')}</T>
              {meds.filter(m => m.due).map(m => <T key={m.id} v="small">{m.name}: {t('week_taken')} {m.taken} {t('week_of')} {m.due}</T>)}
            </View>
          )}
        </View>
      )}
    </Card>
  )
}
