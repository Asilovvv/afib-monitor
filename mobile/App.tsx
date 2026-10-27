import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans'
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono'
import { Unbounded_600SemiBold, Unbounded_700Bold } from '@expo-google-fonts/unbounded'
import { useFonts } from 'expo-font'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { Icon, Toasts, type IconName } from './src/components/ui'
import { RhythmState } from './src/protocol'
import Diary from './src/screens/Diary'
import History from './src/screens/History'
import Monitor from './src/screens/Monitor'
import Profile from './src/screens/Profile'
import { Auth, Onboarding } from './src/screens/Welcome'
import { FamilyHome } from './src/screens/Family'
import { AppProvider, useApp } from './src/store'
import { F } from './src/theme'

export default function App() {
  const [fonts] = useFonts({
    Unbounded_600SemiBold, Unbounded_700Bold, IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, JetBrainsMono_500Medium,
  })
  return (
    <SafeAreaProvider>
      <AppProvider>
        {fonts ? <Root /> : <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>}
      </AppProvider>
    </SafeAreaProvider>
  )
}

type Tab = 'monitor' | 'history' | 'diary' | 'profile'
const TABS: [Tab, IconName, string][] = [['monitor', 'heart', 'tab_monitor'], ['history', 'clock', 'tab_history'], ['diary', 'book', 'tab_diary'], ['profile', 'user', 'tab_profile']]

function Root() {
  const { ready, theme: tm, t, onboarded, user, offline, setOffline, status, source, stop } = useApp()
  const [tab, setTab] = useState<Tab>('monitor')
  const [authOpen, setAuthOpen] = useState(false)
  const fade = useRef(new Animated.Value(1)).current

  const switchTab = (k: Tab) => {
    if (k === tab) return
    fade.setValue(0.4); setTab(k)
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start()
  }
  useEffect(() => { if (user) setAuthOpen(false) }, [user])

  if (!ready) return <View style={{ flex: 1, backgroundColor: tm.bg, justifyContent: 'center' }}><ActivityIndicator color={tm.ink} /></View>
  const bar = <StatusBar style={tm.dark ? 'light' : 'dark'} />
  if (!onboarded) return <>{bar}<Onboarding /></>
  if ((!user && !offline) || authOpen) return <>{bar}<Auth onDone={() => setAuthOpen(false)} /></>

  if (user?.role === 'family') {                       // a relative: one screen, no sensor, no tabs
    return (
      <View style={{ flex: 1, backgroundColor: tm.bg }}>
        {bar}
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          {tab === 'profile' ? <Profile onSignIn={() => { setOffline(false); setAuthOpen(true) }} onBack={() => setTab('monitor')} /> : <FamilyHome onProfile={() => setTab('profile')} />}
        </SafeAreaView>
        <Toasts />
      </View>
    )
  }

  const af = status?.state === RhythmState.AFib
  return (
    <View style={{ flex: 1, backgroundColor: tm.bg }}>
      {bar}
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {source === 'simulator' && (
          <Pressable onPress={stop} style={[s.demoBand, { backgroundColor: tm.warnSoft }]} accessibilityRole="button">
            <Icon name="wave" size={14} color={tm.warn} />
            <Text style={[s.demoText, { color: tm.warn }]}>{t('demo_band')}</Text>
            <Text style={[s.demoText, { color: tm.warn, textDecorationLine: 'underline' }]}>{t('demo_stop')}</Text>
          </Pressable>
        )}
        <Animated.View style={{ flex: 1, opacity: fade }}>
          {tab === 'monitor' && <Monitor go={switchTab} />}
          {tab === 'history' && <History />}
          {tab === 'diary' && <Diary />}
          {tab === 'profile' && <Profile onSignIn={() => { setOffline(false); setAuthOpen(true) }} />}
        </Animated.View>
      </SafeAreaView>
      <SafeAreaView edges={['bottom']} style={[s.tabs, { backgroundColor: tm.card, borderTopColor: tm.line }]}>
        <View style={s.tabRow}>
          {TABS.map(([k, icon, label]) => {
            const on = tab === k
            return (
              <Pressable key={k} style={s.tab} onPress={() => switchTab(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <View style={[s.tabPill, on && { backgroundColor: tm.bg2 }]}>
                  <Icon name={icon} size={21} color={on ? tm.ink : tm.ink3} fill={on && k === 'monitor' ? (af ? tm.af : tm.ink) : undefined} width={on ? 2 : 1.7} />
                  {k === 'monitor' && af && tab !== 'monitor' && <View style={[s.badge, { backgroundColor: tm.af, borderColor: tm.card }]} />}
                </View>
                <Text style={{ fontFamily: on ? F.semi : F.medium, fontSize: 11, color: on ? tm.ink : tm.ink3 }}>{t(label)}</Text>
              </Pressable>
            )
          })}
        </View>
      </SafeAreaView>
      <Toasts />
    </View>
  )
}

const s = StyleSheet.create({
  demoBand: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  demoText: { fontSize: 12.5, fontWeight: '600' },
  tabs: { borderTopWidth: StyleSheet.hairlineWidth },
  tabRow: { flexDirection: 'row', paddingTop: 6, paddingBottom: 4 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabPill: { width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 3, right: 12, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
})
