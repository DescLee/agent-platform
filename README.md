<h1 align="center">绿巨人</h1>

<p align="center">本地优先、可审批、可扩展的个人超级助理桌面客户端</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心能力">核心能力</a> ·
  <a href="#系统架构">系统架构</a> ·
  <a href="#构建桌面安装包">构建安装包</a>
</p>

> 当前版本基于开源项目 [OpenWorker](https://github.com/andrewyng/openworker) 二次开发，保留原项目 MIT License 和内部兼容标识。用户界面与桌面产品名使用“绿巨人”，Python 包名、协议头和部分数据目录仍沿用 `coworker` / `openworker`。

绿巨人不是只返回建议的聊天机器人。它可以在用户授权的工作区内读取和编辑文件、运行命令、调用 Skills 和 MCP 工具、连接办公服务、组织专家协作，并将文档、表格、报告和代码修改作为实际产物交付。涉及写入、执行、外发或持久化的操作会根据权限模式进入审批与审计流程。

## 核心能力

| 能力 | 当前实现 |
|---|---|
| 多种工作入口 | 专家、对话助手、编程助手；会话可恢复、搜索、固定并按项目归组 |
| 专家与团队协作 | 内置软件工程、安全、运维、测试、设计等专家；支持团队提案、任务看板、团队聊天和工作日志 |
| 本地工作区 | 目录信任、只读/读写根目录授权、临时工作区、项目绑定和越界拦截 |
| Skills | 全局、项目和会话级 Skill 管理；支持安装、上传、启停、移动和运行时按需加载 |
| MCP | 支持 stdio 与 Streamable HTTP MCP 服务、工具发现、OAuth 连接和逐工具权限控制 |
| 办公连接器 | 内置绿舟、钉钉、飞书、企业微信、腾讯文档、Slack、Telegram、GitHub、Gmail、Outlook、Jira、Notion、Figma 等连接器描述与配置入口 |
| 知识与记忆 | 知识视图、SQLite 长期记忆、会话事实、记忆撤销和工作区隔离 |
| 自动化 | 定时任务、执行记录、无人值守运行、待处理收件箱和人工恢复 |
| 产物预览 | 在桌面端查看任务生成的文件，包含 Markdown、PDF 和电子表格等常用格式 |
| 绿舟助手 | 按日期和会话读取本地绿舟消息，生成汇总报告，并支持受控发送 |
| 中文语音输入 | 本地 Whisper 中文转写，录音不上传；转写结果统一为简体中文并作为可编辑草稿插入输入框 |
| 桌面体验 | Tauri 原生窗口、系统托盘、开机启动、保持唤醒、自动更新和任务状态桌面宠物 |

连接器目录包含多种认证方式和第三方服务适配。某个连接器是否可用，仍取决于对应服务、账号权限、凭据、CLI 或 MCP 服务是否已经配置。

## 典型工作流

1. 选择对话、编程或专业专家，并绑定一个工作目录。
2. 用文字或中文语音描述期望结果，也可以拖入附件。
3. Agent 选择模型、Skills、本地工具、MCP 或办公连接器完成任务。
4. 写文件、执行命令、发送消息等操作按权限模式自动放行、交给审核模型或请求用户确认。
5. 结果以对话、任务看板和文件产物呈现；全过程可在活动记录中追溯。
6. 可将稳定流程保存为定时任务，后续运行中的问题和审批进入收件箱。

## 系统架构

```text
┌──────────────────────────────────────────────────────────────┐
│                    绿巨人桌面客户端                          │
│  React 18 + TypeScript + Vite                               │
│  会话 / 专家 / Skills / 连接器 / 知识 / 自动化 / 审计       │
└───────────────────────┬──────────────────────────────────────┘
                        │ Tauri Invoke（原生能力）
                        │ HTTP / WebSocket（Agent 事件流）
┌───────────────────────▼──────────────────────────────────────┐
│                       Tauri 2 / Rust                         │
│  窗口与托盘 / Python sidecar 生命周期 / 更新 / 文件对话框   │
│  麦克风采集 / Whisper 中文转写 / 繁体转简体                 │
└───────────────────────┬──────────────────────────────────────┘
                        │ 启动并监督本地进程
┌───────────────────────▼──────────────────────────────────────┐
│                 Python Agent Server / FastAPI                │
│  SessionManager / Agent Engine / Provider Router             │
│  Permissions / Reviewer / Audit / Memory / Automation        │
│  Skills / MCP / Connectors / Teams / Artifacts               │
└───────────────┬───────────────────┬──────────────────────────┘
                │                   │
       本地文件、命令、SQLite      模型服务与用户配置的连接器
```

桌面模式下，Tauri 启动并监督本地 Python sidecar，退出时清理子进程。前端通过仅绑定回环地址的 FastAPI 接口和 WebSocket 获取流式消息、工具提案、审批请求、状态变化及任务结果。Tauri 原生命令处理文件选择、窗口控制、更新和语音等浏览器无法安全提供的能力。

浏览器开发模式使用相同 React 前端，但需要独立启动 Python 服务；语音输入、托盘和桌面宠物等原生能力不可用。

## 模型支持

模型通过 Provider Router 统一接入，并可在会话中切换。当前代码包含：

- OpenAI API 与 ChatGPT 订阅 OAuth
- Anthropic Claude、Google Gemini
- AWS Bedrock、Google Vertex AI
- DeepSeek、智谱 GLM、Kimi、Qwen、MiniMax、Mistral、Grok 等 OpenAI 兼容服务
- Together、Fireworks、OpenRouter
- 自定义 OpenAI / Anthropic 兼容网关
- Ollama 本地模型

不同模型的工具调用、推理和上下文能力不同。界面提供推荐模型，也允许添加自定义模型标识。

## 权限与安全

权限控制位于 Agent 的工具执行路径中，而不只存在于界面层。

- `讨论`：仅对话，不执行工具。
- `操作前询问`：默认模式；读取通常直接进行，写入、命令和外部操作请求审批。
- `替我审批`：由当前会话模型审核中低风险操作，高风险或无法判断的操作仍交给用户。
- `跳过审批`：减少日常确认，但仍受工作区范围和硬性安全边界限制。

后端还保留 `计划` 和 `自定义` 权限模式，供已有会话、配置文件和内部流程使用；当前桌面端选择器暂不展示这两项。

文件写入始终受已授权根目录约束。命令白名单会拒绝变量展开、重定向、嵌套执行器和危险参数等无法可靠判断的形式。API Key、OAuth Token 和连接器凭据保存在本机 SecretStore，不进入模型提示或普通状态接口。工具请求、审批来源、审核结果和执行结果写入审计记录。

## 中文语音输入

语音输入只在桌面客户端提供，首次使用需在“设置 → 语音输入”下载约 141 MiB 的 Whisper Base 多语言模型并完成麦克风测试。

- 识别语言固定为中文 `zh`，避免短句被识别为英语音素。
- 麦克风音频只在录音期间保存在内存中，不上传、不落盘。
- 模型文件下载后执行大小与 SHA-256 校验。
- Whisper 输出可能包含繁体字，返回输入框前会使用本地 OpenCC 规则统一转换为简体中文。
- 支持 macOS 12+ 的 Apple Silicon 设备，以及 Windows 10 22H2 / Windows 11 x64。
- Intel Mac 可以运行主程序，但当前不启用语音输入；浏览器模式和 Linux 不支持该功能。

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 20+
- Rust 1.77+
- macOS 还需要 Xcode Command Line Tools
- Windows 需要 MSVC C++ Build Tools；免安装包需要系统已有 WebView2 Runtime

### macOS

```bash
git clone https://github.com/DescLee/agent-platform.git
cd agent-platform
./install.sh
./start.sh
```

停止开发进程：

```bash
./stop.sh
```

### Windows

在 `cmd.exe` 中运行：

```bat
git clone https://github.com/DescLee/agent-platform.git
cd agent-platform
install.bat
start.bat
```

停止由脚本启动的开发进程：

```bat
stop.bat
```

安装脚本会创建 `.venv`、安装 Python 和前端依赖，并验证 React 与 Tauri 构建。启动脚本运行源码开发版桌面客户端，不等同于生产安装包。

### 浏览器开发模式

先在仓库根目录启动后端：

```bash
./.venv/bin/openworker-server --cwd /path/to/workspace --port 8765
```

Windows 对应命令为 `.venv\Scripts\openworker-server.exe`。然后在另一个终端启动前端：

```bash
cd surfaces/gui
npm run dev
```

默认开发地址为 `http://127.0.0.1:1420`。可通过 `VITE_COWORKER_HTTP` 和 `VITE_COWORKER_WS` 覆盖后端地址。

## 配置与本地数据

配置按“内置默认值 → 全局配置 → 工作区配置”合并：

- 全局配置：macOS/Linux 为 `~/.config/coworker/config.toml`，Windows 为 `%APPDATA%\coworker\config.toml`
- 工作区配置：`<workspace>/.coworker/config.toml`
- 示例配置：[docs/config.example.toml](docs/config.example.toml)
- 状态目录可通过 `COWORKER_STATE_DIR` 覆盖

主要本地数据包括：

| 文件 | 内容 |
|---|---|
| `coworker.db` | 会话索引、工作区、记忆、审计等 |
| `automation.db` | 定时任务和运行记录 |
| `teams.db` | 团队事件、工作项、依赖关系和设置 |
| `chat.db` | 团队聊天与游标 |
| `journal.db` | 团队工作日志和授权记录 |
| `secrets.json` | 模型与连接器凭据，按当前用户限制文件权限 |

这些数据库在首次启动时自动建表。项目不会把 API Key、登录 Cookie 或个人数据库写入构建产物。

## 测试

后端测试：

```bash
./.venv/bin/pytest
```

前端类型检查、单元测试和端到端测试：

```bash
cd surfaces/gui
npm run build
npm test
npm run e2e
```

本地语音模块和 Tauri 壳层：

```bash
cargo test --manifest-path stt/Cargo.toml
cargo check --manifest-path surfaces/gui/src-tauri/Cargo.toml
```

仓库目前包含 Python、React 和端到端测试，覆盖权限、会话、模型适配、连接器、Skills、记忆、自动化、团队协作、附件处理、桌面交互和中文语音等关键路径。

## 构建桌面安装包

正式桌面包必须在目标操作系统原生构建。

macOS：

```bash
bash packaging/build_dmg.sh
```

Windows PowerShell：

```powershell
.\packaging\build_windows.ps1
```

当前产物：

| 平台 | 安装包 | 免安装包 |
|---|---|---|
| macOS Apple Silicon | DMG | `.app.zip` |
| macOS Intel | DMG | `.app.zip` |
| Windows x64 | NSIS `setup.exe` | portable ZIP |

Windows 发布流程只生成 NSIS EXE，不生成 MSI。具体打包依赖、产物收集方式和 GitHub Actions 三平台工作流见 [packaging/DESKTOP_PACKAGES.md](packaging/DESKTOP_PACKAGES.md)。未配置签名密钥的构建会被 macOS Gatekeeper 或 Windows SmartScreen 提示。

## 仓库结构

| 路径 | 职责 |
|---|---|
| `coworker/` | Python Agent 引擎、FastAPI 服务、模型、权限、Skills、MCP、连接器、记忆、自动化和团队协作 |
| `surfaces/gui/` | React/TypeScript 界面与 Tauri 2 桌面壳层 |
| `stt/` | Rust 本地录音、Whisper 中文识别、模型校验及简体中文归一化 |
| `packaging/` | PyInstaller sidecar、DMG/NSIS 构建、更新清单与三平台产物收集 |
| `tests/` | Python 后端测试套件与测试数据 |
| `docs/` | 架构设计、专家导入和二次开发记录 |
| `scripts/` | 审核评估、构建与维护脚本 |
| `ui-mocks/` | 桌面界面原型与视觉参考 |

## 命令行入口

安装 Python 包后提供以下命令：

- `openworker`：终端交互客户端
- `openworker-server`：本地 FastAPI / WebSocket 服务
- `openworker-connectors`：连接器配置工具
- `ocw`：团队看板、工作日志及对应 MCP 服务

## 开源说明

本项目基于 Andrew Ng 团队的 OpenWorker 开源代码继续开发，Agent 运行时建立在 [aisuite](https://github.com/andrewyng/aisuite) 之上。二次开发保留原始版权声明，并继续使用 [MIT License](LICENSE)。安全问题请参阅 [SECURITY.md](SECURITY.md)。
