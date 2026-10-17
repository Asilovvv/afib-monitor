import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/ui'
import { LANG_LABEL, nextLang, useT } from '../i18n'

const TXT = {
  ru: {
    nav: ['Как работает', 'Технология', 'Результаты', 'Приложение'],
    login: 'Кабинет врача',
    kicker: 'Дипломный проект · Ala-Too International University',
    h1a: 'Сердце', h1b: 'под присмотром.', h1c: 'Нейросеть — внутри датчика.',
    lead: 'Носимый монитор ЭКГ, который сам распознаёт фибрилляцию предсердий: сжатая до 8 бит нейросеть работает прямо на микроконтроллере ESP32-S3, телефон сразу предупреждает пациента, а врач видит эпизоды онлайн.',
    cta1: 'Открыть кабинет врача', cta2: 'Как это работает',
    mon: { normal: 'НОРМАЛЬНЫЙ РИТМ', af: 'ФИБРИЛЛЯЦИЯ ПРЕДСЕРДИЙ', bpm: 'уд/мин', prob: 'вероятность ФП', model: 'int8 TCN · на чипе' },
    why: 'Почему это важно',
    whyText: 'Фибрилляция предсердий — самая частая аритмия и одна из главных причин инсульта. Её эпизоды часто короткие и проходят без симптомов, поэтому обычная ЭКГ в кабинете их пропускает. Нужен непрерывный мониторинг — дешёвый, автономный и без облака.',
    whyStats: [['×5', 'выше риск инсульта при ФП'], ['1 из 3', 'эпизодов проходит без симптомов'], ['24/7', 'мониторинг без облачных вычислений']],
    howTitle: 'Как это работает',
    how: [
      ['Датчик ЭКГ', 'AD8232 снимает сигнал с трёх электродов, 250 раз в секунду.'],
      ['Нейросеть на чипе', 'ESP32-S3 находит удары сердца и анализирует 32 интервала моделью TCN в формате int8.'],
      ['Телефон', 'Приложение получает ритм и живую ЭКГ по Bluetooth, предупреждает и записывает ЭКГ приступа.'],
      ['Врач', 'Кабинет показывает тревоги в реальном времени, эпизоды, нагрузку ФП и ЭКГ-записи.'],
    ],
    techTitle: 'Технология',
    techLead: 'Мы сравнили два подхода на 23 пациентах базы MIT-BIH AF Database (проверка на 5 пациентах, которых модель не видела).',
    cmpA: 'TCN на сырой ЭКГ', cmpB: 'TCN на RR-интервалах',
    sens: 'Чувствительность', spec: 'Специфичность',
    quantTitle: 'Сжатие модели', quantLead: 'Чувствительность при уменьшении разрядности весов',
    resTitle: 'Результаты',
    res: [['96,6%', 'чувствительность int8 на новых пациентах'], ['94,6%', 'специфичность'], ['0,98', 'ROC-AUC'], ['27 КБ', 'модель int8 во флеш-памяти'], ['2,8 КБ', 'веса при 4 битах (97,2% чувствит.)'], ['5 665', 'параметров сети']],
    appTitle: 'Приложение пациента',
    appLead: 'Живая ЭКГ, мгновенное предупреждение, кнопка SOS, дневник симптомов и история — в одном приложении для Android и iPhone.',
    appFeat: ['Живая ЭКГ по Bluetooth', 'Уведомление при начале ФП', 'Автозапись ЭКГ приступа', 'Дневник симптомов', 'SOS — звонок 103', 'Близкие получают тревогу в Telegram', 'RU / KY / EN, тёмная тема'],
    docTitle: 'Кабинет врача',
    docFeat: ['Тревоги в реальном времени', 'Нагрузка ФП и эпизоды', 'ЭКГ на миллиметровке', 'Разметка «ФП / ложная тревога»', 'График Пуанкаре и CHA₂DS₂-VASc', 'Тревоги в Telegram с ЭКГ', 'Печатный отчёт'],
    ctaTitle: 'Посмотрите кабинет на демо-данных', ctaText: 'Пять пациентов, неделя мониторинга, реальные сценарии пароксизмальной и персистирующей ФП.',
    demo: 'Демо: doctor@demo.kg / demo1234',
    foot: 'Бектур Асилов · COMSE-23 · Ala-Too International University, Бишкек',
    disc: 'Учебный исследовательский проект. Не является медицинским изделием и не заменяет консультацию врача.',
  },
  en: {
    nav: ['How it works', 'Technology', 'Results', 'App'],
    login: 'Doctor portal',
    kicker: 'Diploma project · Ala-Too International University',
    h1a: 'Your heart,', h1b: 'watched over.', h1c: 'The neural network lives in the sensor.',
    lead: 'A wearable ECG monitor that recognises atrial fibrillation on its own: an 8-bit neural network runs directly on an ESP32-S3 microcontroller, the phone warns the patient instantly and the doctor sees episodes live.',
    cta1: 'Open doctor portal', cta2: 'How it works',
    mon: { normal: 'NORMAL SINUS RHYTHM', af: 'ATRIAL FIBRILLATION', bpm: 'bpm', prob: 'AF probability', model: 'int8 TCN · on-chip' },
    why: 'Why it matters',
    whyText: 'Atrial fibrillation is the most common arrhythmia and a leading cause of stroke. Episodes are often short and silent, so an office ECG misses them. Continuous monitoring is needed — cheap, autonomous and without the cloud.',
    whyStats: [['×5', 'higher stroke risk with AF'], ['1 in 3', 'episodes have no symptoms'], ['24/7', 'monitoring without cloud compute']],
    howTitle: 'How it works',
    how: [
      ['ECG sensor', 'AD8232 picks up the signal from three electrodes, 250 times a second.'],
      ['On-chip AI', 'ESP32-S3 detects heartbeats and analyses 32 intervals with an int8 TCN.'],
      ['Phone', 'The app receives rhythm and live ECG over Bluetooth, warns and records the ECG of the episode.'],
      ['Doctor', 'The portal shows real-time alerts, episodes, AF burden and ECG strips.'],
    ],
    techTitle: 'Technology',
    techLead: 'We compared two approaches on 23 patients of the MIT-BIH AF Database (tested on 5 patients the model never saw).',
    cmpA: 'TCN on raw ECG', cmpB: 'TCN on RR intervals',
    sens: 'Sensitivity', spec: 'Specificity',
    quantTitle: 'Model compression', quantLead: 'Sensitivity as weight bit-width goes down',
    resTitle: 'Results',
    res: [['96.6%', 'int8 sensitivity on unseen patients'], ['94.6%', 'specificity'], ['0.98', 'ROC-AUC'], ['27 KB', 'int8 model in flash'], ['2.8 KB', 'weights at 4 bits (97.2% sens.)'], ['5,665', 'network parameters']],
    appTitle: 'Patient app',
    appLead: 'Live ECG, instant warning, SOS button, symptom diary and history — one app for Android and iPhone.',
    appFeat: ['Live ECG over Bluetooth', 'Alert at AF onset', 'Auto-recorded episode ECG', 'Symptom diary', 'SOS — call 103', 'Relatives get the alert in Telegram', 'RU / KY / EN, dark mode'],
    docTitle: 'Doctor portal',
    docFeat: ['Real-time alerts', 'AF burden and episodes', 'ECG on grid paper', 'Mark "AF / false alarm"', 'Poincaré plot and CHA₂DS₂-VASc', 'Telegram alerts with ECG', 'Printable report'],
    ctaTitle: 'Explore the portal with demo data', ctaText: 'Five patients, a week of monitoring, realistic paroxysmal and persistent AF scenarios.',
    demo: 'Demo: doctor@demo.kg / demo1234',
    foot: 'Bektur Asilov · COMSE-23 · Ala-Too International University, Bishkek',
    disc: 'Educational research project. Not a medical device and not a substitute for medical advice.',
  },
  ky: {
    nav: ['Кантип иштейт', 'Технология', 'Жыйынтыктар', 'Тиркеме'],
    login: 'Дарыгердин кабинети',
    kicker: 'Дипломдук долбоор · Ala-Too International University',
    h1a: 'Жүрөк', h1b: 'көзөмөлдө.', h1c: 'Нейротармак — сенсордун ичинде.',
    lead: 'Жүрөктүн дирилдөөсүн (фибрилляциясын) өзү тааныган кийилүүчү ЭКГ монитору: 8 битке чейин кысылган нейротармак ESP32-S3 микроконтроллеринде түз иштейт, телефон бейтапты дароо эскертет, дарыгер эпизоддорду онлайн көрөт.',
    cta1: 'Дарыгердин кабинетин ачуу', cta2: 'Кантип иштейт',
    mon: { normal: 'КАЛЫПТУУ РИТМ', af: 'ЖҮРӨКТҮН ДИРИЛДӨӨСҮ', bpm: 'сог/мүн', prob: 'ФП ыктымалдыгы', model: 'int8 TCN · чипте' },
    why: 'Эмне үчүн маанилүү',
    whyText: 'Жүрөктүн дирилдөөсү (ФП) — эң көп кездешкен аритмия жана инсульттун негизги себептеринин бири. Эпизоддор көбүнчө кыска жана белгисиз өтөт, ошондуктан кабинеттеги кадимки ЭКГ аларды байкабай калат. Үзгүлтүксүз мониторинг керек — арзан, автономдуу жана булутсуз.',
    whyStats: [['×5', 'ФПда инсульт коркунучу жогору'], ['3төн 1и', 'эпизод белгисиз өтөт'], ['24/7', 'булуттук эсептөөсүз мониторинг']],
    howTitle: 'Кантип иштейт',
    how: [
      ['ЭКГ сенсору', 'AD8232 үч электроддон сигналды секундасына 250 жолу алат.'],
      ['Чиптеги нейротармак', 'ESP32-S3 жүрөктүн согууларын таап, 32 аралыкты int8 TCN модели менен талдайт.'],
      ['Телефон', 'Тиркеме ритмди жана жандуу ЭКГны Bluetooth аркылуу алып, эскертет жана талмадагы ЭКГны жазат.'],
      ['Дарыгер', 'Кабинет эскертүүлөрдү реалдуу убакытта, эпизоддорду, ФП жүгүн жана ЭКГ жазууларын көрсөтөт.'],
    ],
    techTitle: 'Технология',
    techLead: 'Эки ыкманы MIT-BIH AF Database базасынын 23 бейтабында салыштырдык (модель көрбөгөн 5 бейтапта текшерилди).',
    cmpA: 'Чийки ЭКГдагы TCN', cmpB: 'RR-аралыктардагы TCN',
    sens: 'Сезгичтик', spec: 'Өзгөчөлүк',
    quantTitle: 'Моделди кысуу', quantLead: 'Салмактардын разряддуулугун азайтканда сезгичтик',
    resTitle: 'Жыйынтыктар',
    res: [['96,6%', 'жаңы бейтаптардагы int8 сезгичтиги'], ['94,6%', 'өзгөчөлүк'], ['0,98', 'ROC-AUC'], ['27 КБ', 'флеш-эстутумдагы int8 модели'], ['2,8 КБ', '4 биттеги салмактар (97,2% сезгичтик)'], ['5 665', 'тармактын параметрлери']],
    appTitle: 'Бейтаптын тиркемеси',
    appLead: 'Жандуу ЭКГ, дароо эскертүү, SOS баскычы, белгилер күндөлүгү жана тарых — Android жана iPhone үчүн бир тиркемеде.',
    appFeat: ['Bluetooth аркылуу жандуу ЭКГ', 'ФП башталганда эскертүү', 'Талманын ЭКГсын автожазуу', 'Белгилер күндөлүгү', 'SOS — 103 чалуу', 'Жакындар Telegramдан эскертүү алат', 'RU / KY / EN, караңгы тема'],
    docTitle: 'Дарыгердин кабинети',
    docFeat: ['Реалдуу убакыттагы эскертүүлөр', 'ФП жүгү жана эпизоддор', 'Миллиметровкадагы ЭКГ', '«ФП / жалган эскертүү» белгилөө', 'Пуанкаре графиги жана CHA₂DS₂-VASc', 'Telegramдагы эскертүүлөр ЭКГ менен', 'Басып чыгаруучу отчёт'],
    ctaTitle: 'Кабинетти демо-маалыматтар менен көрүңүз', ctaText: 'Беш бейтап, бир жумалык мониторинг, пароксизмдик жана туруктуу ФПнын реалдуу сценарийлери.',
    demo: 'Демо: doctor@demo.kg / demo1234',
    foot: 'Бектур Асилов · COMSE-23 · Ala-Too International University, Бишкек',
    disc: 'Окуу-изилдөө долбоору. Медициналык буюм эмес жана дарыгердин кеңешин алмаштырбайт.',
  },
}

// ---------------------------------------------------------------- live monitor (canvas)
function beat(t: number, af: boolean, phase: number): number {
  // one heartbeat shape around t=0 (seconds), plus f-waves in AF
  const g = (c: number, a: number, w: number) => a * Math.exp(-((t - c) ** 2) / (2 * w * w))
  let v = g(0, 1.15, 0.011) + g(-0.022, -0.14, 0.008) + g(0.026, -0.28, 0.01) + g(0.25, 0.3, 0.045)
  if (!af) v += g(-0.16, 0.14, 0.024)
  else v += 0.05 * Math.sin(2 * Math.PI * 6.3 * (t + phase))
  return v
}

function Monitor({ L }: { L: (typeof TXT)['ru'] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [af, setAf] = useState(false)
  const [bpm, setBpm] = useState(72)
  const [prob, setProb] = useState(0.04)

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    let raf = 0, last = 0, x = 0, prevY = 0
    let tBeat = 0, nextBeat = 0.8, cycle = 0, isAf = false, beats: number[] = []
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const resize = () => {
      const r = cv.getBoundingClientRect()
      cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ctx.fillStyle = '#05080f'; ctx.fillRect(0, 0, r.width, r.height)
      x = 0
    }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(cv)
    const speed = 110 // px per second
    const frame = (now: number) => {
      const dt = last ? Math.max(0.001, Math.min(0.05, (now - last) / 1000)) : 0.016; last = now
      const r = cv.getBoundingClientRect(), W = r.width, H = r.height
      cycle += dt
      if (cycle > 9) { cycle = 0; isAf = !isAf; setAf(isAf); beats = [] }
      const steps = Math.max(1, Math.round(dt * 250))
      for (let k = 0; k < steps; k++) {
        const h = dt / steps
        tBeat += h
        if (tBeat >= nextBeat) {
          beats.push(nextBeat); if (beats.length > 6) beats.shift()
          tBeat -= nextBeat
          nextBeat = isAf ? 0.42 + Math.random() * 0.55 : 0.82 + (Math.random() - 0.5) * 0.04
          const mean = beats.reduce((a, b) => a + b, 0) / beats.length
          setBpm(Math.round(60 / mean))
          setProb(isAf ? 0.88 + Math.random() * 0.11 : Math.random() * 0.08)
        }
        const v = beat(tBeat < 0.45 ? tBeat : tBeat - nextBeat, isAf, now / 1000) + 0.01 * (Math.random() - 0.5)
        const y = H * 0.6 - v * H * 0.36
        const nx = x + speed * h
        // erase bar ahead
        ctx.fillStyle = '#05080f'; ctx.fillRect(nx, 0, 14, H)
        ctx.strokeStyle = isAf ? '#ff6b5e' : '#38f2b0'
        ctx.lineWidth = 2; ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10
        ctx.beginPath(); ctx.moveTo(x, prevY || y); ctx.lineTo(nx, y); ctx.stroke()
        ctx.shadowBlur = 0
        x = nx; prevY = y
        if (x > W) { x = 0; prevY = 0 }
      }
      if (!reduce) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <div className={`monitor ${af ? 'is-af' : ''}`}>
      <div className="mon-top">
        <span className="mon-dot" /> AFib-Monitor · ESP32-S3
        <span className="mon-right">{L.mon.model}</span>
      </div>
      <canvas ref={ref} className="mon-canvas" aria-label="Animated ECG" />
      <div className="mon-bottom">
        <div className="mon-state">{af ? L.mon.af : L.mon.normal}</div>
        <div className="mon-nums">
          <div><b>{bpm}</b><span>{L.mon.bpm}</span></div>
          <div><b>{Math.round(prob * 100)}%</b><span>{L.mon.prob}</span></div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- page
export default function Landing() {
  const { lang, setLang } = useT()
  const L = TXT[lang]
  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.15 })
    document.querySelectorAll('.reveal').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [lang])
  const quant = [['32', 96.7], ['8', 96.6], ['6', 96.9], ['4', 97.2], ['3', 96.6], ['2', 86.1]] as const
  const howIcons = [Icon.heart(26), Icon.chip(26), Icon.mobile(26), Icon.doctor(26)]

  return (
    <div className="landing">
      <header className="l-nav">
        <a href="#top" className="l-brand">{Icon.pulse(22)}<span>AFib<b>Monitor</b></span></a>
        <nav>
          {['how', 'tech', 'results', 'app'].map((id, i) => <a key={id} href={`#${id}`}>{L.nav[i]}</a>)}
        </nav>
        <div className="l-nav-right">
          <button className="lang" onClick={() => setLang(nextLang(lang))}>{LANG_LABEL[nextLang(lang)]}</button>
          <Link to="/login" className="l-btn small">{L.login}</Link>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="kicker">{L.kicker}</p>
          <h1><span>{L.h1a}</span> <span>{L.h1b}</span><em>{L.h1c}</em></h1>
          <p className="lead">{L.lead}</p>
          <div className="hero-cta">
            <Link to="/login" className="l-btn">{L.cta1} {Icon.arrow(18)}</Link>
            <a href="#how" className="l-btn ghost">{L.cta2}</a>
          </div>
        </div>
        <Monitor L={L} />
      </section>

      <section className="why reveal">
        <div>
          <h2>{L.why}</h2>
          <p>{L.whyText}</p>
        </div>
        <div className="why-stats">
          {L.whyStats.map(([n, s]) => <div key={s}><b>{n}</b><span>{s}</span></div>)}
        </div>
      </section>

      <section id="how" className="how reveal">
        <h2>{L.howTitle}</h2>
        <ol className="flow">
          {L.how.map(([h, p], i) => (
            <li key={h} style={{ ['--i' as string]: i }}>
              <span className="flow-ico">{howIcons[i]}</span>
              <span className="flow-n">0{i + 1}</span>
              <h3>{h}</h3><p>{p}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="tech" className="tech reveal">
        <div className="tech-head"><h2>{L.techTitle}</h2><p>{L.techLead}</p></div>
        <div className="tech-grid">
          <div className="t-card">
            {[[L.cmpA, 63.9, 76.6, false], [L.cmpB, 96.7, 94.6, true]].map(([name, s, p, win]) => (
              <div key={String(name)} className={`cmp ${win ? 'win' : ''}`}>
                <h4>{name}</h4>
                {[[L.sens, s], [L.spec, p]].map(([k, v]) => (
                  <div className="bar-row" key={String(k)}>
                    <span>{k}</span>
                    <span className="bar-track"><span style={{ width: `${v}%` }} /></span>
                    <b>{String(v).replace('.', lang === 'en' ? '.' : ',')}%</b>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="t-card">
            <h4>{L.quantTitle}</h4><p className="muted-l">{L.quantLead}</p>
            <div className="quant">
              {quant.map(([b, v]) => (
                <div key={b} className={`q ${v >= 97 ? 'ok' : v < 90 ? 'bad' : ''}`}>
                  <span className="q-bar" style={{ height: `${(v - 80) * 5}%` }}><i>{String(v).replace('.', lang === 'en' ? '.' : ',')}</i></span>
                  <span className="q-b">{b === '32' ? 'fp32' : `${b}-bit`}</span>
                </div>
              ))}
              <span className="q-line" style={{ bottom: `${(97 - 80) * 5}%` }}>97%</span>
            </div>
          </div>
        </div>
      </section>

      <section id="results" className="results reveal">
        <h2>{L.resTitle}</h2>
        <div className="res-grid">
          {L.res.map(([n, s], i) => <div key={s} style={{ ['--i' as string]: i }}><b>{n}</b><span>{s}</span></div>)}
        </div>
      </section>

      <section id="app" className="apps reveal">
        <div className="app-card">
          <h2>{L.appTitle}</h2><p>{L.appLead}</p>
          <ul>{L.appFeat.map(f => <li key={f}>{Icon.check(16)} {f}</li>)}</ul>
          <img src="/mobile-app.png" alt="" loading="lazy" className="app-shot" />
        </div>
        <div className="app-card dark">
          <h2>{L.docTitle}</h2>
          <ul>{L.docFeat.map(f => <li key={f}>{Icon.check(16)} {f}</li>)}</ul>
          <img src="/web-patient.png" alt="" loading="lazy" className="app-shot wide" />
        </div>
      </section>

      <section className="cta reveal">
        <h2>{L.ctaTitle}</h2><p>{L.ctaText}</p>
        <Link to="/login" className="l-btn">{L.cta1} {Icon.arrow(18)}</Link>
        <small>{L.demo}</small>
      </section>

      <footer className="l-foot">
        <span className="l-brand">{Icon.pulse(18)}<span>AFib<b>Monitor</b></span></span>
        <p>{L.foot}</p>
        <p className="disc">{L.disc}</p>
      </footer>
    </div>
  )
}
