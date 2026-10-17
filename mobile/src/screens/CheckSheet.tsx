import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Icon, Ring, Sheet, T } from '../components/ui'
import { CHECK_SECONDS } from '../rr'
import { useApp, type CheckResult } from '../store'
import { F } from '../theme'
import { callSos } from './Monitor'

/** "Check me in 30 seconds": one big ring, then one big answer. Wording is wellness-only:
 *  "regular / irregular — show your doctor / could not read", never a diagnosis. */
export function CheckSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { theme: tm, t, checking, checkMe } = useApp()
  const [res, setRes] = useState<CheckResult | null>(null)

  const run = async () => { setRes(null); const r = await checkMe(); if (r) setRes(r); else onClose() }
  useEffect(() => { if (open) run(); else setRes(null) }, [open])  // eslint-disable-line react-hooks/exhaustive-deps

  const look = res?.verdict === 'regular' ? { c: tm.ok, soft: tm.okSoft, icon: 'check' as const }
    : res?.verdict === 'irregular' ? { c: tm.warn, soft: tm.warnSoft, icon: 'sos' as const }
    : { c: tm.ink2, soft: tm.bg2, icon: 'signal' as const }
  const secs = Math.round((checking ?? 0) * CHECK_SECONDS)

  return (
    <Sheet open={open} onClose={onClose} title={t('check_btn')}>
      {!res ? (
        <View style={s.center}>
          <View style={s.ring}>
            <Ring size={190} stroke={12} progress={checking ?? 0} color={tm.accent} track={tm.bg2} />
            <T style={[s.big, { color: tm.ink }]}>{CHECK_SECONDS - secs}</T>
            <T v="small">{t('s')}</T>
          </View>
          <T v="h3" style={{ marginTop: 18, textAlign: 'center' }}>{t('check_running', { s: secs })}</T>
          <T v="small" style={{ marginTop: 6, textAlign: 'center' }}>{t('check_sub')}</T>
        </View>
      ) : (
        <View style={s.center}>
          <View style={[s.badge, { backgroundColor: look.soft }]}><Icon name={look.icon} color={look.c} size={54} /></View>
          <T style={[s.verdict, { color: look.c }]}>{t(`check_${res.verdict}`)}</T>
          {res.verdict !== 'no_verdict' && <T v="num" style={{ fontSize: 22, marginTop: 4 }}>{res.bpm} {t('bpm')}</T>}
          <T style={[s.sub, { color: tm.ink2 }]}>{t(`check_${res.verdict}_sub`)}</T>
          {res.verdict !== 'no_verdict' && <T v="small" style={{ marginTop: 10 }}>✓ {t('check_saved')}</T>}
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 22 }}>
            {res.verdict === 'irregular' && <Button title="SOS · 103" kind="danger" icon="phone" onPress={() => callSos(t)} />}
            <Button title={t('check_again')} kind={res.verdict === 'irregular' ? 'ghost' : 'primary'} icon="sync" onPress={run} />
            <Button title={t('close')} kind="ghost" onPress={onClose} />
          </View>
        </View>
      )}
    </Sheet>
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
