import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'

/** Printable A4 sheet for a patient (pilot, clinic rental, board day): how to install, where the electrodes go, how to
 *  do the 30-s check, what the three answers mean, when to call 103. Russian on page 1, Kyrgyz on page 2 (?lang=ru|ky
 *  for one). With ?doctor=CODE the sheet shows the doctor's name and a QR code to /join?doctor=CODE.
 *  Wording is copied from the app (mobile/src/i18n.ts) so the paper and the screen say the same thing. */
type L = 'ru' | 'ky'
const APK = 'https://github.com/Asilovvv/afib-monitor/releases/download/android-latest/afib-monitor.apk'

const TX: Record<L, Record<string, string>> = {
  ru: {
    title: 'Проверка ритма за 30 секунд', sub: 'Памятка пациенту AFib Monitor',
    doctor: 'Ваш врач', install: '1. Установите приложение',
    install_t: 'Android: отсканируйте левый QR-код и установите файл. iPhone: приложение установит врач или клиника (до выхода в App Store). При регистрации выберите «Пациент» и введите код врача — или отсканируйте правый QR-код.',
    qr_app: 'Android-приложение', qr_doc: 'Подключиться к врачу',
    el: '2. Наклейте электроды', el_r: 'Красный — под правой ключицей', el_l: 'Жёлтый — под левой ключицей', el_f: 'Зелёный — внизу живота слева',
    el_t: 'Перед наклейкой протрите кожу влажной салфеткой или спиртом и дайте высохнуть — сигнал станет заметно чище. Электроды новые, провода не натянуты. Одноразовые электроды — один раз.',
    how: '3. Сделайте проверку', how_1: 'Сядьте, спина опирается, руки на коленях', how_2: 'Нажмите «Проверь меня» и не разговаривайте и не двигайтесь 30 секунд', how_3: 'Электроды плотно прилегают, провода не натянуты',
    res: '4. Что значит ответ',
    r1: 'Ритм ровный', r1_t: 'За 30 секунд ритм был ровным. Если вам плохо — всё равно обратитесь к врачу.',
    r2: 'Ритм неровный', r2_t: 'Это не диагноз: так бывает при аритмии, но и при движении или плохом контакте электродов. Приложение попросит повторить. Если снова неровный — покажите запись врачу.',
    r3: 'Не удалось прочитать', r3_t: 'Сядьте удобно, проверьте электроды и повторите.',
    sos: 'Боль в груди, сильная одышка или обморок — сразу звоните 103. Не ждите проверки.',
    note: 'AFib Monitor — учебный исследовательский прототип, не медицинское изделие и не ставит диагноз. Решения о лечении принимает только врач.',
    print: 'Распечатать',
  },
  ky: {
    title: '30 секундда ритмди текшерүү', sub: 'AFib Monitor бейтапка эскертме',
    doctor: 'Сиздин дарыгериңиз', install: '1. Тиркемени орнотуңуз',
    install_t: 'Android: сол QR-кодду сканерлеп, файлды орнотуңуз. iPhone: тиркемени дарыгер же клиника орнотуп берет (App Store чыкканга чейин). Катталууда «Бейтап» дегенди тандап, дарыгердин кодун киргизиңиз — же оң QR-кодду сканерлеңиз.',
    qr_app: 'Android тиркемеси', qr_doc: 'Дарыгерге туташуу',
    el: '2. Электроддорду чаптаңыз', el_r: 'Кызыл — оң көкүрөк сөөгүнүн астына', el_l: 'Сары — сол көкүрөк сөөгүнүн астына', el_f: 'Жашыл — курсактын төмөнкү сол жагына',
    el_t: 'Чаптоодон мурун терини нымдуу салфетка же спирт менен сүртүп, кургатыңыз — сигнал бир топ тазарат. Электроддор жаңы, зымдар тартылбасын. Бир жолку электроддор — бир жолу гана.',
    how: '3. Текшерүү жасаңыз', how_1: 'Отуруңуз, жонуңуз таянсын, колуңуз тизеде', how_2: '«Мени текшер» басып, 30 секунд сүйлөбөңүз жана кыймылдабаңыз', how_3: 'Электроддор бекем жабышкан, зымдар тартылган эмес',
    res: '4. Жооп эмнени билдирет',
    r1: 'Ритм бирдей', r1_t: '30 секунд ичинде ритм бирдей болду. Эгер өзүңүздү жаман сезсеңиз — баары бир дарыгерге кайрылыңыз.',
    r2: 'Ритм бирдей эмес', r2_t: 'Бул диагноз эмес: аритмияда да, кыймылдаганда же электрод начар тийгенде да ушундай болот. Тиркеме кайталоону сурайт. Кайра бирдей эмес болсо — жазууну дарыгерге көрсөтүңүз.',
    r3: 'Окуй алган жокмун', r3_t: 'Ыңгайлуу отуруп, электроддорду текшерип, кайталаңыз.',
    sos: 'Көкүрөк ооруса, дем жетпесе же эс-учуңузду жоготсоңуз — дароо 103кө чалыңыз. Текшерүүнү күтпөңүз.',
    note: 'AFib Monitor — окуу-изилдөө прототиби, медициналык буюм эмес жана диагноз койбойт. Дарылоо чечимин дарыгер гана кабыл алат.',
    print: 'Басып чыгаруу',
  },
}

function Body() {
  return (
    <svg viewBox="0 0 120 140" width="150" height="175" aria-hidden="true">
      <circle cx="60" cy="22" r="16" fill="#f1efe9" stroke="#bbb" />
      <path d="M22 50 Q60 34 98 50 L104 132 L16 132 Z" fill="#f1efe9" stroke="#bbb" />
      {[[38, 56, '#E0433F', 'R'], [82, 56, '#E8B400', 'L'], [80, 112, '#1F9D55', 'F']].map(([x, y, c, l]) => (
        <g key={l as string}><circle cx={x as number} cy={y as number} r="9" fill={c as string} stroke="#fff" strokeWidth="2" />
          <text x={x as number} y={(y as number) + 4} fontSize="10" fontWeight="bold" fill="#fff" textAnchor="middle">{l}</text></g>
      ))}
    </svg>
  )
}

function Qr({ text, label }: { text: string; label: string }) {
  const [svg, setSvg] = useState('')
  useEffect(() => { QRCode.toString(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then(setSvg).catch(() => setSvg('')) }, [text])
  return (
    <figure className="g-qr">
      {/* svg string is generated by the qrcode library from our own URL, not from user input */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption>{label}</figcaption>
    </figure>
  )
}

function Page({ l, doctor, code }: { l: L; doctor: { name: string; clinic: string | null } | null; code: string }) {
  const T = TX[l]
  const join = code ? `${location.origin}/join?doctor=${code}` : ''
  return (
    <section className="g-page">
      <header className="g-head">
        <div><h1>{T.title}</h1><p>{T.sub}</p></div>
        {doctor && <div className="g-doc"><small>{T.doctor}</small><b>{doctor.name}</b>{doctor.clinic && <span>{doctor.clinic}</span>}<span className="g-code">{code}</span></div>}
      </header>
      <div className="g-grid">
        <div>
          <h2>{T.install}</h2>
          <p>{T.install_t}</p>
          <div className="g-qrs"><Qr text={APK} label={T.qr_app} />{join && <Qr text={join} label={T.qr_doc} />}</div>
        </div>
        <div>
          <h2>{T.el}</h2>
          <div className="g-el"><Body /><ul><li className="r">{T.el_r}</li><li className="l">{T.el_l}</li><li className="f">{T.el_f}</li></ul></div>
          <p className="g-small">{T.el_t}</p>
        </div>
      </div>
      <h2>{T.how}</h2>
      <ol className="g-steps"><li>{T.how_1}</li><li>{T.how_3}</li><li>{T.how_2}</li></ol>
      <h2>{T.res}</h2>
      <div className="g-res">
        <div className="ok"><b>{T.r1}</b><p>{T.r1_t}</p></div>
        <div className="warn"><b>{T.r2}</b><p>{T.r2_t}</p></div>
        <div className="grey"><b>{T.r3}</b><p>{T.r3_t}</p></div>
      </div>
      <p className="g-sos">{T.sos}</p>
      <p className="g-note">{T.note}</p>
    </section>
  )
}

export default function Guide() {
  const [q] = useSearchParams()
  const code = (q.get('doctor') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  const only = q.get('lang') === 'ru' || q.get('lang') === 'ky' ? (q.get('lang') as L) : null
  const [doctor, setDoctor] = useState<{ name: string; clinic: string | null } | null>(null)
  useEffect(() => {
    if (code.length < 4) return
    fetch(`/api/doctor-code/${code}`).then(r => (r.ok ? r.json() : null)).then(setDoctor).catch(() => undefined)
  }, [code])
  return (
    <div className="guide">
      <div className="g-bar"><button className="btn primary" onClick={() => window.print()}>{TX[only ?? 'ru'].print}</button></div>
      {(only ? [only] : (['ru', 'ky'] as L[])).map(l => <Page key={l} l={l} doctor={doctor} code={code.length >= 4 ? code : ''} />)}
    </div>
  )
}
