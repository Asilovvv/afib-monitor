import { Link } from 'react-router-dom'
import { Icon } from '../components/ui'
import { LANG_LABEL, nextLang, useT, type Lang } from '../i18n'

/** Privacy policy and terms of use (version 2026-10c). Plain language, three languages.
 *  Research prototype: describes what the system actually does today — update together with CONSENT_VERSION. */
type Sec = [string, string[]]
const VERSION = '2026-10c'
/** What changed since 2026-10b, shown at the top of both pages. Research consent is unchanged (same scope), so
 *  CONSENT_VERSION on the server stays; whether the terms/data changes need a fresh "I agree" is a lawyer's call
 *  (docs/REGULATORY_BRIEF_RU.md, [ЮРИСТ]). */
const CHANGED: Record<Lang, string> = {
  ru: 'Изменения от 27.10.2026: дневник давления, сахара и веса; фото тонометра (не сохраняется); семейный режим; Telegram-бот пациента; аренда датчика через клинику; тарифы и оплата через магазины приложений; перенос данных из файла; PDF ЭКГ на телефоне.',
  ky: '27.10.2026-жылдагы өзгөрүүлөр: кан басымы, кант жана салмак күндөлүгү; тонометр сүрөтү (сакталбайт); үй-бүлө режими; бейтаптын Telegram боту; клиника аркылуу датчикти ижарага алуу; тарифтер жана тиркеме дүкөндөрү аркылуу төлөм; маалыматты файлдан көчүрүү; телефондо ЭКГ PDF.',
  en: 'Changes of 27 Oct 2026: blood pressure, glucose and weight diary; cuff photo (not stored); family mode; patient Telegram bot; device rental through a clinic; plans and payment through the app stores; transfer from a file; ECG PDF on the phone.',
}

const PRIVACY: Record<Lang, { title: string; lead: string; sections: Sec[] }> = {
  ru: {
    title: 'Политика конфиденциальности',
    lead: 'AFib Monitor — учебный исследовательский прототип дипломного проекта Ala-Too International University. Он не является медицинским изделием и не ставит диагноз.',
    sections: [
      ['Какие данные мы собираем', [
        'Аккаунт: имя, email, пароль (хранится только в виде хэша bcrypt), год рождения, пол, телефон — если вы их указали. Роль: пациент, врач или близкий.',
        'Данные датчика: время, ритм, пульс, заряд батареи; у участников исследования — также оценка вероятности ФП.',
        'Записи ЭКГ: 30-секундные проверки, записи вручную, при отметке симптома и (у участников исследования) в начале эпизода.',
        'То, что вы вводите сами: симптомы, дневник дня, лекарства и отметки о приёме, план проверок, давление, сахар, вес (вручную, сообщением в Telegram или после фото тонометра).',
        'Фото тонометра распознаётся на телефоне и не сохраняется и не отправляется: на сервер попадают только цифры, которые вы подтвердили.',
        'Заметки и отметки врача («видел»), факторы риска CHA₂DS₂-VASc, если их заполнил врач.',
        'Если вы подключили Telegram — номер чата, имя в Telegram и выбранный язык.',
        'Если клиника выдала вам датчик — его номер, даты выдачи и возврата, число электродов.',
        'Тариф: название, срок и источник (пробный период, магазин, счёт клиники). Данные банковских карт мы не получаем — их хранят Apple и Google; от магазина приходят только события подписки (оформлена, продлена, закончилась).',
      ]],
      ['Чего мы не собираем', [
        'Геолокацию, контакты, фото из галереи, микрофон. Голосовые подсказки и PDF ЭКГ создаются на телефоне без интернета.',
        'Сырой сигнал, записанный на экране «Стенд», и PDF остаются на телефоне, пока вы сами ими не поделитесь.',
      ]],
      ['Зачем', [
        'Показать вам, вашему врачу и близким, которых вы сами подключили, то, что вы им разрешили; напомнить о проверках, лекарствах и возврате датчика.',
        'Для управления сервисом мы считаем только обезличенные итоги (сколько пациентов, проверок, подписок) — без имён.',
        'Мы не продаём данные, не показываем рекламу и не передаём данные третьим лицам для маркетинга.',
      ]],
      ['Кто видит ваши данные', [
        'Вы. Врач — только если вы ввели его код или подтвердили ссылку от него; он видит ваши записи и проверки.',
        'Близкие — только если вы дали им код: они видят дневную карточку (сделана ли проверка, вердикт словами, давление, приём лекарств), но не ЭКГ и не оценку ФП. Отключить можно в профиле.',
        'Клиника, выдавшая датчик, видит, у кого он и до какого числа.',
        'Каждый просмотр ваших данных врачом или близким записывается: список виден в приложении (Профиль → «Кто смотрел мои данные»).',
      ]],
      ['Где хранятся', [
        'На облачном сервере Render (регион Oregon, США) и в базе Neon PostgreSQL, по зашифрованному соединению HTTPS. Для реального применения данные будут перенесены на сервер в Кыргызстане или ЕАЭС.',
        'Пока сервер работает в демо-режиме, данные могут сбрасываться при обновлении.',
      ]],
      ['Ваши права', [
        'Скачать все свои данные одним файлом: Профиль → «Скачать мои данные». Перенести их в новый аккаунт: Профиль → «Перенести из файла» (врач и близкие при этом не переносятся).',
        'Удалить аккаунт и все записи безвозвратно: Профиль → «Удалить аккаунт».',
        'Отозвать согласие на участие в исследовании, отключить близких или Telegram в любой момент.',
      ]],
      ['Контакт', ['Бектур Асилов, COMSE-23, Ala-Too International University, Бишкек. Научный руководитель: Erustan Erkebulanov.']],
    ],
  },
  ky: {
    title: 'Купуялуулук саясаты',
    lead: 'AFib Monitor — Ala-Too International University дипломдук долбоорунун окуу-изилдөө прототиби. Ал медициналык буюм эмес жана диагноз койбойт.',
    sections: [
      ['Кандай маалыматтарды чогултабыз', [
        'Аккаунт: аты, email, сырсөз (bcrypt хэши катары гана сакталат), туулган жылы, жынысы, телефону — эгер көрсөтсөңүз. Ролу: бейтап, дарыгер же жакын адам.',
        'Датчиктин маалыматтары: убакыт, ритм, пульс, батареянын заряды; изилдөөгө катышуучуларда — ФП ыктымалдыгынын баасы да.',
        'ЭКГ жазуулары: 30 секунддук текшерүүлөр, кол менен жазуулар, белги кошкондо жана (изилдөөгө катышуучуларда) эпизоддун башында.',
        'Өзүңүз киргизген маалымат: белгилер, күн күндөлүгү, дарылар жана кабыл алуу белгилери, текшерүү планы, кан басымы, кант, салмак (колго, Telegram билдирүүсү менен же тонометрдин сүрөтүнөн кийин).',
        'Тонометрдин сүрөтү телефондо таанылат, сакталбайт жана жөнөтүлбөйт: серверге сиз ырастаган сандар гана барат.',
        'Дарыгердин жазуулары жана белгилери («көрдү»), дарыгер толтурса — CHA₂DS₂-VASc тобокелдик факторлору.',
        'Telegram туташтырсаңыз — чаттын номери, Telegramдагы атыңыз жана тандаган тилиңиз.',
        'Клиника сизге датчик берсе — анын номери, берилген жана кайтарылган күндөрү, электроддордун саны.',
        'Тариф: аталышы, мөөнөтү жана булагы (сыноо мезгили, дүкөн, клиниканын эсеби). Банк карталарынын маалыматын биз албайбыз — аларды Apple жана Google сактайт; дүкөндөн жазылуу окуялары гана келет (тариздөө, узартуу, бүтүү).',
      ]],
      ['Эмнени чогултпайбыз', [
        'Жайгашкан жерди, байланыштарды, галереядагы сүрөттөрдү, микрофонду. Үн эскертүүлөрү жана ЭКГ PDF телефондо интернетсиз түзүлөт.',
        '«Стенд» экранында жазылган чийки сигнал жана PDF сиз өзүңүз бөлүшмөйүнчө телефондо калат.',
      ]],
      ['Эмне үчүн', [
        'Сизге, дарыгериңизге жана өзүңүз туташтырган жакындарыңызга уруксат берген нерсени көрсөтүү; текшерүүлөрдү, дарыларды жана датчикти кайтарууну эскертүү.',
        'Кызматты башкаруу үчүн жашыруун жыйынтыктарды гана эсептейбиз (канча бейтап, текшерүү, жазылуу) — аттарсыз.',
        'Биз маалыматтарды сатпайбыз, жарнама көрсөтпөйбүз жана маркетинг үчүн үчүнчү жактарга бербейбиз.',
      ]],
      ['Маалыматтарыңызды ким көрөт', [
        'Сиз. Дарыгер — анын кодун киргизсеңиз же андан келген шилтемени ырастасаңыз гана; ал жазууларыңызды жана текшерүүлөрүңүздү көрөт.',
        'Жакындар — аларга код берсеңиз гана: алар күндүк карточканы көрүшөт (текшерүү жасалдыбы, жыйынтык сөз менен, кан басымы, дары кабыл алуу), бирок ЭКГны жана ФП баасын көрүшпөйт. Профилден ажыратса болот.',
        'Датчик берген клиника ал кимде жана кайсы күнгө чейин экенин көрөт.',
        'Дарыгер же жакын адам маалыматыңызды ар бир жолу ачканы жазылат: тизме тиркемеде көрүнөт (Профиль → «Маалыматымды ким көрдү»).',
      ]],
      ['Кайда сакталат', [
        'Render булут серверинде (Oregon аймагы, АКШ) жана Neon PostgreSQL базасында, шифрленген HTTPS байланышы аркылуу. Чыныгы колдонуу үчүн маалыматтар Кыргызстандагы же ЕАЭБдеги серверге көчүрүлөт.',
        'Сервер демо-режимде иштеп жатканда маалыматтар жаңыртууда өчүп калышы мүмкүн.',
      ]],
      ['Сиздин укуктарыңыз', [
        'Бардык маалыматтарыңызды бир файл менен жүктөп алуу: Профиль → «Маалыматымды жүктөө». Жаңы аккаунтка көчүрүү: Профиль → «Файлдан көчүрүү» (дарыгер жана жакындар көчүрүлбөйт).',
        'Аккаунтту жана бардык жазууларды биротоло өчүрүү: Профиль → «Аккаунтту өчүрүү».',
        'Изилдөөгө катышуу макулдугун кайтарып алуу, жакындарды же Telegramды каалаган убакта ажыратуу.',
      ]],
      ['Байланыш', ['Бектур Асилов, COMSE-23, Ala-Too International University, Бишкек. Илимий жетекчи: Erustan Erkebulanov.']],
    ],
  },
  en: {
    title: 'Privacy policy',
    lead: 'AFib Monitor is an educational research prototype from a diploma project at Ala-Too International University. It is not a medical device and does not diagnose.',
    sections: [
      ['What we collect', [
        'Account: name, email, password (stored only as a bcrypt hash), year of birth, sex, phone — if you provide them. Role: patient, doctor or relative.',
        'Sensor data: time, rhythm, heart rate, battery level; for study participants also the AF probability estimate.',
        'ECG recordings: 30-second checks, manual recordings, recordings with a symptom and (study participants) at the start of an episode.',
        'What you enter yourself: symptoms, day diary, medicines and doses taken, check plan, blood pressure, glucose, weight (typed, by Telegram message or after a cuff photo).',
        'The cuff photo is read on the phone and is neither stored nor sent: only the numbers you confirm reach the server.',
        'Your doctor’s notes and “seen” marks; CHA₂DS₂-VASc risk factors if your doctor filled them in.',
        'If you connect Telegram — the chat number, Telegram name and chosen language.',
        'If a clinic lends you a sensor — its number, issue and return dates, number of electrodes.',
        'Plan: name, end date and source (trial, store, clinic invoice). We never receive card details — Apple and Google keep them; the store sends us only subscription events (started, renewed, ended).',
      ]],
      ['What we do not collect', [
        'Location, contacts, gallery photos, microphone. Voice prompts and the ECG PDF are made on the phone without internet.',
        'Raw signal recorded on the “Bench” screen and PDFs stay on the phone until you share them yourself.',
      ]],
      ['Why', [
        'To show you, your doctor and the relatives you connected what you allowed; to remind you about checks, medicines and returning the sensor.',
        'To run the service we count only de-identified totals (how many patients, checks, subscriptions) — no names.',
        'We do not sell data, show ads, or share data with third parties for marketing.',
      ]],
      ['Who sees your data', [
        'You. A doctor — only if you entered their code or confirmed their link; they see your records and checks.',
        'Relatives — only if you gave them a code: they see a daily card (check done or not, verdict in words, blood pressure, medicines taken), not the ECG and not the AF estimate. You can disconnect them in your profile.',
        'A clinic that lent you a sensor sees who has it and until when.',
        'Every time a doctor or relative opens your data it is logged; you can see the list in the app (Profile → “Who viewed my data”).',
      ]],
      ['Where it is stored', [
        'On a Render cloud server (Oregon region, USA) and a Neon PostgreSQL database, over encrypted HTTPS. For real use, data will move to a server in Kyrgyzstan or the EAEU.',
        'While the server runs in demo mode, data may be reset on updates.',
      ]],
      ['Your rights', [
        'Download all your data as one file: Profile → “Download my data”. Move it into a new account: Profile → “Transfer from a file” (doctor and relatives are not carried over).',
        'Delete your account and every record permanently: Profile → “Delete account”.',
        'Withdraw research consent, disconnect relatives or Telegram at any time.',
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
        'Прототип создан для учёбы и исследования. Он может ошибаться: пропустить фибрилляцию или показать ложное «неровно».',
        'Не принимайте решений о лечении без врача. При боли в груди, обмороке или сильной одышке звоните 103.',
        'Давление, сахар и вес в дневнике — ваши записи с домашних приборов, а не измерения AFib Monitor. Распознанные с фото цифры проверяйте перед сохранением.',
      ]],
      ['Исследование', [
        'Оценку ритма «возможная фибрилляция» и уведомления врачу получают только участники исследования: те, кто дал согласие и привязан к своему врачу. Остальные видят проверку ритма без диагноза.',
        'Обезличенные данные участников могут использоваться для улучшения алгоритма. Согласие можно отозвать в профиле, тогда приложение вернётся к проверке без диагноза.',
      ]],
      ['Аккаунт', [
        'Вы отвечаете за сохранность пароля. Аккаунт и все данные можно удалить в любой момент в профиле.',
        'Подключайте врача только по коду или ссылке, которую получили от него самого.',
      ]],
      ['Тарифы и оплата', [
        'Всё, что касается безопасности, бесплатно навсегда: проверка 30 секунд и её результат, SOS, напоминания, отправка записей врачу, экспорт и удаление данных. Результат проверки одинаков на любом тарифе.',
        'Подписка «Семья» — удобства (больше близких, история без ограничений, фото тонометра, бот, перенос). Новым пациентам — 30 дней бесплатно, без карты; после этого подписка сама не включается.',
        'Подписка оформляется и отменяется через App Store или Google Play по их правилам; цена показана в сомах перед оплатой. Тарифы клиник оплачиваются по счёту.',
      ]],
      ['Датчик от клиники', [
        'Если датчик выдан клиникой, его нужно вернуть к указанной дате. Условия аренды и оплаты устанавливает клиника.',
      ]],
      ['Доступность', [
        'Сервис работает «как есть», без гарантий непрерывной работы.',
      ]],
    ],
  },
  ky: {
    title: 'Колдонуу шарттары',
    lead: 'AFib Monitor колдонуу менен сиз бул шарттарга макул болосуз.',
    sections: [
      ['Бул медициналык буюм эмес', [
        'Прототип окуу жана изилдөө үчүн түзүлгөн. Ал жаңылышы мүмкүн: фибрилляцияны байкабай калышы же жалган «бир калыпта эмес» көрсөтүшү мүмкүн.',
        'Дарыгерсиз дарылоо чечимдерин кабыл албаңыз. Көкүрөк ооруса, эс-учуңузду жоготсоңуз же катуу ентиксеңиз 103кө чалыңыз.',
        'Күндөлүктөгү кан басымы, кант жана салмак — үй приборлорунан алынган сиздин жазууларыңыз, AFib Monitor өлчөөсү эмес. Сүрөттөн таанылган сандарды сактоодон мурун текшериңиз.',
      ]],
      ['Изилдөө', [
        '«Мүмкүн болгон фибрилляция» баасын жана дарыгерге билдирүүнү изилдөөгө катышуучулар гана алышат: макулдук берген жана өз дарыгерине байланган адамдар. Калгандары диагнозсуз ритм текшерүүсүн көрүшөт.',
        'Катышуучулардын жашыруун маалыматтары алгоритмди жакшыртуу үчүн колдонулушу мүмкүн. Макулдукту профилден кайтарып алса болот, анда тиркеме диагнозсуз текшерүүгө кайтат.',
      ]],
      ['Аккаунт', [
        'Сырсөздүн коопсуздугуна сиз жооптуусуз. Аккаунтту жана бардык маалыматтарды профилден каалаган убакта өчүрсө болот.',
        'Дарыгерди андан өзүнөн алган код же шилтеме аркылуу гана туташтырыңыз.',
      ]],
      ['Тарифтер жана төлөм', [
        'Коопсуздукка тиешелүү бардыгы түбөлүк акысыз: 30 секунддук текшерүү жана анын жыйынтыгы, SOS, эскертмелер, жазууларды дарыгерге жөнөтүү, маалыматты экспорттоо жана өчүрүү. Текшерүүнүн жыйынтыгы ар кандай тарифте бирдей.',
        '«Үй-бүлө» жазылуусу — ыңгайлуулуктар (көбүрөөк жакындар, чексиз тарых, тонометр сүрөтү, бот, көчүрүү). Жаңы бейтаптарга — 30 күн акысыз, картасыз; андан кийин жазылуу өзү күйгүзүлбөйт.',
        'Жазылуу App Store же Google Play аркылуу алардын эрежелери боюнча тариздейт жана жокко чыгарылат; баа төлөөдөн мурун сом менен көрсөтүлөт. Клиникалардын тарифтери эсеп боюнча төлөнөт.',
      ]],
      ['Клиникадан алынган датчик', [
        'Датчикти клиника берсе, аны көрсөтүлгөн күнгө чейин кайтаруу керек. Ижаранын жана төлөмдүн шарттарын клиника белгилейт.',
      ]],
      ['Жеткиликтүүлүк', [
        'Кызмат «кандай болсо ошондой» иштейт, үзгүлтүксүз иштөөгө кепилдик жок.',
      ]],
    ],
  },
  en: {
    title: 'Terms of use',
    lead: 'By using AFib Monitor you agree to these terms.',
    sections: [
      ['This is not a medical device', [
        'The prototype is built for study and research. It can be wrong: it may miss fibrillation or show a false “irregular”.',
        'Do not make treatment decisions without a doctor. For chest pain, fainting or severe shortness of breath call 103.',
        'Blood pressure, glucose and weight in the diary are your entries from home devices, not AFib Monitor measurements. Check numbers read from a photo before saving.',
      ]],
      ['Research', [
        'Only study participants (consent given and linked to their own doctor) see the "possible atrial fibrillation" estimate, and only their doctor is notified. Everyone else gets a rhythm check without a diagnosis.',
        'De-identified data of participants may be used to improve the algorithm. You can withdraw consent in your profile; the app then returns to the check without a diagnosis.',
      ]],
      ['Account', [
        'You are responsible for keeping your password safe. You can delete your account and all data at any time in your profile.',
        'Link a doctor only with a code or link you received from that doctor.',
      ]],
      ['Plans and payment', [
        'Everything about safety is free forever: the 30-second check and its result, SOS, reminders, sending records to your doctor, data export and deletion. The check result is the same on every plan.',
        'The Family plan adds convenience (more relatives, unlimited history, cuff photo, bot, transfer). New patients get 30 days free, no card; afterwards the plan does not turn on by itself.',
        'The subscription is bought and cancelled through the App Store or Google Play under their rules; the price is shown in som before paying. Clinic plans are paid by invoice.',
      ]],
      ['Sensor from a clinic', [
        'If a clinic lends you a sensor, return it by the date shown. Rental and payment terms are set by the clinic.',
      ]],
      ['Availability', [
        'The service is provided “as is”, with no guarantee of uninterrupted operation.',
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
        <p className="muted" style={{ fontSize: 13.5 }}>{CHANGED[lang]}</p>
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
