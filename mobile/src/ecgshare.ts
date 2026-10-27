import { Platform } from 'react-native'
import type { Lang } from './i18n'
import { ecgHtml, type PdfStrip } from './ecgpdf'

/** Make the PDF on the phone and open the share sheet. Returns false when printing is unavailable (web: opens print). */
export async function shareEcgPdf(strip: PdfStrip, lang: Lang, withName: boolean, fileName = 'afib_ecg.pdf'): Promise<boolean> {
  const html = ecgHtml(strip, lang, withName)
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank'); if (!w) return false
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 300)
    return true
  }
  try {
    const Print: typeof import('expo-print') = require('expo-print')
    const Sharing: typeof import('expo-sharing') = require('expo-sharing')
    const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 })   // A4 landscape in points
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: fileName, UTI: 'com.adobe.pdf' })
    return true
  } catch { return false }
}
