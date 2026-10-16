export type ThemePref = 'light' | 'dark' | 'system'

export function getTheme(): ThemePref {
  try { return (localStorage.getItem('afib.theme') as ThemePref) || 'system' } catch { return 'system' }
}

export function applyTheme(p: ThemePref) {
  try { localStorage.setItem('afib.theme', p) } catch { /* ignore */ }
  const root = document.documentElement
  if (p === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', p)
}
