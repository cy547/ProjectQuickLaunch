# ProjectQuickLaunch（项目速启）

> Windows 桌面端「一键启动项目」工具 —— 本地项目快速启动 + Git 仓库拉取 + 启动命令自动识别 + 运行环境管理

![Electron](https://img.shields.io/badge/Electron-33-47848F) ![React](https://img.shields.io/badge/React-18-61DAFB) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6) ![platform](https://img.shields.io/badge/platform-Windows-blue)

## 它解决什么问题

前后端分离项目启动繁琐？每次克隆新项目都要翻 README 找启动命令？运行环境版本对不上？

ProjectQuickLaunch 把这些收进一个桌面应用：

- **一键启动**：配置好的项目点一下，nginx / 后端 / 前端全部拉起，实时日志、就绪检测、点击跳转
- **拉取项目**：填仓库地址（自动注入系统代理给 git），克隆完自动识别项目结构并生成启动配置
- **导入项目**：丢一个目录或 zip 包，自动识别 10 种项目类型生成启动配置；缺 Node/JDK/Maven 时先确认再自动从国内镜像下载合适版本
- **运行与端口**：运行中任务占了哪些端口（进程树级归因）、系统全量端口占用排查、一键结束占用进程

## 功能一览

| 模块 | 能力 |
|---|---|
| 项目管理 | 多项目 × 多任务（独立工作目录/命令/访问地址），package.json / 项目结构自动识别 |
| 一键启动 | 全量/单个启停，进程树查杀（不留残留进程），npm 依赖缺失自动 `npm install` |
| 实时日志 | 流式输出、自动滚动、**落盘持久化**（重启后可查）、失败自动诊断 |
| 访问地址 | 手动配置 / 日志自动识别 / 健康检查（服务就绪变绿）/ 点击跳转浏览器 |
| 拉取项目 | git clone 进度条、系统代理自动检测注入（git 本身不读系统代理） |
| 导入向导 | 目录或 zip → 自动识别 → 环境检查 → Node/JDK/Maven 缺失自动安装（国内镜像） |
| 运行与端口 | 任务端口占用（进程树聚合）、系统端口表、结束占用进程、10s 自动刷新 |

**自动识别支持**：Node(npm scripts)、Maven Spring Boot（多模块/嵌套聚合器）、Gradle Spring Boot、
Go、Rust、.NET、Django、Flask/FastAPI、nginx、Docker Compose、已构建 jar。

## 开发

```bash
npm install        # 已配置 npmmirror 镜像（.npmrc）
npm run dev        # 开发模式
npm run smoke      # 无界面端到端冒烟测试（16 项断言）
npm run dist       # 打包 Windows NSIS 安装包 + 绿色版（dist/）
```

要求：Node.js ≥ 18、git。打包需要本机有 Electron 运行时缓存（首次 `npm install` 自动下载）。

## 目录结构

```
src/
├── main/          # 主进程：窗口、IPC、进程管理、git 克隆、健康检查、
│                  # 项目识别、运行环境管理、端口探测
├── preload/       # contextBridge 暴露 RendererApi
├── shared/        # 类型定义 + IPC 通道 + 渲染端 API 契约
└── renderer/      # React 界面：项目列表/详情、克隆页、导入向导、
                   # 运行与端口、设置、日志面板
```

## 数据与配置

- 应用配置：`%APPDATA%/ProjectQuickLaunch/config.json`
- 任务日志：`%APPDATA%/ProjectQuickLaunch/logs/`
- 托管运行环境：`%APPDATA%/ProjectQuickLaunch/runtimes/`

## 详细开发历程

见 [DEVELOPMENT_LOG.md](./DEVELOPMENT_LOG.md) —— 包含完整的需求迭代、
Windows 打包踩坑（假 ICO / winCodeSign 符号链接 / Electron 下载损坏）、
JDK 检测（JAVA_HOME 优先）、git 代理注入等问题的定位与修复过程。

## License

MIT
