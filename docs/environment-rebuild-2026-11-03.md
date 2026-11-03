# Windows 开发环境重建（2026-11-03）

仓库：`D:\Code\JSONEditor`。共享工具及下载缓存：`D:\5DevelopmentEnvironment`。

## 复用与补齐

| 工具          | 版本 / 位置                                                        | 处理                              |
| ------------- | ------------------------------------------------------------------ | --------------------------------- |
| Node.js / npm | 24.22.1 / 11.19.1，`C:\Program Files\nodejs`                       | 复用，满足 `>=24.16.0 <25`        |
| Git           | 2.56.0.windows.1，`C:\Program Files\Git`                           | 复用                              |
| PowerShell    | 7.6.7                                                              | 复用                              |
| VS Code       | 1.143.1，`D:\Microsoft VS Code`                                    | 复用                              |
| Python        | `D:\2PythonEnv\py13\Scripts\Activate.ps1`                          | 已确认存在，当前项目不依赖 Python |
| pnpm          | 12.15.0，`D:\5DevelopmentEnvironment\package-manager\pnpm\12.15.0` | 新装；重复执行 Setup 已验证复用   |
| ESLint 扩展   | dbaeumer.vscode-eslint 3.0.34                                      | 新装                              |
| Prettier 扩展 | esbenp.prettier-vscode 12.4.0                                      | 新装                              |

依赖使用原 `pnpm-lock.yaml`，不升级版本。pnpm store 为 `D:\5DevelopmentEnvironment\cache\pnpm\v11`，与仓库同卷，可使用硬链接。npm、Electron 和 electron-builder 缓存分别在同一根目录的 `cache` 子目录。

## 使用

在项目根目录打开 PowerShell：

```powershell
# 首次准备；已有正确版本时直接复用
.\tools\Setup-WindowsEnvironment.ps1

# 每个新终端激活当前进程
. .\tools\Enter-DevEnvironment.ps1
pnpm dev
```

VS Code 的 Windows 开发启动配置也会先激活项目环境。Setup 默认不修改持久化 PATH；如需加入用户 PATH，可显式传 `-AddToUserPath`，脚本会先备份原值。自定义目录时，三个环境脚本均传相同的 `-EnvironmentRoot`。

未改动系统 PATH、PowerShell profile、执行策略或全局 npm 配置。未重新安装 Node、Python、Git、VS Code、C++ 工具链或 Node 版本管理器。`.node-version` 保留团队基线 24.16.0，本机复用允许范围内的更新补丁。

## 网络处理

本次 Node / VS Code CLI 下载 GitHub Release 资源及 Marketplace 扩展时出现 TLS 中断。使用 Windows 自带 `curl.exe` 从官方端点下载，文件存放于 `D:\5DevelopmentEnvironment\temp`。Marketplace 响应使用 gzip 编码，解码后安装本地 VSIX；两个扩展安装成功并经 CLI 版本检查确认。

Electron 安装器使用 `electron_config_cache`，激活脚本已同时设置该变量与 `ELECTRON_CACHE`，指向 `cache\electron`。下载文件必须与 `node_modules/electron/checksums.json` 的 SHA-256 一致后才放入缓存，再由原安装器校验并解压。临时文件及缓存保留用于后续复用。

Electron 45.0.0 Windows x64 压缩包最终大小为 158,223,852 字节，SHA-256 为 `ae53887a23bb640369c93dbd38c408a2af5c0deb86f2fa76c6c244cb444b7f47`，与官方 npm 包随附清单一致。已通过原安装器从缓存完成安装；最终 `pnpm install --frozen-lockfile` 成功，无需再次下载。

## 验证

基础环境验证已通过，详见 [环境检查报告](environment-check-2026-11-03.json)。该脚本覆盖真实系统/用户 PATH 加项目激活、npm 网络、独立依赖执行和锁文件离线复现；不代表桌面或打包验证。

| 检查                                     | 结果                                                                                   |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`         | 通过，运行时从已校验缓存安装                                                           |
| `pnpm check`                             | Lint、Prettier、两套 TypeScript 检查通过；18 文件、215/215 测试通过                    |
| `pnpm test:dev`                          | 开发窗口、桌面 IPC、Monaco、树和 Worker 就绪                                           |
| `pnpm build`                             | Main、Preload、Renderer、Worker 生产构建通过                                           |
| 生产窗口 smoke                           | Electron 45.0.0、版本 0.7.0、IPC/Worker/Monaco/树通过，sandbox/contextIsolation 均开启 |
| `pnpm test:e2e`                          | 无法执行：当前提交缺少 `tests/e2e` 源码，报 `No tests found`                           |
| PowerShell 脚本语法 / `git diff --check` | 通过                                                                                   |

新机器证据：[开发窗口](environment-check-development-2026-11-03.json)、[生产窗口](environment-check-production-2026-11-03.json)、[E2E 缺失报告](environment-check-e2e-2026-11-03.json)。开发 smoke 原脚本会写入历史 Phase7 报告；本次已另存日期报告并恢复历史文件，未覆盖旧机器证据。

检查 Git 历史发现，当前提交 `d68ceeb` 删除了 7 个 `tests/e2e` 文件，且 `.gitignore` 末尾包含 `tests`。上一提交保留过 28 项阶段测试，但不包含文档所述完整 Phase7 30 项验收源码，因此未擅自恢复旧版或把生产 smoke 当作完整 E2E。要复现 Phase7 的 30 项结果，仍需找回对应版本的测试源码；这属于仓库内容缺失，与本机运行环境无关。

后续 CI 修复已在独立分支 `codex/restore-e2e-ci` 中恢复上述 7 个文件，并重新补齐离线/权限及 HTML/协议边界测试，共 30 项；移除 `tests` 忽略规则，修复所有测试的 profile 隔离，并加入 CI 测试发现检查。上方“无法执行”及 E2E 缺失 JSON 是重建阶段的历史结果，修复后的状态以新分支运行结果为准。

本次没有执行 Windows 安装包构建/安装/升级/卸载、Linux 验收、性能基准或原生桌面手工验收，没有提交或推送 Git。
