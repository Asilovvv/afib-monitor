import { Platform } from 'react-native'
import { guessCuff, type CuffGuess, type OcrBlock } from './cuffocr'

/** Take a photo of a blood-pressure cuff and read the numbers ON THE PHONE (Google ML Kit, offline).
 *  The photo is not saved to the gallery and is never sent to the server: only the three numbers go into editable
 *  fields. Native modules are required lazily so the web build and Expo Go (where they are absent) keep working. */
export async function readCuffFromCamera(): Promise<CuffGuess | 'unavailable' | 'denied' | 'cancelled'> {
  if (Platform.OS === 'web') return 'unavailable'
  let picker: typeof import('expo-image-picker'), ocr: typeof import('@react-native-ml-kit/text-recognition').default
  try {
    picker = require('expo-image-picker')
    ocr = require('@react-native-ml-kit/text-recognition').default
  } catch { return 'unavailable' }
  const perm = await picker.requestCameraPermissionsAsync()
  if (!perm.granted) return 'denied'
  const shot = await picker.launchCameraAsync({ quality: 0.7, allowsEditing: false, exif: false, base64: false })
  if (shot.canceled || !shot.assets?.[0]?.uri) return 'cancelled'
  try {
    const res = await ocr.recognize(shot.assets[0].uri)
    const lines: OcrBlock[] = res.blocks.flatMap(b => b.lines.length ? b.lines.map(l => ({ text: l.text, frame: l.frame ?? null })) : [{ text: b.text, frame: b.frame ?? null }])
    return guessCuff(lines)
  } catch { return { systolic: null, diastolic: null, pulse: null, confidence: 'none' } }
}
