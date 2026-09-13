import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { taskKey } from '../shared/types'

interface StatRecord {
  count: number
  totalMs: number
  lastStart: number
}

type StatsMap = Record<string, StatRecord>

function statsPath(): string {
  return path.join(app.getPath('appData'), 'ProjectQuickLaunch', 'stats.json')
}

function readAll(): StatsMap {
  try {
    return JSON.parse(fs.readFileSync(statsPath(), 'utf-8')) as StatsMap
  } catch {
    return {}
  }
}

function writeAll(map: StatsMap): void {
  try {
    fs.mkdirSync(path.dirname(statsPath()), { recursive: true })
    fs.writeFileSync(statsPath(), JSON.stringify(map, null, 2), 'utf-8')
  } catch {
    // 统计写入失败不影响功能
  }
}

/** 任务启动成功时记录：次数 +1、最近启动时间 */
export function recordStart(projectId: string, taskId: string): void {
  const map = readAll()
  const key = taskKey(projectId, taskId)
  const rec = map[key] ?? { count: 0, totalMs: 0, lastStart: 0 }
  rec.count += 1
  rec.lastStart = Date.now()
  map[key] = rec
  writeAll(map)
}

/** 任务退出时累计运行时长（本次会话内的运行时长） */
export function recordEnd(projectId: string, taskId: string, durationMs: number): void {
  if (durationMs <= 0) return
  const map = readAll()
  const key = taskKey(projectId, taskId)
  const rec = map[key]
  if (!rec) return
  rec.totalMs += durationMs
  map[key] = rec
  writeAll(map)
}

export function getAllStats(): StatsMap {
  return readAll()
}
