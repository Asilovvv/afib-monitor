import { Platform } from 'react-native'
import type { Lang } from './i18n'

/** Voice prompts during a check, for people who cannot read a small screen while sitting still.
 *  Russian / English: the phone's own speech engine (offline on iOS; on Android when the Google voice is downloaded).
 *  Kyrgyz: there is no system voice on iOS or Android as far as we could find (docs/voice/PHRASES.md), so Kyrgyz plays
 *  pre-recorded files from assets/voice/ky/ once a native speaker records them; until then, Kyrgyz falls back to the
 *  phone's Russian voice. Everything here is wording from i18n, no medical content beyond the on-screen verdict words.
 *  One switch in Profile; off by default. */
export type PhraseId = 'sit' | 'start' | 'half' | 'ten' | 'done' | 'regular' | 'irregular' | 'confirm' | 'no_verdict' | 'poor'

export const PHRASES: Record<Lang, Record<PhraseId, string>> = {
  ru: {
    sit: 'Сядьте удобно, положите руки на колени и не разговаривайте.',
    start: 'Начинаем. Тридцать секунд. Сидите спокойно.',
    half: 'Осталось пятнадцать секунд.',
    ten: 'Осталось десять секунд.',
    done: 'Готово.',
    regular: 'Ритм ровный.',
    irregular: 'Ритм неровный. Покажите запись врачу.',
    confirm: 'Ритм показался неровным. Пожалуйста, посидите спокойно и проверьте ещё раз.',
    no_verdict: 'Не удалось прочитать запись. Поправьте электроды и повторите.',
    poor: 'Сигнал слабый. Проверьте электроды.',
  },
  ky: {
    sit: 'Жайланышып отуруңуз, колуңузду тизеңизге коюңуз жана сүйлөбөңүз.',
    start: 'Баштайбыз. Отуз секунд. Тынч отуруңуз.',
    half: 'Он беш секунд калды.',
    ten: 'Он секунд калды.',
    done: 'Даяр.',
    regular: 'Ритм бирдей.',
    irregular: 'Ритм бирдей эмес. Жазууну дарыгерге көрсөтүңүз.',
    confirm: 'Ритм бирдей эмес сыяктуу. Тынч отуруп, дагы бир жолу текшериңиз.',
    no_verdict: 'Жазуу окулбады. Электроддорду оңдоп, кайталаңыз.',
    poor: 'Сигнал начар. Электроддорду текшериңиз.',
  },
  en: {
    sit: 'Sit comfortably, rest your hands on your knees and do not talk.',
    start: 'Starting. Thirty seconds. Sit still.',
    half: 'Fifteen seconds left.',
    ten: 'Ten seconds left.',
    done: 'Done.',
    regular: 'The rhythm is regular.',
    irregular: 'The rhythm is irregular. Show the recording to your doctor.',
    confirm: 'The rhythm looked irregular. Please sit still and check once more.',
    no_verdict: 'Could not read the recording. Adjust the electrodes and try again.',
    poor: 'Weak signal. Check the electrodes.',
  },
}

/** Recorded Kyrgyz files go here once a native speaker records them (see docs/voice/PHRASES.md). Keep as `null`
 *  until the file exists: `require` of a missing asset breaks the bundle. */
const KY_FILES: Partial<Record<PhraseId, number | null>> = {
  // sit: require('../assets/voice/ky/sit.m4a'),
}

const TTS_LANG: Record<Lang, string> = { ru: 'ru-RU', ky: 'ky-KG', en: 'en-US' }
let enabled = false
let lastId: PhraseId | null = null
let lastAt = 0

export function setVoiceEnabled(on: boolean) { enabled = on }
export function voiceEnabled() { return enabled }

/** Does the phone have a voice for this language? Used by the settings row to show "кыргызский голос: нет". */
export async function hasSystemVoice(lang: Lang): Promise<boolean> {
  if (Platform.OS === 'web') return typeof window !== 'undefined' && 'speechSynthesis' in window
  try {
    const Speech: typeof import('expo-speech') = require('expo-speech')
    const voices = await Speech.getAvailableVoicesAsync()
    const code = TTS_LANG[lang].slice(0, 2).toLowerCase()
    return voices.some(v => v.language.toLowerCase().startsWith(code))
  } catch { return false }
}

export async function say(id: PhraseId, lang: Lang) {
  if (!enabled) return
  if (id === lastId && Date.now() - lastAt < 4000) return      // no stutter on re-renders
  lastId = id; lastAt = Date.now()
  if (Platform.OS === 'web') { webSay(PHRASES[lang][id], TTS_LANG[lang]); return }
  try {
    if (lang === 'ky') {
      const file = KY_FILES[id]
      if (file) { await playFile(file); return }
      if (!(await hasSystemVoice('ky'))) lang = 'ru'            // documented fallback until recordings exist
    }
    const Speech: typeof import('expo-speech') = require('expo-speech')
    Speech.stop()
    Speech.speak(PHRASES[lang][id], { language: TTS_LANG[lang], rate: 0.92 })
  } catch { /* no engine: silent, the screen still shows everything */ }
}

export function stopVoice() {
  try { if (Platform.OS === 'web') window.speechSynthesis?.cancel(); else (require('expo-speech') as typeof import('expo-speech')).stop() } catch { /* ignore */ }
}

async function playFile(src: number) {
  const Audio: typeof import('expo-audio') = require('expo-audio')
  const player = Audio.createAudioPlayer(src)
  player.play()
  await new Promise(r => setTimeout(r, 4000))
  player.remove()
}

function webSay(text: string, lang: string) {
  try {
    const u = new SpeechSynthesisUtterance(text); u.lang = lang; u.rate = 0.92
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u)
  } catch { /* ignore */ }
}
