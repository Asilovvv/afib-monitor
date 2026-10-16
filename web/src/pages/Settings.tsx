import { useState } from 'react'
import { post, put, type User } from '../api'
import { Icon, Seg, useFmt } from '../components/ui'
import { useT } from '../i18n'
import { applyTheme, getTheme, type ThemePref } from '../theme'

export default function Settings({ me, onUpdate }: { me: User; onUpdate: (u: User) => void }) {
  const f = useFmt()
  const { lang, setLang } = useT()
  const [form, setForm] = useState({ name: me.name, clinic: me.clinic ?? '', specialty: me.specialty ?? '', phone: me.phone ?? '' })
  const [msg, setMsg] = useState('')
  const [theme, setTheme] = useState<ThemePref>(getTheme())
  const [copied, setCopied] = useState(false)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { onUpdate(await put<User>('/api/me', form)); setMsg(f.t('Сохранено')) } catch (e) { setMsg((e as Error).message) }
    setTimeout(() => setMsg(''), 2500)
  }
  async function regen() {
    const r = await post<{ invite_code: string }>('/api/me/invite')
    onUpdate({ ...me, invite_code: r.invite_code })
  }
  function copy() {
    navigator.clipboard?.writeText(me.invite_code ?? '').then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => undefined)
  }

  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>{f.t('Настройки')}</h1></div></div>
      <form className="card form" onSubmit={save}>
        <h2>{f.t('Профиль')}</h2>
        <label>{f.t('Имя')}<input value={form.name} onChange={set('name')} required /></label>
        <div className="row2">
          <label>{f.t('Клиника')}<input value={form.clinic} onChange={set('clinic')} /></label>
          <label>{f.t('Специальность')}<input value={form.specialty} onChange={set('specialty')} /></label>
        </div>
        <label>{f.t('Телефон')}<input value={form.phone} onChange={set('phone')} /></label>
        <div className="form-foot"><button className="btn primary">{f.t('Сохранить')}</button><span className="muted">{msg}</span></div>
      </form>

      <div className="card invite-card">
        <div>
          <h2>{f.t('Код для пациентов')}</h2>
          <p className="muted">{lang === 'en' ? 'The patient enters this code in the mobile app to share their data with you.' : 'Пациент вводит этот код в мобильном приложении, чтобы вы видели его данные.'}</p>
        </div>
        <div className="code-big">{(me.invite_code ?? '').split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        <div className="row-btns">
          <button className="btn ghost" onClick={copy}>{copied ? f.t('Скопировано') : f.t('Скопировать')}</button>
          <button className="btn ghost" onClick={regen}>{Icon.bolt(16)} {f.t('Новый код')}</button>
        </div>
      </div>

      <div className="card form">
        <h2>{f.t('Тема')} · {f.t('Язык')}</h2>
        <div className="row-btns">
          <Seg value={theme} onChange={v => { setTheme(v); applyTheme(v) }} items={[['light', f.t('Светлая')], ['dark', f.t('Тёмная')], ['system', f.t('Системная')]]} />
          <Seg value={lang} onChange={setLang} items={[['ru', 'Русский'], ['en', 'English']]} />
        </div>
      </div>
    </div>
  )
}
