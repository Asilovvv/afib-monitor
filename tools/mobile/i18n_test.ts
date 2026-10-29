/* Kyrgyz dates and server error messages (mobile/src/i18n.ts, servererr.ts). Run: npx -y tsx@4.19.2 tools/mobile/i18n_test.ts */
import assert from 'node:assert/strict'
import { fmtDate, translate } from '../../mobile/src/i18n'
const d = new Date(2026, 9, 29, 6, 5)                                    // Thursday 29 October 2026, 06:05 local
assert.equal(fmtDate('ky', d, { weekday: 'long', day: 'numeric', month: 'long' }), 'бейшемби, 29-октябрь')
assert.equal(fmtDate('ky', d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), '29-окт., 06:05')
assert.equal(fmtDate('ky', d, { hour: '2-digit', minute: '2-digit' }), '06:05')
assert.equal(translate('ru', 'Wrong email or password'), 'Неверный email или пароль')
assert.equal(translate('ky', 'Wrong email or password'), 'Email же сырсөз туура эмес')
assert.equal(translate('en', 'Wrong email or password'), 'Wrong email or password')
assert.equal(translate('ru', 'some new server message'), 'some new server message')   // unknown text passes through
assert.equal(translate('ru', 'today'), 'Сегодня')                                         // app keys still win
console.log('i18n ok')
