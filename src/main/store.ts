import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { AppConfig, Project, Settings } from '../shared/types'

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function defaultSettings(): Settings {
  const base = app.getPath('documents') || app.getPath('home')
  return { defaultCloneDir: path.join(base, 'projects') }
}

function defaultConfig(): AppConfig {
  return { projects: [], settings: defaultSettings() }
}

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    return {
      projects: Array.isArray(parsed.projects) ? (parsed.projects as Project[]) : [],
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) }
    }
  } catch {
    return defaultConfig()
  }
}

export function saveConfig(config: AppConfig): void {
  const file = configPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8')
}

export function saveSettings(settings: Settings): Settings {
  const config = loadConfig()
  config.settings = settings
  saveConfig(config)
  return settings
}

export function upsertProject(project: Project): Project[] {
  const config = loadConfig()
  const index = config.projects.findIndex((p) => p.id === project.id)
  if (index >= 0) config.projects[index] = project
  else config.projects.push(project)
  saveConfig(config)
  return config.projects
}

export function removeProject(id: string): Project[] {
  const config = loadConfig()
  config.projects = config.projects.filter((p) => p.id !== id)
  saveConfig(config)
  return config.projects
}
