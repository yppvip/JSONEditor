# JSONEditor

Electron + React + TypeScript 桌面应用。当前完成 Phase2：Monaco JSON 文本编辑、严格后台校验、格式化及错误定位。

支持 JSON 高亮、Ctrl+Shift+F 格式化、撤销/重做和重复键警告。非法输入保持原样，格式化保留数字字面量。超过 2 Mi UTF-16 字符时使用手动校验；当前分析上限为 20 Mi 字符、512 层嵌套。

当前为未保存的临时文档，关闭应用不会持久化。Tree 编辑、文件打开/保存与完整同步功能尚未实现。

Windows PowerShell：

```powershell
. .\tools\Enter-DevEnvironment.ps1
pnpm install --frozen-lockfile
pnpm dev
```

需要 Node 24.16.0（当前验证基线）与 pnpm 12.15.0。

```text
pnpm check               Lint、格式、类型和单元/组件测试
pnpm build               构建 Main / Preload / Renderer / Worker
pnpm test:e2e            验证已构建的应用
pnpm test:dev            验证开发模式
pnpm test:performance    独立性能风险原型
pnpm build:win           构建 Windows x64 NSIS 安装包
```

架构、实际验证结果与阶段进度见 [开发指南](docs/development.md)。

脚手架来源：`@quick-start/create-electron@1.0.31`（MIT），已按项目边界调整。项目本身尚未确定对外开源许可。
