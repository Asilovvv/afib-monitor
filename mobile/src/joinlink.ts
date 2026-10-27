/** Invitation links. Two forms open the same thing:
 *    afibmonitor://join?doctor=DEMO42      afibmonitor://join?family=ABC123   (opens the app directly)
 *    https://<server>/join?doctor=DEMO42   (a web page that shows the code and an "open in app" button, for people
 *                                           who get the link before installing the app)
 *  Universal/app links are not set up (they need a domain file and store accounts), so the https form is a plain page. */
export type Join = { kind: 'doctor' | 'family'; code: string }

export function parseJoin(url: string | null | undefined): Join | null {
  if (!url) return null
  const m = /[?&](doctor|family)=([A-Za-z0-9]{4,12})/.exec(url)
  if (!m || !/(^afibmonitor:|\/join)/.test(url)) return null
  return { kind: m[1] as Join['kind'], code: m[2].toUpperCase() }
}

export function joinUrl(kind: Join['kind'], code: string, server?: string | null): { app: string; web: string | null } {
  const q = `${kind}=${encodeURIComponent(code)}`
  const base = (server || '').replace(/\/+$/, '')
  return { app: `afibmonitor://join?${q}`, web: base ? `${base}/join?${q}` : null }
}

