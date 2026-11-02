# JSONEditor 发布与验收

当前候选版本为 0.7.0。本流程生成内部验收工件，不自动创建 Release、推送 tag 或上传到公开下载站。构建成功不代表目标系统验收已经通过；本次实际结果见 development.md 第 33 节与 phase7 验证报告。

## 可复现构建

使用 `.node-version` 指定的 Node 24.16.0、pnpm 12.15.0，以及仓库中的锁文件。不要临时升级依赖或关闭 Electron sandbox 来使测试通过。

```text
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm test:tree-performance
```

Windows PowerShell 先执行 `. .\tools\Enter-DevEnvironment.ps1`；CI 的临时 runner 使用固定版本 pnpm。性能探针输出本机硬件、每个规模的多次编辑时间、挂载行数、进程内存及规模降级结果；样本不构成固定时延或容量承诺。

## Windows x64

```powershell
pnpm build:win
./tools/Test-WindowsInstaller.ps1 -RunE2E
# 本机已有旧版本工件时，增加真实升级检查：
./tools/Test-WindowsInstaller.ps1 -PreviousInstaller ./release/JSONEditor-0.6.0-x64-setup.exe -RunE2E
pnpm release:manifest win32
```

脚本先检查既有注册项和快捷方式；发现已有安装就退出，避免覆盖用户安装。仅在 `release/installer-validation/` 下创建随机目录，执行当前用户静默安装、检查注册版本/安装位置/开始菜单快捷方式、启动实际安装的程序、离线刷新和源码字节保存，再运行完整 E2E。提供旧安装包时先安装旧版并升级，验证同一 profile 标记保留。最后调用本次安装目录的卸载器，校对程序、快捷方式和注册项移除，并保留测试 profile。测试输出目录保留以供检查；不删除用户 JSON 文件或真实用户配置。

该检查会临时创建当前用户安装注册项与开始菜单快捷方式，不需要管理员安装。控制进程先启动独立验收进程，待其退出后调用 `Complete-WindowsInstaller.ps1` 卸载，避免验收宿主的资源映射影响删除；不会结束其他应用进程。它覆盖静默路径；交互向导、UAC、受限账户、签名信誉和系统重启后的行为仍须人工验收。文件对话框返回位置使用替身，保存服务、IPC、磁盘和安装后的可执行文件均为真实路径。

## Linux x64

在原生 Linux 主机或 Ubuntu 24.04 CI runner 上运行。`JSONEDITOR_PROJECT_URL` 必须是项目真实的 HTTPS 主页；deb 打包器要求该字段，仓库未提供时不虚构地址。在 GitHub 仓库 Actions Variables 中配置同名变量。

```bash
export JSONEDITOR_PROJECT_URL='项目实际的 HTTPS 主页 URL'
pnpm build:linux
xvfb-run -a pnpm test:e2e
sudo apt-get install -y ./release/JSONEditor-*-x64.deb
JSONEDITOR_EXECUTABLE=/opt/JSONEditor/jsoneditor xvfb-run -a pnpm test:e2e
sudo apt-get remove -y jsoneditor
pnpm release:manifest linux
```

CI 另对 AppImage 解包后的可执行文件运行启动/保存检查。该路径验证 AppImage 内的负载，不等同 AppImage/FUSE 双击挂载、系统菜单和真实桌面验收。完整验收应在有 FUSE 的桌面直接运行 AppImage，并分别验证 X11/Wayland、字体、中文输入、剪贴板、文件对话框、权限和 deb 安装/卸载后的菜单。

工作流只在一次性的 Ubuntu runner 上放开 AppArmor 对非特权用户命名空间的限制，使 Chromium 保持 sandbox 运行；不使用 `--no-sandbox`，不建议在用户机器全局修改此策略。目标系统应采用合适的发行版 sandbox/AppArmor 配置。

## CI 与证据

`.github/workflows/verify.yml` 使用独立 Windows 2025、Ubuntu 24.04 runner，固定官方 Action 提交、Node 和 pnpm 版本，执行 frozen-lockfile 安装、检查、源码 E2E、规模探针、原生打包与安装后 E2E。token 仅有 contents:read，checkout 不保留凭据；构建明确指定 `--publish never`。

每个平台上传独立候选工件和测试报告，保留 14 天。失败任务也保存现有报告；是否通过必须看 job 结果和报告内容，不能仅根据附件存在判断。只有当前 package.json 版本的必需工件齐全，清单工具才生成 `manifest-<platform>.json` 和 `SHA256SUMS-<platform>.txt`；清单不是签名，也不证明来源可信。

手工核对 Windows 工件：

```powershell
Get-FileHash ./release/JSONEditor-0.7.0-x64-setup.exe -Algorithm SHA256
```

Linux 在 `release` 目录内执行 `sha256sum -c SHA256SUMS-linux.txt`。

## 公开发布门槛

| 检查       | 要求                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| 自动化     | 同一提交的两平台 CI 全绿，源码和安装后 E2E 无失败/跳过，校验清单对应实际工件                                   |
| 桌面与安装 | Windows 交互安装/升级/卸载；Linux deb、AppImage/FUSE 与 X11/Wayland；物理输入法、鼠标拖拽、原生对话框/剪贴板   |
| 数据与性能 | 无损字节、非法 JSON、冲突及取消保护；在目标设备检查真实大文件与长时编辑                                        |
| 身份与许可 | 确定项目许可和真实发布主页、完整运行时依赖声明、产品图标；当前 `UNLICENSED` 和脚手架 NOTICE 不构成对外开源授权 |
| 签名       | Windows 证书、签名及时间戳策略经维护者确定，凭据只存安全存储；当前候选工件未签名                               |
| 最终分发   | 维护者审阅版本、说明、哈希及已知限制后，再明确授权 tag/Release/上传；不自动执行                                |

当前不提供自动更新。回滚前先备份用户文件与配置，卸载时保留数据，再安装经过校验的历史版本；旧版本不保证理解未来配置格式。不要用降级测试覆盖用户的工作文件。

官方实现依据：[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[upload-artifact](https://github.com/actions/upload-artifact)。electron-builder 的 deb 主页要求和 NSIS 行为另按本项目锁定的 26.18.0 本地实现核对。
