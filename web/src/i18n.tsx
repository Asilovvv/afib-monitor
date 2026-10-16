import { createContext, useContext, useState, type ReactNode } from 'react'

export type Lang = 'ru' | 'en'

// Keys are the Russian strings; English translations below. Missing keys fall back to Russian.
const EN: Record<string, string> = {
  'Обзор': 'Overview', 'Пациенты': 'Patients', 'Тревоги': 'Alerts', 'Настройки': 'Settings', 'Выйти': 'Sign out',
  'Войти': 'Sign in', 'Кабинет врача': 'Doctor portal', 'Поиск пациента…': 'Search patient…',
  'Онлайн': 'Online', 'ФП сейчас': 'AF now', 'Новые тревоги': 'New alerts', 'Эпизоды за 24 ч': 'Episodes, 24 h',
  'Средняя нагрузка ФП': 'Mean AF burden', 'Требуют внимания': 'Needs attention', 'Нагрузка ФП за 24 ч': 'AF burden, 24 h',
  'Последние тревоги': 'Recent alerts', 'Все': 'All', 'С тревогой': 'With alert', 'Пациент': 'Patient',
  'Сейчас': 'Now', 'Пульс': 'Heart rate', 'Нагрузка ФП': 'AF burden', 'Эпизоды': 'Episodes', 'Связь': 'Last seen',
  'Тренд': 'Trend', 'Норма': 'Normal', 'Фибрилляция': 'Atrial fibrillation', 'Сбор данных': 'Collecting',
  'Нет сигнала': 'No signal', 'онлайн': 'online', 'нет данных': 'no data', 'только что': 'just now',
  'мин назад': 'min ago', 'ч назад': 'h ago', 'дн назад': 'd ago', 'ЭКГ': 'ECG', 'Симптомы': 'Symptoms',
  'Заметки': 'Notes', 'Отчёт': 'Report', 'Подтвердить ФП': 'Confirm AF', 'Ложная тревога': 'False alarm',
  'Подтверждено': 'Confirmed', 'Не просмотрено': 'Not reviewed', 'Начало': 'Start', 'Длительность': 'Duration',
  'Уверенность': 'Confidence', 'Решение врача': 'Doctor verdict', 'Мониторинг': 'Monitoring', 'Батарея': 'Battery',
  'Код для пациентов': 'Patient invite code', 'Новый код': 'New code', 'Скопировать': 'Copy', 'Скопировано': 'Copied',
  'Отметить всё прочитанным': 'Acknowledge all', 'Принять': 'Acknowledge', 'Принято': 'Acknowledged', 'Новые': 'New',
  'Добавить заметку': 'Add note', 'Сохранить': 'Save', 'Удалить': 'Delete', 'Профиль': 'Profile', 'Имя': 'Name',
  'Клиника': 'Clinic', 'Специальность': 'Specialty', 'Телефон': 'Phone', 'Тема': 'Theme', 'Язык': 'Language',
  'Светлая': 'Light', 'Тёмная': 'Dark', 'Системная': 'System', 'Сохранено': 'Saved', 'Пароль': 'Password',
  'Нет аккаунта? Регистрация врача': 'No account? Register as a doctor', 'Уже есть аккаунт? Войти': 'Have an account? Sign in',
  'Создать аккаунт': 'Create account', 'Демо-доступ': 'Demo access', 'ЭКГ-записи': 'ECG strips', 'Записей нет.': 'No strips.',
  'Эпизодов нет.': 'No episodes.', 'Симптомов нет.': 'No symptoms.', 'Заметок нет.': 'No notes yet.',
  'Пульс и эпизоды фибрилляции': 'Heart rate and AF episodes', 'Минуты ФП по часам': 'AF minutes per hour',
  'Минуты ФП по дням': 'AF minutes per day', 'автозапись при ФП': 'auto, AF onset', 'записано пациентом': 'recorded by patient',
  'при симптомах': 'with symptoms', 'Сердцебиение': 'Palpitations', 'Головокружение': 'Dizziness', 'Одышка': 'Shortness of breath',
  'Боль в груди': 'Chest pain', 'Слабость': 'Fatigue', 'Тревожность': 'Anxiety', 'Другое': 'Other', 'лёгкие': 'mild',
  'умеренные': 'moderate', 'сильные': 'severe', 'Печать / PDF': 'Print / PDF', 'Назад': 'Back', 'Все пациенты': 'All patients',
  'лет': 'y.o.', 'Новая тревога': 'New alert', 'Новый симптом': 'New symptom', 'Новая ЭКГ': 'New ECG',
  'Тревог нет — всё спокойно.': 'No alerts — all quiet.', 'Пока нет пациентов. Дайте пациенту код': 'No patients yet. Give your patient the code',
  'Подтверждённые': 'Confirmed', 'Ложные': 'False alarms', 'самый длинный': 'longest', 'средн.': 'mean',
  'мин': 'min', 'макс': 'max', 'уд/мин': 'bpm', 'Отчёт пациента': 'Patient report', 'Период': 'Period',
  'Сформирован': 'Generated', 'Врач': 'Physician', 'Не является медицинским изделием.': 'Not a medical device.',
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: (s: string) => string }
const I18n = createContext<Ctx>({ lang: 'ru', setLang: () => {}, t: s => s })

function stored(): Lang {
  try { return (localStorage.getItem('afib.lang') as Lang) || 'ru' } catch { return 'ru' }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setL] = useState<Lang>(stored())
  const setLang = (l: Lang) => { setL(l); try { localStorage.setItem('afib.lang', l) } catch { /* private mode */ } }
  const t = (s: string) => (lang === 'en' ? EN[s] ?? s : s)
  return <I18n.Provider value={{ lang, setLang, t }}>{children}</I18n.Provider>
}

export const useT = () => useContext(I18n)
