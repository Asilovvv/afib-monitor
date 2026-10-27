import { useSearchParams } from 'react-router-dom'
import { useFmt } from '../components/ui'

/** Public landing for invitation links: /join?doctor=CODE or /join?family=CODE. Shows the code in big letters and an
 *  "open in the app" button (custom scheme afibmonitor://), plus where to get the app. No account needed to view it,
 *  and the page never reveals who the doctor or the patient is — only the code the person was already sent. */
const APK = 'https://github.com/Asilovvv/afib-monitor/releases/download/android-latest/afib-monitor.apk'

export default function Join() {
  const f = useFmt()
  const [q] = useSearchParams()
  const kind = q.get('doctor') ? 'doctor' : q.get('family') ? 'family' : null
  const code = (q.get('doctor') || q.get('family') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  if (!kind || code.length < 4) return <div className="page narrow"><div className="card"><h1>{f.tr('Ссылка неполная', 'Incomplete link', 'Шилтеме толук эмес')}</h1></div></div>
  const app = `afibmonitor://join?${kind}=${code}`
  return (
    <div className="page narrow" style={{ paddingTop: 40 }}>
      <div className="card invite-card">
        <div>
          <h1>{kind === 'doctor' ? f.tr('Приглашение от врача', 'Invitation from a doctor', 'Дарыгерден чакыруу') : f.tr('Приглашение близкого', 'Invitation from a relative', 'Жакындан чакыруу')}</h1>
          <p className="muted">{kind === 'doctor'
            ? f.tr('Установите AFib Monitor, зарегистрируйтесь как пациент и введите этот код врача — или нажмите кнопку, если приложение уже стоит.',
              'Install AFib Monitor, sign up as a patient and enter this doctor code — or press the button if the app is already installed.',
              'AFib Monitor орнотуп, бейтап катары катталып, бул дарыгер кодун киргизиңиз — же тиркеме орнотулган болсо, баскычты басыңыз.')
            : f.tr('Установите AFib Monitor, выберите «Я близкий человек» и введите этот код — или нажмите кнопку, если приложение уже стоит.',
              'Install AFib Monitor, choose "I am a relative" and enter this code — or press the button if the app is already installed.',
              'AFib Monitor орнотуп, «Мен жакын адаммын» дегенди тандап, бул кодду киргизиңиз — же тиркеме орнотулган болсо, баскычты басыңыз.')}</p>
        </div>
        <div className="code-big">{code.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
        <div className="row-btns">
          <a className="btn primary" href={app}>{f.tr('Открыть в приложении', 'Open in the app', 'Тиркемеде ачуу')}</a>
          <a className="btn ghost" href={APK}>{f.tr('Android: скачать APK', 'Android: download APK', 'Android: APK жүктөө')}</a>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>{f.tr('iPhone: приложение пока устанавливается через Xcode (до выхода в App Store). Приложение не является медицинским изделием.',
          'iPhone: the app is installed through Xcode for now (until the App Store release). The app is not a medical device.',
          'iPhone: тиркеме азырынча Xcode аркылуу орнотулат (App Store чыкканга чейин). Тиркеме медициналык буюм эмес.')}</p>
      </div>
    </div>
  )
}
