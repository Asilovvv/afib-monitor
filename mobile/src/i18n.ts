export type Lang = 'ru' | 'en'

const ru = {
  // tabs
  tab_monitor: 'Монитор', tab_history: 'История', tab_diary: 'Дневник', tab_profile: 'Профиль',
  // onboarding
  ob1_t: 'Сердце под присмотром', ob1_b: 'Носимый монитор ЭКГ сам распознаёт фибрилляцию предсердий — нейросеть работает прямо в датчике.',
  ob2_t: 'Мгновенное предупреждение', ob2_b: 'Телефон получает ритм по Bluetooth, вибрирует при начале приступа и сам записывает ЭКГ для врача.',
  ob3_t: 'Врач всегда в курсе', ob3_b: 'Эпизоды, пульс и ваши симптомы попадают в кабинет врача в реальном времени.',
  next: 'Далее', start: 'Начать', skip: 'Пропустить',
  // auth
  welcome: 'Добро пожаловать', signin: 'Вход', signup: 'Регистрация', email: 'Email', password: 'Пароль',
  name: 'Имя и фамилия', doctor_code: 'Код врача (необязательно)', birth_year: 'Год рождения',
  server: 'Адрес сервера', server_hint: 'Например http://192.168.1.5:8000 — адрес компьютера с сервером в той же Wi-Fi сети',
  sign_in_btn: 'Войти', sign_up_btn: 'Создать аккаунт', no_account: 'Нет аккаунта? Регистрация', have_account: 'Уже есть аккаунт? Войти',
  demo_login: 'Демо-пациент', offline_mode: 'Продолжить без сервера', check: 'Проверить', server_ok: 'Сервер доступен', server_bad: 'Сервер недоступен',
  // monitor
  hello: 'Здравствуйте', connect_title: 'Подключите монитор', connect_text: 'Включите CoreS3 SE и наденьте электроды: красный — под правую ключицу, жёлтый — под левую, зелёный — слева внизу живота.',
  connect_device: 'Подключить устройство', demo_mode: 'Демо-режим без устройства',
  scanning: 'Ищу устройство…', connecting: 'Подключаюсь…', reconnecting: 'Связь потеряна, переподключаюсь…',
  not_found: 'Устройство не найдено. Оно включено и рядом?', no_permission: 'Нет разрешения на Bluetooth',
  st_collecting: 'Сбор данных', st_normal: 'Нормальный ритм', st_afib: 'Фибрилляция', st_nosignal: 'Нет сигнала',
  st_collecting_sub: 'Нужно 32 удара — около 30 секунд', st_normal_sub: 'Ритм регулярный', st_afib_sub: 'Сядьте и отдохните. ЭКГ записана для врача.',
  st_nosignal_sub: 'Проверьте электроды и провода', waiting: 'Ожидание данных…', stale: 'Нет данных',
  bpm: 'уд/мин', confidence: 'вероятность ФП', today: 'Сегодня', episodes: 'Эпизоды', burden: 'Нагрузка ФП', monitored: 'Мониторинг',
  live_ecg: 'Живая ЭКГ', record_ecg: 'Записать ЭКГ', recording: 'Запись…', ecg_saved: 'ЭКГ сохранена и отправлена врачу',
  ecg_saved_local: 'ЭКГ сохранена, отправим при появлении связи', how_feel: 'Как самочувствие?', add_symptom: 'Отметить симптом',
  sos: 'SOS', sos_title: 'Экстренный вызов', sos_text: 'Позвонить в скорую помощь (103)?', call: 'Позвонить', call_doctor: 'Позвонить врачу',
  cancel: 'Отмена', stop: 'Отключить', device: 'Устройство',
  af_notif_t: 'Обнаружена фибрилляция предсердий', af_notif_b: 'Пульс {bpm} уд/мин. Сядьте и отдохните; если плохо — звоните 103.',
  // device
  battery: 'Батарея', signal: 'Сигнал', inference: 'Инференс на чипе', uptime: 'Время работы', model: 'Модель', firmware: 'Прошивка',
  source_sim: 'Симулятор', source_dev: 'CoreS3 SE · Bluetooth', packets: 'ЭКГ-пакеты', sync: 'Синхронизация',
  pending: 'в очереди', synced: 'синхронизировано', never: 'ещё не было', sync_now: 'Синхронизировать',
  // history
  h24: '24 ч', d7: '7 дней', d30: '30 дней', af_minutes: 'Минуты ФП', pulse: 'Пульс', no_episodes: 'Эпизодов фибрилляции не было',
  longest: 'самый длинный', ecg_records: 'Записи ЭКГ', auto_rec: 'автозапись при ФП', manual_rec: 'записано вами', symptom_rec: 'при симптоме',
  verdict_confirmed: 'Подтверждено врачом', verdict_false: 'Ложная тревога', on_phone: 'На этом телефоне', login_needed: 'Войдите, чтобы видеть историю с сервера',
  min: 'мин', h: 'ч', s: 'с', ago: 'назад', now: 'сейчас',
  // diary
  diary_title: 'Дневник симптомов', diary_sub: 'Отмечайте самочувствие — врач увидит это рядом с ЭКГ.',
  severity: 'Насколько сильно', sev1: 'Слабо', sev2: 'Средне', sev3: 'Сильно', note: 'Комментарий', note_ph: 'Что делали, сколько длилось…',
  save: 'Сохранить', saved: 'Сохранено', choose_symptom: 'Выберите хотя бы один симптом', no_symptoms: 'Записей пока нет',
  palpitations: 'Сердцебиение', dizziness: 'Головокружение', shortness_of_breath: 'Одышка', chest_pain: 'Боль в груди',
  fatigue: 'Слабость', anxiety: 'Тревога', other: 'Другое', attach_ecg: 'Приложить ЭКГ последних 10 с',
  // profile
  profile: 'Профиль', my_doctor: 'Мой врач', no_doctor: 'Врач не подключён', link: 'Подключить', doctor_linked: 'Врач подключён',
  appearance: 'Оформление', theme: 'Тема', th_system: 'Системная', th_light: 'Светлая', th_dark: 'Тёмная', language: 'Язык',
  account: 'Аккаунт', sign_out: 'Выйти', not_signed: 'Вы не вошли', sign_in_cta: 'Войти или зарегистрироваться',
  about: 'О приложении', disclaimer: 'Учебный исследовательский проект. Не является медицинским изделием и не заменяет консультацию врача.',
  phone: 'Телефон', edit: 'Изменить', years: 'лет', error: 'Ошибка',
}
export type Key = keyof typeof ru

const en: Record<Key, string> = {
  tab_monitor: 'Monitor', tab_history: 'History', tab_diary: 'Diary', tab_profile: 'Profile',
  ob1_t: 'Your heart, watched over', ob1_b: 'A wearable ECG monitor that recognises atrial fibrillation on its own — the neural network runs inside the sensor.',
  ob2_t: 'Instant warning', ob2_b: 'Your phone gets the rhythm over Bluetooth, vibrates when an episode starts and records the ECG for your doctor.',
  ob3_t: 'Your doctor stays informed', ob3_b: 'Episodes, heart rate and your symptoms reach the doctor portal in real time.',
  next: 'Next', start: 'Get started', skip: 'Skip',
  welcome: 'Welcome', signin: 'Sign in', signup: 'Sign up', email: 'Email', password: 'Password',
  name: 'Full name', doctor_code: 'Doctor code (optional)', birth_year: 'Year of birth',
  server: 'Server address', server_hint: 'For example http://192.168.1.5:8000 — the computer running the server on the same Wi-Fi',
  sign_in_btn: 'Sign in', sign_up_btn: 'Create account', no_account: 'No account? Sign up', have_account: 'Have an account? Sign in',
  demo_login: 'Demo patient', offline_mode: 'Continue without a server', check: 'Check', server_ok: 'Server reachable', server_bad: 'Server unreachable',
  hello: 'Hello', connect_title: 'Connect your monitor', connect_text: 'Turn on the CoreS3 SE and attach the electrodes: red under the right collarbone, yellow under the left, green on the lower left abdomen.',
  connect_device: 'Connect device', demo_mode: 'Demo mode without a device',
  scanning: 'Looking for the device…', connecting: 'Connecting…', reconnecting: 'Connection lost, reconnecting…',
  not_found: 'Device not found. Is it on and nearby?', no_permission: 'Bluetooth permission denied',
  st_collecting: 'Collecting', st_normal: 'Normal rhythm', st_afib: 'Fibrillation', st_nosignal: 'No signal',
  st_collecting_sub: '32 beats needed — about 30 seconds', st_normal_sub: 'Rhythm is regular', st_afib_sub: 'Sit down and rest. The ECG was recorded for your doctor.',
  st_nosignal_sub: 'Check the electrodes and leads', waiting: 'Waiting for data…', stale: 'No data',
  bpm: 'bpm', confidence: 'AF probability', today: 'Today', episodes: 'Episodes', burden: 'AF burden', monitored: 'Monitored',
  live_ecg: 'Live ECG', record_ecg: 'Record ECG', recording: 'Recording…', ecg_saved: 'ECG saved and sent to your doctor',
  ecg_saved_local: 'ECG saved, will be sent when online', how_feel: 'How do you feel?', add_symptom: 'Log a symptom',
  sos: 'SOS', sos_title: 'Emergency call', sos_text: 'Call an ambulance (103)?', call: 'Call', call_doctor: 'Call my doctor',
  cancel: 'Cancel', stop: 'Disconnect', device: 'Device',
  af_notif_t: 'Atrial fibrillation detected', af_notif_b: 'Heart rate {bpm} bpm. Sit down and rest; if you feel unwell call 103.',
  battery: 'Battery', signal: 'Signal', inference: 'On-chip inference', uptime: 'Uptime', model: 'Model', firmware: 'Firmware',
  source_sim: 'Simulator', source_dev: 'CoreS3 SE · Bluetooth', packets: 'ECG packets', sync: 'Sync',
  pending: 'queued', synced: 'synced', never: 'not yet', sync_now: 'Sync now',
  h24: '24 h', d7: '7 days', d30: '30 days', af_minutes: 'AF minutes', pulse: 'Heart rate', no_episodes: 'No AF episodes',
  longest: 'longest', ecg_records: 'ECG recordings', auto_rec: 'auto-recorded at AF', manual_rec: 'recorded by you', symptom_rec: 'with a symptom',
  verdict_confirmed: 'Confirmed by doctor', verdict_false: 'False alarm', on_phone: 'On this phone', login_needed: 'Sign in to see your history from the server',
  min: 'min', h: 'h', s: 's', ago: 'ago', now: 'now',
  diary_title: 'Symptom diary', diary_sub: 'Log how you feel — your doctor sees it next to the ECG.',
  severity: 'How strong', sev1: 'Mild', sev2: 'Moderate', sev3: 'Severe', note: 'Note', note_ph: 'What you were doing, how long it lasted…',
  save: 'Save', saved: 'Saved', choose_symptom: 'Choose at least one symptom', no_symptoms: 'No entries yet',
  palpitations: 'Palpitations', dizziness: 'Dizziness', shortness_of_breath: 'Short of breath', chest_pain: 'Chest pain',
  fatigue: 'Fatigue', anxiety: 'Anxiety', other: 'Other', attach_ecg: 'Attach ECG of the last 10 s',
  profile: 'Profile', my_doctor: 'My doctor', no_doctor: 'No doctor linked', link: 'Link', doctor_linked: 'Doctor linked',
  appearance: 'Appearance', theme: 'Theme', th_system: 'System', th_light: 'Light', th_dark: 'Dark', language: 'Language',
  account: 'Account', sign_out: 'Sign out', not_signed: 'You are not signed in', sign_in_cta: 'Sign in or sign up',
  about: 'About', disclaimer: 'Educational research project. Not a medical device and not a substitute for medical advice.',
  phone: 'Phone', edit: 'Edit', years: 'y', error: 'Error',
}

export const DICT: Record<Lang, Record<Key, string>> = { ru, en }
export const SYMPTOMS = ['palpitations', 'dizziness', 'shortness_of_breath', 'chest_pain', 'fatigue', 'anxiety', 'other'] as const

export function translate(lang: Lang, k: Key | string, vars?: Record<string, string | number>): string {
  let s = (DICT[lang] as Record<string, string>)[k] ?? (ru as Record<string, string>)[k] ?? k
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b))
  return s
}
