import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Linking } from 'react-native'
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg'
import { QualityPill, useLiveAnalysis } from '../components/Poincare'
import { Button, Icon, Ring, Row, Sheet, T } from '../components/ui'
import { CHECK_SECONDS } from '../rr'
import { useApp, type CheckResult } from '../store'
import { F } from '../theme'
import { callSos } from './Monitor'

/** "Check me in 30 seconds": one big ring, then one big answer. Wording is wellness-only:
 *  "regular / irregular — show your doctor / could not read", never a diagnosis.
 *  "Irregular" is shown only after two irregular checks in a row (ml/REPEAT_LTAFDB.md: AF minutes found 93.6 -> 92.3 %,
 *  false "irregular" on normal rhythm 13.2 -> 8.7 %). After the first one the app asks to check again. */
const CONFIRM_WINDOW_MS = 10 * 60e3
let firstIrregularAt = 0            // survives closing the sheet; a repeat within 10 minutes confirms it
type Shown = CheckResult & { stage: 'final' | 'confirm' | 'mixed' }
export function CheckSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme: tm, t, checking, checkMe, user, ecg } = useApp()
  const doctorPhone = user?.doctor?.phone?.replace(/\s/g, '')
  const [res, setRes] = useState<Shown | null>(null)
  const [prep, setPrep] = useState(true)
  const live = useLiveAnalysis(ecg, 8)          // last 8 s: is the signal good enough right now?

  const run = async () => {
    setPrep(false)
    setRes(null)
    const r = await checkMe()
    if (!r) { onClose(); return }
    const pending = Date.now() - firstIrregularAt < CONFIRM_WINDOW_MS
    if (r.verdict === 'irregular' && !pending) { firstIrregularAt = Date.now(); setRes({ ...r, stage: 'confirm' }); return }
    if (pending && r.verdict !== 'no_verdict') {
      firstIrregularAt = 0
      setRes(r.verdict === 'irregular' ? { ...r, stage: 'final' } : { ...r, verdict: 'no_verdict', stage: 'mixed' })
      return
    }
    setRes({ ...r, stage: 'final' })
  }
  useEffect(() => { if (!open) { setRes(null); setPrep(true) } }, [open])
  const signal = !live ? <T v="small" c={tm.ink3}>{t('signal_wait')}</T> : (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <QualityPill q={live.quality} />
      {live.quality.level === 'poor' && <T v="small" c={tm.af} style={{ textAlign: 'center' }}>{t('signal_poor')}</T>}
    </View>
  )

  const confirm = res?.stage === 'confirm'
  const look = confirm ? { c: tm.accent, soft: tm.accentSoft, icon: 'sync' as const }
    : res?.verdict === 'regular' ? { c: tm.ok, soft: tm.okSoft, icon: 'check' as const }
    : res?.verdict === 'irregular' ? { c: tm.warn, soft: tm.warnSoft, icon: 'sos' as const }
    : { c: tm.ink2, soft: tm.bg2, icon: 'signal' as const }
  const secs = Math.round((checking ?? 0) * CHECK_SECONDS)

  return (
    <Sheet open={open} onClose={onClose} title={t('check_btn')}>
      {prep ? (
        <View style={s.center}>
          <ElectrodeMap />
          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 14 }}>
            {(['check_prep_1', 'check_prep_2', 'check_prep_3'] as const).map(k => (
              <Row key={k} gap={10}><Icon name="check" color={tm.ok} size={18} /><T style={{ flex: 1, fontSize: 16, lineHeight: 22 }}>{t(k)}</T></Row>
            ))}
          </View>
          <View style={{ marginTop: 16 }}>{signal}</View>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 18 }}>
            <Button title={t('check_start')} icon="heart" onPress={run} />
            <Button title={t('close')} kind="ghost" onPress={onClose} />
          </View>
        </View>
      ) : !res ? (
        <View style={s.center}>
          <View style={s.ring}>
            <Ring size={190} stroke={12} progress={checking ?? 0} color={tm.accent} track={tm.bg2} />
            <T style={[s.big, { color: tm.ink }]}>{CHECK_SECONDS - secs}</T>
            <T v="small">{t('s')}</T>
          </View>
          <T v="h3" style={{ marginTop: 18, textAlign: 'center' }}>{t('check_running', { s: secs })}</T>
          <T v="small" style={{ marginTop: 6, textAlign: 'center' }}>{t('check_sub')}</T>
          <View style={{ marginTop: 12 }}>{signal}</View>
        </View>
      ) : (
        <View style={s.center}>
          <View style={[s.badge, { backgroundColor: look.soft }]}><Icon name={look.icon} color={look.c} size={54} /></View>
          <T style={[s.verdict, { color: look.c }]}>{confirm ? t('check_confirm') : res.stage === 'mixed' ? t('check_mixed') : t(`check_${res.verdict}`)}</T>
          {res.verdict !== 'no_verdict' && <T v="num" style={{ fontSize: 22, marginTop: 4 }}>{res.bpm} {t('bpm')}</T>}
          <T style={[s.sub, { color: tm.ink2 }]}>{res.gaps ? t('check_gaps') : confirm ? t('check_confirm_sub') : res.stage === 'mixed' ? t('check_mixed_sub') : t(`check_${res.verdict}_sub`)}</T>
          {res.verdict !== 'no_verdict' && <T v="small" style={{ marginTop: 10 }}>✓ {t(user?.doctor ? 'check_saved' : 'check_saved_local')}</T>}
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 22 }}>
            {/* an irregular rhythm without symptoms is a reason to show the doctor, not an emergency: doctor first,
                103 only with the warning symptoms named on the button */}
            {res.verdict === 'irregular' && !confirm && doctorPhone &&
              <Button title={t('call_doctor')} kind="primary" icon="stetho" onPress={() => Linking.openURL(`tel:${doctorPhone}`).catch(() => undefined)} />}
            <Button title={t('check_again')} kind={res.verdict === 'irregular' && !confirm && doctorPhone ? 'soft' : 'primary'} icon="sync" onPress={run} />
            {res.verdict === 'irregular' && !confirm && <Button title={t('sos_if')} kind="ghost" icon="phone" onPress={() => callSos(t)} />}
            <Button title={t('close')} kind="ghost" onPress={onClose} />
          </View>
        </View>
      )}
    </Sheet>
  )
}

/** Where the three electrodes go (front view: the person's right side is on the left of the picture). */
function ElectrodeMap() {
  const { theme: tm, t } = useApp()
  const dot = (cx: number, cy: number, c: string, l: string) => (<>
    <Circle cx={cx} cy={cy} r={9} fill={c} stroke="#fff" strokeWidth={2} />
    <SvgText x={cx} y={cy + 4} fontSize={10} fontWeight="bold" fill="#fff" textAnchor="middle">{l}</SvgText>
  </>)
  return (
    <Row gap={14} style={{ alignSelf: 'stretch', alignItems: 'center' }}>
      <Svg width={120} height={140} viewBox="0 0 120 140">
        <Circle cx={60} cy={22} r={16} fill={tm.bg2} stroke={tm.line} />
        <Path d="M22 50 Q60 34 98 50 L104 132 L16 132 Z" fill={tm.bg2} stroke={tm.line} />
        {dot(38, 56, '#E0433F', 'R')}{dot(82, 56, '#E8B400', 'L')}{dot(80, 112, '#1F9D55', 'F')}
      </Svg>
      <View style={{ flex: 1, gap: 6 }}>
        <T v="small" c="#E0433F">● {t('el_r')}</T>
        <T v="small" c={tm.warn}>● {t('el_l')}</T>
        <T v="small" c={tm.ok}>● {t('el_f')}</T>
      </View>
    </Row>
  )
}

const s = StyleSheet.create({
  center: { alignItems: 'center', paddingVertical: 12 },
  ring: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center' },
  big: { fontFamily: F.displayBold, fontSize: 64, lineHeight: 70, letterSpacing: -2 },
  badge: { width: 104, height: 104, borderRadius: 52, alignItems: 'center', justifyContent: 'center' },
  verdict: { fontFamily: F.displayBold, fontSize: 30, marginTop: 16, textAlign: 'center' },
  sub: { fontFamily: F.body, fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 10, paddingHorizontal: 8 },
})
