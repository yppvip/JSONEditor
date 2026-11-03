# JSONEditor 开发指南

更新日期：2026-11-03（Asia/Shanghai）。本文件是后续人工和 AI 开发的共同依据。发生工具链、数据模型、同步协议或发布方式调整时，同步更新本文件及架构决策记录。

2026-11-03 新电脑环境重建：当前仓库位于 `D:\Code\JSONEditor`，开发工具和缓存统一使用 `D:\5DevelopmentEnvironment`；复用现有 Node 24.22.1、npm 11.19.1、Git 2.56.0.windows.1、PowerShell 7.6.7、VS Code 1.143.1 及 Python 环境 `D:\2PythonEnv\py13`。独立 pnpm 仍固定 12.15.0，依赖版本与锁文件保持不变。以下旧路径及旧机器验收属于历史记录，当前环境以 [环境重建记录](environment-rebuild-2026-11-03.md) 为准。`.node-version` 保留团队验证基线 24.16.0；本机使用 package.json 允许范围内的更新补丁。

同日 CI 修复：移除 `.gitignore` 对整个 `tests` 的忽略，从 `75c0dfb` 恢复被发布提交删除的 7 个 E2E 文件；补齐发布边界 2 项测试，共 30 项。源码/安装后测试使用隔离 profile，CI 增加测试发现检查；Linux 打包主页默认使用当前 GitHub 仓库 URL，可由 Actions Variable 覆盖。详见 [发布与验收](release.md)。

修复分支本机验证：`pnpm check`（215/215）、`pnpm build` 和 `pnpm test:e2e`（30/30）全部通过；YAML 解析与测试发现通过。此结果为 Windows 源码运行验证，远程两平台打包/安装验收以本次 Actions 结果为准。

远程运行 `41567773084` 已确认 Windows/Linux 源码 E2E 均通过。Linux 首次实际打包生成 `x86_64.AppImage` / `amd64.deb`，原工作流却查找 `x64`，导致 apt 安装失败；已统一修正工作流安装/上传路径和清单工具的 Linux 工件名。

## 1. 项目概述

开发支持 Windows/Linux 的桌面 JSON Editor，未来扩展 macOS。核心能力为 JSON 文本编辑、树形编辑、可靠双向同步、节点结构操作、大文件处理，以及文件和剪贴板能力。

Phase0 至 Phase6 已完成（2026-10-25）。当前候选版本 0.7.0，Phase7 的 Windows 自动化、安装/升级/卸载和发布流程已完成；Linux 原生构建/验收及公开发布门槛尚待完成，详见第 33 节。

项目根目录已确认：`D:\4Code\JSONEditor`。检查时目录仅有 `.git`；已有 Git 仓库，不再次执行 `git init`，不擅自提交或推送。

## 2. 技术栈

| 层次 | 已确定方向 | 版本策略 |
| --- | --- | --- |
| Desktop | Electron 45.0.0 | 已锁定并验证 Windows 运行时 |
| Frontend / Language | React 19.3.1 / TypeScript 6.0.3 strict | 已锁定并通过检查 |
| UI | 自定义轻量编辑界面；Ant Design 方向 | 当前使用本地 CSS，组件库留待需要时引入 |
| Tree | React Arborist 4.0.1，自定义 JSON 行 | 受控虚拟树、稳定拓扑与挂载行节点订阅；独立节点和结构操作表单 |
| Text | Monaco Editor 0.57.0，封装官方 API | Phase2 已正式集成，ESM 代码/字体/Worker 本地打包 |
| State | 独立文档会话 + React UI 元数据 | TextDocumentSession 协调同步，DesktopDocumentSession 管理文件生命周期；内容不进入 React state |
| JSON Engine | TypeScript Worker + jsonc-parser 3.3.1 | 严格校验、源码 edits、规范化模型、结构命令、有界身份历史及受限标量投影更新 |
| DnD / Virtualization | Arborist + React DnD 16.0.1 / HTML5 Backend 16.0.1 | 单节点拖放、实时落点检查、同级/跨容器操作与固定行虚拟化已实现；物理鼠标待手工验收 |
| Build | electron-vite 6.0.0 / Vite 8.3.5 | 本地依赖，生产构建已通过 |
| Package | electron-builder 26.18.0 | Windows NSIS 已构建；Linux 配置待目标系统验证 |
| Test | Vitest 5.0.5、Testing Library 16.3.3、Playwright 1.64.1 | 215 项单元/组件测试、源码与安装后 exe 各 30 项交互 E2E 已通过；fast-check 留待后续阶段 |

## 3. 技术选型结论

Electron + React + TypeScript 已获确认，不重新评选桌面路线。优先开发效率、Windows/Linux 一致性和同步可靠性；接受 Electron 的基础体积与资源成本，通过 Worker、虚拟化和减少复制优化大数据性能。

不因为采用 Electron 或虚拟化就承诺大文件规模。支持边界必须来自目标设备和发行版上的测量。纯 JS/TS 首期不需要自行编译 Electron，也不需要 Rust。

## 4. 开发环境

### 4.1 本机实测基线

| 工具 | 2026-10-25 实测版本 | 路径/处理 |
| --- | --- | --- |
| Node.js | 24.16.0 | 复用 `C:\Program Files\nodejs\node.exe` |
| npm | 11.13.0 | 复用 Node 安装中的 npm，只用于引导安装等必要场景 |
| pnpm | 12.15.0 | 新装至 `C:\Code\SoftEnv\package-manager\pnpm\12.15.0` |
| Git for Windows | 2.54.0.windows.1 | 复用 `C:\Program Files\Git\cmd\git.exe` |
| VS Code | 1.133.0 x64 | 复用 `D:\Microsoft VS Code`，CLI 可用 |
| Corepack | 0.35.0 | 已有；本方案不执行 `corepack enable` |
| PowerShell | 7.6.7 | 已有，继续使用 |
| ESLint 扩展 | dbaeumer.vscode-eslint 3.0.34 | 本轮新增 |
| Prettier 扩展 | esbenp.prettier-vscode 12.4.0 | 本轮新增 |

Node 24 当前属于 LTS。24.16.0 是已安装、已验证的项目基线，不宣称它是最新补丁版本。Phase1 已确认其满足实际依赖 engines，并将精确版本写入 .node-version；没有替换用户全局 Node/npm。后续定期检查 Node 24 官方补丁，升级后重新验证并统一声明文件，不自动升级到 Current 大版本。

暂不新增 Node 版本管理器：当前只有一个明确的有效系统 Node，避免引入版本管理器与现有安装路径竞争。团队出现多 Node 项目后，再单独选择和验证版本管理方案，不并行叠加多个管理器。

TypeScript/JavaScript 支持和调试由 VS Code 内置能力提供。ESLint/Prettier 扩展及项目规则均已配置并验证，VS Code 工作区提供开发启动入口。可选扩展为 GitLens、测试查看器；当前没有安装它们。

### 4.2 必须、推荐和可选工具

- 必须：现有 Node 24 LTS、独立 pnpm、Git、VS Code。
- 推荐且已具备：PowerShell 7。Windows Terminal 可选，当前工作流不依赖它。
- Corepack：已有但可选；不创建 Program Files 下的全局 shim，不与独立 pnpm 混用。
- 7-Zip：未在 PATH 找到 `7z`，本阶段使用 PowerShell/.NET 即可，无需安装。
- Python：已有 `C:\Python314`，但本阶段不依赖它，也没有重新安装。
- Visual Studio Build Tools / Windows SDK / C++：当前不要求安装或补装。使用缺少适配预编译包的 native module、执行 node-gyp 源码编译、开发原生插件或从源码构建 Electron 时，再检查并安装受支持的 MSVC、SDK 与兼容 Python。
- 原生工具链由 Visual Studio Installer 管理，不强行放入 SoftEnv。其安装通常需要管理员权限；本轮没有执行。

仅使用预编译 Electron 和常规前端工具时，不需要先安装完整 Visual Studio。原生依赖未来需要按 Electron ABI、平台、CPU 架构验证，必要时使用 `@electron/rebuild`。

### 4.3 环境使用和验证

在项目根目录的 PowerShell 中：

```powershell
. .\tools\Enter-DevEnvironment.ps1
node --version
npm.cmd --version
pnpm.cmd --version
git --version
code --version
```

激活脚本只设置当前进程的缓存路径和 pnpm 入口，不修改 PowerShell profile、执行策略或系统 PATH。若策略阻止脚本，应先诊断策略来源，勿永久放宽系统策略；也可以直接调用已安装的 `pnpm.cmd`。

复现准备和验证：

```powershell
.\tools\Setup-WindowsEnvironment.ps1
.\tools\Test-DevelopmentEnvironment.ps1
```

Setup 默认复用现有 Node >=24.16.0 <25，仅在指定版本 pnpm 缺失时安装。默认目录为 `D:\5DevelopmentEnvironment`，不修改持久化 PATH；可显式使用 `-AddToUserPath` 添加用户 PATH 并备份原值。若同路径出现异常版本，拒绝覆盖。它不安装 VS Code 扩展；新机器已有 VS Code 时，可按需执行下面两条命令（下方历史基线曾安装，当前机器状态见重建记录）：

```powershell
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
```

测试脚本重新组合持久化的系统/用户 PATH，并显式激活项目环境，排除代理进程注入的工具路径；在 EnvironmentRoot 临时目录验证网络、普通依赖安装执行及锁文件离线复现，保存日期报告。重跑会更新当天报告并保留临时验证目录；脚本不自动删除目录。

## 5. 目录结构

### 5.1 开发工具目录（已创建）

```text
C:\Code\SoftEnv\
├─ package-manager\pnpm\12.15.0\   # 独立 pnpm，npm 自定义 prefix
├─ cache\
│  ├─ npm\                         # 本次安装和激活会话使用
│  ├─ pnpm\                        # 激活会话使用，内部版本子目录由 pnpm 管理
│  ├─ electron\                    # 预留下载缓存；本轮未下载 Electron
│  └─ electron-builder\            # 预留打包缓存
├─ metadata\                       # 用户 PATH 变更前的备份
└─ temp\environment-check-*\       # 独立验证包，不是应用项目
```

没有为形式完整而创建空的 node/git/tools 目录。Node、Git、VS Code 保留现有安装位置。未来确需便携多版本 Node 时，可新增 `node/<version>`，不能把 MSI 管理的目录手动搬走。

项目在 D 盘、共享 pnpm store 在 C 盘，跨卷安装可能使用复制而非硬链接；这影响磁盘占用和安装速度，不影响当前验证正确性。后续如果明显影响效率，再配置 D 盘 store；不在仓库硬编码所有成员的绝对路径。

### 5.2 当前仓库实际文件

```text
src/                         # Main / Preload / Renderer / shared / core / workers
tests/                       # unit / component / e2e / performance / integration / fixtures
docs/                        # 开发指南、环境验证、Phase1 实测报告
tools/                       # 环境脚本、开发模式 smoke、性能原型入口
build/                       # 预留发布资源
.vscode/                     # IDE 扩展建议、格式与启动入口
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
electron.vite.config.mts
electron-builder.yml
vitest.config.mts
playwright.config.ts
tsconfig.{base,node,web}.json
release/                     # 忽略跟踪：安装包及解包后的 exe
out/                         # 忽略跟踪：生产构建结果
```

以下目录边界已建立；尚未实现的业务模块仅保留 .gitkeep，不放假实现：

```text
src/
  main/                         # 生命周期、窗口、系统适配
  preload/                      # 有限桌面接口
  shared/                       # IPC DTO、错误协议、共享类型
  renderer/
    app/                        # React 入口和布局
    ui/                         # 外围 UI
    tree-editor/                # Tree 组件适配与编辑
    text-editor/                # Monaco 适配
    state/                      # Zustand/UI 状态
  core/
    document/                   # 会话、revision、编辑事务
    json/                       # 解析、校验、格式化、压缩
    tree-model/                 # 身份、节点索引、源码映射
    commands/                   # 节点与结构编辑命令
    sync/                       # 同步协议和调度
    history/                    # 撤销分组及身份恢复
  workers/                      # 后台计算入口
tests/{unit,integration,e2e,performance,fixtures}/
build/
```

Phase2 新增实际入口：`core/json/engine.ts`、`core/json/limits.ts`、`core/document/text-session.ts`、`shared/json-worker-protocol.ts`、`workers/json.worker.ts`、`renderer/text-editor/create-editor.ts`、`renderer/text-editor/JsonTextEditor.tsx`。已用正式 JSON Worker 替换 Phase1 的 probe Worker。

## 6. 项目架构

采用单仓库、单应用，先以目录和接口建立边界，不预先拆出多个包。主进程、preload、renderer 和 Worker 分别构建；领域核心不导入 React/Electron。

默认启用 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。开发和生产均遵守进程边界，不为解决加载问题而关闭安全机制。生产资源本地加载；不执行文档内容，不把 JSON 值当作 HTML。

## 7. 模块构成

ElectronMain、Preload、Renderer、TreeEditor、TextEditor、JSONCore、JSONTreeModel、StateManagement、SyncEngine、DragAndDrop、FileSystem、Clipboard、IPCBridge、Testing。

## 8. 模块职责

| 模块 | 职责与限制 |
| --- | --- |
| ElectronMain | 生命周期、窗口、菜单、系统服务注册；不承担大 JSON 同步计算 |
| Preload / IPCBridge | 暴露精简的类型化 API；不暴露通用 ipcRenderer、任意文件访问或任意命令执行 |
| Renderer | 布局与用户操作；不直接使用 Node 文件系统 |
| TreeEditor | 节点显示、选择、编辑输入；不拥有独立业务数据源 |
| TextEditor | 文本缓冲区、光标、诊断展示、文档编辑适配 |
| JSONCore | 严格解析、源码 edits、无损数值处理、格式化和压缩 |
| JSONTreeModel | 稳定 ID、有序父子关系、源码范围、定位索引 |
| StateManagement | 会话元数据与 UI 状态；内容由 DocumentSession 管理 |
| SyncEngine | debounce、任务版本、结果发布、循环避免、错误状态 |
| DragAndDrop | 拖拽意图转领域命令；防循环、类型和 key 冲突校验 |
| FileSystem | 原生打开/保存、编码与写入错误处理，通过有限 IPC 调用 |
| Clipboard | 原始/格式化/压缩文本复制；无效 JSON 不从旧树伪造当前结果 |
| Testing | 核心不变量、集成协议、UI 流程、跨平台与性能验证 |

## 9. 模块依赖关系

```text
React UI -> Editor adapters -> DocumentSession / Commands / SyncEngine
SyncEngine -> Worker protocol -> JSONCore / JSONTreeModel
Renderer -> typed Desktop API -> Preload -> Main -> OS services
所有进程 -> shared 中的纯类型/序列化协议
```

避免 core -> renderer、core -> Electron、TreeEditor -> TextEditor 的反向依赖。Worker 通过请求/响应协议通信，不共享任意可变对象。IPC 校验发送者、参数、大小和允许操作，返回可序列化错误；不直接传递 Electron 事件对象。

## 10. 核心数据流

文档文本是内容权威；有效树是带解析 revision 的派生投影，不建立另一份可以随意改写的 Object 真相源。

文本由 Monaco ITextModel 持有，TextDocumentSession 通过 DocumentBuffer 接口读写，不把全文逐键复制到 React state。树命令通过源码 edits 回到同一缓冲区；文件与系统剪贴板通过有限 IPC、能力令牌和版本检查接入。

```text
Text input -> DocumentSession(text, revision) -> Worker parse -> valid Tree projection
Tree intent -> command validation(baseRevision) -> text edit transaction -> same parse pipeline
File open -> Main read -> document load transaction
Save / Copy -> current document revision -> Main system adapter
```

保存和复制时必须明确操作的是当前文本，不能使用非法输入前的旧树替代。文件层保留换行与编码策略；首次支持 UTF-8，其他编码应明确诊断，不默默误解码。

## 11. Tree/Text 同步设计原则

1. 同一会话只有一个内容权威和一条编辑事务管线。
2. Worker 请求/响应携带 documentId、revision；过期结果不能发布。
3. 文本输入立即进入编辑器，初始约 300ms debounce 调度解析，值随基准调优。
4. 非法文本保留原样，旧树可浏览但标记过期，并暂停结构编辑。
5. Tree 操作在当前有效 revision 上校验后生成局部文本 edits，不全量 setValue。
6. 区分 user/tree/format/history/load 等来源，禁止双向 useEffect 相互覆盖。
7. 输入法 composition 期间不强行重写文本；设置执行中任务和最新待处理任务上限。
8. jsonc-parser 禁止注释、尾随逗号和空内容；检查错误列表，不能接受容错结果即算成功。
9. 节点 ID 不等于路径或数组下标；移动尽量保留 ID，任意全文重写允许部分重建。
10. 有序成员、数字字面量、重复 key 都需要明确策略。不能以 JSON.parse/stringify 无条件往返原文；重复 key 给诊断并暂停歧义结构操作。
11. 格式化/压缩基于源码 token 与范围，避免意外数值精度变化。
12. Undo/Redo 统一文档文本历史，Tree/格式化/移动进入同一历史事务；不再维护独立 Tree 数据历史。

## 12. 开发阶段划分

| 阶段 | 目标 | 完成标准 |
| --- | --- | --- |
| Phase0 环境准备 | 工具、目录、验证、本文档 | 已完成 |
| Phase1 初始化 | Electron/React/TS 骨架、lint/format/test、安全 IPC、Windows 构建 | 已完成；开发模式、生产资源、打包 exe 均通过验证 |
| Phase2 Text | Monaco、严格解析、格式化、错误位置 | 已完成；后台诊断、无损字面量格式化、定位及统一文本撤销栈通过验收 |
| Phase3 Tree | 六种类型、增删改、展开折叠 | 已完成；受控虚拟树、源码命令、基础版本保护与统一文本撤销通过验收 |
| Phase4 同步引擎 | 双向事务、版本冲突、非法中间态、统一历史 | 已完成；有界身份恢复、提交核对、组合输入与 Worker 竞争回归通过，无反馈循环 |
| Phase5 高级 Tree | 拖拽、移动、排序、大文件优化 | 已完成；移动保护、精确排序、受限增量投影和节点订阅通过回归；100,000 节点规模/资源已测 |
| Phase6 桌面能力 | 文件、剪贴板、快捷键、最近文件 | 已完成；文件字节/冲突/未保存关闭、剪贴板转换与历史持久化通过回归 |
| Phase7 测试发布 | Windows/Linux 安装、回归与性能、发布流程 | Windows 及流程已验证；Linux 原生 runner、桌面手工验收和公开发布门槛待完成 |

## 13. 各阶段目标

Phase1 就定义文档/revision/IPC 接口，并以临时性能样本验证 Tree 索引与 Monaco/Worker 成本；Phase2 开始实现文档核心，Phase4 完成协调。不能到 Phase4 才临时创建第二份数据源。

虚拟化是 Phase3 的基础，不等到 Phase5 再改造普通递归树；Phase5 优化索引、可见行和大文件模式。此处是对阶段执行顺序的细化，保持此前确认的架构。

## 14. 开发执行顺序

### 14.1 Phase0 已执行

检查工具和路径 -> 识别代理内置 pnpm -> 查询官方 registry -> 独立安装 pnpm -> 备份并追加用户 PATH -> 安装两项 VS Code 扩展 -> 使用持久化 PATH 验证 -> 安装执行普通依赖 -> 锁文件离线复现 -> 记录文档。

### 14.2 Phase1 初始化记录与后续使用

仓库已有 docs/tools，禁止直接把脚手架覆盖到项目根目录，禁止删除目录或重新 git init。先生成到新的 staging 目录，检查内容，再以拒绝覆盖的方式合并。

已执行：查询并检查 `@quick-start/create-electron@1.0.31` 包源码，安装至 `.phase1-staging/generator`，从 staging 工作目录运行 `index.js phase1-app --template react-ts --skip`，仅向原先不存在的目录生成。没有执行生成器的覆盖逻辑，没有对根目录强制覆盖。模板源码经审查后重写/适配到本项目目录，保留 NOTICE 中的 MIT 声明。

`--skip` 会跳过覆盖提示，不能用于已经有文件的目标；不要对本项目根目录重复运行生成器。后续开发直接使用：

```powershell
Set-Location -LiteralPath 'D:\4Code\JSONEditor'
. .\tools\Enter-DevEnvironment.ps1
pnpm.cmd install --frozen-lockfile
pnpm.cmd dev
# 检查、构建和验证分别执行：
pnpm.cmd check
pnpm.cmd build
pnpm.cmd test:e2e
pnpm.cmd build:win
```

生成器可能交互询问更新、镜像或依赖安装：首期不启用自动更新，不预设第三方镜像，不在未经检查的生成内容上直接运行。先审阅 package.json、scripts、配置和实际模板目录。

本轮按以下顺序完成：

1. 检查 staging 中的源码与 manifest，拒绝把其中 `.git`、node_modules 或现有同名文档覆盖进仓库。
2. 逐个合并尚不存在的文件；有冲突就编辑整合，不使用强制递归覆盖。模板可能使用 `src/renderer/src`，通过配置明确调整到建议边界，不盲目移动。
3. 锁定 Electron、React、TS、electron-vite、打包和测试工具版本；写入 Node 声明和 packageManager。
4. 建立 pnpm-workspace.yaml、锁文件、lint/format/typecheck/unit test、项目级 Git 行尾规则。
5. 依据当时 pnpm 版本配置需要执行构建脚本的依赖，明确允许 Electron 下载脚本及实际需要的构建工具；不全局允许所有依赖脚本。
6. 运行 install、lint、format check、typecheck、unit tests、build，然后验证开发窗口与 Windows 安装包。
7. 验证打包后资源/Worker 的加载、安全 IPC 及退出行为，更新本文件实际版本和结果。

上述命令现在均已建立，精确脚本以 package.json 为准。测试已打包 exe：设置当前会话 `JSONEDITOR_EXECUTABLE` 为 `release/win-unpacked/JSONEditor.exe` 绝对路径后运行 `pnpm test:e2e`，完成后移除该会话变量。`test:dev`/`test:performance` 会临时启动并关闭独立测试窗口，不修改文档数据。

## 15. 编码规范

- TypeScript strict，避免跨边界 any；对未知 JSON/IPC 输入使用 unknown 并校验。
- UTF-8、LF、末尾换行；PowerShell/CMD 特殊文件按平台需要单独约定。
- React 组件 PascalCase，变量/函数 camelCase；领域模块不放 UI 状态。
- 错误包含可定位的文档/事务信息，日志不输出整份用户 JSON、文件敏感内容或凭据。
- 大数据计算不可放 React render、输入事件或 Main 同步路径。
- 文本 offset 统一使用编辑器的 UTF-16 单位；文件字节偏移另行转换。
- ESLint 与 Prettier 职责分开，使用兼容配置避免规则互相冲突。规则和脚本已在 Phase1 落地。

## 16. Git 规范

现有 user.name/user.email 已配置，本轮不改身份。全局 core.autocrlf=true 已存在；已通过仓库 `.gitattributes` 声明行尾，不修改全局设置。仓库未跟踪文件可能不在简略 status 中展示，审阅时使用 `git status --short --untracked-files=all`。

建议提交前缀 feat/fix/docs/refactor/test/build/chore，提交按可审阅变更组织；提交前查看 diff 和必要检查。不擅自 reset、清理未跟踪文件、覆盖用户修改、提交或推送。

不提交 node_modules、out/dist、安装包、缓存、凭据或真实用户 JSON。当前环境报告只记录工具与测试结果；后续提交前检查是否包含本机路径等不适合公开的信息。

## 17. 依赖管理规范

- pnpm 是唯一项目包管理器；npm 只用于环境引导，不混入 package-lock.json/yarn.lock。
- package.json 已使用 `packageManager: pnpm@12.15.0`；实际变更版本时同时更新环境脚本、文档、CI 和锁文件。
- Node 当前基线 24.16.0，已使用 engines 范围 `>=24.16.0 <25`，并用 `.node-version` 写入精确版本。`.nvmrc` 仅在确实选用对应管理器时提供；声明文件本身不会自动切换运行时。
- 提交 pnpm-lock.yaml，CI 使用 `pnpm install --frozen-lockfile`。依赖版本升级单独审阅并验证。
- pnpm 12 通用设置放 pnpm-workspace.yaml，不沿用旧版将所有选项写入 .npmrc 的做法。`.npmrc` 仅处理受支持的 registry/auth 等兼容项，绝不提交 token。
- saveExact、engineStrict、strictPeerDependencies、nodeLinker 和构建脚本允许列表已在 pnpm-workspace.yaml 配置；不要照搬其他 pnpm 大版本的键名或命令参数。
- cache/store 的本机绝对路径通过激活会话或本机配置提供，不写死团队跨平台配置。
- Monaco 和 jsonc-parser 为浏览器构建依赖，保留在 devDependencies；Vite 已将运行所需代码和资源打包进产品，不在 ASAR 中重复携带其原始 npm 源码包。
- 不为安装速度关闭 TLS 验证、添加防病毒排除、切换不明镜像或全局允许安装脚本。

## 18. 测试策略

已配置并运行 Vitest + Testing Library（Phase2 共 56 项）、Playwright Electron（当前完整文本交互 4 项），以及开发启动 smoke 和 Phase1 独立性能原型。历史结果见第 27 节，最新结果见第 28 节。fast-check 留待业务结构编辑阶段，尚未安装或执行。

后续：Vitest 测纯领域逻辑；fast-check 验证随机结构操作、无损字面量与撤销；Testing Library 测节点输入/焦点/诊断；集成测试覆盖 revision 竞争和无效中间态；Playwright Electron 验证实际窗口和编辑流程。

Electron 自动化支持仍需按所选 Playwright/Electron 版本验证；原生文件对话框在自动化中使用明确替身，同时保留真实系统安装与桌面手动验收。性能测试记录文件字节数、节点数、深度、首屏、输入延迟、主线程长任务及全部进程内存。

## 19. 构建策略

electron-vite 分别构建 Main/Preload/Renderer；Worker 和 Monaco 资源随应用本地打包。electron-builder 负责分发。开发 Node 与 Electron 内置 Node 分别看待，不假设版本一致。

Phase7 已建立 `.github/workflows/verify.yml`，分别使用 Windows 2025 / Ubuntu 24.04 runner，固定 Action 提交、Node、pnpm 和依赖，执行检查、源码/安装后回归、性能及原生打包，保存工件与报告。CI 尚未在远程运行；本机 Windows 已验证，Linux 仍待执行。流程清除 checkout 中历史 phase7 JSON 报告，避免把旧报告混入新任务证据；token 只读、构建不自动发布。

## 20. Windows 发布策略

首期 Windows x64、NSIS exe。portable 按需增加；不为同时生成 MSI 增加首期维护成本。Phase7 已验证当前用户静默安装、0.6.0 到 0.7.0 升级、离线启动/保存、开始菜单快捷方式及卸载清理；交互向导、UAC、签名和受限账户仍待验收。

不要求用户安装 Node、pnpm 或开发工具来运行发布应用。签名和更新策略单独确定，本轮不申请证书、不发布应用。

## 21. Linux 发布策略

首期计划 AppImage + deb，明确目标发行版和最低运行库要求；rpm 在确认需求后增加。Linux runner 原生构建，在实际桌面环境验证 X11/Wayland、输入法、剪贴板、文件选择和权限。

AppImage 不等于可以无条件运行在任意 Linux；系统库、FUSE 和架构兼容需要验证。Windows/WSL2 上的辅助构建不能代替目标 Linux 桌面验收。

## 22. 性能设计原则

- 首期固定行高虚拟 Tree，长值截断/独立编辑，不默认展开全树。
- 解析/格式化/排序放 Worker；首期全量解析，保留局部文本 edits 与未来增量索引接口。
- 限制任务队列、历史容量和重复副本；避免常驻完整 Object + AST + 重复树多套结构。
- 大文件关闭高成本语言服务、装饰、minimap/自动换行，必要时手动同步。
- 深层解析预检和遍历深度保护；项目自建遍历使用显式栈。
- 1/10/50/100 MiB 与 1万/10万/30万节点分别测量，加入超长单行、长字符串、重复 key 和精度边界。
- 10 MiB/10万节点是初始验证档位、30万节点是压力档位，不是当前已实现支持范围。
- Worker 不会消除全文解析、structured clone 和内存成本；优先测量后优化，不预先增加 Rust 或自研解析器。

## 23. 风险与技术债务

| 项目 | 当前状态与处理 |
| --- | --- |
| 代理内置 pnpm | 初检找到 11.25.0，但其路径依赖代理运行环境；已新增独立 12.15.0 并验证持久 PATH |
| 旧终端 PATH | 已启动终端或 IDE 可能仍持有旧 PATH；激活脚本可立即使用，或重启父应用 |
| 多 Git | 普通 PATH 还有 UGit 内置 Git，系统 Git 排在前；未移除第三方集成，无当前阻断 |
| Node/npm 补丁 | 已验证并锁定 Node 24.16.0 基线，非最新承诺；后续补丁升级单独验证 |
| pnpm 12 变化 | 原生 CLI、配置位置和脚本策略需按当前文档验证；首轮测试发现旧参数不兼容，已修正 |
| 跨卷 store | C 盘 store 与 D 盘项目可能采用复制，Phase1 测安装成本 |
| VS Code 提示 | 扩展安装出现 DEP0169 url.parse 弃用提示，安装成功；未因此修改用户设置或升级整套 IDE |
| 应用验证 | Phase1 已验证开发模式、生产资源模式和打包 exe，已生成 NSIS；尚未执行安装/卸载流程 |
| Linux | 尚未验证，需独立 runner 和实际桌面验收 |
| Tree 大规模更新 | Phase1 原型已发现 10万/30万行整体更新成本明显，详见第 27.2 节；后续优化适配器 |
| 无损编辑 | 数字、成员顺序、重复 key、身份恢复均需测试，不能静默转普通 Object |

### 23.1 本轮失败与修复记录

受限执行环境最初的 registry 请求未获得响应，以及 VS Code 扩展查询报 `EPERM ... mkdir ... Code\User`；通过已授权的正常用户执行权限重试后均成功，未关闭 TLS 或调整系统权限。

首次依赖安装验证失败：pnpm 12 返回 `error: unexpected argument '--fetch-retries' found`，exitCode=2。原因是测试脚本沿用旧 CLI 参数；移除 pnpm add 不接受的参数后，网络安装、依赖执行、独立目录 offline/frozen-lockfile 复现均成功。npm ping 仍使用 npm 自身支持的超时参数。

首次报告保留在 `docs/environment-check-initial-failure.json`；通过报告在 `docs/environment-check-2026-10-25.json`。没有忽略失败或把未执行步骤标成成功。

### 23.2 安装与配置边界

新增用户级 PATH 条目仅为独立 pnpm 目录。变更前备份：

`C:\Code\SoftEnv\metadata\user-path-before-20261025T0415161568148Z.json`

未修改机器级 PATH、Git 全局设置、npm 全局配置、PowerShell profile/执行策略；未卸载或替换既有 Node/Git/IDE；未设置系统 TEMP 或全局下载镜像。安装通过受限代理的授权执行完成，没有请求 UAC，也没有安装要求管理员的系统软件。

如需撤回 pnpm PATH 条目，仅移除该精确条目，保留后续其他更改；不要无条件把旧备份整个覆盖回当前 PATH。目录保留以便复用，未经检查不自动递归删除。

## 24. 架构决策记录

| ID | 日期 | 决策 | 状态 |
| --- | --- | --- | --- |
| ADR-001 | 2026-10-25 | Electron + React + TypeScript，沿用上一阶段架构 | 已确认 |
| ADR-002 | 2026-10-25 | 复用系统 Node 24/Git/VS Code，不迁移或重复安装 | 已执行 |
| ADR-003 | 2026-10-25 | 独立 pnpm 12.15.0，自定义 prefix、用户 PATH、版本目录 | 已执行并验证 |
| ADR-004 | 2026-10-25 | 缓存路径只作用于激活会话，保留全局配置 | 已执行并验证 store 路径 |
| ADR-005 | 2026-10-25 | 当前不安装 Rust、C++ Build Tools、额外 Python/Corepack shim | 已确认 |
| ADR-006 | 2026-10-25 | 文本权威、有效 Tree 投影、带 revision 事务、统一历史 | 后续实现约束 |
| ADR-007 | 2026-10-25 | Tree 首次实现就使用虚拟化，先测后承诺规模 | 后续实现约束 |
| ADR-008 | 2026-10-25 | 非空仓库先 staging 生成、拒绝覆盖合并 | 已执行 |
| ADR-009 | 2026-10-25 | D 盘 symlink 失败后使用项目级 hoisted；不用 Squirrel，禁用 electron-winstaller 脚本 | 已验证 |
| ADR-010 | 2026-10-25 | 本地资源使用 app://editor 安全协议、精确主 frame IPC 校验和 CSP | 已通过开发/打包 E2E |
| ADR-011 | 2026-10-25 | TS 6.0.3 满足当前 lint peer；ESM 工具配置使用 .mts | 已验证 |
| ADR-012 | 2026-10-25 | Monaco 文本为权威，TextDocumentSession 使用缓冲区端口与带版本 Worker 协议 | Phase2 已验证 |
| ADR-013 | 2026-10-25 | 严格诊断由自有 JSON Worker 唯一提供，禁用 Monaco 重复诊断与远程 Schema 请求 | Phase2 已验证 |
| ADR-014 | 2026-10-25 | 格式化只修改源码空白，使用 Monaco executeEdits/undo stops，不经 Object stringify 往返 | Phase2 已验证 |
| ADR-015 | 2026-10-25 | textarea 输入基线，关闭自动闭合/包围/缩进；大文档采用批量粘贴与显式校验 | Phase2 已验证，物理输入法仍待手工回归 |

## 25. Phase0 验证结果与停止条件

通过报告记录 15 项检查：Node/npm/pnpm/Corepack/Git/VS Code CLI、Node 执行、pnpm 精确版本、缓存路径、registry、两项 IDE 扩展、普通依赖安装执行、锁文件离线复现。实际判定以报告的 checks 和 passed 为准。

测试依赖为 `is-number@7.0.0`，安装于 SoftEnv 临时目录并使用 `--ignore-scripts`；没有污染仓库 manifest 或锁文件。离线复现使用另一个目录及同一 store，证明普通依赖锁定安装，不代表 Electron 的下载脚本或二进制已验证。

以上为 Phase0 历史验收记录。Phase1 随后已获用户授权并完成，其执行结果以第 27 节为准。

## 26. 官方参考

- [Node.js 版本与 LTS 状态](https://nodejs.org/en/about/previous-releases)
- [pnpm 安装及 Windows 指引](https://pnpm.io/installation)
- [pnpm 12 配置位置](https://pnpm.io/settings)
- [pnpm install / frozen lockfile](https://pnpm.io/cli/install)
- [electron-vite 入门与模板](https://electron-vite.org/guide/)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Electron 安全约束](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron 42 安装机制变化](https://www.electronjs.org/blog/electron-42-0)
- [pnpm 构建脚本策略](https://pnpm.io/settings/build)
- [electron-builder 跨平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)

官方链接用于版本/机制依据；本机版本、安装成功与失败的证据以本仓库验证报告为准。

## 27. Phase1 执行进度

开始/完成日期：2026-10-25（Asia/Shanghai）。状态：已完成。没有自动进入 Phase2。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| 仓库和环境复查 | 已完成 | 已读取现有文档与环境脚本；保留现有 docs/tools |
| staging 生成与模板审查 | 已完成 | 1.0.31 模板生成于 .phase1-staging/phase1-app；移除默认 sandbox:false、通用 IPC 和示例更新配置 |
| 精确版本与目录边界 | 已完成 | package.json 精确版本 + pnpm-lock.yaml；Node 24.16.0；pnpm 12.15.0 |
| Main/Preload/Renderer 与安全 IPC | 已完成并通过运行验收 | sandbox/contextIsolation 开启；仅 getAppInfo；app:// 本地资源协议与源码目录边界 |
| Lint/Format/Typecheck/测试 | 已通过 | Lint/Format/TS strict 均通过；Vitest 2 文件、12 测试通过；性能原型 TS 也纳入类型检查 |
| 开发模式与打包窗口验证 | 全部通过 | 开发模式、生产资源模式、解包 exe 的 IPC/隔离/Worker 均通过；测试窗口已关闭 |
| Windows 安装包构建 | 已完成 | 已生成 x64 NSIS 和 blockmap；未执行安装或发布 |
| 技术风险原型与收尾 | 已完成 | 1万/10万/30万行报告；锁文件冻结安装通过；ASAR 未包含性能原型或开发工具 |

### 27.1 执行问题与决策

- TypeScript 最新稳定版 7.0.2 超出 typescript-eslint 8.72.0 的 peer 范围（<6.1）；选用兼容稳定版 6.0.3。
- Electron 42 起已不靠依赖 postinstall 自动下载二进制。本项目显式通过根项目 postinstall 的 `install-electron` 完成运行时准备。
- 首次 pnpm install 在 D 盘创建依赖 symlink 时失败：`Failed to create symlink ... 函数不正确 (os error 1)`。采用项目级 `nodeLinker: hoisted` 后重试；只清理本次产生的 node_modules，不改系统权限或全局包管理器设置。
- hoisted 安装完成 Electron 下载后，pnpm 严格脚本策略报告 electron-winstaller 的未决 install 脚本。本项目只构建 NSIS，不使用 Squirrel，已显式配置 `allowBuilds.electron-winstaller: false`；随后 `install --frozen-lockfile` 成功。
- Node 沿用本机已验证的 24.16.0，不替换全局安装；其版本满足当前依赖 engines。后续升级补丁时同步 .node-version、engines 与 CI，不将此基线称为最新补丁。
- Vite 提示 CommonJS 项目中的 ESM 配置未来不兼容 native loader；已将 electron-vite/Vitest 配置显式改为 .mts，不设置全局忽略变量。
- Vitest 5 与当前 jest-dom 类型扩展不匹配；初始阶段使用 Testing Library 查询 DOM、Vitest 原生断言，移除不必要的断言扩展依赖。最终类型检查与组件测试通过。
- Electron 没有公开的 getLastWebPreferences API；运行时沙箱/隔离状态由 preload 在同一 getAppInfo 返回值中提供，E2E 验证真实状态和主世界无 require/process 暴露，不增加通用调试 IPC。

### 27.2 初步性能结果（单次合成样本）

完整数据见 `docs/phase1-performance.json`。以下均为 Windows 本机单次测量，包含至少两帧等待，不是发布性能承诺。输入是平铺 Tree 行，每行 id/name/value 三属性；不是完整嵌套 JSON Tree Model。Monaco 使用关闭 JSON 语言服务的 plaintext 基线。

| Tree 行数 | 文本字节数 | Tree 首次挂载 | 更新一行后的整体提交 | 实际挂载行数 | Worker parse / serialize |
| --- | --- | --- | --- | --- | --- |
| 10,000 | 456,671 | 58.6ms | 96.7ms | 16 | 7.0 / 0.9ms |
| 100,000 | 4,866,671 | 517.9ms | 313.1ms | 16 | 55.7 / 12.1ms |
| 300,000 | 15,266,671 | 1432.9ms | 1015.6ms | 16 | 154.2 / 32.4ms |

Monaco 基线首次创建约 61–111ms，局部插入加帧等待约 37–50ms。Worker 原生 JSON.parse/stringify 仅用于性能比较，不是生产无损 JSON 引擎；不代表严格诊断、Schema 或复杂模型同步性能。

结论：虚拟化确实限制了 DOM 行数，但大数组引用变化仍触发显著的索引/组件工作量。React Arborist 可继续作为首期适配器，不能以此承诺 10万/30万节点即时交互。Phase3/5 必须避免每次值修改替换整棵树输入，验证节点级订阅、稳定元数据与索引更新；仍不达标时替换 Tree 适配器，领域核心不依赖 Arborist。深层结构、多次统计、编辑历史和真实大文件语言服务尚待测试。

### 27.3 最终验证与工件

| 命令/检查 | 结果 |
| --- | --- |
| pnpm install --frozen-lockfile | 通过，锁文件与 manifest 一致，未重新解析依赖 |
| pnpm check | 通过：Lint 零 warning、格式检查、两套 TS strict、12 项 Vitest 测试 |
| pnpm build | 通过：Main、Preload、Renderer、独立 Worker 资源 |
| pnpm test:e2e（生产资源） | 1/1 通过，app://editor/index.html、本地资源、IPC、Worker、隔离、禁止新窗口 |
| pnpm test:dev | 通过，实际 electron-vite 开发服务器、桌面窗口、IPC 和 Worker |
| pnpm test:performance | 通过，独立组件样本；具体性能限制见上文 |
| pnpm build:win | 通过，Windows x64 NSIS |
| pnpm test:e2e（JSONEDITOR_EXECUTABLE 指向解包 exe） | 1/1 通过，验证真实 ASAR 打包程序 |
| ASAR 内容检查 | 通过，102 项；无 tests/tools/monaco-editor/react-arborist 原型包进入应用 |

报告：`docs/phase1-verification.json`、`docs/phase1-development-smoke.json`、`docs/phase1-performance.json`。Playwright 原始报告在忽略跟踪的 `test-results/`；后续重跑会更新它。

Windows 安装包：`release/JSONEditor-0.1.0-x64-setup.exe`，121,976,143 字节（约 116.3 MiB）。

SHA-256：`a980e1cd96294866f581b885699e8bda98f7e2c9d050e3e35e3273fad14006be`

可直接运行的解包程序：`release/win-unpacked/JSONEditor.exe`。本轮未运行安装器，未执行安装/升级/卸载验证，未签名、未发布；使用默认 Electron 图标，正式品牌资源留待后续阶段。工件、缓存和 staging 均不纳入 Git 跟踪。用户原有环境脚本和环境报告未改写，未提交或推送 Git。

### 27.4 后续入口与明确限制

下一阶段是 Phase2：集成正式 Monaco、严格 JSON 解析/格式化和错误定位，继续遵守文档/revision 契约。当前仅有初始化提示页面、只读运行时信息接口和 Worker 探针，没有 Tree/Text 业务实现。

Linux 构建/运行、原生安装流程、签名、自动更新、JSON Schema、撤销/重做与复杂模型性能均未验收。性能原型只作为选型风险证据，不把原生 JSON.parse 或 plaintext 编辑器当成完成后的 JSON 引擎。

## 28. Phase2 执行进度

开始/完成日期：2026-10-25（Asia/Shanghai）。状态：已完成。当前版本 0.2.0；未自动进入 Phase3。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| Phase1 基线与现有改动复查 | 已完成 | 保留全部未提交 Phase1 文件，不重置或覆盖用户修改 |
| 严格 JSON 核心与 Worker 协议 | 已完成 | jsonc-parser 3.3.1；严格语法、重复键、版本/任务上限、深度和尺寸保护、超时/构建失败恢复 |
| 正式 Monaco 集成 | 已完成 | JSON token 高亮、本地资源和字体、独立文档模型及释放；禁用重复诊断/远程 Schema |
| 校验、格式化与错误定位 | 已验收 | 300ms debounce；非法输入不改写；标记和问题列表支持行/列跳转；格式化可单步撤销/重做 |
| 测试和 Windows 工件 | 已完成 | 56 项单元/组件测试；开发 smoke；生产资源与打包 exe 交互 E2E 通过；0.2.0 NSIS 已生成 |
| 文档与收尾 | 已完成 | 报告、操作说明、实际限制和后续入口已记录；未开始 Tree 开发 |

### 28.1 集成问题与处理

- 官方 registry 首次元数据查询遇到 ECONNRESET，重试成功，未更改 TLS 或镜像。
- jsonc-parser 的 ambient const enum 不兼容当前 verbatimModuleSyntax；深度预检仍使用其 scanner，但读取单字符结构 token，不放宽 TS 检查。库的 content 编辑字段显式映射到领域 TextEdit.text。
- Monaco 0.57 的旧 json/monaco.contribution 转发入口无类型声明；使用当前带类型的 languages/features/json/register，不声明 any 模块。
- 整段键盘输入最初出现尾部残留，切换 textarea 后仍复现，排除了 EditContext 是唯一原因。调试确认选区已覆盖全文；JSON 语言的自动括号/引号闭合仍会在整段输入中补字符。Phase2 显式关闭自动闭合和自动包围，保留 textarea 输入基线；后续重新启用需验证输入、粘贴和输入法，不改变安全沙箱配置。
- 同时关闭自动缩进，保证输入和粘贴不隐式重排源码，缩进只由显式格式化操作产生。大文档测试通过合成 ClipboardEvent 触发 Monaco 批量粘贴路径，不覆盖系统剪贴板；不把多 Mi 字符当一次逐键 type 输入作为批量导入方式。
- 单元/组件测试只替换浏览器编辑器适配端口，不伪造真实 Monaco 成功；真实高亮、键盘输入、批量粘贴、快捷键和撤销操作另在 Electron 中验收。

### 28.2 数据流与操作约定

```text
Monaco ITextModel（内容权威）
  -> onDidChangeContent / revision++ / 清除过期诊断
  -> 300ms debounce 或显式校验/格式化
  -> 自有 JSON Worker 严格检查 / 源码格式 edits
  -> documentId + revision + requestId 匹配后发布
  -> Monaco markers + 可点击的行/列问题列表
```

常用操作：直接编辑 JSON；点击“校验”；点击“格式化”或 Ctrl+Shift+F；点击错误跳转到源码；使用撤销/重做按钮或编辑器原生快捷键。格式化一次是一组撤销事务，非法 JSON 不返回格式 edits。Object 数字形式 key 的顺序、大整数、-0、指数/小数写法、字符串转义和重复键均不通过原生 Object 重新序列化。

严格拒绝注释、尾随逗号、空文档、单引号、非法数字、非法转义和多根值。重复 key 属于警告，源文保留，不擅自合并或覆盖；它不等同语法错误。校验失败和过期响应都不覆盖当前输入。

每文档最多一个执行中任务和一个最新待处理意图，不缓存多份待发全文。输入法 composition 期间暂停自动请求和格式应用；结束后重新 debounce。Worker 超时/错误时终止后台任务并保留文档，可点击“重试后台”建立新 Worker。模型、编辑器、监听、定时器和 Worker 在组件卸载时释放。

### 28.3 当前边界（不是大文件性能承诺）

| 项目 | 当前值 / 行为 |
| --- | --- |
| 自动校验 | 不超过 2 × 1024 × 1024 个 UTF-16 code units；300ms debounce |
| 大文件模式 | 超过上述字符数后，用户显式校验/格式化；关闭校验装饰以减少渲染工作 |
| 分析上限 | 20 × 1024 × 1024 个 UTF-16 code units；超过上限在主线程发送前即阻止额外全文复制，原文保留 |
| 嵌套保护 | 最大 512 层；使用 scanner 迭代预检，避免先进入递归解析器 |
| 诊断上限 | 保留 100 项并提示截断；语法错误优先于超出的重复键警告 |
| 后台时限 | 15 秒（包括启动），超时终止并允许恢复 |
| 已实测大输入 | 2,097,154 字符 ASCII JSON 字符串，真实 Monaco 批量粘贴及手动校验通过 |

阈值按 UTF-16 字符单元计算，不等同 UTF-8 文件字节数或节点数量。上限是保护策略，并不证明该范围内所有结构都具备同等交互性能。尚未覆盖全范围格式化压力、深层混合结构、长期连续编辑内存和真实物理中文输入法手工回归。

本阶段没有文件保存：内容仅在当前窗口的临时模型中，关闭应用不会持久化。已在页面明确提示。Tree Model、Tree/Text 双向同步和文件/剪贴板桌面 API 不在本轮实现。

### 28.4 验证结果与工件

| 验证 | 结果 |
| --- | --- |
| Lint / Format / TypeScript strict | 通过 |
| Vitest / Testing Library | 4 文件、56 测试通过：严格语法/无损格式化、UTF-16 offset、重复键/深度、队列/版本竞争、IME 调度、超时/构建失败恢复、资源释放、工具栏和错误 UI |
| 生产资源 E2E | 4/4 通过 |
| 开发模式 smoke | 通过，Monaco 显示、后台校验、IPC 和 Worker 正常 |
| 打包 exe E2E | 4/4 通过，无 skipped/unexpected/flaky；保留数字字面量的格式化、单步撤销/重做、Ctrl+Shift+F、错误定位、重复键及大输入手动校验 |
| 离线资源边界 | E2E 观察到的渲染资源均为 app://editor；ASAR 包含字体、Monaco editor Worker 与自有 JSON Worker，无 CDN / Schema 请求 |
| Windows x64 NSIS / frozen-lockfile | 构建通过，冻结安装通过 |

证据：`docs/phase2-verification.json`、`docs/phase2-development-smoke.json`、`docs/phase2-e2e.json`。截图位于忽略跟踪的 `test-results/phase2-editor.png`，后续 E2E 会更新测试目录。

安装包：`release/JSONEditor-0.2.0-x64-setup.exe`，123,485,071 字节（约 117.8 MiB）。

SHA-256：`0453d7d5e4c5bdb89c3cba09a1bce394cf54ebb7ec708ff7851cf7f64face897`

保留此前的 0.1.0 安装包；`release/win-unpacked/JSONEditor.exe` 为最新 0.2.0 程序。当前仍未签名、未执行安装器或发布；Linux、安装/升级/卸载和物理输入法验收尚未执行。没有修改全局环境、提交或推送 Git。

### 28.5 下一阶段入口

Phase2 到此完成。下一阶段为 Phase3：在现有文档缓冲区、revision、源码范围与 Worker 协议基础上建立独立 Tree Model 和虚拟树浏览/基础节点操作；不能引入第二份可独立覆盖文本的数据源。本轮未开始 Phase3。

## 29. Phase3 执行进度

开始/完成日期：2026-10-25（Asia/Shanghai）。状态：已完成。版本 0.3.0；未自动进入 Phase4。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| Phase2 与仓库复查 | 已完成 | 保留全部现有未提交文件和历史报告 |
| 规范化 Tree Model | 已完成 | Worker visitor 构建节点表，避免额外完整 AST；数字字面量、源码范围与节点 ID 保留 |
| 版本化基础命令 | 已完成 | 增删改、key/类型修改，源码 edits 原子提交；数组删除校验后保留剩余节点身份 |
| 虚拟树 UI | 已验收 | React Arborist 固定 28px 行高；属性/类型/JSON 值表单；深层横向滚动与键盘选择 |
| 非法/过期状态 | 已验收 | 有效树保留为只读快照，重复 key 全树只读，100000 节点保护 |
| 测试与工件 | 已完成 | 99 项单元/组件测试；源码与打包 exe 各 10/10 E2E；0.3.0 NSIS |
| 规模验证与收尾 | 已完成 | 真实模型路径 1,001/10,001/50,001 节点，11 行挂载；100,001 节点降级通过；文档及证据已记录 |

### 29.1 已发现的问题与处理

- React Arborist 行组件只负责展示与选择，不使用其内部数据编辑能力；拖拽、Drop 与内联重命名已禁用，避免绕过文档事务。
- 新树表单在过期期间通过 fieldset 与提交处理器双重拦截，核心会话和 Worker 仍独立检查 revision、节点存在性及原始文本一致性。
- JSDOM 不提供 ResizeObserver，组件测试只补齐尺寸观察端口；真实虚拟滚动与节点交互另在 Electron 验收。
- Monaco 自带多个 alert 元素，节点命令错误增加独立的可访问名称，避免混淆错误来源。
- 值表单读取上限 65,536 UTF-16 字符；更长值在文本区编辑，未截断后写回。模型预览最多 100 个源码字符。
- 深层节点按实际最大深度提供横向滚动；Worker 重启导致根 ID 变化时重建树适配器，避免残留旧展开状态。
- 键盘测试先点击选中根节点再发送方向键，符合树组件的焦点状态机制；单纯 DOM focus 不等同节点选中。真实窗口中的方向键选择与深层展开均通过。

### 29.2 模型与命令边界

`src/core/tree-model/model.ts` 定义独立于 React/Electron 的平铺节点表：ID、parentId、有序 children、key/index、六种类型、UTF-16 源码范围及预览。JSON Pointer 按需计算，ID 使用 Worker 代际前缀与递增计数，不把路径当身份。有效解析按父节点/key/位置尽量复用 ID；树命令删除数组元素时显式保留其余兄弟身份。任意文本插入/重排、历史回放或子树整体替换的身份只作尽力复用，不承诺所有结构编辑都保持语义 ID。

Worker 内 `JsonDocumentEngine` 缓存上次有效树和源码。树命令必须匹配文档、revision、节点和原始源码，生成经过严格 JSON 验证的局部 edits。会话再次过滤过期响应后，以一次 Monaco 事务提交，再沿相同校验管线更新树。属性名和值可原子修改；Object 新增属性要求名称唯一，Array 新增追加末尾；根节点可以改值/类型，但不能删除。删除处理首/中/末/唯一成员的分隔符。

树没有独立数据撤销栈，不使用 Arborist 内部写入能力。数字值按用户输入的 JSON 字面量写入，未改动部分不会经 JSON.parse/stringify 重排或丢失精度。非法文本保留旧树但禁用编辑和源码定位；恢复有效文本后重新启用。重复 key 保留原文、给出警告，并使整棵树只读。超过 100,000 节点停止构建并保留文本，旧树仍只读；不发布半棵树。超过自动校验字符阈值仍需显式校验。

树选择可查看属性/类型/JSON 值，并点击“定位文本”；展开按钮、全部折叠、展开根节点和方向键支持浏览。更长值可直接在 Monaco 编辑；表单显式切换类型可替换整个值，不将截断预览写回。

### 29.3 真实模型规模测量

命令：`pnpm test:tree-performance`，证据 `docs/phase3-performance.json`。Windows x64 10.0.26200、i5-9400F、6 逻辑处理器、约 16 GiB RAM；每种合成平坦数组单次测量。通过真实 Monaco 粘贴、Worker 节点构建、传输及 Arborist 显示路径，不覆盖系统剪贴板。

| 总节点数 | UTF-8 字节 | 粘贴至树可用 ms | 单节点修改至树更新 ms | 挂载行数 | 进程工作集之和 MiB | Private Bytes 之和 MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1,001 | 3,891 | 447.1 | 148.9 | 11 | 437.2 | 294.5 |
| 10,001 | 48,891 | 884.3 | 190.8 | 11 | 511.7 | 370.4 |
| 50,001 | 288,891 | 931.6 | 328.2 | 11 | 669.6 | 528.7 |

100,001 节点文本仍通过 JSON 校验，树构建按上限安全降级。计时含自动校验 300ms debounce、粘贴、Worker 往返、完整元数据/索引重建、React 与自动化开销，不是纯解析耗时。内存来自 Electron 各进程，含 GPU 和自动化，工作集共享页可能重复计算；不是冷启动基线或泄漏证明。该探针在补充深度元数据和横向布局前运行，平坦数组数据路径相同；最终交互回归另覆盖深层布局。

当前仍有线性完整模型/索引更新和多份投影内存成本。Phase1 原型发现的问题尚未以增量索引彻底解决，本轮只完成安全上限和实际测量，不宣称 10万/30万节点即时交互。后续需要节点级更新、深层混合结构、多次统计与长期编辑内存回归。

### 29.4 最终验证与交付

| 验证 | 结果 |
| --- | --- |
| Lint / Prettier / TypeScript strict | 通过 |
| Vitest / Testing Library | 7 文件、99 项通过；覆盖范围编辑、六种类型、顺序/精度、重复 key、稳定 ID、命令保护、过期响应和表单只读 |
| 生产资源 Electron E2E | 10/10 通过，无 skipped/unexpected/flaky |
| 打包 exe E2E | 10/10 通过；包含原有文本、安全 IPC/Worker、树增删改、统一撤销重做、只读恢复、深层滚动、虚拟化及键盘选择 |
| 开发模式 smoke | 通过；0.3.0、Monaco/树、IPC、Worker 正常 |
| Windows x64 NSIS | 构建成功；未执行安装器 |

报告：`docs/phase3-verification.json`、`docs/phase3-development-smoke.json`、`docs/phase3-e2e.json`、`docs/phase3-performance.json`。最终窗口截图：`test-results/phase3-editor.png`（忽略跟踪，后续测试可能更新）。

安装包：`release/JSONEditor-0.3.0-x64-setup.exe`，123,528,199 字节（约 117.8 MiB）。SHA-256：`0b6ff6a5435633d1c4ded6dfe5b793e888c1897b43958ba433bb76ea299bb775`。保留 0.1.0/0.2.0 历史安装包；`release/win-unpacked/JSONEditor.exe` 为最新 0.3.0。未签名，使用默认图标，未发布或执行安装/升级/卸载。Linux 与真实物理中文输入法尚未验收。没有提交或推送 Git。

当前仍是临时文档，关闭窗口不会保存；文件打开/保存和系统剪贴板 API 待 Phase6，拖拽/移动/排序待 Phase5。

### 29.5 下一阶段入口

Phase3 已完成。Phase4 继续完善同步引擎：复杂编辑与撤销回放的节点身份、版本冲突/快速连续输入/后台重启竞争、统一历史与防循环覆盖的系统性验收。Phase3 为可操作树所需的基础双向事务、非法中间态与统一撤销已实现，Phase4 应在同一内容权威上完善，避免重新创建另一份可覆盖文本的状态。本轮未开始 Phase4。

## 30. Phase4 执行进度

开始/完成日期：2026-10-25（Asia/Shanghai）。状态：已完成。版本 0.4.0；未自动进入 Phase5。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| 基线复查 | 已完成 | 以 Monaco 为内容权威，保留全部既有改动与历史报告 |
| 文本变更与节点身份 | 已完成 | 有界源码范围变更记录；数组插删、属性重命名、格式化与非法中间态 |
| 历史回放 | 已完成 | 基于 Monaco 历史版本、精确源码校对的有界身份缓存 |
| 同步协调与冲突保护 | 已验收 | 组合输入、过期响应、后台重启、提交失败与防循环覆盖；真实 Worker 故障恢复通过 |
| 测试与 Windows 工件 | 已完成 | 129 项单元/组件；源码与打包 exe 各 16/16 E2E；开发 smoke；0.4.0 NSIS |
| 规模与文档收尾 | 已完成 | 真实模型 1,001/10,001/50,001 节点、100,001 节点降级；保留历史报告与安装包 |

### 30.1 统一内容、版本与历史

Monaco ITextModel 仍是唯一内容权威，`TextDocumentSession` 协调输入、命令和 Worker；`JsonDocumentEngine` 在 Worker 中持有带源码范围的规范化树投影。React 只消费状态/投影并维护尚未提交的表单草稿。没有增加原生 JS Object 真相源，也没有 Tree/Text 相互写入的 useEffect。

每次 Monaco 内容事件只推进一次单调 revision，并标注 text/tree/format/undo/redo 来源。树和格式化通过一组局部 edits 提交，每组有前后 undo stop，文本键盘编辑继续使用 Monaco 的原生分组。撤销/重做不是第二套树历史，而是文本历史回放后重新发布同一管线的树。

Monaco `getAlternativeVersionId()` 提供历史版本标识；它与单调 revision 分开使用。撤销可回到旧历史版本，但新的 revision 仍增长，因此旧命令或旧响应无法借撤销绕过版本保护。

### 30.2 文本范围变更与身份恢复

新增 `src/core/document/change-map.ts`。Monaco 每次事件只记录 offset、旧 length 和插入字符数，不在 React 或变更队列保存全文。每个 batch 的范围都指向该次事务前的源码；同批 edits 排序并校验整数、范围、非重叠、连续 revision 和最终字符数后，才用于映射旧节点锚点。

Object 节点以属性名起点为锚点，Array 元素以值起点为锚点；跨插入/删除换算位置，要求父节点身份和容器类型仍匹配。文本插入数组元素后，原有后续节点及其未改动后代可以保持 ID、选中与展开状态。属性名和类型/值的原子修改保留目标身份；被整个替换的子树内部节点不冒用已删除后代的身份。根仍属于同一文档节点。

`src/core/tree-model/identity-history.ts` 只缓存已成功解析历史版本的有序 ID 序列和精确校对源码，不缓存第二套可写树或提供文本 undo/redo。命中文档 ID、历史版本及完全相同源码后，重新解析时恢复该版本节点 ID；新的投影使用当前 revision。后台重启会建立新 ID 代际，UI 安全重建适配器，原文和 Monaco 撤销历史继续保留。

| 身份跟踪边界 | 当前保护 |
| --- | --- |
| 变更记录 | 最多 256 条范围编辑；超过时移除最早完整 batch；未知/flush 事件清空记录 |
| 历史检查点 | 最多 8 个已解析版本，按解析访问顺序保留 |
| 历史 ID 总量 | 最多 200,000 个节点 ID 引用 |
| 历史源码总量 | 最多 4,194,304 UTF-16 字符；超限逐个驱逐旧检查点，单项过大不缓存 |
| 命中条件 | 同一文档、同一历史版本、源码逐字符相同；仅版本相同不接受 |

完整连续变更记录和历史命中才提供上述增强身份保证。记录截断、历史驱逐、未曾解析的中间版本、整段重写和重启后的身份只作尽力复用；现有 key/位置策略可作为回退，不宣称任意重排或相同值元素都可识别语义身份。身份缓存丢失不会破坏文本撤销/重做。

### 30.3 冲突、输入法和提交保护

请求仍受 documentId/revision/requestId/action/Worker 代际约束，最多一个执行中任务和一个最新待处理意图。新输入清除旧意图；树命令不排队等待一个可能过期的基准。收到当前响应后还核对真实缓冲区源码和嵌套树版本；若适配器漏报内容事件，则使 revision 失效并重新校验，不应用旧 edits。

在调用编辑器前先验证源码 edits，计算预期结果；提交必须成功、只触发一次同步内容事件，且提交后源码必须与预期一致。适配器拒绝、抛错、漏事件或部分/错误提交都会终止当前后台并显示恢复入口，避免反复应用或循环覆盖。部分提交时保留实际缓冲区供用户检查，不用旧快照强行回滚覆盖新输入。

源码 edits 按原始范围切成互不重叠的片段后一次 join，排序之外的拼接工作为线性复杂度，避免格式化产生大量 edits 时反复重建全文。新增 10,000 个 UTF-16 范围 edits 的正确性测试，以及真实窗口 5,001 节点格式化/撤销的事务回归。

该大批事务回归还发现 Monaco 会合并多个格式化范围，使仅依赖合并后范围的身份映射误把存量节点当成新节点。引擎自身生成的树命令现在保留原始范围信息，格式化保留有序 ID；只有 documentId、预期下一 revision 和提交后精确源码全部匹配时才采用这些信息。不能让提交后合并的内容事件抹去已知事务语义，也不能把未应用或过期事务的身份提示用于不相关输入。

composition 期间 UI 禁用格式化/校验/树提交，核心同时拦截命令并丢弃期间抵达的结果。结束后小文档重新 debounce，大文档回到手动校验；修复了大文件在组合输入消耗执行中响应后停留于“正在校验”的边界问题。非法中间态、重复 key、超限和失败期间旧有效树仅供浏览，不能改写当前输入。

### 30.4 验证进展

静态检查通过，9 文件、129 项单元/组件测试通过。新增同步核心覆盖数组插删/后代身份、属性改名、多范围 edits、非法中间态、格式化及编辑器合并事件、历史校对与驱逐、截断变更记录、过期树命令、连续 40 次树事务无反馈循环、组合输入/大文件状态、Worker 代际及异常编辑器提交。

新增 6 项真实 Electron 交互测试已通过，覆盖文本插入后选中/展开保留、树删除及撤销重做恢复 ID、格式化与树编辑的共同历史、快速非法输入恢复、真实 JSON Worker 抛错后重试、组合输入事件和 5,001 节点格式化/撤销/后续编辑。最终生产资源完整 16/16 通过。一次失败断言误将合法数字拼接当成非法 JSON，已改为显式非法 token 后修复输入；没有放宽解析规则。组合输入使用合成事件，不代替真实物理输入法验收。

| 最终验证 | 结果 |
| --- | --- |
| ESLint / Prettier / TypeScript strict | 通过 |
| Vitest / Testing Library | 9 文件、129/129 通过 |
| 生产资源 Electron E2E | 16/16 通过，0 skipped/unexpected/flaky |
| 打包 exe E2E | 16/16 通过，0 skipped/unexpected/flaky |
| 开发模式 smoke | 通过；版本 0.4.0，树/文本、IPC、Worker 和安全边界正常 |
| Windows x64 NSIS | 构建通过；最终工件已包含大批格式化身份修复 |
| 真实树模型规模探针 | 通过；50,001 节点仅挂载 11 行；100,001 节点按上限降级 |

证据：`docs/phase4-verification.json`、`docs/phase4-source-e2e.json`、`docs/phase4-e2e.json`、`docs/phase4-development-smoke.json`、`docs/phase4-performance.json`。截图：`test-results/phase4-editor.png`（忽略跟踪，后续测试可能更新）。

### 30.5 规模与资源记录

执行 `pnpm test:tree-performance`，使用真实生产资源、Monaco 粘贴、Worker、树投影与 Arborist，未写入系统剪贴板。设备仍为 Windows x64 / i5-9400F / 6 逻辑处理器 / 约 16 GiB RAM。每种平坦数组单次测量：

| 总节点数 | 粘贴至树可用 ms | 单节点修改至树更新 ms | 挂载行数 | 进程工作集之和 MiB | Private Bytes 之和 MiB |
| --- | --- | --- | --- | --- | --- |
| 1,001 | 427.5 | 93.3 | 11 | 438.2 | 289.6 |
| 10,001 | 448.6 | 213.8 | 11 | 520.8 | 371.7 |
| 50,001 | 930.4 | 372.0 | 11 | 712.6 | 569.9 |

100,001 节点安全降级通过。计时包含粘贴、300ms debounce、后台往返、完整模型/索引更新、事务核对、React 和自动化。内存包含 GPU/自动化且共享工作集可能重复计算；身份缓存与事务核对有额外内存成本。与 Phase3 都是单次样本，不能据此推断统计意义上的性能提升或退化，也不能替代深层混合结构、多次测量或长期泄漏回归。

当前仍完整重建模型/索引，变更映射还受记录数影响；没有宣称完成增量解析或通用 10万/30万节点即时编辑。Phase5 继续处理这些性能问题，现有安全上限保持不变。

### 30.6 工件与后续入口

安装包：`release/JSONEditor-0.4.0-x64-setup.exe`，123,532,606 字节（约 117.8 MiB）。SHA-256：`fb087aa25a12a3db08d04af523020226d68d4da2aa58a0857179a8548f7deb2c`。

`release/win-unpacked/JSONEditor.exe` 为最新 0.4.0；0.1.0/0.2.0/0.3.0 安装包和历史验证报告保留。当前使用默认图标、未签名；未运行安装/升级/卸载或发布，未验证 Linux 和真实物理中文输入法。没有改动全局环境、提交或推送 Git。

Phase4 到此完成。下一阶段 Phase5 为拖拽、节点移动、排序及大型 JSON 性能优化，继续复用同一内容权威与事务通道。本轮未开始 Phase5。文件打开/保存、系统剪贴板 API 仍待 Phase6，当前窗口内容关闭后不会持久化。

## 31. Phase5 执行进度

开始/完成日期：2026-10-25（Asia/Shanghai）。状态：已完成，版本 0.5.0；未自动进入 Phase6。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| 基线与目标复查 | 已完成 | 保留现有改动、历史工件和报告，继续使用单一内容权威 |
| 移动与排序命令 | 已实现、核心通过 | 同级/跨容器移动、属性名冲突与防循环、稳定身份及源码字面量 |
| 拖拽和可访问操作 | 已实现、交互通过 | 单节点 HTML5 拖拽、移动表单、上移/下移和排序 |
| 大模型路径优化 | 已实现、差分验证通过 | 复用索引、标量范围投影更新、紧凑 Worker 响应、稳定拓扑和挂载行订阅；结构变更仍严格全量校验 |
| 验证与交付 | 已完成 | 173 项单元/组件、源码与打包 exe 各 21 项交互、开发 smoke；100,000 节点编辑/排序/撤销与 100,001 降级通过；NSIS 已生成 |

### 31.1 移动、拖拽与排序约定

`src/core/commands/structural-commands.ts` 实现 move/sort 命令。位置为目标容器在移除源节点后的 0 起始最终位置；同级拖拽适配器将 Arborist 的插入槽位换算为该约定。只移动单节点；根不能移动，目标必须是 Object/Array，不能进入自身或后代，Object 属性名冲突直接拒绝，不覆盖或自动改名。

Object 到 Array 会去掉属性名、保留值；Array 到 Object 必须通过表单显式填写属性名（空字符串是合法名称）。Object 到 Object 默认保留属性名，也可通过表单改名。移动和排序返回有序 ID 序列，经下一 revision 及精确源码核对后复用，移动子树的后代身份随之保留。统一 Monaco 事务提供单步撤销/重做，旧版本和重复 key 状态不能提交结构操作。

UI 提供拖拽手柄、上移/下移、目标 JSON Pointer / 位置 / 属性名表单及升降序按钮。JSON Pointer 空字符串表示根，使用 ~0/~1 转义；不为大文档创建包含全树节点的巨型下拉框。拖拽 Array 元素进入 Object 缺少名称时禁用落点，改用表单。表单和按钮是拖拽的键盘操作替代。

Object 按直接子属性名的 UTF-16 ordinal 顺序排序，不递归排序子树。Array 仅自动排序同一标量类型，字符串按解码后 UTF-16 ordinal 比较，boolean 为 false 在前，null 保持稳定顺序；混合类型或容器元素要求手动移动。数字按十进制符号、有效位和任意精度指数比较，不转为 JS Number；相等值（包括 -0/0、1/1.00）保持原顺序。单个数字排序原文超过 65,536 字符或指数部分超过 1,024 字符时拒绝自动比较，允许手动移动。

结构操作重写最小共同祖先容器的值范围，以原始成员/值源码切片重组。受影响容器使用两空格换行布局，未改动的数字字面量、字符串转义、属性名拼写和子树源码保留；不通过原生 Object 往返全文。提交前严格校验尺寸/深度/语法；不合法或超限时不返回可提交 edits。空容器或已在目标顺序的命令是 no-op，不新增历史事务。

### 31.2 大模型路径优化与边界

`indexTree` 按不可变投影使用 WeakMap 缓存，避免同一版本被命令、路径和 UI 多次建立 ID 索引。源码范围编辑抽取到独立 document/source-edits 模块，保持排序后线性片段拼接。

新增 `scalar-patch.ts`：仅当当前缓存源码/版本完全一致、树无重复 key、目标旧值和新值均为标量且不改属性名时启用快速路径。新标量仍严格校验；替换保持结构、深度与属性名不变，并检查文档字符上限。Worker 更新节点范围/预览而不再次完整解析文档，等长替换复用其他节点对象。下一次 validate 必须精确命中预期源码和 revision 才使用准备好的投影。

真实 Worker 只传递带基准版本、目标 ID 与源码 edit 的紧凑标量 patch，不传整份节点表；接收方再次核对版本、范围与当前源码后更新派生投影。失配立即暂停后台并保留实际文本。领域核心仍可返回完整投影供差分测试和历史使用。任意文本输入、key/容器/结构修改、撤销和未命中的准备结果继续走原有严格解析路径。

`presentation-store.ts` 将最小树拓扑（ID、parentId、children）与源码范围/值记录分离。标量 patch 共享不可序列化的弱拓扑标识，Arborist 的 data、childrenAccessor、回调与初始展开输入保持稳定；仅已挂载行通过 useSyncExternalStore 订阅节点记录和可编辑状态。在拓扑、尺寸与选择不变时，值或校验状态变化不再触发 Arborist 全树重建；节点值、类型和范围不会从旧拓扑读取。模型索引仍线性更新，结构变化、展开/折叠和选择可能重建 Arborist 索引。

Arborist 会在创建 NodeApi 时缓存 isDraggable，因此静态拓扑资格仅排除根；动态只读期间移除拖拽手柄，并由实时 drop 检查及会话版本门禁独立拦截。不能把一次校验中暂时禁用的标志缓存为该拓扑永久不可拖拽。保留拓扑复用前的测量报告 `docs/phase5-performance-before-row-subscriptions.json`，以便核对优化效果和范围。

这是受限的标量投影及展示优化，不是通用增量解析。范围平移和 ID 索引仍可能是 O(n)，长度变化可导致后续范围对象重建；结构移动/排序仍需完整校验与树重建。保留 100,000 节点、20 Mi UTF-16 分析、512 层、15 秒后台时限等既有保护，不宣称无限规模或固定延迟。

### 31.3 验证进展与已发现问题

13 个文件、173 项单元/组件测试已通过。新增测试覆盖同级/跨容器移动、祖先/后代与深度保护、命名冲突、空/转义属性名、大整数/指数/负零稳定排序、混合数组拒绝、历史身份、紧凑 patch 失配、节点订阅/拓扑稳定和移动表单只读保护。标量范围投影与独立全量 visitor 构建逐字段比较，覆盖嵌套容器、UTF-16 字符、长度变化、六种类型中的四种标量，以及快速路径不执行全文 analyze 的调用验证。

新增 5 项 Electron 交互已通过：按钮移动/排序/共同撤销、跨容器表单/冲突、HTML5 拖拽重排及跨容器落点、精确数字排序及非法文本只读；源码与打包 exe 各 21 项回归均通过。原生鼠标拖拽在 Windows 自动化中进入系统拖拽循环，CDP 驱动未完成；最终测试使用 DataTransfer + 标准 DOM HTML5 DragEvent，通过真实 React DnD/Arborist/Worker/Monaco 路径验收，不伪造 onMove 或核心成功。该证据不等同物理鼠标手工拖拽验收；物理拖拽与中文输入法仍需后续人工回归。

| 最终检查 | 结果 |
| --- | --- |
| Lint / Prettier / TypeScript strict | 通过 |
| Vitest / Testing Library | 13 文件、173/173 通过 |
| 生产资源 Electron E2E | 21/21，0 skipped/unexpected/flaky |
| 打包 exe E2E | 21/21，0 skipped/unexpected/flaky |
| 开发模式 smoke | 通过；0.5.0、树/文本、Worker、IPC 和安全边界正常 |
| Windows x64 NSIS | 构建通过，包含最终拓扑/节点订阅优化 |
| 规模保护与结构事务 | 100,000 节点标量编辑、排序、撤销通过；100,001 节点安全降级 |

证据：`docs/phase5-verification.json`、`docs/phase5-source-e2e.json`、`docs/phase5-e2e.json`、`docs/phase5-development-smoke.json`、`docs/phase5-performance.json`。最终窗口截图：`test-results/phase5-editor.png`（忽略跟踪，后续测试可能更新）。

### 31.4 规模、时延与资源

命令 `pnpm test:tree-performance`；Windows x64 10.0.26200、i5-9400F、6 逻辑处理器、约 16 GiB RAM。每种合成平坦数组粘贴一次、顺序执行三次标量修改；首次改变源码长度，后两次等长替换。记录端到端时间，包含 Playwright、React、Monaco、后台往返、范围/ID 索引更新；粘贴还包含自动校验 debounce。

| 总节点数 | 粘贴至树可用 ms | 三次标量修改 ms | 修改中位 ms | 挂载行数 | 工作集之和 MiB | Private Bytes 之和 MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1,001 | 426.1 | 74.0 / 85.0 / 63.8 | 74.0 | 11 | 449.5 | 303.1 |
| 10,001 | 893.2 | 117.7 / 122.3 / 107.9 | 117.7 | 11 | 516.3 | 372.0 |
| 50,001 | 922.9 | 167.6 / 107.6 / 114.6 | 114.6 | 11 | 696.7 | 557.6 |
| 100,000 | 964.8 | 178.3 / 184.9 / 166.3 | 178.3 | 11 | 944.9 | 806.4 |

100,000 节点降序数字排序约 924.9ms，单步撤销约 977.7ms，校对排序后和撤销后元素值通过；100,001 节点降级通过，原文仍为有效 JSON。

同一阶段、同机、相同数据脚本的节点订阅优化前报告保留为 `phase5-performance-before-row-subscriptions.json`：50,001/100,000 节点修改中位为 242.0/317.2ms。本次最终为 114.6/178.3ms；100,000 节点工作集合计约从 1.2 GiB 降至 945 MiB。该对照未随机化运行顺序，未固定 GC 或后台负载，每种仅三次连续修改；例如另一次相同代码实测 100,000 节点中位为 131.6ms，显示存在明显波动。只作为本机优化证据，不宣称统计显著的通用性能比例或固定时延。

内存为 Electron 各进程快照合计，含 GPU/自动化，共享工作集可能重复计数；不是空闲基线、峰值上限或长期无泄漏证明。深层/混合数据的规模性能、多轮长时编辑、全量文本重排和跨平台仍需后续回归。达到节点/字符上限不代表任意形态都具有同样交互能力。

### 31.5 工件与下一阶段

安装包：`release/JSONEditor-0.5.0-x64-setup.exe`，123,537,544 字节（约 117.8 MiB）。SHA-256：`a5462bd88d03cd724ac56864853a4adf20836abfcca3dfbd910312dbb2345916`。

`release/win-unpacked/JSONEditor.exe` 为最新 0.5.0；保留 0.1.0 至 0.4.0 安装包及历史报告。使用默认图标、未签名；未执行安装/升级/卸载、发布或 Linux 验收。物理鼠标拖拽、物理中文输入法和长期内存测试未执行。没有提交、推送 Git 或修改全局环境。

Phase5 到此完成。下一阶段 Phase6 为文件打开/保存、编码/写入错误处理、系统剪贴板、快捷键及最近文件等桌面能力，继续使用有限 IPC、单一内容权威和事务版本保护。本轮未进入 Phase6；当前内容仅在窗口临时模型中，关闭不会持久化。

## 32. Phase6 执行进度

开始/完成日期：2026-10-25（Asia/Shanghai）。状态：已完成，版本 0.6.0；未自动进入 Phase7。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| 基线与边界 | 已完成 | 保留既有改动与工件；单文档、当前文本为权威 |
| 文件服务 | 已实现，磁盘测试通过 | UTF-8/BOM、LF/CRLF、尺寸保护、能力令牌、磁盘冲突和临时文件替换 |
| 文档生命周期 | 已实现，窗口验证通过 | 新建/打开/保存/另存为、历史脏状态、未保存确认、版本竞争与关闭输入锁定 |
| 剪贴板/快捷键/最近文件 | 已实现，窗口验证通过 | 有限 IPC、Worker 转换复制、可撤销整篇粘贴、持久化最近文件及键盘回退 |
| 验证与交付 | 已完成 | 215 项单元/组件、源码与打包 exe 各 28 项交互、开发 smoke 和规模回归通过；NSIS 已生成 |

### 32.1 文件能力与无损边界

Renderer 不接收任意文件系统函数。Main 接受打开对话框选择或应用内最近文件 ID，解析真实路径并返回绑定窗口的随机 fileId；保存只使用该授权或原生另存为对话框选择的位置。多余字段、路径冒充 fileId、未知/其他窗口授权、非主框架请求均拒绝。新文档或成功切换文件后释放旧授权，窗口关闭释放该窗口授权。

`file-service.ts` 每块最多读取 64 KiB、累计最多读取 64 MiB 普通文件，读取后解码上限为 20 Mi UTF-16 字符。首期支持 UTF-8 和一个 UTF-8 BOM，LF 或 CRLF 必须一致；非法 UTF-8、UTF-16、混合换行、单独 CR、重复 BOM 明确报错，不覆盖当前模型。保存拒绝未配对 UTF-16 代理字符和额外前导 BOM，避免隐式替换字符或 Monaco 隐藏 BOM。UTF-8 BOM 与加载的 LF/CRLF 风格保留；新文档默认为 UTF-8 无 BOM、LF。不自动格式化或 JSON.parse/stringify 保存，非法 JSON 也可按当前源码写入。

保存使用同目录随机临时文件、独占创建、写入/fsync/关闭、目标校对后 rename；失败时仅尝试清理本次成功创建的临时文件，不先截断目标；临时文件使用固定长度随机名称，避免长文件名导致临时名称超限。对已有授权记录字节 SHA-256，提交前及 rename 前再次比较磁盘内容，检测修改或删除后拒绝覆盖。另存为可选择另一位置保留两份，选择原文件仍执行冲突检查；符号链接写入被拒绝。该保护不等同跨进程文件锁：外部写入恰好发生在最后检查与 rename 之间仍存在竞争；未做断电/强制终止的持久化故障注入，不承诺完全的崩溃一致性。

### 32.2 文档状态、保存竞争和关闭

`DesktopDocumentSession` 仅持有文件元数据、脏状态、I/O 状态和最近文件，不把全文放入 React state。Monaco 仍持有当前内容；文件读入时只暂存待加载文本引用，创建新模型/会话后清除。每次打开/新建使用新 documentId、模型、撤销历史与 Worker；旧后台响应随旧会话释放，不能写入新文档。

脏状态基于 Monaco 历史版本与最后已保存版本比较，撤销回已保存版本时恢复干净。保存捕获操作开始时的文本/历史版本；保存期间的新编辑保持脏状态，不被错误标记为已保存。打开、丢弃确认和剪贴板读取均校对 generation/revision/historyVersion；等待期间发生新编辑则取消替换、保留当前文本，并释放未使用的文件能力。

新建、打开和关闭遇到未保存修改时显示保存/不保存/取消；保存取消、失败或保存后仍有新修改，都不会丢弃当前内容。Main 关闭事件先阻止窗口销毁，发送一次性请求 ID；Renderer 做完决策、同步锁定编辑输入后才允许关闭，Main 独立核对窗口和 nonce。繁忙操作期间拒绝关闭，失败回复不会获得关闭授权。没有自动保存或崩溃恢复功能。

### 32.3 剪贴板、菜单、快捷键和最近文件

系统剪贴板由 Main 的 Electron 45 异步 readText/writeText 操作，Renderer 的普通剪贴板权限仍未开放。复制原文使用当前模型；格式化/压缩复制由现有 Worker 进行严格校验和源码 token/范围转换，不改模型或撤销历史。数字字面量、重复 key、成员顺序、字符串空格与转义保留。非法 JSON 的转换复制取消且不写剪贴板，可改用原文复制；等待期间输入或后台失败会取消转换。整篇剪贴板替换是一次可撤销编辑，保持当前文档绑定和换行风格。文本/转换输出均限制 20 Mi UTF-16 字符；原生剪贴板无预取大小 API，读取后检查上限。

应用内最近文件最多 10 条，以 UUID 选择、按路径去重，写入 userData/recent-files.json；记录损坏时按空历史恢复，不影响文档。历史写入失败只给成功附带警告，不能把成功的文件保存误报为未保存。支持标准绝对路径 `--user-data-dir` 配置目录选项；E2E 使用项目 test-results 内隔离目录，不改真实用户最近文件。没有新增任意路径读取 IPC 或自动扫描文件夹。

| 操作 | Windows/Linux 快捷键（macOS 用 Cmd 代替 Ctrl） |
| --- | --- |
| 新建 / 打开 | Ctrl+N / Ctrl+O |
| 保存 / 另存为 | Ctrl+S / Ctrl+Shift+S |
| 复制原文 / 格式化 / 压缩 | Ctrl+Shift+C / Ctrl+Alt+C / Ctrl+Alt+M |
| 剪贴板替换全文 | Ctrl+Alt+V |
| 编辑器撤销 / 重做 / 格式化 | 现有 Ctrl+Z、Ctrl+Y（或平台重做键）、Ctrl+Shift+F |

文件/全文操作有 Main 菜单加速器和同一映射的 DOM 键盘回退；原生 before-input-event 处理时阻止重复投递，回退覆盖 CDP 等仅向页面派发按键的场景。普通 Ctrl+C/V/A/Z 不被文件快捷键拦截，编辑菜单提供选区剪切/复制/粘贴及文档撤销/重做操作。IME 组合和重复按键不触发桌面快捷操作。

### 32.4 验证进展与环境处理

已有树、文本、同步的 21 项 Electron 回归通过；新增 7 项桌面窗口测试通过，覆盖 BOM/CRLF 与大整数字节校对、Ctrl+S/脏状态、非法 JSON 原文保存、最近文件重启恢复、解码错误和取消保留原文、外部冲突/另存为、剪贴板转换/撤销、原生关闭取消/保存路径和 IPC 越权参数。

文件测试调用真实磁盘服务和 IPC，原生对话框的返回值在测试中替换，未自动点击操作系统对话框。剪贴板原生端口在 E2E 中替换为隔离字符串存储，完整通过 Preload/IPC/Worker/Monaco 路径验证；没有读取、记录或改写现有系统剪贴板内容，因此不把此结果当作系统剪贴板手工验收。测试清理专门允许丢弃测试文档，生产关闭保护保持启用。单元临时目录在删除前校验绝对路径位于 test-results 内。

初次类型检查发现 Electron 45 的剪贴板接口已为异步，按本地 electron.d.ts 适配并等待失败；没有照搬旧同步签名。发现 CDP 键盘事件不触发原生菜单后补齐统一 DOM 回退。关闭成功后不能继续对同一实例测试其他关闭选择，单元场景改为独立会话；已关闭 Electron 进程的清理也作了兼容。

| 最终检查 | 结果 |
| --- | --- |
| Lint / Prettier / TypeScript strict | 通过 |
| Vitest / Testing Library | 18 文件、215/215 通过 |
| 生产资源 Electron E2E | 28/28，0 skipped/unexpected/flaky |
| 打包 exe E2E | 28/28，0 skipped/unexpected/flaky |
| 开发模式 smoke | 通过；0.6.0、Worker ready、sandbox/contextIsolation 开启 |
| Windows x64 NSIS | 构建通过；最终代码已包含在安装包中 |
| 规模保护与结构事务 | 100,000 节点编辑/排序/撤销、100,001 节点安全降级通过 |

证据：`docs/phase6-verification.json`、`docs/phase6-source-e2e.json`、`docs/phase6-e2e.json`、`docs/phase6-development-smoke.json`、`docs/phase6-performance.json`。最终窗口截图为 `test-results/phase6-editor.png`（忽略跟踪）。最终源码检查、构建、源码 E2E、打包 E2E 和开发 smoke 均在应用代码冻结后完成。

### 32.5 规模与资源回归

同机 Windows x64 10.0.26200、i5-9400F、6 逻辑处理器、约 16 GiB RAM；每种平坦数组粘贴一次、连续修改三次标量，第一次改变源码长度，后两次等长。Renderer/Worker 与最终版本一致；后续 Main 的临时文件清理/命名及换行扫描调整不在本规模脚本路径中。

| 总节点数 | 粘贴至树可用 ms | 三次标量修改 ms | 修改中位 ms | 挂载行数 | 工作集之和 MiB | Private Bytes 之和 MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1,001 | 458.7 | 116.0 / 106.9 / 107.0 | 107.0 | 10 | 441.7 | 323.4 |
| 10,001 | 941.8 | 136.8 / 96.7 / 170.4 | 136.8 | 10 | 520.4 | 404.7 |
| 50,001 | 953.9 | 137.6 / 151.7 / 132.8 | 137.6 | 10 | 698.6 | 588.7 |
| 100,000 | 1097.2 | 156.6 / 270.8 / 194.5 | 194.5 | 10 | 1007.6 | 901.3 |

100,000 节点排序约 1005.2ms，撤销约 1031.0ms；100,001 节点安全降级。文件工具栏占用额外高度，当前视口挂载 10 行。计时包含自动化、后台往返和渲染，粘贴还包含 debounce；内存包含 GPU/自动化且共享工作集可能重复计数。这是少量合成样本，不承诺固定时延、内存上限或长期无泄漏，也不替代 20 Mi 字符文件 I/O、复杂嵌套、物理输入法及跨平台验收。

### 32.6 工件与后续入口

安装包：`release/JSONEditor-0.6.0-x64-setup.exe`，123,542,624 字节（约 117.8 MiB）。SHA-256：`9efe26c292a1b939ec87217615e8f2abbb7d8580232ea9919d9a83e6663e36e2`。

`release/win-unpacked/JSONEditor.exe` 为最新 0.6.0；保留 0.1.0 至 0.5.0 安装包及历史报告。当前使用默认图标、未签名；未运行安装/升级/卸载或发布，未执行 Linux、原生剪贴板/文件对话框手工验收、物理鼠标拖拽/中文输入法及长期内存测试。没有修改全局环境、提交或推送 Git。

Phase6 到此完成，未进入 Phase7。保存成功的文件已写入磁盘；未保存内容仍需用户保存，没有自动保存或崩溃恢复。Phase7 继续最终验收与发布准备，不能将本阶段自动化替身覆盖的原生端口视为物理桌面验收已完成。

## 33. Phase7 执行进度

开始/本机验证完成日期：2026-10-25（Asia/Shanghai）。候选版本：0.7.0。状态：Windows 与发布流程已完成；Phase7 总体仍待 Linux 原生构建/验收及公开发布门槛，尚未对外发布。

| 步骤 | 状态 | 记录 |
| --- | --- | --- |
| 范围与环境检查 | 已完成 | 自动化、Windows 安装/升级/卸载、Linux 构建、性能及发布流程；WSL/Linux 不可用 |
| 自动化补充 | 本机通过 | 215 项单元/组件、源码与安装后 exe 各 30 项 E2E；全部 E2E 使用独立 profile |
| Windows 交付 | 本机通过 | 隔离目录真实安装、0.6.0 升级、注册/快捷方式/配置保留及卸载清理 |
| Linux CI | 已编写，待运行 | Ubuntu 24.04 原生 AppImage/deb 构建及安装回归；缺少 Linux 环境及项目主页 URL |
| 性能与工件 | 本机通过 | 100,000 节点编辑/排序/撤销、100,001 降级；NSIS、blockmap 和 SHA-256 清单已生成 |
| 发布流程 | 已编写 | docs/release.md；只生成候选工件与报告，未签名/发布 |

### 33.1 自动化与安全验收

新增 2 项真实 Electron 发布回归：禁用 HTTP/HTTPS 后刷新、编辑和 Worker 同步正常，sandbox/contextIsolation 开启、Node require 不可用、生产 CSP 无 unsafe-eval、地理位置权限被拒绝；JSON 中的 HTML 保持文本显示，穿越/反斜杠资源和 POST 请求均返回 403。旧 E2E 启动入口也改为每个场景独立 userData，不再依赖真实用户最近文件。

| 最终检查 | 结果 |
| --- | --- |
| Lint / Prettier / TypeScript strict | 通过 |
| 单元/组件 | 18 文件、215/215 通过 |
| 生产资源 Electron E2E | 30/30，0 skipped/unexpected/flaky |
| 实际安装的 0.7.0 exe E2E | 30/30，0 skipped/unexpected/flaky |
| Windows 安装链路 | 0.6.0 安装、0.7.0 升级、离线保存、注册/快捷方式、显式 profile 保留及卸载清理通过 |
| 开发模式 smoke | 0.7.0、Worker ready、sandbox/contextIsolation 开启 |
| 打包内容 | ASAR 107 条目、版本 0.7.0，未包含 src/tests/tools/docs/.github/.git 目录 |
| CI 静态检查 | YAML 可解析、两平台 runner、官方 Action 提交固定、contents:read；未在远程执行 |

首轮源码回归发现初始导航完成前刷新导致 ERR_ABORTED，补齐等待后专项与最终完整回归通过。一次构建与源码 E2E 重叠时树场景超时，随后冻结资源、顺序执行的完整回归通过；不把失败运行计入最终通过证据。

### 33.2 Windows 安装与卸载发现

`Test-WindowsInstaller.ps1` 先检查已存在的同应用注册项和快捷方式，存在则退出；测试目录限定在本项目 `release/installer-validation/`，不覆盖现有安装。提供旧安装包时真实安装 0.6.0，再升级到 0.7.0；每版实际程序均离线启动、确认安全边界，并通过有限 IPC 把当前源码保存到磁盘核对字节。快捷方式目标、注册版本/安装位置及显式 profile 标记均校对。

卸载最初四次在验收宿主仍存活时留下主 exe，而注册项和快捷方式已经移除；观察到文件占用，宿主结束后残留消失或可清理。单纯等待文件可独占读取、释放 COM 或隔离快捷方式检查不足以解决。最终将完整验收放入子进程，待该进程退出后由控制进程调用 `Complete-WindowsInstaller.ps1`，实测卸载成功，主 exe、注册项和快捷方式均不存在，profile 标记保留。该结果支持验收宿主资源生命周期造成干扰的判断，不声称已经确定某个第三方进程或覆盖所有 Windows 文件锁竞争。

保留 `phase7-installer-first-attempt.json` 至 `phase7-installer-fourth-attempt.json` 失败证据；本次隔离目录内的已知残留 exe 曾按绝对路径边界校验后清理，未删除用户文件。最终 `phase7-installer.json` 为分进程链路通过报告。安装后完整 E2E 的 30/30 证据来自同一哈希工件的此前运行；最终分进程链路另外复验安装、升级、启动/保存及卸载，没有再次重复整组 E2E。

这是当前用户静默安装检查，未覆盖交互向导/UAC、真实文件对话框点击、原生系统剪贴板、受限账户和重启。最近文件及 profile 测试使用显式隔离目录，不能据此宣称默认用户配置升级的所有历史版本兼容性。

### 33.3 规模与资源回归

Windows x64 10.0.26200、i5-9400F、6 逻辑处理器、约 16 GiB RAM。每种合成平坦数组粘贴一次、连续修改三次标量；第一次改变长度，后两次等长。计时含自动化、后台和渲染，粘贴含 debounce。

| 总节点数 | 粘贴至树可用 ms | 三次标量修改 ms | 修改中位 ms | 挂载行数 | 工作集之和 MiB | Private Bytes 之和 MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1,001 | 543.4 | 100.2 / 86.7 / 93.1 | 93.1 | 10 | 460.0 | 337.6 |
| 10,001 | 979.1 | 199.6 / 184.3 / 119.1 | 184.3 | 10 | 518.4 | 395.9 |
| 50,001 | 1005.1 | 171.2 / 152.1 / 132.0 | 152.1 | 10 | 712.5 | 596.0 |
| 100,000 | 1283.1 | 267.1 / 340.0 / 188.7 | 267.1 | 10 | 1018.9 | 901.7 |

100,000 节点排序约 1064.6ms，撤销约 1180.1ms；100,001 节点安全降级。测量时安装验收已无运行中的编辑器；不是隔离系统负载的基准测试。工作集含 GPU/自动化且共享页可能重复计算，不是峰值/空闲或无泄漏证明；少量样本不保证固定延迟，也不替代深层混合数据、20 Mi 字符文件 I/O 或长期编辑测试。

### 33.4 Linux、CI 与发布门槛

`.github/workflows/verify.yml` 已准备 Windows 2025 / Ubuntu 24.04 原生任务，固定 Node 24.16.0、pnpm 12.15.0、官方 Action 提交和 frozen-lockfile；执行检查、开发/生产/安装后测试、规模探针、NSIS 或 AppImage/deb、卸载及 SHA-256 清单，失败也保存本次生成的证据，保留 14 天。先清除 checkout 中历史 Phase7 JSON 报告，避免上传旧成功记录。

Linux 使用 Xvfb；只在一次性 runner 放开 AppArmor 对非特权用户命名空间的限制，继续保留 Chromium sandbox，不使用 --no-sandbox。AppImage 解包后的负载 smoke 不替代 FUSE 挂载或真实 X11/Wayland 桌面验收。工作流尚未远程运行，仓库没有 remote，未推送或触发任务。

本机没有可用 WSL/Linux 或 Docker。锁定的 electron-builder 26.18.0 deb 实现还要求真实项目主页，当前 package.json 与 git remote 均未提供；已向用户请求 URL。`build-linux.mjs` 明确要求 JSONEDITOR_PROJECT_URL（或 package.json homepage）为无凭据的 HTTPS URL，并只在 Linux 执行；缺失元数据会报错，不虚构主页。GitHub 仓库需配置同名 Actions Variable。尚未生成或验证 Linux 工件。

发布流程见 `docs/release.md`。项目当前 UNLICENSED、默认图标、未签名；完整许可/运行时声明、签名身份、物理鼠标/中文输入法、系统剪贴板/对话框、交互安装及 Linux 桌面仍待维护者验收。本轮只准备内部候选包，不把它标为正式发布就绪；没有上传、创建 Release/tag、提交或推送 Git。

### 33.5 工件与继续入口

Windows 安装包：`release/JSONEditor-0.7.0-x64-setup.exe`，123,542,892 字节（约 117.8 MiB）。SHA-256：`10684d8c29d02ef1e88afb5d629787e9cd063e9f7011f5d6afabd969c84b1311`。

生成 `release/manifest-win32.json` 与 `release/SHA256SUMS-win32.txt`，包含当前版本安装包和 blockmap；工具对当前版本必需文件缺失直接失败，不把历史安装包混入清单。`release/win-unpacked/JSONEditor.exe` 为 0.7.0，旧安装包保留。

综合证据为 `docs/phase7-verification.json`，另有 source-e2e、installed-e2e、installer、performance、development-smoke、package-audit 报告。下一步需要真实项目主页 URL 和 Linux runner/桌面环境，执行工作流与 Linux 验收，再处理许可、签名和人工发布门槛。Phase7 总体尚未全部完成，不自动进入其他阶段或对外发布。
