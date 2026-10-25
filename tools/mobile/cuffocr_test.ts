/* Unit test for the cuff-photo parser: synthetic OCR layouts of common home cuffs (Omron / AND / Microlife style).
   Run: npx -y tsx@4.19.2 tools/mobile/cuffocr_test.ts   (CI does this). Real-photo accuracy is measured separately
   on 20 photos when a device is in hand; this only pins the rules. */
import { guessCuff, type OcrBlock } from '../../mobile/src/cuffocr'

const L = (text: string, top: number, h = 60, left = 100): OcrBlock => ({ text, frame: { left, top, width: 200, height: h } })
let fails = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

// 1. classic three rows, labels on the side
eq('omron', guessCuff([L('SYS 128', 100), L('DIA 82', 200), L('PUL 67', 300)]), { systolic: 128, diastolic: 82, pulse: 67, confidence: 'high' })
// 2. date/time on top in small digits must not win
eq('date row', guessCuff([L('25.10 08:15', 20, 20), L('mmHg', 60, 15), L('142', 100), L('91', 200), L('58', 300)]), { systolic: 142, diastolic: 91, pulse: 58, confidence: 'high' })
// 3. 7-segment misreads: "l" for 1, "O" for 0
eq('misread digits', guessCuff([L('l1O', 100), L('7O', 200), L('72', 300)]), { systolic: 110, diastolic: 70, pulse: 72, confidence: 'high' })
// 4. no pulse row (some cuffs show pulse after a delay)
eq('no pulse', guessCuff([L('135', 100), L('85', 200)]), { systolic: 135, diastolic: 85, pulse: null, confidence: 'high' })
// 5. nothing readable → all empty
eq('blank', guessCuff([L('mmHg', 10), L('M1', 50)]), { systolic: null, diastolic: null, pulse: null, confidence: 'none' })
// 6. sys<dia order impossible (upside-down photo) → not a confident pair; parser must not swap
eq('reversed', guessCuff([L('80', 100), L('120', 200)]), { systolic: null, diastolic: null, pulse: null, confidence: 'none' })
// 7. memory number "M 12" and "No.3" near the display are rejected by range / adjacency
eq('memory slot', guessCuff([L('No.3', 10, 18), L('118', 100), L('76', 200), L('64', 300), L('M 12', 400, 18)]), { systolic: 118, diastolic: 76, pulse: 64, confidence: 'high' })
// 8. too-wide spread (sys-dia > 120) is marked low confidence, fields still filled for the person to check
eq('wide spread', guessCuff([L('200', 100), L('50', 200), L('70', 300)]), { systolic: 200, diastolic: 50, pulse: 70, confidence: 'low' })
// 9. one line with both numbers as "128/82"
eq('slash', guessCuff([L('128/82', 100), L('67', 200)]), { systolic: 128, diastolic: 82, pulse: 67, confidence: 'high' })

if (fails) { console.error(`${fails} failing`); process.exit(1) }
console.log('all cuff parser tests passed')
