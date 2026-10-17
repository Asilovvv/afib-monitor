import { useEffect, useState } from 'react'
import { api, del, post, put, type User } from '../api'
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
          <p className="muted">{f.tr('Пациент вводит этот код в мобильном приложении, чтобы вы видели его данные.', 'The patient enters this code in the mobile app to share their data with you.', 'Бейтап бул кодду мобилдик тиркемеге киргизет, ошондо сиз анын маалыматтарын көрөсүз.')}</p>
        </div>
        <div className="code-big">{(me.invite_code ?? '').split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        <div className="row-btns">
          <button className="btn ghost" onClick={copy}>{copied ? f.t('Скопировано') : f.t('Скопировать')}</button>
          <button className="btn ghost" onClick={regen}>{Icon.bolt(16)} {f.t('Новый код')}</button>
        </div>
      </div>

      <TelegramCard />

      <div className="card form">
        <h2>{f.t('Тема')} · {f.t('Язык')}</h2>
        <div className="row-btns">
          <Seg value={theme} onChange={v => { setTheme(v); applyTheme(v) }} items={[['light', f.t('Светлая')], ['dark', f.t('Тёмная')], ['system', f.t('Системная')]]} />
          <Seg value={lang} onChange={setLang} items={[['ru', 'Русский'], ['ky', 'Кыргызча'], ['en', 'English']]} />
        </div>
      </div>
    </div>
  )
}

type TgLink = { id: number; name: string; kind: string; created_at: string }
type TgInfo = { enabled: boolean; bot: string | null; links: TgLink[] }

function TelegramCard() {
  const f = useFmt()
  const [info, setInfo] = useState<TgInfo | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const load = () => api<TgInfo>('/api/telegram').then(setInfo).catch(() => undefined)
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)          // pick up the new chat once the doctor presses Start
    return () => clearInterval(id)
  }, [])
  async function connect() {
    const r = await post<{ url: string | null }>('/api/telegram/link')
    setUrl(r.url)
    if (r.url) window.open(r.url, '_blank', 'noopener')
  }
  return (
    <div className="card tg-card">
      <div className="tg-head">
        <span className="tg-logo" aria-hidden>{Icon.send(22)}</span>
        <div>
          <h2>{f.t('Тревоги в Telegram')}</h2>
          <p className="muted">{f.tr(
            'Бот пришлёт тревогу ФП по любому вашему пациенту с ЭКГ приступа и кнопкой «Принять». Сервер просыпается сам, когда приходит сообщение.',
            'The bot sends an AF alert for any of your patients with the onset ECG and an "Accept" button.',
            'Бот каалаган бейтабыңыз боюнча ФП эскертүүсүн ЭКГ жана «Кабыл алуу» баскычы менен жиберет.')}</p>
        </div>
      </div>
      {info && !info.enabled && <p className="warn-box">{f.tr(
        'Бот не настроен на сервере: задайте переменную TELEGRAM_BOT_TOKEN.',
        'The bot is not configured on the server: set TELEGRAM_BOT_TOKEN.',
        'Сервер боту жөндөлгөн эмес: TELEGRAM_BOT_TOKEN өзгөрмөсүн коюңуз.')}</p>}
      {info?.enabled && <>
        {info.links.length > 0 && <div className="tg-links">
          <span className="eyebrow">{f.t('Подключённые чаты')}</span>
          {info.links.map(l => (
            <div key={l.id} className="tg-link"><span className="ok">●</span> <b>{l.name}</b>
              <span className="muted">{f.dt(l.created_at)}</span>
              <button className="btn tiny" onClick={async () => setInfo({ ...info, links: await del<TgLink[]>(`/api/telegram/links/${l.id}`) })}>{f.t('Отключить')}</button>
            </div>
          ))}
        </div>}
        <div className="row-btns">
          <button className="btn primary" onClick={connect}>{Icon.send(16)} {f.t('Подключить Telegram')}</button>
          {url && <a className="btn ghost" href={url} target="_blank" rel="noreferrer">{f.t('Открыть в Telegram')} @{info.bot}</a>}
        </div>
        {url && <p className="fine">{f.tr('Нажмите «Start» в Telegram. Ссылка одноразовая и действует 24 часа.', 'Press "Start" in Telegram. The link works once, for 24 hours.', 'Telegramда «Start» басыңыз. Шилтеме бир жолку, 24 саат жарактуу.')}</p>}
      </>}
    </div>
  )
}
