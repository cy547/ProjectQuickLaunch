/* 临时脚本：以隔离 userData 启动一个验证实例 */
const { spawn } = require('node:child_process')
const path = require('node:path')

process.env.PQL_USER_DATA_DIR = path.join(process.env.TEMP || 'C:\\Temp', 'pql-verify2')
const exe = path.resolve(__dirname, '..', 'dist', 'win-unpacked', 'ProjectQuickLaunch.exe')
const p = spawn(exe, [], { detached: true, stdio: 'ignore', env: process.env, cwd: path.dirname(exe) })
p.unref()
console.log('spawned pid', p.pid)
