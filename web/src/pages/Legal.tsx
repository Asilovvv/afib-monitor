import { Link } from 'react-router-dom'
import { Icon } from '../components/ui'
import { LANG_LABEL, nextLang, useT, type Lang } from '../i18n'

/** Privacy policy and terms of use (version 2026-10). Plain language, three languages.
 *  Research prototype: describes what the system actually does today — update together with CONSENT_VERSION. */
type Sec = [string, string[]]
const VERSION = '2026-10b'

const PRIVACY: Record<Lang, { title: string; lead: string; sections: Sec[] }> = {
  ru: {
    title: 'Политика конфиденциальности',
    lead: 'AFib Monitor — учебный исследовательский прототип дипломного проекта Ala-Too International University. Он не является медицинским изделием и не ставит диагноз.',
    sections: [
      ['Какие данные мы собираем', [
        'Аккаунт: имя, email, пароль (хранится только в виде хэша bcrypt), год рождения, пол, телефон — если вы их указали.',
        'Данные монитора: время, ритм (норма / ФП / нет сигнала), вероятность ФП, пульс, заряд батареи.',
        'Записи ЭКГ по 10 секунд: автоматически в начале эпизода ФП, вручную или при отметке симптома.',
        'Дневник симптомов и заметки вашего врача; факторы риска CHA₂DS₂-VASc, если их заполнил врач.',
        'Если вы подключили Telegram — номер чата и имя в Telegram, чтобы присылать тревоги.',
      ]],
      ['Зачем', [
        'Показать вам и вашему врачу ритм, эпизоды и ЭКГ; прислать тревогу врачу и близким, которых вы сами подключили.',
        'Мы не продаём данные, не показываем рекламу и не передаём данные третьим лицам для маркетинга.',
      ]],
      ['Кто видит ваши данные', [
        'Вы. Врач — только если вы ввели его код. Близкие в Telegram — только тревоги и ЭКГ эпизода, только если вы их пригласили.',
        'Каждый просмотр ваших данных врачом записывается: список виден в приложении (Профиль → «Кто смотрел мои данные»).',
      ]],
      ['Где хранятся', [
        'На облачном сервере Render (регион Oregon, США) по зашифрованному соединению HTTPS. Для реального применения данные будут перенесены на сервер в Кыргызстане или ЕАЭС.',
        'Пока сервер работает в демо-режиме, данные могут сбрасываться при обновлении.',
      ]],
      ['Ваши права', [
        'Скачать все свои данные одним файлом: Профиль → «Скачать мои данные».',
        'Удалить аккаунт и все записи безвозвратно: Профиль → «Удалить аккаунт».',
        'Отозвать согласие на участие в исследовании или отключить Telegram в любой момент.',
      ]],
      ['Контакт', ['Бектур Асилов, COMSE-23, Ala-Too International University, Бишкек. Научный руководитель: Erustan Erkebulanov.']],
    ],
  },
  ky: {
    title: 'Купуялуулук саясаты',
    lead: 'AFib Monitor — Ala-Too International University дипломдук долбоорунун окуу-изилдөө прототиби. Ал медициналык буюм эмес жана диагноз койбойт.',
    sections: [
      ['Кандай маалыматтарды чогултабыз', [
        'Аккаунт: аты, email, сырсөз (bcrypt хэши катары гана сакталат), туулган жылы, жынысы, телефону — эгер көрсөтсөңүз.',
        'Монитордун маалыматтары: убакыт, ритм (норма / ФП / сигнал жок), ФП ыктымалдыгы, пульс, батареянын заряды.',
        '10 секунддук ЭКГ жазуулары: ФП эпизоду башталганда автоматтык түрдө, кол менен же белги кошкондо.',
        'Белгилер күндөлүгү жана дарыгериңиздин жазуулары; дарыгер толтурса — CHA₂DS₂-VASc тобокелдик факторлору.',
        'Telegram туташтырсаңыз — эскертүү жиберүү үчүн чаттын номери жана Telegramдагы атыңыз.',
      ]],
      ['Эмне үчүн', [
        'Сизге жана дарыгериңизге ритмди, эпизоддорду жана ЭКГны көрсөтүү; өзүңүз туташтырган дарыгерге жана жакындарыңызга эскертүү жиберүү.',
        'Биз маалыматтарды сатпайбыз, жарнама көрсөтпөйбүз жана маркетинг үчүн үчүнчү жактарга бербейбиз.',
      ]],
      ['Маалыматтарыңызды ким көрөт', [
        'Сиз. Дарыгер — анын кодун киргизсеңиз гана. Telegramдагы жакындар — сиз чакырсаңыз гана, эскертүүлөрдү жана эпизоддун ЭКГсын гана.',
        'Дарыгер маалыматтарыңызды ар бир жолу ачканы жазылат: тизме тиркемеде көрүнөт (Профиль → «Маалыматымды ким көрдү»).',
      ]],
      ['Кайда сакталат', [
        'Render булут серверинде (Oregon аймагы, АКШ), шифрленген HTTPS байланышы аркылуу. Чыныгы колдонуу үчүн маалыматтар Кыргызстандагы же ЕАЭБдеги серверге көчүрүлөт.',
        'Сервер демо-режимде иштеп жатканда маалыматтар жаңыртууда өчүп калышы мүмкүн.',
      ]],
      ['Сиздин укуктарыңыз', [
        'Бардык маалыматтарыңызды бир файл менен жүктөп алуу: Профиль → «Маалыматымды жүктөө».',
        'Аккаунтту жана бардык жазууларды биротоло өчүрүү: Профиль → «Аккаунтту өчүрүү».',
        'Изилдөөгө катышуу макулдугун кайтарып алуу же Telegramды каалаган убакта ажыратуу.',
      ]],
      ['Байланыш', ['Бектур Асилов, COMSE-23, Ala-Too International University, Бишкек. Илимий жетекчи: Erustan Erkebulanov.']],
    ],
  },
  en: {
    title: 'Privacy policy',
    lead: 'AFib Monitor is an educational research prototype from a diploma project at Ala-Too International University. It is not a medical device and does not diagnose.',
    sections: [
      ['What we collect', [
        'Account: name, email, password (stored only as a bcrypt hash), year of birth, sex, phone — if you provide them.',
        'Monitor data: time, rhythm (normal / AF / no signal), AF probability, heart rate, battery level.',
        '10-second ECG recordings: automatically at the start of an AF episode, manually, or with a symptom.',
        'Symptom diary and your doctor’s notes; CHA₂DS₂-VASc risk factors if your doctor filled them in.',
        'If you connect Telegram — the chat number and Telegram name, to send alerts.',
      ]],
      ['Why', [
        'To show you and your doctor the rhythm, episodes and ECG; to alert the doctor and relatives you connected yourself.',
        'We do not sell data, show ads, or share data with third parties for marketing.',
      ]],
      ['Who sees your data', [
        'You. A doctor — only if you entered their code. Relatives in Telegram — only alerts and the episode ECG, only if you invited them.',
        'Every time a doctor opens your data it is logged; you can see the list in the app (Profile → “Who viewed my data”).',
      ]],
      ['Where it is stored', [
        'On a Render cloud server (Oregon region, USA), over encrypted HTTPS. For real use, data will move to a server in Kyrgyzstan or the EAEU.',
        'While the server runs in demo mode, data may be reset on updates.',
      ]],
      ['Your rights', [
        'Download all your data as one file: Profile → “Download my data”.',
        'Delete your account and every record permanently: Profile → “Delete account”.',
        'Withdraw research consent or disconnect Telegram at any time.',
      ]],
      ['Contact', ['Bektur Asilov, COMSE-23, Ala-Too International University, Bishkek. Supervisor: Erustan Erkebulanov.']],
    ],
  },
}

const TERMS: Record<Lang, { title: string; lead: string; sections: Sec[] }> = {
  ru: {
    title: 'Условия использования',
    lead: 'Пользуясь AFib Monitor, вы соглашаетесь с этими условиями.',
    sections: [
      ['Это не медицинское изделие', [
        'Прототип создан для учёбы и исследования. Он может ошибаться: пропустить фибрилляцию или показать ложную тревогу.',
        'Не принимайте решений о лечении без врача. При боли в груди, обмороке или сильной одышке звоните 103.',
      ]],
      ['Исследование', [
        'Оценку ритма «возможная фибрилляция» и уведомления врачу получают только участники исследования: те, кто дал согласие и привязан к своему врачу. Остальные видят проверку ритма без диагноза.',
        'Обезличенные данные участников могут использоваться для улучшения алгоритма. Согласие можно отозвать в профиле, тогда приложение вернётся к проверке без диагноза.',
      ]],
      ['Аккаунт', [
        'Вы отвечаете за сохранность пароля. Аккаунт и все данные можно удалить в любой момент в профиле.',
      ]],
      ['Доступность', [
        'Сервис бесплатный и работает «как есть», без гарантий непрерывной работы.',
      ]],
    ],
  },
  ky: {
    title: 'Колдонуу шарттары',
    lead: 'AFib Monitor колдонуу менен сиз бул шарттарга макул болосуз.',
    sections: [
      ['Бул медициналык буюм эмес', [
        'Прототип окуу жана изилдөө үчүн түзүлгөн. Ал жаңылышы мүмкүн: фибрилляцияны байкабай калышы же жалган эскертүү бериши мүмкүн.',
        'Дарыгерсиз дарылоо чечимдерин кабыл албаңыз. Көкүрөк ооруса, эс-учуңузду жоготсоңуз же катуу ентиксеңиз 103кө чалыңыз.',
      ]],
      ['Изилдөө', [
        '«Мүмкүн болгон фибрилляция» баасын жана дарыгерге билдирүүнү изилдөөгө катышуучулар гана алышат: макулдук берген жана өз дарыгерине байланган адамдар. Калгандары диагнозсуз ритм текшерүүсүн көрүшөт.',
        'Катышуучулардын жашыруун маалыматтары алгоритмди жакшыртуу үчүн колдонулушу мүмкүн. Макулдукту профилден кайтарып алса болот, анда тиркеме диагнозсуз текшерүүгө кайтат.',
      ]],
      ['Аккаунт', [
        'Сырсөздүн коопсуздугуна сиз жооптуусуз. Аккаунтту жана бардык маалыматтарды профилден каалаган убакта өчүрсө болот.',
      ]],
      ['Жеткиликтүүлүк', [
        'Кызмат акысыз жана «кандай болсо ошондой» иштейт, үзгүлтүксүз иштөөгө кепилдик жок.',
      ]],
    ],
  },
  en: {
    title: 'Terms of use',
    lead: 'By using AFib Monitor you agree to these terms.',
    sections: [
      ['This is not a medical device', [
        'The prototype is built for study and research. It can be wrong: it may miss fibrillation or raise a false alarm.',
        'Do not make treatment decisions without a doctor. For chest pain, fainting or severe shortness of breath call 103.',
      ]],
      ['Research', [
        'Only study participants (consent given and linked to their own doctor) see the "possible atrial fibrillation" estimate, and only their doctor is notified. Everyone else gets a rhythm check without a diagnosis.',
        'De-identified data of participants may be used to improve the algorithm. You can withdraw consent in your profile; the app then returns to the check without a diagnosis.',
      ]],
      ['Account', [
        'You are responsible for keeping your password safe. You can delete your account and all data at any time in your profile.',
      ]],
      ['Availability', [
        'The service is free and provided “as is”, with no guarantee of uninterrupted operation.',
      ]],
    ],
  },
}

export default function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const { lang, setLang } = useT()
  const doc = (kind === 'privacy' ? PRIVACY : TERMS)[lang]
  const other = kind === 'privacy' ? TERMS[lang].title : PRIVACY[lang].title
  return (
    <div className="legal">
      <header className="l-nav">
        <Link to="/" className="l-brand">{Icon.pulse(22)}<span>AFib<b>Monitor</b></span></Link>
        <div className="l-nav-right">
          <button className="lang" onClick={() => setLang(nextLang(lang))}>{LANG_LABEL[nextLang(lang)]}</button>
        </div>
      </header>
      <article className="legal-body">
        <p className="kicker">{lang === 'en' ? 'Version' : lang === 'ky' ? 'Версия' : 'Версия'} {VERSION}</p>
        <h1>{doc.title}</h1>
        <p className="lead">{doc.lead}</p>
        {doc.sections.map(([h, items]) => (
          <section key={h}>
            <h2>{h}</h2>
            {items.length === 1 ? <p>{items[0]}</p> : <ul>{items.map(t => <li key={t}>{t}</li>)}</ul>}
          </section>
        ))}
        <p className="legal-foot"><Link to={kind === 'privacy' ? '/terms' : '/privacy'}>{other}</Link> · <Link to="/">AFib Monitor</Link></p>
      </article>
    </div>
  )
}
