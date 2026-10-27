import type { Lang } from './i18n'

/** A paper-style ECG page any cardiologist can read: 25 mm/s, 10 mm/mV, 1 mm / 5 mm grid, rows of 10 s, A4 landscape.
 *  Built as HTML + inline SVG in millimetres and printed to PDF on the phone (expo-print); nothing goes to a server.
 *  The sheet says in words that it is a single-lead wellness recording and not a diagnosis. */
export type PdfStrip = { samples: number[]; fs: number; ts: number; bpm: number | null; verdict?: string | null; name?: string | null; device?: string }

const MM_PER_S = 25, MM_PER_MV = 10, ROW_S = 10, ROW_H = 40   // mm; ±2 mV fits in 40 mm
const W = 297, H = 210, M = 12                                 // A4 landscape, margin

const TXT: Record<Lang, Record<string, string>> = {
  ru: { title: 'ЭКГ — одно отведение, бытовой датчик', date: 'Запись', hr: 'ЧСС', dur: 'Длительность', scale: '25 мм/с · 10 мм/мВ', fs: 'частота',
        verdict: 'Проверка ритма (приложение)', regular: 'ритм ровный', irregular: 'ритм неровный — показать врачу', no_verdict: 'не удалось прочитать',
        note: 'Это запись одного отведения бытовым датчиком AFib Monitor (не зарегистрирован как медицинское изделие). Не является диагнозом и не заменяет 12-канальную ЭКГ. Интерпретация — только врачом.',
        patient: 'Пациент', page: 'стр.' },
  en: { title: 'ECG — single lead, consumer sensor', date: 'Recorded', hr: 'HR', dur: 'Duration', scale: '25 mm/s · 10 mm/mV', fs: 'sampling',
        verdict: 'Rhythm check (app)', regular: 'regular rhythm', irregular: 'irregular rhythm — show a doctor', no_verdict: 'could not read',
        note: 'Single-lead recording by the AFib Monitor consumer sensor (not registered as a medical device). Not a diagnosis and not a substitute for a 12-lead ECG. Interpretation by a physician only.',
        patient: 'Patient', page: 'p.' },
  ky: { title: 'ЭКГ — бир тармак, тиричилик датчиги', date: 'Жазуу', hr: 'ЖСЖ', dur: 'Узактыгы', scale: '25 мм/с · 10 мм/мВ', fs: 'жыштык',
        verdict: 'Ритм текшерүү (тиркеме)', regular: 'ритм бир калыпта', irregular: 'ритм бир калыпта эмес — дарыгерге көрсөтүңүз', no_verdict: 'окуу мүмкүн болгон жок',
        note: 'Бул AFib Monitor тиричилик датчиги менен жазылган бир тармактуу жазуу (медициналык буюм катары катталган эмес). Диагноз эмес жана 12 тармактуу ЭКГнын ордун баспайт. Чечмелөөнү дарыгер гана жасайт.',
        patient: 'Бейтап', page: 'бет' },
}

function grid(x0: number, y0: number, w: number, h: number): string {
  const parts: string[] = []
  for (let x = 0; x <= w + 1e-6; x += 1) parts.push(`M${(x0 + x).toFixed(2)} ${y0} v${h}`)
  for (let y = 0; y <= h + 1e-6; y += 1) parts.push(`M${x0} ${(y0 + y).toFixed(2)} h${w}`)
  const big: string[] = []
  for (let x = 0; x <= w + 1e-6; x += 5) big.push(`M${(x0 + x).toFixed(2)} ${y0} v${h}`)
  for (let y = 0; y <= h + 1e-6; y += 5) big.push(`M${x0} ${(y0 + y).toFixed(2)} h${w}`)
  return `<path d="${parts.join('')}" stroke="#f3b7b7" stroke-width="0.1" fill="none"/><path d="${big.join('')}" stroke="#e58b8b" stroke-width="0.2" fill="none"/>`
}

function rowPath(s: number[], fs: number, x0: number, yMid: number): string {
  let d = ''
  for (let i = 0; i < s.length; i++) {
    const x = x0 + (i / fs) * MM_PER_S, y = yMid - Math.max(-2, Math.min(2, s[i])) * MM_PER_MV
    d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2)
  }
  return `<path d="${d}" stroke="#111" stroke-width="0.25" fill="none" stroke-linejoin="round"/>`
}

export function ecgHtml(strip: PdfStrip, lang: Lang, withName: boolean): string {
  const T = TXT[lang]
  // remove DC offset so the trace sits on the row's midline
  const mean = strip.samples.reduce((a, b) => a + b, 0) / Math.max(1, strip.samples.length)
  const s = strip.samples.map(v => v - mean)
  const perRow = ROW_S * strip.fs, rows = Math.ceil(s.length / perRow)
  const rowsPerPage = Math.floor((H - 2 * M - 22) / (ROW_H + 4))
  const pages = Math.max(1, Math.ceil(rows / rowsPerPage))
  const when = new Date(strip.ts).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const dur = (s.length / strip.fs).toFixed(0)
  const verdict = strip.verdict ? `${T.verdict}: ${T[strip.verdict] ?? strip.verdict}` : ''
  let html = ''
  for (let p = 0; p < pages; p++) {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`
    svg += `<text x="${M}" y="${M + 4}" font-size="4.2" font-weight="bold">${T.title}</text>`
    svg += `<text x="${M}" y="${M + 9.5}" font-size="3">${withName && strip.name ? `${T.patient}: ${esc(strip.name)} · ` : ''}${T.date}: ${when} · ${T.dur}: ${dur} s · ${T.hr}: ${strip.bpm ? Math.round(strip.bpm) : '—'} /min · ${T.scale} · ${T.fs} ${strip.fs} Hz${strip.device ? ` · ${esc(strip.device)}` : ''}</text>`
    if (verdict) svg += `<text x="${M}" y="${M + 14}" font-size="3">${esc(verdict)}</text>`
    let y = M + 18
    for (let r = p * rowsPerPage; r < Math.min(rows, (p + 1) * rowsPerPage); r++) {
      const seg = s.slice(r * perRow, (r + 1) * perRow)
      const w = ROW_S * MM_PER_S
      svg += grid(M, y, w, ROW_H)
      // 1 mV calibration pulse at the row start
      svg += `<path d="M${M - 6} ${y + ROW_H / 2} h2 v-${MM_PER_MV} h2 v${MM_PER_MV} h2" stroke="#111" stroke-width="0.25" fill="none"/>`
      svg += rowPath(seg, strip.fs, M, y + ROW_H / 2)
      svg += `<text x="${M + w + 1.5}" y="${y + 3}" font-size="2.6" fill="#555">${r * ROW_S}–${Math.min((r + 1) * ROW_S, Math.ceil(s.length / strip.fs))} s</text>`
      y += ROW_H + 4
    }
    svg += `<text x="${M}" y="${H - M + 2}" font-size="2.6" fill="#333">${T.note}</text>`
    svg += `<text x="${W - M}" y="${H - M + 2}" font-size="2.6" fill="#555" text-anchor="end">${T.page} ${p + 1}/${pages}</text>`
    svg += '</svg>'
    html += `<div class="pg">${svg}</div>`
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:0}html,body{margin:0;padding:0}.pg{width:${W}mm;height:${H}mm;page-break-after:always;overflow:hidden}svg{display:block}</style></head><body>${html}</body></html>`
}

const esc = (x: string) => x.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

