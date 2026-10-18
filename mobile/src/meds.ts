/** Daily medicine reminders as local notifications: they fire even when the phone is offline or the app is closed. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { Med } from './api'
import { translate, type Lang } from './i18n'

const K_IDS = 'afib.medNotif'

export async function scheduleMedReminders(meds: Med[], lang: Lang) {
  if (Platform.OS === 'web') return
  try {
    const old: string[] = JSON.parse((await AsyncStorage.getItem(K_IDS)) ?? '[]')
    await Promise.all(old.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)))
    const ids: string[] = []
    for (const m of meds.filter(x => x.active)) {
      for (const t of m.times) {
        const [hour, minute] = t.split(':').map(Number)
        ids.push(await Notifications.scheduleNotificationAsync({
          content: {
            title: translate(lang, m.anticoagulant ? 'med_notif_ac' : 'med_notif_t'),
            body: `${m.name}${m.dose ? ' · ' + m.dose : ''} · ${t}`,
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
        }))
      }
    }
    await AsyncStorage.setItem(K_IDS, JSON.stringify(ids))
  } catch { /* permissions refused: the in-app list still works */ }
}
