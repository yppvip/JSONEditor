# JSONEditor 开发指南

更新日期：2026-10-25（Asia/Shanghai）。本文件是后续人工和 AI 开发的共同依据。发生工具链、数据模型、同步协议或发布方式调整时，同步更新本文件及架构决策记录。

## 1. 项目概述

开发支持 Windows/Linux 的桌面 JSON Editor，未来扩展 macOS。核心能力为 JSON 文本编辑、树形编辑、可靠双向同步、节点结构操作、大文件处理，以及文件和剪贴板能力。

Phase0、Phase1 和 Phase2 已完成（2026-10-25）。当前版本 0.2.0，已提供正式 Monaco JSON 文本编辑、严格后台校验、无损数字字面量格式化、错误定位及格式化撤销/重做。尚未进入 Tree 或 Tree/Text 双向同步阶段。

项目根目录已确认：`D:\4Code\JSONEditor`。检查时目录仅有 `.git`；已有 Git 仓库，不再次执行 `git init`，不擅自提交或推送。

## 2. 技术栈

| 层次 | 已确定方向 | 版本策略 |
| --- | --- | --- |
| Desktop | Electron 45.0.0 | 已锁定并验证 Windows 运行时 |
| Frontend / Language | React 19.3.1 / TypeScript 6.0.3 strict | 已锁定并通过检查 |
| UI | Ant Design | 后续业务阶段安装，当前只有初始化提示页 |
| Tree | React Arborist 4.0.1，自定义 JSON 行方向 | 仅 devDependency 性能原型，尚无业务 Tree |
| Text | Monaco Editor 0.57.0，封装官方 API | Phase2 已正式集成，ESM 代码/字体/Worker 本地打包 |
| State | Zustand 方向 + 独立文档核心 | Phase2 TextDocumentSession 已实现；React 仅管理 UI 元数据，后续再引入 Zustand |
| JSON Engine | TypeScript Worker + jsonc-parser 3.3.1 | 已实现严格校验与源码 edits 格式化，尚未生成业务 Tree Model |
| DnD / Virtualization | Arborist + React DnD 16.0.1 / HTML5 Backend 16.0.1 | 组件兼容和虚拟化原型通过，业务拖拽未实现 |
| Build | electron-vite 6.0.0 / Vite 8.3.5 | 本地依赖，生产构建已通过 |
| Package | electron-builder 26.18.0 | Windows NSIS 已构建；Linux 配置待目标系统验证 |
| Test | Vitest 5.0.5、Testing Library 16.3.3、Playwright 1.64.1 | 56 项单元/组件测试、4 项交互 E2E 已通过；fast-check 留待业务阶段 |

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

Phase2 的文本由 Monaco ITextModel 持有，TextDocumentSession 通过 DocumentBuffer 接口读写，不把全文逐键复制到 React state。当前只发布校验结果；下图中的 Tree 投影为 Phase3/4 目标，尚未实现。

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

CI 计划在 Phase7 使用 Windows/Linux 各自 runner，本轮尚未建立 CI workflow。届时锁定 Node、pnpm、依赖和构建环境；检查通过后构建并保存工件，签名凭据通过安全存储注入。当前已在本机验证 Windows 工件，不宣称 Linux 已通过。

## 20. Windows 发布策略

首期 Windows x64、NSIS exe。portable 按需增加；不为同时生成 MSI 增加首期维护成本。Phase1 已验证 Windows 构建和解包 exe 启动，Phase7 补齐安装/升级/卸载、离线启动、签名和快捷方式检查。

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
