import fs from 'node:fs'
import path from 'node:path'
import { detectSingleDir, requirementsForSuggestion, scanSubProjects } from './scan'
import type { DetectionResult, RuntimeRequirement, RuntimeType, SubProjectSuggestion } from '../shared/types'

function dedupeRequirements(reqs: RuntimeRequirement[]): RuntimeRequirement[] {
  const byType = new Map<RuntimeType, RuntimeRequirement>()
  for (const req of reqs) {
    const existing = byType.get(req.type)
    if (!existing || (!existing.version && req.version)) byType.set(req.type, req)
  }
  return [...byType.values()]
}

/**
 * 深度识别项目：根目录特征 + 一级子目录扫描合并。
 * 产出可启动任务建议与运行环境需求（含版本要求）。
 */
export function detectProject(root: string): DetectionResult {
  const tasks: SubProjectSuggestion[] = []
  const requirements: RuntimeRequirement[] = []
  const baseName = path.basename(root)

  const summaryOf = (): string => {
    if (tasks.length === 0) {
      return '未识别到可启动项目（支持 Node / Java Maven·Gradle / Go / Rust / .NET / Python·Django·Flask·FastAPI / nginx / Docker Compose）'
    }
    const typeNames: Record<RuntimeType, string> = {
      node: 'Node.js',
      jdk: 'JDK',
      maven: 'Maven',
      python: 'Python',
      go: 'Go',
      rust: 'Rust',
      dotnet: '.NET',
      docker: 'Docker'
    }
    const reqText =
      requirements.length === 0
        ? ''
        : `，需要运行环境：${requirements.map((r) => typeNames[r.type] + (r.version ? ` ${r.version}` : '')).join('、')}`
    return `识别到 ${tasks.length} 个可启动任务${reqText}`
  }

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { tasks, requirements, summary: '目录不存在或不是文件夹' }
  }

  // ---- 根目录 ----
  const rootSuggestion = detectSingleDir(root, baseName)
  if (rootSuggestion) {
    tasks.push(rootSuggestion)
    requirements.push(...requirementsForSuggestion(rootSuggestion))
  } else if (fs.existsSync(path.join(root, 'pom.xml'))) {
    // Maven 项目但没有可启动模块：回退尝试已构建的 jar
    const targetDir = path.join(root, 'target')
    const jar = fs.existsSync(targetDir)
      ? fs.readdirSync(targetDir).find((f) => f.endsWith('.jar') && !f.endsWith('.original'))
      : undefined
    if (jar) {
      tasks.push({ name: `后端 ${baseName}`, command: `java -jar target\\${jar}`, cwd: root })
      requirements.push({ type: 'jdk', reason: '运行已构建的 jar' })
    }
  }

  // ---- 一级子目录（前后端分离等场景）----
  for (const sub of scanSubProjects(root)) {
    tasks.push(sub)
    requirements.push(...requirementsForSuggestion(sub))
  }

  const requirements1 = dedupeRequirements(requirements)
  return { tasks, requirements: requirements1, summary: summaryOf() }
}
