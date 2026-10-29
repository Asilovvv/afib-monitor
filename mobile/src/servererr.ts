/** Server error messages (English, from the API) shown in the user's language. Unknown messages pass through unchanged. */
export const SERVER_ERR: Record<string, [ru: string, ky: string]> = {
  'Wrong email or password': ['Неверный email или пароль', 'Email же сырсөз туура эмес'],
  'Wrong password': ['Неверный пароль', 'Сырсөз туура эмес'],
  'Email already registered': ['Этот email уже зарегистрирован', 'Бул email мурун катталган'],
  'Too many attempts, try later in 15 minutes': ['Слишком много попыток, попробуйте через 15 минут', 'Аракет өтө көп, 15 мүнөттөн кийин кайталаңыз'],
  'Too many attempts, try again in 15 minutes': ['Слишком много попыток, попробуйте через 15 минут', 'Аракет өтө көп, 15 мүнөттөн кийин кайталаңыз'],
  'Doctor code not found': ['Код врача не найден', 'Дарыгердин коду табылган жок'],
  'This is your own code': ['Это ваш собственный код', 'Бул өзүңүздүн кодуңуз'],
  'The demo doctor code is for viewing only. Ask your own doctor for a code.': ['Код демо-врача только для просмотра. Попросите код у своего врача.', 'Демо-дарыгердин коду көрүү үчүн гана. Кодду өз дарыгериңизден сураңыз.'],
  'Family code not found or expired': ['Код близкого не найден или устарел', 'Жакындын коду табылган жок же мөөнөтү өткөн'],
  'Telegram bot is not configured on this server': ['Telegram-бот на сервере не настроен', 'Серверде Telegram-бот орнотулган эмес'],
  'Patient not found': ['Пациент не найден', 'Бейтап табылган жок'],
  'User not found': ['Пользователь не найден', 'Колдонуучу табылган жок'],
  'Not found': ['Не найдено', 'Табылган жок'],
  'ECG not found': ['Запись ЭКГ не найдена', 'ЭКГ жазуусу табылган жок'],
  'Alert not found': ['Тревога не найдена', 'Эскертүү табылган жок'],
  'Medication not found': ['Лекарство не найдено', 'Дары табылган жок'],
  'Device not found': ['Датчик не найден', 'Датчик табылган жок'],
  'Only for doctors': ['Только для врачей', 'Дарыгерлер үчүн гана'],
  'Forbidden': ['Нет доступа', 'Уруксат жок'],
  'Link expired': ['Ссылка устарела', 'Шилтеменин мөөнөтү өттү'],
  'systolic must be above diastolic': ['Верхнее давление должно быть больше нижнего', 'Жогорку басым төмөнкүдөн чоң болушу керек'],
  'blood pressure needs systolic and diastolic': ['Введите верхнее и нижнее давление', 'Жогорку жана төмөнкү басымды жазыңыз'],
  'Not an AFib Monitor export file': ['Это не файл экспорта AFib Monitor', 'Бул AFib Monitor экспорт файлы эмес'],
  'Export file too large (60 MB max)': ['Файл слишком большой (максимум 60 МБ)', 'Файл өтө чоң (эң көп 60 МБ)'],
  'Patient already has a device': ['У пациента уже есть датчик', 'Бейтапта датчик бар'],
  'Device with this chip ID already exists': ['Датчик с таким ID чипа уже есть', 'Мындай чип ID менен датчик бар'],
  'Device is retired': ['Датчик списан', 'Датчик эсептен чыгарылган'],
  'Device is issued; take it back first': ['Датчик выдан — сначала примите его обратно', 'Датчик берилген — адегенде кайра алыңыз'],
  'Device is already issued': ['Датчик уже выдан', 'Датчик мурун берилген'],
  'Already returned': ['Уже возвращён', 'Мурун кайтарылган'],
  'Not enough electrodes with this device': ['С этим датчиком недостаточно электродов', 'Бул датчик менен электроддор жетишсиз'],
}

export function serverError(msg: string, lang: string): string {
  const r = SERVER_ERR[msg]
  return !r || lang === 'en' ? msg : lang === 'ky' ? r[1] : r[0]
}
