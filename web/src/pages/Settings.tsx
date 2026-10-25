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

      <PlanCard />
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

type PlanInfo = { plan: 'doctor_free' | 'clinic50' | 'clinic200'; until: string | null; source: string | null
  limits: { patients: number }; usage: { patients: number }; prices_som: Record<string, Record<string, number>> }

/** Clinic plan: what the cabinet has, how much of it is used, "request an invoice". Paid by bank transfer, switched on
 *  by hand after payment — nothing here charges anything. Free cabinet stays free (10 patients). */
function PlanCard() {
  const f = useFmt()
  const [p, setP] = useState<PlanInfo | null>(null)
  const [req, setReq] = useState<{ plan: string; months: number } | null>(null)
  const [choice, setChoice] = useState<'clinic50' | 'clinic200'>('clinic50')
  const [months, setMonths] = useState(3)
  const [contact, setContact] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => { api<PlanInfo>('/api/me/plan').then(setP).catch(() => undefined) }, [])
  if (!p) return null
  const names = { doctor_free: f.tr('Бесплатный кабинет', 'Free cabinet', 'Акысыз кабинет'), clinic50: '«Клиника 50»', clinic200: '«Клиника 200»' }
  const pct = Math.min(100, Math.round((p.usage.patients / p.limits.patients) * 100))
  async function send(e: React.FormEvent) {
    e.preventDefault()
    try { setReq(await post('/api/me/plan/request', { plan: choice, months, contact: contact || null })) } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="card form">
      <h2>{f.t('Тариф')}</h2>
      <p><b>{names[p.plan]}</b>{p.until && <span className="muted"> · {f.tr('до', 'until', 'чейин')} {new Date(p.until).toLocaleDateString(f.loc)}</span>}</p>
      <div className="burden"><div className="bar" style={{ width: 160 }}><span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--af)' : 'var(--accent)' }} /></div>
        <span className="muted">{p.usage.patients} / {p.limits.patients} {f.tr('пациентов', 'patients', 'бейтап')}</span></div>
      <p className="muted" style={{ fontSize: 13 }}>{f.tr('Когда лимит достигнут, новые пациенты не могут подключиться к кабинету; все нынешние остаются видны. Проверка ритма, вердикт и всё, что касается безопасности пациента, одинаковы на любом тарифе.',
        'At the limit, new patients cannot join the cabinet; current ones stay visible. The rhythm check, the verdict and everything about patient safety are the same on every plan.',
        'Чек жеткенде жаңы бейтаптар кабинетке кошула албайт; азыркылары көрүнө берет. Ритм текшерүү, жыйынтык жана бейтаптын коопсуздугуна тиешелүү бардыгы ар кандай тарифте бирдей.')}</p>
      {p.plan === 'doctor_free' && !req && (
        <form onSubmit={send} style={{ display: 'grid', gap: 10 }}>
          <div className="row2">
            <label>{f.t('Тариф')}
              <select value={choice} onChange={e => setChoice(e.target.value as 'clinic50' | 'clinic200')}>
                <option value="clinic50">«Клиника 50» — {p.prices_som.clinic50.month.toLocaleString('ru')} {f.tr('сом/мес', 'som/mo', 'сом/ай')} · 50 {f.tr('пациентов', 'patients', 'бейтап')}</option>
                <option value="clinic200">«Клиника 200» — {f.tr('по запросу', 'on request', 'суроо боюнча')}</option>
              </select></label>
            <label>{f.tr('Месяцев', 'Months', 'Ай')}<input type="number" min={1} max={12} value={months} onChange={e => setMonths(Number(e.target.value))} /></label>
          </div>
          <label>{f.tr('Куда прислать счёт (почта или телефон)', 'Where to send the invoice (email or phone)', 'Эсепти кайда жөнөтөлү (почта же телефон)')}<input value={contact} onChange={e => setContact(e.target.value)} maxLength={200} /></label>
          <div className="form-foot"><button className="btn primary">{f.tr('Запросить счёт', 'Request an invoice', 'Эсеп суроо')}</button><span className="muted">{err}</span></div>
          <p className="muted" style={{ fontSize: 12.5 }}>{f.tr('Оплата по счёту на ИП/ОсОО, без карты в приложении. Тариф включается вручную после оплаты. Цены — предложение, уточняются с клиниками.',
            'Paid by invoice, no card in the app. The plan is switched on by hand after payment. Prices are a proposal, to be confirmed with clinics.',
            'Эсеп боюнча төлөм, тиркемеде карта жок. Тариф төлөмдөн кийин кол менен күйгүзүлөт. Баалар — сунуш, клиникалар менен такталат.')}</p>
        </form>
      )}
      {req && <p className="pill st-new">{f.tr(`Заявка на ${req.plan === 'clinic50' ? '«Клинику 50»' : '«Клинику 200»'} на ${req.months} мес отправлена — пришлём счёт`, `Request for ${req.plan} × ${req.months} months sent — invoice to follow`, `${req.plan} × ${req.months} айга өтүнмө жөнөтүлдү — эсеп жөнөтөбүз`)}</p>}
    </div>
  )
}

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
