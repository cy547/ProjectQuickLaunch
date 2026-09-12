import { useEffect } from 'react'
import { Layout, Spin } from 'antd'
import ProjectList from './components/ProjectList'
import ProjectDetail from './components/ProjectDetail'
import ProjectEditModal from './components/ProjectEditModal'
import ClonePage from './pages/ClonePage'
import ImportPage from './pages/ImportPage'
import PortsPage from './pages/PortsPage'
import SettingsPage from './pages/SettingsPage'
import { useAppStore } from './store'
import { extractUrls, flushRemainder, ingestChunk } from './utils'

export default function App() {
  const loaded = useAppStore((s) => s.loaded)
  const view = useAppStore((s) => s.view)

  useEffect(() => {
    void window.api.configLoad().then((cfg) => useAppStore.getState().init(cfg))

    const unsubStatus = window.api.onTaskStatus((p) => {
      useAppStore.getState().applyTaskStatus(p)
      // 进程结束时冲刷未换行的半行，避免最后一行日志丢失
      if (p.status !== 'running') {
        const rest = flushRemainder(p.key)
        if (rest.length > 0) useAppStore.getState().appendLogLines(p.key, rest)
      }
    })
    const unsubOutput = window.api.onTaskOutput((p) => {
      const state = useAppStore.getState()
      const lines = ingestChunk(p.key, p.data)
      if (lines.length > 0) state.appendLogLines(p.key, lines)
      for (const line of lines) {
        for (const url of extractUrls(line)) state.addUrlCandidate(p.key, url)
      }
    })
    const unsubHealth = window.api.onUrlHealth((p) =>
      useAppStore.getState().setUrlHealth(p.key, p.health)
    )

    return () => {
      unsubStatus()
      unsubOutput()
      unsubHealth()
    }
  }, [])

  if (!loaded) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Layout style={{ height: '100%', flexDirection: 'row', overflow: 'hidden' }}>
      <ProjectList />
      <Layout.Content style={{ flex: 1, overflow: 'auto', background: '#f5f5f5', minWidth: 0 }}>
        {view.type === 'project' && <ProjectDetail projectId={view.projectId} />}
        {view.type === 'clone' && <ClonePage />}
        {view.type === 'import' && <ImportPage />}
        {view.type === 'ports' && <PortsPage />}
        {view.type === 'settings' && <SettingsPage />}
      </Layout.Content>
      <ProjectEditModal />
    </Layout>
  )
}
