// Accessibility audit for NFR-14 (docs/engineering/REQUIREMENTS.md): axe-core WCAG 2.1 A/AA rules on the public pages and
// the doctor portal, light and dark theme, plus a keyboard pass (Tab order, visible focus, clickable things that the
// keyboard cannot reach). Target fixed before the first run (commit ae5da83): 0 critical and 0 serious violations.
//
//   cd backend && SEED_DEMO=1 DEMO_LIVE=0 DATABASE_URL=sqlite:///a11y.db uvicorn app.main:app --port 8096 &
//   npm i --no-save axe-core@4.14.0 playwright      # once, in any folder; then point AXE at axe.min.js
//   AXE=node_modules/axe-core/axe.min.js node tools/a11y_audit.mjs http://localhost:8096 out.json
//
// Logs in as the public demo doctor; refuses a non-local address unless --allow-remote is given.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
const { chromium } = createRequire(process.cwd() + '/')('playwright')   // CommonJS lookup: local node_modules or NODE_PATH

const BASE = (process.argv[2] || 'http://localhost:8096').replace(/\/+$/, '')
const OUT = process.argv[3] || ''
const AXE = process.env.AXE || 'node_modules/axe-core/axe.min.js'
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && !process.argv.includes('--allow-remote')) {
  console.error('refusing a non-local address (add --allow-remote)'); process.exit(2)
}
const axeSrc = readFileSync(AXE, 'utf8')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

const login = await fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'doctor@demo.kg', password: 'demo1234' }),
}).then(r => r.json())
const token = login.token
const patients = await fetch(BASE + '/api/patients', { headers: { Authorization: 'Bearer ' + token } }).then(r => r.json())
const pid = patients[0]?.id

const PUBLIC = ['/', '/login', '/guide', '/join?doctor=DEMO42', '/privacy', '/terms']
const PORTAL = ['/app', '/app/patients', `/app/patients/${pid}`, `/app/patients/${pid}/report`, '/app/alerts', '/app/devices', '/app/settings']

const browser = await chromium.launch()
const results = []
for (const theme of ['light', 'dark']) {
  for (const path of [...PUBLIC, ...PORTAL]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const portal = path.startsWith('/app')
    await ctx.addInitScript(([t, tok, portal]) => {
      localStorage.setItem('afib.theme', t)
      if (portal) localStorage.setItem('afib_token', tok); else localStorage.removeItem('afib_token')
    }, [theme, token, portal])
    const page = await ctx.newPage()
    await page.goto(BASE + path, { waitUntil: 'load' })   // not 'networkidle': the portal keeps a live event stream open
    await page.waitForTimeout(2500)
    await page.addScriptTag({ content: axeSrc })
    const res = await page.evaluate(async (tags) => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] })
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        examples: v.nodes.slice(0, 3).map(n => n.target.join(' ') + (n.failureSummary ? ' :: ' + n.failureSummary.split('\n').slice(1, 2).join(' ').trim() : '')) }))
    }, TAGS)
    // keyboard pass: up to 60 Tab presses; does every stop show a visible focus indicator?
    const kb = await page.evaluate(() => {
      const focusable = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'
      const clickable = [...document.querySelectorAll('body *')].filter(el => {
        const cs = getComputedStyle(el)
        if (cs.cursor !== 'pointer' || cs.visibility === 'hidden' || cs.display === 'none') return false
        if (el.closest(focusable)) return false
        if (el.closest('label')) return false                 // a label forwards the click to its input
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0
      })
      // keep only the outermost such elements
      const outer = clickable.filter(el => !clickable.some(o => o !== el && o.contains(el)))
      return { unreachable: outer.length, unreachableExamples: outer.slice(0, 4).map(el => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"') }
    })
    // Visible focus = the focused element or one of its two nearest ancestors looks different from before it had focus
    // (outline, box-shadow, border or background). A search box that draws the ring around its input counts.
    await page.evaluate(() => {
      const key = el => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|') }
      window.__snap = new Map([...document.querySelectorAll('body *')].map(el => [el, key(el)]))
      window.__key = key
    })
    const stops = []
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab')
      const s = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return null
        const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean)
        const ring = chain.some(e => window.__snap.has(e) ? window.__snap.get(e) !== window.__key(e) : (() => {
          const cs = getComputedStyle(e); return (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none')
        })())
        return { tag: el.tagName.toLowerCase(), name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 30), ring }
      })
      if (!s) continue
      if (stops.length && stops[0].tag === s.tag && stops[0].name === s.name && stops.length > 2) break   // wrapped around
      stops.push(s)
    }
    const noRing = stops.filter(s => !s.ring)
    const lang = await page.evaluate(() => document.documentElement.lang)
    results.push({ theme, path: path.replace(String(pid), ':id'), lang, violations: res, tabStops: stops.length,
      tabStopsWithoutVisibleFocus: noRing.length, noRingExamples: noRing.slice(0, 4).map(s => `${s.tag} "${s.name}"`), ...kb })
    await ctx.close()
  }
}
await browser.close()

const count = (impact) => results.reduce((n, r) => n + r.violations.filter(v => v.impact === impact).length, 0)
const summary = { critical: count('critical'), serious: count('serious'), moderate: count('moderate'), minor: count('minor') }
for (const r of results) {
  const v = r.violations.map(v => `${v.impact}:${v.id}(${v.nodes})`).join(' ') || '-'
  console.log(`${r.theme.padEnd(5)} ${r.path.padEnd(28)} tab ${String(r.tabStops).padStart(2)} noFocusRing ${r.tabStopsWithoutVisibleFocus} unreachable ${r.unreachable}  ${v}`)
}
console.log('rule violations by impact (page × theme):', JSON.stringify(summary))
const pass = summary.critical === 0 && summary.serious === 0
console.log('NFR-14 (axe part):', pass ? 'PASS' : 'FAIL')
if (OUT) writeFileSync(OUT, JSON.stringify({ base: BASE, axe: '4.14.0', tags: TAGS, summary, pass, results }, null, 1))
process.exit(pass ? 0 : 1)
