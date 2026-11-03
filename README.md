# JSONEditor

Electron + React + TypeScript 桌面应用。当前候选版本 0.7.0：文本/树编辑、统一同步、高级节点操作及本地文件和剪贴板能力，已加入跨平台 CI 和发布验收流程。

支持 JSON 高亮、Ctrl+Shift+F 格式化、撤销/重做和重复键警告。非法输入保持原样，格式化保留数字字面量。超过 2 Mi UTF-16 字符时使用手动校验；当前分析上限为 20 Mi 字符、512 层嵌套。

树支持六种 JSON 类型、展开/折叠、属性名/值/类型修改、Object/Array 子节点新增和删除。树操作与文本共用撤销栈；非法文本保留上次有效树供只读浏览，重复属性名暂停树编辑。树最多构建 100,000 个节点，长值请在文本区编辑。

文本变更通过有界范围记录跟踪节点身份；撤销/重做在历史缓存范围内恢复已解析版本的节点 ID。文本、树和格式化共用 Monaco 历史；组合输入期间暂停同步，过期后台结果不能覆盖新文本，后台故障可重试恢复。具体身份保证与缓存边界见开发指南。

支持单节点拖拽、上移/下移和跨容器移动表单（JSON Pointer 定位目标）。Object 可按属性名排序，Array 可按同一标量类型排序；数字比较保持大整数、指数和负零字面量。循环移动、命名冲突和过期操作会被拒绝，移动与排序可单步撤销。

标量值编辑采用范围投影更新和紧凑 Worker 响应，减少全文解析与整树传输；树拓扑保持稳定，仅挂载行订阅值更新。范围/ID 索引更新仍可能为线性复杂度，具体实测及限制见开发指南。

支持新建、打开、保存、另存为和最近文件；保留 UTF-8/BOM 及一致的 LF/CRLF，非法 JSON 可原文保存。保存前检查外部修改，使用同目录临时文件替换；未保存修改在新建/打开/关闭前提示保存、不保存或取消。文件上限 64 MiB 字节且解码后不超过 20 Mi UTF-16 字符，其他编码、混合换行或重复 BOM 明确报错。

支持复制原文/格式化/压缩文本和一次可撤销的整篇剪贴板替换。Ctrl+N/O/S、Ctrl+Shift+S 分别用于新建/打开/保存/另存为；Ctrl+Shift+C、Ctrl+Alt+C/M/V 用于原文复制、格式化复制、压缩复制及剪贴板替换全文。新文档仍需保存到文件才会持久化；没有自动保存或崩溃恢复。

Windows PowerShell：

```powershell
.\tools\Setup-WindowsEnvironment.ps1
. .\tools\Enter-DevEnvironment.ps1
pnpm install --frozen-lockfile
pnpm dev
```

需要 Node 24.16.0（当前验证基线）与 pnpm 12.15.0。

Windows 环境脚本默认将 pnpm 与下载缓存放在 `D:\5DevelopmentEnvironment`，复用已有 Node 24（>=24.16.0），默认不修改系统或用户 PATH。自定义目录时为 Setup、Enter 和 Test 脚本传入相同的 `-EnvironmentRoot`。本机重建记录见 [2026-11-03 环境重建](docs/environment-rebuild-2026-11-03.md)。

```text
pnpm check               Lint、格式、类型和单元/组件测试
pnpm build               构建 Main / Preload / Renderer / Worker
pnpm test:e2e            验证已构建的应用
pnpm test:dev            验证开发模式
pnpm test:performance    独立性能风险原型
pnpm test:tree-performance 真实树模型规模与资源探针
pnpm build:win           构建 Windows x64 NSIS 安装包
pnpm build:linux         在 Linux 构建 AppImage/deb（需要真实 JSONEDITOR_PROJECT_URL）
pnpm release:manifest win32 生成当前版本 Windows 工件 SHA-256 清单
```

架构、实际验证结果与阶段进度见 [开发指南](docs/development.md)。

安装/升级/卸载验证、Linux CI 配置、工件校验和发布门槛见 [发布与验收](docs/release.md)。当前候选包未签名；Linux 目标系统验收及原生桌面手工检查的状态以验证报告为准。

脚手架来源：`@quick-start/create-electron@1.0.31`（MIT），已按项目边界调整。项目本身尚未确定对外开源许可。
