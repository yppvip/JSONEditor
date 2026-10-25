import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/desktop-api'
import { JsonTextEditor } from '../text-editor/JsonTextEditor'

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    window.desktop.getAppInfo().then(
      (result) => {
        if (active) setInfo(result)
      },
      () => {
        if (active) setError(true)
      },
    )
    return () => {
      active = false
    }
  }, [])
  return (
    <main>
      <header className="app-header">
        <div>
          <h1>JSONEditor</h1>
          <p>JSON 文本编辑</p>
        </div>
        <p role="status" aria-label="桌面连接" className="desktop-status">
          {error ? '桌面连接失败' : info ? `桌面连接正常 · v${info.version}` : '正在连接桌面环境…'}
        </p>
      </header>
      <JsonTextEditor />
    </main>
  )
}
