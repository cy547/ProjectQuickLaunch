import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ServiceDep } from '../shared/types'

function readIfExists(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return ''
  }
}

const CONFIG_FILES = [
  'application.yml',
  'application.yaml',
  'application.properties',
  'application-dev.yml',
  'application-dev.yaml',
  'application-dev.properties',
  'application-local.yml',
  'application-local.yaml',
  'application-local.properties',
  '.env',
  'docker-compose.yml',
  'docker-compose.yaml'
]

const SCAN_DIRS = [() => '', () => path.join('src', 'main', 'resources'), () => 'config']

/**
 * 从项目配置文件中检测所需中间件服务：
 * Spring Boot 的 application.yml/properties（JDBC URL、redis/rabbitmq/mongodb 关键字）、
 * .env、docker-compose.yml。
 * 按端口去重；这是启发式检测，结果供预检弹窗与导入向导使用。
 */
export function detectServices(root: string): ServiceDep[] {
  const texts: string[] = []
  for (const sub of SCAN_DIRS) {
    const dir = path.join(root, sub())
    for (const f of CONFIG_FILES) {
      const t = readIfExists(path.join(dir, f))
      if (t) texts.push(t)
    }
  }
  const merged = texts.join('\n')
  if (!merged) return []

  const out: ServiceDep[] = []
  const seen = new Set<number>()
  const add = (name: string, host: string, port: number): void => {
    if (!port || seen.has(port)) return
    seen.add(port)
    out.push({ id: randomUUID(), name, host: host || '127.0.0.1', port })
  }

  // JDBC URL：jdbc:mysql://host:3306/db、jdbc:postgresql://...
  for (const m of merged.matchAll(/jdbc:(mysql|postgresql):\/\/([^:"'\s)]+):(\d+)/gi)) {
    add(m[1].toLowerCase() === 'mysql' ? 'MySQL 数据库' : 'PostgreSQL 数据库', m[2], Number(m[3]))
  }
  // MongoDB URI：mongodb://host:27017
  for (const m of merged.matchAll(/mongodb(?:\+srv)?:\/\/([^:'"\/\s]+):(\d+)/gi)) {
    add('MongoDB 数据库', m[1], Number(m[2]))
  }
  // 关键字推断（配置里出现 redis/rabbitmq 即认为需要）
  if (/redis/i.test(merged)) add('Redis', '127.0.0.1', 6379)
  if (/rabbitmq|amqp/i.test(merged)) add('RabbitMQ', '127.0.0.1', 5672)

  return out
}
