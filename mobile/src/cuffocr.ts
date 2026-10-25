/** Reading a home blood-pressure cuff from a photo.
 *  The OCR engine (Google ML Kit, on the phone, no upload) returns text blocks with their boxes. This file turns them
 *  into a guess for systolic / diastolic / pulse. It is a GUESS: the app shows it in editable fields and nothing is
 *  saved until the person confirms. When unsure, a field stays empty rather than "close". Pure TypeScript: tested
 *  without a phone in tools/mobile/cuffocr_test.ts. */

export type OcrBlock = { text: string; frame?: { left: number; top: number; width: number; height: number } | null }
export type CuffGuess = { systolic: number | null; diastolic: number | null; pulse: number | null; confidence: 'high' | 'low' | 'none' }

const LIM = { sys: [60, 260], dia: [30, 160], pulse: [20, 250] } as const
const inR = (v: number, r: readonly [number, number]) => v >= r[0] && v <= r[1]

type Num = { v: number; top: number; height: number; left: number }

/** Digits as cuff displays show them: OCR often reads 7-segment "1" as "l"/"I" and "0" as "O". */
function cleanDigits(s: string): string {
  return s.replace(/[oO]/g, '0').replace(/[lI|]/g, '1').replace(/[sS]/g, '5').replace(/[bB]/g, '8')
}

function numbersOf(blocks: OcrBlock[]): Num[] {
  const out: Num[] = []
  for (const b of blocks) {
    const lines = b.text.split(/\n+/)
    const n = lines.length
    lines.forEach((line, i) => {
      // skip units and labels; keep standalone 2-3 digit groups
      const l = cleanDigits(line).replace(/mmHg|мм\s*рт|kPa|SYS|DIA|PUL|PULSE|min|мин/gi, ' ')
      for (const m of l.matchAll(/(?<![\d.,:])(\d{2,3})(?![\d.,:])/g)) {
        const v = Number(m[1])
        const f = b.frame
        const top = f ? f.top + (f.height * i) / n : out.length * 100
        out.push({ v, top, height: f ? f.height / n : 10, left: f ? f.left : 0 })
      }
    })
  }
  return out
}

/** Main rule: cuffs show SYS above DIA above PULSE, SYS > DIA, in large digits. Dates/times/memory numbers are the
 *  usual false positives; the range limits and the ordering reject most of them. */
export function guessCuff(blocks: OcrBlock[]): CuffGuess {
  const nums = numbersOf(blocks).sort((a, b) => a.top - b.top)
  const none: CuffGuess = { systolic: null, diastolic: null, pulse: null, confidence: 'none' }
  if (nums.length < 2) return none
  // candidates: any ordered pair (sys above dia) within ranges, sys > dia; prefer the pair with the largest digits
  let best: { s: Num; d: Num; score: number } | null = null
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      const s = nums[i], d = nums[j]
      if (!inR(s.v, LIM.sys) || !inR(d.v, LIM.dia) || s.v <= d.v) continue
      const size = s.height + d.height
      const gap = Math.abs(s.height - d.height) / Math.max(1, Math.max(s.height, d.height))   // same font size on a cuff
      const score = size * (1 - gap) - (j - i - 1) * 2                                           // adjacent rows preferred
      if (!best || score > best.score) best = { s, d, score }
    }
  }
  if (!best) return none
  const below = nums.filter(n => n.top > best!.d.top && inR(n.v, LIM.pulse) && n !== best!.s && n !== best!.d)
  const pulse = below.length ? below[0].v : null
  const plausible = best.s.v - best.d.v >= 15 && best.s.v - best.d.v <= 120
  const confidence: CuffGuess['confidence'] = plausible && (pulse != null || nums.length <= 4) ? 'high' : 'low'
  return { systolic: best.s.v, diastolic: best.d.v, pulse, confidence }
}
