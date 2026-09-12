import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import type { IpcSender, TaskConfig, TaskStatusPayload } from '../shared/types'
import { ProcessManager } from './processes'
import { HealthMonitor } from './health'
import { CloneManager } from './gitClone'
import { detectProject } from './detect'
import { detectInstalled } from './runtimes'

function report(name: string, ok: boolean, extra = ''): void {
  console.log(`[SMOKE] ${ok ? 'PASS' : 'FAIL'} - ${name}${extra ? ` :: ${extra}` : ''}`)
  if (!ok) process.exitCode = 1
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function makeFakeSender(onMessage: (channel: string, payload: unknown) => void): IpcSender {
  return {
    send: (channel: string, ...args: unknown[]) => onMessage(channel, args[0])
  }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

/**
 * 无界面端到端冒烟测试：验证进程启停、日志捕获、URL 健康检查、本地 git 克隆。
 * 通过 `npm run smoke`（electron . --smoke）触发，打印 [SMOKE] 行并以退出码表达结果。
 */
export async function runSmokeTest(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pql-smoke-'))
  const projDir = path.join(tmp, 'demo-project')
  fs.mkdirSync(projDir)

  try {
    // ---- 1. 任务启动 / 日志捕获 ----
    const port = 39217 + Math.floor(Math.random() * 500)
    const command = [
      'node -e "',
      `const http=require('http');`,
      `http.createServer((q,s)=>s.end('ok')).listen(${port},()=>console.log('listening http://localhost:${port}'))`,
      '"'
    ].join('')

    const pm = new ProcessManager()
    const statuses: TaskStatusPayload[] = []
    pm.on('status', (p) => statuses.push(p))

    const project = { id: 'p1', name: 'demo', path: projDir, tasks: [], createdAt: 0 }
    const task: TaskConfig = { id: 't1', name: 'server', command }
    const startResult = pm.start(project, task)
    report('task:start', startResult.ok, startResult.message)

    await wait(1500)
    const logs = pm.getLogs('p1', 't1')
    report('task:logs contain startup line', logs.includes(`http://localhost:${port}`), logs.slice(-200))

    // ---- 2. URL 健康检查 ----
    let healthReady = false
    const sender = makeFakeSender((_ch, payload) => {
      const p = payload as { key: string; health: string }
      if (p.health === 'ready') healthReady = true
    })
    const hm = new HealthMonitor()
    hm.start('p1:t1', `http://localhost:${port}`, sender)
    await wait(4000)
    report('health: becomes ready', healthReady)
    hm.stopAll()

    // ---- 3. 停止任务并确认进程树被杀掉（端口释放）----
    await pm.stop('p1', 't1')
    await wait(800)
    report('task:stop frees port', await portFree(port))
    const finalStatus = statuses[statuses.length - 1]
    report('task: final status is stopped', finalStatus?.status === 'stopped', JSON.stringify(finalStatus))

    // ---- 4. 本地 git 仓库克隆（file:// 协议，不依赖网络）----
    execSync('git init', { cwd: projDir, stdio: 'ignore' })
    fs.writeFileSync(path.join(projDir, 'README.md'), '# smoke test\n')
    execSync('git add .', { cwd: projDir, stdio: 'ignore' })
    execSync('git -c user.email=smoke@test.local -c user.name=smoke commit -m init', {
      cwd: projDir,
      stdio: 'ignore'
    })

    const cm = new CloneManager()
    let lastPercent: number | undefined
    const cloneSender = makeFakeSender((_ch, payload) => {
      const p = payload as { percent?: number }
      if (typeof p.percent === 'number') lastPercent = p.percent
    })
    const dest = path.join(tmp, 'cloned-repo')
    const cloneResult = await cm.clone(pathToFileURL(projDir).href, dest, cloneSender)
    report('git:clone succeeds', cloneResult.ok, cloneResult.message)
    report('git:clone file exists', fs.existsSync(path.join(dest, 'README.md')))
    report('git:clone progress emitted (non-fatal if none)', lastPercent === undefined || lastPercent >= 0)

    // ---- 5. 连续第二次克隆应正常执行（验证 CloneManager 状态复位）----
    const secondResult = await cm.clone(pathToFileURL(projDir).href, path.join(tmp, 'cloned-2'), cloneSender)
    report('git:clone second run succeeds', secondResult.ok, secondResult.message)

    // ---- 6. 任务级工作目录（cwd）应覆盖项目路径 ----
    const subDir = path.join(tmp, 'sub-dir')
    fs.mkdirSync(subDir)
    const cwdTask: TaskConfig = {
      id: 't2',
      name: 'cwd-check',
      command: 'node -p process.cwd()',
      cwd: subDir
    }
    report('task:start with custom cwd', pm.start(project, cwdTask).ok)
    let t2Logs = ''
    const onOutput = (key: string, data: string): void => {
      if (key === 'p1:t2') t2Logs += data
    }
    pm.on('output', onOutput)
    for (let i = 0; i < 20; i++) {
      await wait(400)
      if (t2Logs.includes('sub-dir')) break
    }
    pm.off('output', onOutput)
    report(
      'task: custom cwd respected',
      t2Logs.toLowerCase().includes(subDir.toLowerCase()),
      t2Logs.slice(-200)
    )

    // ---- 7. 项目深度识别（Node 前端 + Maven Boot 后端 + nginx 分离结构）----
    const detDir = path.join(tmp, 'detect-fixture')
    const feDir = path.join(detDir, 'web-front')
    const beDir = path.join(detDir, 'server-be')
    const ngDir = path.join(detDir, 'nginx-1.20.2')
    fs.mkdirSync(feDir, { recursive: true })
    fs.mkdirSync(beDir, { recursive: true })
    fs.mkdirSync(path.join(ngDir, 'conf'), { recursive: true })
    fs.writeFileSync(
      path.join(feDir, 'package.json'),
      JSON.stringify({ name: 'web-front', engines: { node: '>=18' }, scripts: { dev: 'vite' } })
    )
    fs.writeFileSync(
      path.join(beDir, 'pom.xml'),
      '<project><artifactId>be</artifactId><properties><java.version>17</java.version></properties><build><plugins><plugin>spring-boot-maven-plugin</plugin></plugins></build></project>'
    )
    fs.writeFileSync(path.join(ngDir, 'nginx.exe'), '')
    fs.writeFileSync(path.join(ngDir, 'conf', 'nginx.conf'), 'server {\n  listen 80;\n}')
    const goDir = path.join(detDir, 'gofs')
    fs.mkdirSync(goDir, { recursive: true })
    fs.writeFileSync(path.join(goDir, 'go.mod'), 'module gofs\n\ngo 1.21\n')
    const gradleDir = path.join(detDir, 'gradle-app')
    fs.mkdirSync(gradleDir, { recursive: true })
    fs.writeFileSync(
      path.join(gradleDir, 'build.gradle'),
      "plugins { id 'org.springframework.boot' version '3.2.0' }"
    )
    // 嵌套结构：wrapper 目录本身不可启动，真正的项目在两层深
    const nestedGo = path.join(detDir, 'wrapper', 'inner-go')
    fs.mkdirSync(nestedGo, { recursive: true })
    fs.writeFileSync(path.join(nestedGo, 'go.mod'), 'module inner-go\n\ngo 1.22\n')
    const det = detectProject(detDir)
    report('detect: finds 6 tasks', det.tasks.length === 6, JSON.stringify(det.tasks.map((t) => t.command)))
    report(
      'detect: nested depth-2 project found',
      det.tasks.some((t) => t.command === 'go run .' && t.cwd === nestedGo)
    )
    const detTypes = det.requirements.map((r) => `${r.type}${r.version ? '@' + r.version : ''}`).sort()
    report(
      'detect: requirements node@18 + jdk@17 + maven + go@1.21',
      JSON.stringify(detTypes) === JSON.stringify(['go@1.21', 'jdk@17', 'maven', 'node@18']),
      JSON.stringify(detTypes)
    )

    // ---- 8. 运行环境版本检测（本机必有 node）----
    const nodeVersion = await detectInstalled('node')
    report('runtime: detect node version', !!nodeVersion, nodeVersion ?? 'null')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log('[SMOKE] done')
}
