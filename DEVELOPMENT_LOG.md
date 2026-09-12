# ProjectQuickLaunch 开发日志

> 项目速启 —— Windows 桌面端「一键启动项目」工具
> 技术栈：Electron 33 + React 18 + TypeScript 5 + Ant Design 5 + Zustand + electron-vite
> 开发日期：2026-09-12（一天完成主体开发与迭代）

---

## 一、项目立项与选型（上午）

**目标**：解决本地开发的痛点——前后端分离项目启动繁琐（开 IDEA、开 nginx、开前端 dev server、记端口）、
GitHub/Gitee 拉项目后还要手动配启动命令、运行环境（JDK/Node 版本）经常对不上。

**技术选型决策**：

| 候选 | 结论 | 原因 |
|---|---|---|
| Electron | ✅ 采用 | 本机已有 Node 22，零额外工具链；进程管理/文件操作生态成熟 |
| Tauri | ❌ | 需要安装 Rust + MSVC Build Tools（约 2-4GB），前期成本高 |
| WPF/.NET | ❌ | 本机无 .NET SDK |
| Python PySide6 | ❌ | 打包体积大、界面观感一般 |

**架构**：electron-vite 三段式（main / preload / renderer），主进程与渲染进程通过
contextBridge + IPC 通信，渲染层 React + antd + zustand。国内网络全链路走 npmmirror 镜像
（`.npmrc` 配置 `electron_mirror` 等）。

**首日完成的核心功能**：

1. 项目管理：路径选择、多任务（名称/命令/访问地址）、任务卡片式启停
2. 一键启动：顺序拉起全部任务；`taskkill /T /F` 杀整棵进程树（解决 npm→node 子进程残留）
3. 实时日志：环形缓冲（600 块）+ IPC 流式推送 + 自动滚动面板
4. 访问地址三重保障：手动配置 + 日志正则自动识别 `http://localhost:*` + 每 3s 健康检查（就绪变绿可点击跳转）
5. Git 拉取：`git clone --progress` 实时解析百分比进度条
6. 配置持久化：`%APPDATA%/ProjectQuickLaunch/config.json`

**质量保障**：内置 `npm run smoke` 无界面端到端冒烟测试（进程启停/日志捕获/健康检查/本地 git 克隆），
16 项断言全部通过；每次迭代后全量回归。

---

## 二、打包踩坑记录（下午）

把 exe 打出来比写代码费劲，三个坑：

1. **用户给的"图标"其实是 PNG 改后缀**（文件头 `89 50 4E 47`）——electron-builder 会拒绝。
   写了 `scripts/make-icon-from-image.js`：用 jimp 读图 → 盖掉 AI 生成水印（采样背景色填充）→
   缩放出 256/128/64/48/32/16 六档 → png-to-ico 生成真 ICO。
2. **winCodeSign 解压失败**：`7za -snld` 解压符号链接需要特权，非管理员必挂，且每次重试都下载到新的
   随机目录。解法：手动把 7z 解压到 electron-builder 缓存的最终目录
   `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`，让它跳过下载。
3. **Electron 二进制下载损坏**：npmmirror 下载 115MB 的 electron zip 多次重试后解压不完整
   （`electron.exe` 缺失）。解法：`electronDist: node_modules/electron/dist` 直接复用本地已装运行时。

另：**Git Bash 的反斜杠转义**（`node -e "..."` 里 `\\\\` 层层吃掉）和 **MSYS 路径转换**
（`taskkill /pid` 被转成 `D:/...Git/pid`）在调试脚本里反复出现，统一改用脚本文件 + `//pid` 双斜杠。

---

## 三、迭代一：任务级工作目录 + 子项目扫描

**需求来源**：`skyTakeOut` 这类项目，nginx 和 Java 后端在不同子文件夹，任务只能跑在项目根目录不够用。

- `TaskConfig` 增加 `cwd` 字段，spawn 时 `task.cwd || project.path`
- 编辑弹窗任务行改两行式布局，工作目录带文件夹选择按钮
- 新增「扫描子目录」：识别 nginx（`nginx.exe`）/ Node（package.json scripts）/ Maven Spring Boot（pom.xml 模块树）/ Django（manage.py）

**Maven 识别的关键点**：
- 递归下钻模块树（`vhrserver(聚合器) → vhr-web(启动)` 两层嵌套也能找到真启动模块），`-pl` 从聚合器根执行保证 reactor 可解析兄弟模块
- 剥离 `<pluginManagement>` 再判断 boot 插件，避免聚合器误判
- 多个可启动模块时打分：模块名包含项目文件夹名 +2（vhr → vhr-server），名字含 server/web/app +1

---

## 四、迭代二：智能导入向导 + 运行环境管理器

**需求**："我只提供目录或 zip 包，自动识别配置启动信息；缺运行环境先问我，然后自动下载合适版本。"

- **导入向导**（侧栏入口）：目录/zip → zip 自动解压 → 深度识别（根目录 + 递归子目录）→
  任务预览表 + 运行环境检查表（缺失项给「自动下载」勾选框）→ 创建项目
- **环境管理器**：
  - Node：npmmirror 版本索引 JSON 按 `engines` 主版本挑选，走 npmmirror zip
  - JDK：微软 OpenJDK 稳定别名 `aka.ms/download-jdk/microsoft-jdk-{11|17|21}-windows-x64.zip`
    （重定向到微软 CDN，国内快）；JDK 8 不支持自动装，明确提示手动安装
  - Maven：TUNA 列表取当前版 + archive.apache.org 固定版兜底
  - 解压：系统自带 bsdtar（`tar -xf`），失败回退 PowerShell Expand-Archive
  - 安装位置：`%APPDATA%/ProjectQuickLaunch/runtimes/`，设置页可移除
- **环境注入**：任务 spawn 时托管版本的 binDir 前插 PATH、JDK 注入 JAVA_HOME——
  这与 Maven 的实际行为（用 JAVA_HOME）一致

**版本来源均先用 curl 验证可达性再写代码。下载管线用真实 Maven 包（9.4MB）做了
下载→解压→校验 `bin/mvn.cmd` 的全链路测试。**

---

## 五、Bug 修复记录

### 5.1 JDK 检测：装了 1.8 却提示要下载

两层原因，都修了：

1. 检测用 `java -version`，但用户系统 PATH 里的 JDK21 抢在前（系统 PATH 先于用户 PATH）。
   **Maven 构建实际用的是 `JAVA_HOME`** → 检测改为优先执行 `%JAVA_HOME%\bin\java.exe -version`，
   结果标注来源（JAVA_HOME / PATH）。
2. 版本正则 `/version "((?:1\.)?\d+(?:\.\d+)*)"/` 匹配不了 `1.8.0_452`（Corretto 带构建后缀），
   引号前多了下划线导致匹配失败回退 PATH。改为 `/version "([^"]+)"/` 整体捕获再解析主版本。

顺带发现 spawn 细节：带引号的空格路径走 `shell:true` 会被 `cmd /s` 剥引号破坏，
读 JAVA_HOME 分支改为直接 `spawn(java.exe绝对路径, ['-version'])` 不经 shell。

### 5.2 克隆 GitHub 失败：开了代理也没用

两个原因叠加：

1. 用户的 Clash「当前节点」选的是 DIRECT（直连），全局模式形同虚设——这是使用问题
2. **git 本身不读 Windows 系统代理**——这是程序问题

修复：克隆前自动检测系统代理（环境变量 → 注册表 `ProxyEnable/ProxyServer`），
显式注入 `git -c http.proxy=... -c https.proxy=... clone`；克隆页显示检测到的代理；
设置页可手动指定；失败提示区分"未走代理"与"代理节点不可用"两种情况。

### 5.3 布局：内容区跑到侧栏下半屏

antd `Layout` 只在检测到原生 `Sider` 组件时才横向排列，侧栏是普通 div 时退化为纵向。
修复：Layout 显式 `flexDirection: 'row'` + Content `flex: 1; minWidth: 0`，不再依赖自动检测。

### 5.4 日志丢失：启动失败却"暂无输出"

三个层面的修复：

1. **日志落盘**：实时写入 `%APPDATA%/ProjectQuickLaunch/logs/项目_任务_时间.log`，
   面板新增「日志文件」按钮，应用重启后也能查
2. **半行冲刷**：进程退出时把未换行的缓冲行强制刷进面板（`flushRemainder`）
3. **失败诊断**：进程秒退且零输出时自动输出[诊断]清单（命令不存在/目录不对/缺 node_modules/中间件未启动）

同时发现 npm 任务在未 `npm install` 时必然失败 → 启动前检测 `node_modules`，
缺失自动前置 `npm install &&`（输出进同一份日志）。

### 5.5 早期修复（简录）

- `PlayOutlined` 等 antd 图标名不存在 → `CaretRightOutlined`
- ipc handler 返回 Promise 与同步签名冲突 → async 化
- IPC TaskStop 的 Promise 返回类型声明错误
- smoke 测试里 HTML 转义符 `&gt;` 混进命令字符串
- dev 与打包版 userData 不一致（package.json name vs productName）导致配置互不可见 →
  显式 `app.setPath('userData', %APPDATA%/ProjectQuickLaunch)` 并迁移旧配置
- smoke 用 `getLogs()` 验证瞬时进程：进程退出即清 Map 导致日志"消失"→ 改用事件捕获；
  `node -e "带引号命令"` 经 cmd 后引号被剥 → 改用无引号写法 `node -p process.cwd()`

---

## 六、最终功能清单

| 模块 | 功能 |
|---|---|
| 项目管理 | 多项目、多任务（独立工作目录/命令/访问地址）、package.json/深度结构识别 |
| 一键启动 | 全量/单个启停、进程树查杀、npm 依赖缺失自动 install、实时日志 + 落盘 + 诊断 |
| 访问地址 | 手动配置 / 日志自动识别 / 健康检查（就绪变绿）/ 点击跳转浏览器 |
| 拉取项目 | git clone 进度条、系统代理自动注入、克隆完成自动识别并预填 |
| 导入向导 | 目录/zip → 自动识别 10 种项目类型 → 环境检查 → Node/JDK/Maven 缺失自动装 |
| 运行与端口 | 运行中任务监听端口（进程树聚合）、系统全量端口占用、结束占用进程 |
| 其他 | 中英文环境全中文界面、皮卡丘图标、单实例、electron-builder NSIS 安装包 |

**自动识别支持的类型**：Node（npm scripts）、Maven Spring Boot（多模块/嵌套聚合器）、
Gradle Spring Boot、Go、Rust、.NET（csproj/sln）、Django、Flask/FastAPI、nginx、Docker Compose、
已构建 jar（java -jar 回退）。

---

## 七、遗留与后续计划

- [ ] Python / Go / Rust / .NET 的自动安装（当前仅检测）
- [ ] rar/7z 压缩包支持（当前仅 zip）
- [ ] 系统托盘常驻、开机自启
- [ ] 端口占用与启动失败的自动联动诊断（"端口被占 → 谁占的 → 一键释放"）
- [ ] 配置导入导出、任务模板
- [ ] 代码签名（消除 SmartScreen 提示）

## 八、经验小结

1. **Windows 生态的坑主要在"环境"**：PowerShell 5.1 vs 7 的参数差异、cmd 引号剥离、
   MSYS 路径转换、图标缓存、系统/用户 PATH 合并顺序——每个都真实咬过一口。
2. **国内网络是第一公民**：所有外部下载（npm/electron/builder 二进制/JDK/Node/Maven/系统代理）
   都必须有镜像或兜底，且先用 curl 验证 URL 再写代码。
3. **检测要贴真实运行时**：JDK 检测读 JAVA_HOME 而不是 PATH 的 java，就是"程序怎么跑，
   检测就怎么判"的原则。
4. **无界面 smoke 测试**对 GUI 应用回报极高——16 项断言在每次迭代后兜底核心链路。
