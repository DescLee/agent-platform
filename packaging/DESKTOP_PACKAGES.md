# 三平台构建（1.0.0）

GitHub Actions → **Competition desktop packages** → **Run workflow**。
三个原生 runner 并行构建；成功后下载 `OpenWorker-three-platforms`，即三平台合集 ZIP。
不会创建或发布 GitHub Release，也不会移动已有的 1.0.0 标签。

| 目录 | 安装包 | 解压运行包 |
| --- | --- | --- |
| desktop-macos-arm64 | DMG | app.zip（完整 .app，含后端） |
| desktop-macos-x64 | DMG | app.zip（完整 .app，含后端） |
| desktop-windows-x64 | NSIS EXE | portable.zip（lvjuren.exe + sidecar） |

每个平台附带使用说明与 manifest.json（源码提交、版本、文件大小、SHA256）。
Python 后端已冻结打包，运行机器不需要 Python、Node、Rust。
Windows 免安装版本需要系统已有 WebView2 Runtime；安装包可以引导安装。
macOS 最低版本以 tauri.conf.json 为准（当前 12.0）。Intel 与 Apple Silicon 不互相替代。
当前专用 CI 没有配置发布签名、公证；不可宣称所有设备均能无警告启动。
构建成功也不代表人工启动测试通过；提交前必须在对应机器验证并录屏。

## 本机构建

先按已有打包脚本的说明安装 Rust、Node 20、Python 3.12、平台 SDK，创建 .venv：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[bedrock,messaging,browser,dev]' pyinstaller typer tzdata
npm ci --prefix surfaces/gui
bash packaging/build_dmg.sh
python3 packaging/collect_desktop.py --target macos-arm64
```

Intel Mac 最后一条改为 `--target macos-x64`。Windows 在 PowerShell 中：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python -m pip install -e '.[bedrock,messaging,browser,dev]' pyinstaller typer tzdata
npm ci --prefix surfaces/gui
.\packaging\build_windows.ps1
py packaging/collect_desktop.py --target windows-x64
```

产物在 `out/desktop/`；同名目录已存在时拒绝覆盖，可通过 `--output` 指定新目录。
必须在对应架构原生构建，不能只修改文件名冒充另一个平台。

## 参赛交付边界

这是三平台二进制合集，不是全部参赛材料。最终参赛 ZIP 还必须加入：完整源码、
1000 字以上说明文档、数据库初始化资料、install.sh 和根目录 MP4 完整演示录屏，
并命名为“参赛编码-个人超级助理.zip”。不包含个人配置、Cookie 或数据库。
