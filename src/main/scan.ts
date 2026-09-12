import fs from 'node:fs'
import path from 'node:path'
import type { RuntimeRequirement, SubProjectSuggestion } from '../shared/types'

function readJsonFile(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readTextFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return ''
  }
}

function exists(dir: string, name: string): boolean {
  return fs.existsSync(path.join(dir, name))
}

/** 判断 pom 是否在 <build><plugins> 中声明了 spring-boot 插件（剥离 pluginManagement 避免误判） */
function isBootPom(pomText: string): boolean {
  const buildOnly = pomText.replace(/<pluginManagement>[\s\S]*?<\/pluginManagement>/g, '')
  return buildOnly.includes('spring-boot-maven-plugin')
}

/** 从 pom.xml 提取 <module>x</module> 子模块列表 */
function pomModules(pomText: string): string[] {
  const modules: string[] = []
  const re = /<module>([^<]+)<\/module>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pomText)) !== null) modules.push(m[1].trim())
  return modules
}

function artifactId(dir: string): string {
  const pom = readTextFile(path.join(dir, 'pom.xml'))
  const m = pom.match(/<artifactId>([^<]+)<\/artifactId>/)
  return m?.[1] ?? path.basename(dir)
}

export interface BootTarget {
  /** 执行 mvn 的目录（包含启动模块直接子模块的聚合器） */
  cwd: string
  /** -pl 的模块名（cwd 自身可启动时为 null） */
  rel: string | null
  /** 模块名（用于打分/命名） */
  module: string
}

/**
 * 递归在 Maven 模块树中收集所有 Spring Boot 可启动模块（最多下钻 3 层聚合器）。
 * 形如 vhrserver(聚合器) → vhr-server(启动) 的嵌套结构也能找到。
 */
function collectBootTargets(dir: string, depth = 0): BootTarget[] {
  if (depth > 3) return []
  const pom = readTextFile(path.join(dir, 'pom.xml'))
  if (!pom) return []

  const targets: BootTarget[] = []
  if (isBootPom(pom)) {
    targets.push({ cwd: dir, rel: null, module: artifactId(dir) })
  }
  for (const mod of pomModules(pom)) {
    const sub = path.join(dir, mod)
    const subPom = readTextFile(path.join(sub, 'pom.xml'))
    if (!subPom) continue
    if (isBootPom(subPom)) {
      targets.push({ cwd: dir, rel: mod, module: mod })
    } else {
      targets.push(...collectBootTargets(sub, depth + 1))
    }
  }
  return targets
}

/**
 * 为一个 Maven 项目目录挑选最合适的启动模块：
 * 模块名包含项目文件夹名（如 vhr → vhrserver）加 2 分，名字像 server/web/app 加 1 分。
 */
export function mavenBootTarget(dir: string): BootTarget | null {
  const pom = readTextFile(path.join(dir, 'pom.xml'))
  if (!pom) return null
  const targets = collectBootTargets(dir)
  if (targets.length === 0) return null
  if (targets.length === 1) return targets[0]

  const dirName = path.basename(dir).toLowerCase()
  const score = (t: BootTarget): number => {
    let s = 0
    if (t.module.toLowerCase().includes(dirName)) s += 2
    if (/server|web|app|api|boot/i.test(t.module)) s += 1
    return s
  }
  return [...targets].sort((a, b) => score(b) - score(a))[0]
}

// ---------- Gradle ----------

function gradleBootModule(dir: string): string | null {
  // 在一级子模块的 build.gradle(.kts) 里找声明了 spring boot 插件的模块
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const bootModules: string[] = []
  for (const e of entries.filter((x) => x.isDirectory() && !x.name.startsWith('.'))) {
    const sub = path.join(dir, e.name)
    const gradleFile = exists(sub, 'build.gradle')
      ? readTextFile(path.join(sub, 'build.gradle'))
      : exists(sub, 'build.gradle.kts')
        ? readTextFile(path.join(sub, 'build.gradle.kts'))
        : ''
    if (gradleFile.includes('org.springframework.boot')) bootModules.push(e.name)
  }
  if (bootModules.length === 0) return null
  const dirName = path.basename(dir).toLowerCase()
  const score = (m: string): number => {
    let s = 0
    if (m.toLowerCase().includes(dirName)) s += 2
    if (/server|web|app|api|boot/i.test(m)) s += 1
    return s
  }
  return [...bootModules].sort((a, b) => score(b) - score(a))[0]
}

/** 从 build.gradle(.kts) 提取 Java 版本要求 */
function javaVersionFromGradle(dir: string): string | undefined {
  const text =
    readTextFile(path.join(dir, 'build.gradle')) + readTextFile(path.join(dir, 'build.gradle.kts'))
  const m =
    text.match(/sourceCompatibility\s*=?\s*['"]?(\d+)/) ??
    text.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/)
  if (!m) return undefined
  const n = Number(m[1])
  return String(n === 1 ? 8 : n)
}

// ---------- Python Web（Flask / FastAPI） ----------

function pythonWebSuggestion(dir: string, fallbackName: string): SubProjectSuggestion | null {
  const depText =
    readTextFile(path.join(dir, 'requirements.txt')) + readTextFile(path.join(dir, 'pyproject.toml'))
  if (!depText) return null
  for (const name of ['main.py', 'app.py', 'server.py', 'run.py']) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) continue
    const content = readTextFile(file)
    const module = name.replace(/\.py$/, '')
    if (/FastAPI/.test(content) || depText.includes('fastapi')) {
      return {
        name: fallbackName,
        command: `uvicorn ${module}:app --reload`,
        cwd: dir,
        url: 'http://localhost:8000'
      }
    }
    if (/Flask/.test(content) || depText.includes('flask')) {
      return { name: fallbackName, command: `python ${name}`, cwd: dir }
    }
  }
  return null
}

// ---------- 单目录识别 ----------

/**
 * 识别一个目录本身可启动的项目类型，返回任务建议；识别不出返回 null。
 * 根目录与子目录共用这一套逻辑。
 */
export function detectSingleDir(dir: string, fallbackName?: string): SubProjectSuggestion | null {
  const name = fallbackName ?? path.basename(dir)

  // Node.js
  const pkg = readJsonFile(path.join(dir, 'package.json'))
  if (pkg) {
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    const script = scripts.dev ? 'dev' : scripts.serve ? 'serve' : scripts.start ? 'start' : null
    if (script) {
      return { name: (pkg.name as string) || name, command: `npm run ${script}`, cwd: dir }
    }
  }

  // Maven Spring Boot（多模块/嵌套聚合器）
  if (exists(dir, 'pom.xml')) {
    const boot = mavenBootTarget(dir)
    if (boot) {
      return {
        name: boot.rel ? `后端 ${boot.rel}` : `后端 ${boot.module}`,
        command: boot.rel ? `mvn spring-boot:run -pl ${boot.rel}` : 'mvn spring-boot:run',
        cwd: boot.cwd
      }
    }
  }

  // Gradle Spring Boot
  if (exists(dir, 'build.gradle') || exists(dir, 'build.gradle.kts') || exists(dir, 'settings.gradle')) {
    const rootGradle =
      readTextFile(path.join(dir, 'build.gradle')) + readTextFile(path.join(dir, 'build.gradle.kts'))
    const useWrapper = exists(dir, 'gradlew.bat')
    const gradle = useWrapper ? 'gradlew.bat' : 'gradle'
    const module = gradleBootModule(dir)
    if (module) return { name: `后端 ${module}`, command: `${gradle} :${module}:bootRun`, cwd: dir }
    if (rootGradle.includes('org.springframework.boot')) {
      return { name: `后端 ${name}`, command: `${gradle} bootRun`, cwd: dir }
    }
  }

  // Python：Django
  if (exists(dir, 'manage.py')) {
    return { name, command: 'python manage.py runserver', cwd: dir, url: 'http://localhost:8000' }
  }

  // Python：Flask / FastAPI
  const pyWeb = pythonWebSuggestion(dir, name)
  if (pyWeb) return pyWeb

  // Go
  if (exists(dir, 'go.mod')) {
    return { name, command: 'go run .', cwd: dir }
  }

  // Rust
  if (exists(dir, 'Cargo.toml')) {
    return { name, command: 'cargo run', cwd: dir }
  }

  // .NET：目录内直接有 csproj
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  if (entries.some((e) => e.isFile() && e.name.endsWith('.csproj'))) {
    return { name, command: 'dotnet run', cwd: dir }
  }
  // .NET：sln + 唯一子项目
  if (entries.some((e) => e.isFile() && e.name.endsWith('.sln'))) {
    const csprojs: string[] = []
    for (const e of entries.filter((x) => x.isDirectory())) {
      const sub = path.join(dir, e.name)
      for (const f of fs.readdirSync(sub)) {
        if (f.endsWith('.csproj')) csprojs.push(path.join(sub, f))
      }
    }
    if (csprojs.length === 1) {
      return { name, command: 'dotnet run', cwd: path.dirname(csprojs[0]) }
    }
  }

  // Docker Compose
  if (
    exists(dir, 'docker-compose.yml') ||
    exists(dir, 'docker-compose.yaml') ||
    exists(dir, 'compose.yaml')
  ) {
    return { name, command: 'docker compose up', cwd: dir }
  }

  // nginx
  if (exists(dir, 'nginx.exe')) {
    const conf = readTextFile(path.join(dir, 'conf', 'nginx.conf'))
    const listen = conf.match(/^\s*listen\s+(\d+)/m)?.[1] ?? '80'
    return {
      name: name.startsWith('前端') ? name : `前端 ${name}`,
      command: 'nginx.exe',
      cwd: dir,
      url: `http://localhost${listen === '80' ? '' : ':' + listen}`
    }
  }

  return null
}

/** 递归扫描时跳过的噪音目录 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'build',
  'out',
  '.idea',
  '.vscode',
  '.gradle',
  'venv',
  '.venv',
  '__pycache__',
  'bin',
  'obj',
  '.svn',
  '.mvn'
])

/**
 * 递归扫描项目子目录（前后端分离、仓库套仓库等场景），最多下钻 maxDepth 层。
 * 某个目录识别成功就停止向它内部下钻（避免重复：Maven 嵌套已由 mavenBootTarget 处理）。
 */
export function scanSubProjects(root: string, maxDepth = 3): SubProjectSuggestion[] {
  const out: SubProjectSuggestion[] = []
  const visited = new Set<string>()
  let dirBudget = 300

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || dirBudget <= 0) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    dirBudget -= 1
    const suggestion = detectSingleDir(dir)
    if (suggestion) {
      if (!out.some((o) => o.cwd === suggestion.cwd && o.command === suggestion.command)) {
        out.push(suggestion)
      }
      return
    }
    for (const entry of entries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))) {
      const sub = path.join(dir, entry.name)
      if (visited.has(sub)) continue
      visited.add(sub)
      walk(sub, depth + 1)
    }
  }

  let rootEntries: fs.Dirent[]
  try {
    rootEntries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of rootEntries.filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))) {
    const sub = path.join(root, entry.name)
    if (visited.has(sub)) continue
    visited.add(sub)
    walk(sub, 0)
  }
  return out
}

/** 根据任务建议推断需要的运行环境（读取对应项目文件里的版本要求） */
export function requirementsForSuggestion(
  s: SubProjectSuggestion
): RuntimeRequirement[] {
  const reqs: RuntimeRequirement[] = []
  const reason = (r: string): string => `${r}（${s.name}）`
  if (s.command.startsWith('npm run')) {
    const pkg = readJsonFile(path.join(s.cwd, 'package.json'))
    const engines = (pkg?.engines ?? {}) as { node?: string }
    reqs.push({ type: 'node', version: engines.node?.match(/\d+/)?.[0], reason: reason('package.json engines 要求') })
  } else if (s.command.startsWith('mvn')) {
    const pom = readTextFile(path.join(s.cwd, 'pom.xml'))
    const m = pom.match(/<(?:java\.version|maven\.compiler\.release|maven\.compiler\.target)>(\d+(?:\.\d+)?)</)
    const javaVersion = m ? String(Number(m[1].split('.')[0]) === 1 ? 8 : Number(m[1].split('.')[0])) : undefined
    reqs.push({ type: 'jdk', version: javaVersion, reason: reason(`pom.xml 要求 Java${javaVersion ? ' ' + javaVersion : ''}`) })
    reqs.push({ type: 'maven', reason: reason('Maven 构建 Spring Boot 项目') })
  } else if (s.command.includes('bootRun')) {
    reqs.push({ type: 'jdk', version: javaVersionFromGradle(s.cwd), reason: reason('Gradle 项目要求') })
  } else if (s.command.startsWith('go run')) {
    const goMod = readTextFile(path.join(s.cwd, 'go.mod'))
    const v = goMod.match(/^go (\d+\.\d+)/m)?.[1]
    reqs.push({ type: 'go', version: v, reason: reason('go.mod 要求') })
  } else if (s.command.startsWith('cargo')) {
    reqs.push({ type: 'rust', reason: reason('需要 Rust 工具链') })
  } else if (s.command.startsWith('dotnet')) {
    reqs.push({ type: 'dotnet', reason: reason('需要 .NET SDK') })
  } else if (s.command.startsWith('python')) {
    reqs.push({ type: 'python', reason: reason('需要 Python') })
  } else if (s.command.startsWith('uvicorn')) {
    reqs.push({ type: 'python', reason: reason('需要 Python（FastAPI）') })
  } else if (s.command.startsWith('docker compose')) {
    reqs.push({ type: 'docker', reason: reason('需要 Docker') })
  }
  return reqs.filter((r) => r.type)
}
