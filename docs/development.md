# JSONEditor 开发指南

更新日期：2026-10-25（Asia/Shanghai）。本文件是后续人工和 AI 开发的共同依据。发生工具链、数据模型、同步协议或发布方式调整时，同步更新本文件及架构决策记录。

## 1. 项目概述

开发支持 Windows/Linux 的桌面 JSON Editor，未来扩展 macOS。核心能力为 JSON 文本编辑、树形编辑、可靠双向同步、节点结构操作、大文件处理，以及文件和剪贴板能力。

当前处于 Phase0：开发环境准备。只准备环境、验证工具、记录规范；本轮没有创建 Electron 应用、安装项目业务依赖、设计 UI 或实现编辑器。进入 Phase1 必须等待用户确认。

项目根目录已确认：`D:\4Code\JSONEditor`。检查时目录仅有 `.git`；已有 Git 仓库，不再次执行 `git init`，不擅自提交或推送。

## 2. 技术栈

| 层次 | 已确定方向 | 版本策略 |
| --- | --- | --- |
| Desktop | Electron | Phase1 选择仍受支持的稳定版本，锁定精确版本 |
| Frontend / Language | React / TypeScript strict | Phase1 验证组件兼容后锁定 |
| UI | Ant Design | 用于外围控件，不代替 JSON 编辑逻辑 |
| Tree | React Arborist 受控模式、自定义 JSON 行 | Phase1 原型验证大规模数据与 React 版本兼容 |
| Text | Monaco Editor，封装官方 API | 本地打包编辑器与 Worker，不依赖 CDN |
| State | Zustand + 独立文档核心 | 会话元数据和 UI 状态进入 store，编辑器文本不逐键复制进 React |
| JSON Engine | TypeScript Worker + jsonc-parser | 严格 JSON 配置，保留源码范围和数字字面量 |
| DnD / Virtualization | Arborist + React DnD / HTML5 Backend / 内置虚拟化 | 不重复叠加拖拽库或虚拟列表 |
| Build | electron-vite / Vite | 本地项目依赖，不全局安装 |
| Package | electron-builder | Windows NSIS exe；Linux AppImage、deb，后续 rpm |
| Test | Vitest、Testing Library、fast-check、Playwright Electron | Phase1 配置基础工具，后续按阶段增加测试 |

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

Node 24 当前属于 LTS。24.16.0 是已安装、已验证的本机基线，不宣称它是最新补丁版本。没有为了本项目替换用户全局 Node/npm；Phase1 锁定团队基线时重新检查 Node 24 官方补丁，升级后重新验证，再统一声明文件。不要自动升级到 Current 大版本。

暂不新增 Node 版本管理器：当前只有一个明确的有效系统 Node，避免引入版本管理器与现有安装路径竞争。团队出现多 Node 项目后，再单独选择和验证版本管理方案，不并行叠加多个管理器。

TypeScript/JavaScript 支持和调试由 VS Code 内置能力提供。ESLint/Prettier 扩展已安装，但项目 lint/format 依赖和规则将在 Phase1 建立，扩展安装不代表项目配置已经完成。可选扩展为 GitLens、测试查看器；当前没有安装它们。

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

Setup 默认复用现有 Node 24，仅在指定版本 pnpm 缺失时安装。若同路径出现异常版本，拒绝覆盖。它不安装 VS Code 扩展；新机器已有 VS Code 时，可按需执行下面两条命令，本机已执行完成：

```powershell
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
```

测试脚本重新组合持久化的系统/用户 PATH，排除代理进程注入的工具路径；在 SoftEnv 临时目录验证网络、普通依赖安装执行及锁文件离线复现，保存日期报告。重跑会更新当天报告并保留临时验证目录；脚本不自动删除目录。

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
docs/
  development.md
  environment-check-2026-10-25.json
  environment-check-initial-failure.json
tools/
  Setup-WindowsEnvironment.ps1
  Enter-DevEnvironment.ps1
  Test-DevelopmentEnvironment.ps1
```

以下是后续目录建议，当前未创建业务骨架：

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
| Phase0 环境准备 | 工具、目录、验证、本文档 | 当前完成，停止等待用户确认 |
| Phase1 初始化 | Electron/React/TS 骨架、lint/format/test、安全 IPC、Windows 构建 | 开发启动和打包资源可加载；精确版本已记录 |
| Phase2 Text | Monaco、严格解析、格式化、错误位置 | 非法输入保留，核心解析可测试 |
| Phase3 Tree | 六种类型、增删改、展开折叠 | 虚拟化从此阶段采用，稳定 ID 和模型协议已建立 |
| Phase4 同步引擎 | 双向事务、版本冲突、非法中间态、统一历史 | 无循环覆盖，旧结果不能覆盖新文本 |
| Phase5 高级 Tree | 拖拽、移动、排序、大文件优化 | 校验移动规则，完成规模与资源基准 |
| Phase6 桌面能力 | 文件、剪贴板、快捷键、最近文件 | IPC 有限且校验充分，错误不丢文本 |
| Phase7 测试发布 | Windows/Linux 安装、回归与性能、发布流程 | 目标系统实际运行与安装验收 |

## 13. 各阶段目标

Phase1 就定义文档/revision/IPC 接口，并以临时性能样本验证 Tree 索引与 Monaco/Worker 成本；Phase2 开始实现文档核心，Phase4 完成协调。不能到 Phase4 才临时创建第二份数据源。

虚拟化是 Phase3 的基础，不等到 Phase5 再改造普通递归树；Phase5 优化索引、可见行和大文件模式。此处是对阶段执行顺序的细化，保持此前确认的架构。

## 14. 开发执行顺序

### 14.1 Phase0 已执行

检查工具和路径 -> 识别代理内置 pnpm -> 查询官方 registry -> 独立安装 pnpm -> 备份并追加用户 PATH -> 安装两项 VS Code 扩展 -> 使用持久化 PATH 验证 -> 安装执行普通依赖 -> 锁文件离线复现 -> 记录文档。

### 14.2 Phase1 待用户确认后执行

仓库已有 docs/tools，禁止直接把脚手架覆盖到项目根目录，禁止删除目录或重新 git init。先生成到新的 staging 目录，检查内容，再以拒绝覆盖的方式合并。

以下命令是下一阶段计划，本轮没有执行 dlx，也没有运行生成器：

本轮只查询了生成器元数据：`@quick-start/create-electron` 稳定版为 `1.0.31`，CLI 名为 `create-electron`；没有下载或执行生成器。下一阶段重新确认后记录实际使用版本。

```powershell
Set-Location -LiteralPath 'D:\4Code\JSONEditor'
. .\tools\Enter-DevEnvironment.ps1
# 查询、审阅并记录当时的稳定版，随后的 dlx 使用精确版本，避免隐式 latest。
$generatorVersion = (pnpm.cmd view '@quick-start/create-electron' version --registry=https://registry.npmjs.org/).Trim()
if ($LASTEXITCODE -ne 0 -or $generatorVersion -notmatch '^\d+\.\d+\.\d+$') {
    throw 'Cannot resolve a stable generator version.'
}
$staging = Join-Path 'C:\Code\SoftEnv\temp' ('jsoneditor-phase1-' + [Guid]::NewGuid().ToString('N'))
# 执行前将 generatorVersion 记录到本节/ADR，并检查该版本 --help。
pnpm.cmd dlx "@quick-start/create-electron@$generatorVersion" $staging --template react-ts
if ($LASTEXITCODE -ne 0) { throw 'Scaffolding failed; do not merge output.' }
```

生成器可能交互询问更新、镜像或依赖安装：首期不启用自动更新，不预设第三方镜像，不在未经检查的生成内容上直接运行。先审阅 package.json、scripts、配置和实际模板目录。

随后按此顺序完成：

1. 检查 staging 中的源码与 manifest，拒绝把其中 `.git`、node_modules 或现有同名文档覆盖进仓库。
2. 逐个合并尚不存在的文件；有冲突就编辑整合，不使用强制递归覆盖。模板可能使用 `src/renderer/src`，通过配置明确调整到建议边界，不盲目移动。
3. 锁定 Electron、React、TS、electron-vite、打包和测试工具版本；写入 Node 声明和 packageManager。
4. 建立 pnpm-workspace.yaml、锁文件、lint/format/typecheck/unit test、项目级 Git 行尾规则。
5. 依据当时 pnpm 版本配置需要执行构建脚本的依赖，明确允许 Electron 下载脚本及实际需要的构建工具；不全局允许所有依赖脚本。
6. 运行 install、lint、format check、typecheck、unit tests、build，然后验证开发窗口与 Windows 安装包。
7. 验证打包后资源/Worker 的加载、安全 IPC 及退出行为，更新本文件实际版本和结果。

脚本名称和完整运行命令以最终合并的 package.json 为准，不把尚未创建的 `pnpm dev` 或 `pnpm build:win` 描述成当前可执行状态。

## 15. 编码规范

- TypeScript strict，避免跨边界 any；对未知 JSON/IPC 输入使用 unknown 并校验。
- UTF-8、LF、末尾换行；PowerShell/CMD 特殊文件按平台需要单独约定。
- React 组件 PascalCase，变量/函数 camelCase；领域模块不放 UI 状态。
- 错误包含可定位的文档/事务信息，日志不输出整份用户 JSON、文件敏感内容或凭据。
- 大数据计算不可放 React render、输入事件或 Main 同步路径。
- 文本 offset 统一使用编辑器的 UTF-16 单位；文件字节偏移另行转换。
- ESLint 与 Prettier 职责分开，使用兼容配置避免规则互相冲突。规则和脚本在 Phase1 实际落地。

## 16. Git 规范

现有 user.name/user.email 已配置，本轮不改身份。全局 core.autocrlf=true 已存在；Phase1 通过仓库 `.gitattributes` 声明行尾，不修改全局设置。

建议提交前缀 feat/fix/docs/refactor/test/build/chore，提交按可审阅变更组织；提交前查看 diff 和必要检查。不擅自 reset、清理未跟踪文件、覆盖用户修改、提交或推送。

不提交 node_modules、out/dist、安装包、缓存、凭据或真实用户 JSON。当前环境报告只记录工具与测试结果；后续提交前检查是否包含本机路径等不适合公开的信息。

## 17. 依赖管理规范

- pnpm 是唯一项目包管理器；npm 只用于环境引导，不混入 package-lock.json/yarn.lock。
- Phase1 package.json 使用 `packageManager: pnpm@12.15.0`；实际变更版本时同时更新环境脚本、文档、CI 和锁文件。
- Node 当前基线 24.16.0，可使用 engines 范围 `>=24.16.0 <25`，并用 `.node-version` 写入精确团队版本。`.nvmrc` 仅在确实选用对应管理器时提供；声明文件本身不会自动切换运行时。
- 提交 pnpm-lock.yaml，CI 使用 `pnpm install --frozen-lockfile`。依赖版本升级单独审阅并验证。
- pnpm 12 通用设置放 pnpm-workspace.yaml，不沿用旧版将所有选项写入 .npmrc 的做法。`.npmrc` 仅处理受支持的 registry/auth 等兼容项，绝不提交 token。
- saveExact、engineStrict、构建脚本允许列表等在 Phase1 依据所选版本配置；不要照搬其他 pnpm 大版本的键名或命令参数。
- cache/store 的本机绝对路径通过激活会话或本机配置提供，不写死团队跨平台配置。
- 不为安装速度关闭 TLS 验证、添加防病毒排除、切换不明镜像或全局允许安装脚本。

## 18. 测试策略

当前只完成工具链验证，尚未配置/运行应用测试框架。

后续：Vitest 测纯领域逻辑；fast-check 验证随机结构操作、无损字面量与撤销；Testing Library 测节点输入/焦点/诊断；集成测试覆盖 revision 竞争和无效中间态；Playwright Electron 验证实际窗口和编辑流程。

Electron 自动化支持仍需按所选 Playwright/Electron 版本验证；原生文件对话框在自动化中使用明确替身，同时保留真实系统安装与桌面手动验收。性能测试记录文件字节数、节点数、深度、首屏、输入延迟、主线程长任务及全部进程内存。

## 19. 构建策略

electron-vite 分别构建 Main/Preload/Renderer；Worker 和 Monaco 资源随应用本地打包。electron-builder 负责分发。开发 Node 与 Electron 内置 Node 分别看待，不假设版本一致。

CI 使用 Windows/Linux 各自 runner；锁定 Node、pnpm、依赖和构建环境。检查通过后构建并保存工件，签名凭据通过安全存储注入。不得因为开发服务器可用就宣称打包版本可用。

## 20. Windows 发布策略

首期 Windows x64、NSIS exe。portable 按需增加；不为同时生成 MSI 增加首期维护成本。Phase1 验证 Windows 构建，Phase7 补齐安装/升级/卸载、离线启动、签名和快捷方式检查。

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
| Node/npm 补丁 | 复用已满足基础要求的版本，非最新承诺；Phase1 确定并验证统一补丁基线 |
| pnpm 12 变化 | 原生 CLI、配置位置和脚本策略需按当前文档验证；首轮测试发现旧参数不兼容，已修正 |
| 跨卷 store | C 盘 store 与 D 盘项目可能采用复制，Phase1 测安装成本 |
| VS Code 提示 | 扩展安装出现 DEP0169 url.parse 弃用提示，安装成功；未因此修改用户设置或升级整套 IDE |
| 应用验证 | 未下载/启动 Electron，未构建安装包；这属于 Phase1，不能将工具链通过等同应用可运行 |
| Linux | 尚未验证，需独立 runner 和实际桌面验收 |
| Tree 大规模更新 | 虚拟化仅控制渲染，不保证内部索引局部更新；Phase1 做性能原型 |
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
| ADR-008 | 2026-10-25 | 非空仓库先 staging 生成、拒绝覆盖合并，等待用户启动 Phase1 | 待下一阶段执行 |

## 25. Phase0 验证结果与停止条件

通过报告记录 15 项检查：Node/npm/pnpm/Corepack/Git/VS Code CLI、Node 执行、pnpm 精确版本、缓存路径、registry、两项 IDE 扩展、普通依赖安装执行、锁文件离线复现。实际判定以报告的 checks 和 passed 为准。

测试依赖为 `is-number@7.0.0`，安装于 SoftEnv 临时目录并使用 `--ignore-scripts`；没有污染仓库 manifest 或锁文件。离线复现使用另一个目录及同一 store，证明普通依赖锁定安装，不代表 Electron 的下载脚本或二进制已验证。

Phase0 工具链条件已满足，可以在用户确认后进入 Phase1。本轮到此停止，未执行脚手架、项目依赖安装、应用启动或 Windows/Linux 业务构建。

## 26. 官方参考

- [Node.js 版本与 LTS 状态](https://nodejs.org/en/about/previous-releases)
- [pnpm 安装及 Windows 指引](https://pnpm.io/installation)
- [pnpm 12 配置位置](https://pnpm.io/settings)
- [pnpm install / frozen lockfile](https://pnpm.io/cli/install)
- [electron-vite 入门与模板](https://electron-vite.org/guide/)
- [Electron Native Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [Electron 安全约束](https://www.electronjs.org/docs/latest/tutorial/security)
- [electron-builder 跨平台构建](https://www.electron.build/v26/docs/features/multi-platform-build/)

官方链接用于版本/机制依据；本机版本、安装成功与失败的证据以本仓库验证报告为准。
