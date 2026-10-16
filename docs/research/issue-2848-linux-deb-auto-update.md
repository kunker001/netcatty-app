# Issue #2848：Linux `.deb` 应用内自更新研究

研究日期：2026-08-10

研究范围：Issue #2848、`electron-builder` / `electron-updater` 官方文档与源码，以及 Element Desktop、Joplin、Beekeeper Studio 三个开源 Electron 项目的固定提交源码。本文只记录已经在一手来源中确认的行为，不把“发布了 `.deb`”等同于“支持应用内自更新”。

## 结论先行

1. `electron-updater@6.8.3` 已经有 Linux `.deb` 的完整更新路径。它不是只能更新 AppImage：`electron-builder` 为可发布的 FPM Linux 包写入 `app-update.yml` 和 `resources/package-type`，`electron-updater` 再根据 `package-type=deb` 实例化 `DebUpdater`。[FpmTarget.ts](https://github.com/electron-userland/electron-builder/blob/103863c143e09c5a4dd3cca24a78302cf1b782e4/packages/app-builder-lib/src/targets/FpmTarget.ts#L139-L150)、[main.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/main.ts#L24-L66)

2. 官方 `.deb` 路径的边界很清楚：检查更新时读取 Linux 更新清单，下载清单中匹配架构的 `.deb`，下载过程校验哈希并缓存；安装时调用 `dpkg` 或 `apt`，普通用户通过 `pkexec`、图形化 sudo 工具或 `sudo` 提权。它不是“把新文件复制到应用目录”，也不提供应用级的旧版本回滚。[DebUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/DebUpdater.ts#L15-L81)、[LinuxUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/LinuxUpdater.ts#L10-L97)

3. 官方库本身不会替应用设计确认界面。`autoDownload` 默认开启，下载完成后 `autoInstallOnAppQuit` 默认也开启；如果产品要求“用户确认下载”和“用户确认重启安装”，应用层应关闭自动下载/退出安装，收到事件后由界面触发下载和 `quitAndInstall`。[AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/AppUpdater.ts#L52-L69)、[BaseUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/BaseUpdater.ts#L14-L25)

4. 三个成熟项目都没有把 Linux `.deb` 做成应用内自更新：Element Desktop 在 Linux 直接关闭更新；Joplin 的桌面更新入口打开下载地址，Linux 安装脚本更新的是用户目录中的 AppImage；Beekeeper Studio 明确只对 Linux AppImage 启用 `electron-updater`，非 AppImage Linux 包直接跳过。[Element updater.ts](https://github.com/element-hq/element-desktop/blob/bcd84015638697695b50b3e9d3031ba4eecff831/src/updater.ts#L74-L128)、[Joplin checkForUpdates.ts](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/packages/app-desktop/checkForUpdates.ts#L85-L126)、[Beekeeper update_manager.ts](https://github.com/beekeeper-studio/beekeeper-studio/blob/55938d331df2b102aeda57f7a640a98489c7826f/apps/studio/src/background/update_manager.ts#L31-L69)

5. 对 Issue #2848 来说，关键问题不是 `electron-updater` 能不能安装 `.deb`，而是发布物和运行时是否成对满足条件：`.deb` 内要有正确的 `package-type` 和 `app-update.yml`，更新服务器要有对应的 `latest-linux[-架构].yml` 与 `.deb`，安装时要处理提权确认、取消、失败和手动降级入口。当前工作区的桥接层已经按这个方向读取 `package-type`，构建配置也包含 `.deb` 和 GitHub 发布配置；但本次是只读研究，没有把它表述为已在实际安装包中验证或已随正式版本发布。[Netcatty autoUpdateBridge.cjs](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/electron/bridges/autoUpdateBridge.cjs#L50-L80)、[Netcatty electron-builder.config.cjs](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/electron-builder.config.cjs#L257-L305)、[Netcatty package.json](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/package.json#L107-L113)

## 1. 官方实现：从安装包识别到安装

### 1.1 如何识别 `.deb`

`electron-builder` 的 FPM 目标在有发布配置时，向 Linux 应用资源目录写入两份更新文件：

- `app-update.yml`：发布服务配置；
- `package-type`：目标名，例如 `deb`、`rpm` 或 `pacman`。

`electron-updater` 在 Linux 启动时先创建 `AppImageUpdater`，然后读取 `process.resourcesPath/package-type`。读取到 `deb` 时改用 `DebUpdater`；没有该标记时保持 AppImage 路径。AppImage 则通过 `APPIMAGE` 环境变量识别。[FpmTarget.ts](https://github.com/electron-userland/electron-builder/blob/103863c143e09c5a4dd3cca24a78302cf1b782e4/packages/app-builder-lib/src/targets/FpmTarget.ts#L139-L150)、[main.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/main.ts#L24-L66)、[AppImageUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/AppImageUpdater.ts#L462-L489)

这意味着不能只按 `process.platform === "linux"` 判断是否支持更新，也不能只看当前安装文件的扩展名。运行时真正依赖的是构建时写入的安装类型标记和发布配置。

### 1.2 如何选择清单和安装包

Linux 更新清单的默认名称带有平台和架构后缀：x64 使用 `latest-linux.yml`，其他架构使用 `latest-linux-架构.yml`。清单中的文件会经过扩展名筛选，并优先选择名称中包含当前 `process.arch` 的文件。[Provider.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/providers/Provider.ts#L40-L60)、[Provider.ts 的 findFile](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/providers/Provider.ts#L97-L111)

`DebUpdater` 只选择 `.deb` 文件，下载任务把文件扩展名固定为 `deb`，并把下载进度向外发出。与 AppImage 路径不同，这里没有差分下载逻辑；它下载完整的 `.deb`。[DebUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/DebUpdater.ts#L15-L29)

### 1.3 下载、校验和缓存

通用下载流程会把清单中的 `sha2/sha512` 传给 HTTP 下载器，先写入缓存目录中的临时文件，下载成功后再改名为最终缓存文件。网络错误、取消或改名失败会清理临时下载；已缓存的更新会在再次使用前检查清单哈希和文件哈希，校验不一致时清空缓存并重新下载。[AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/AppUpdater.ts#L709-L799)、[DownloadedUpdateHelper.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/DownloadedUpdateHelper.ts#L38-L151)、[builder-util-runtime HTTP 校验](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/builder-util-runtime/src/httpExecutor.ts#L451-L549)

所以，下载失败时的可靠回退是“删除坏的临时/缓存文件，等待下一次检查重新下载”，不是切换到另一个 Linux 安装格式。安装失败后也不会自动把旧 `.deb` 重新安装一遍。

### 1.4 root 权限和用户确认

安装逻辑先检查 `dpkg` 或 `apt` 是否存在，并优先选择 `dpkg`。如果当前进程 UID 是 0，直接运行包管理命令；普通用户则按顺序寻找 `gksudo`、`kdesudo`、`pkexec`、`beesu`，都没有时使用 `sudo`，并以应用名生成“希望更新”的提示文本。[LinuxUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/LinuxUpdater.ts#L10-L73)

源码没有弹出产品层“是否现在更新”的对话框。它的默认值是发现更新后自动下载，下载完成后在正常退出时自动安装；显式 `quitAndInstall` 则立即进入安装并退出应用。[AppUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/AppUpdater.ts#L52-L69)、[BaseUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/BaseUpdater.ts#L78-L103)

因此，若 Netcatty 要求用户确认，确认应由 Netcatty 自己的界面控制：确认下载后调用 `downloadUpdate()`，确认重启后调用 `quitAndInstall()`；同时关闭默认的退出即安装，避免用户只是退出应用时突然触发提权。

### 1.5 安装失败和回退

官方 `DebUpdater` 的失败处理是：

- 找不到下载文件，或找不到 `dpkg/apt`：发出错误并返回失败；
- 使用 `dpkg -i` 时失败：记录警告，再执行 `apt-get install -f -y` 尝试修复依赖；
- 没有 `dpkg`、只有 `apt`：执行本地 `.deb` 安装，并带上 `--allow-unauthenticated`、`--allow-downgrades`、`--allow-change-held-packages`；
- 安装命令仍失败：发出错误，不会在应用层恢复旧版本。[DebUpdater.ts](https://github.com/electron-userland/electron-builder/blob/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6/packages/electron-updater/src/DebUpdater.ts#L31-L81)

其中 `--allow-unauthenticated` 是当前 `6.8.3` 源码的实际行为，不能被描述成安全的签名验证方案。它说明官方实现把 `.deb` 安装交给系统包管理器，但没有替应用建立完整的包签名信任链。

## 2. 开源项目对照

| 项目 | 发布的 Linux 格式 | 实际更新路径 | 权限 / 用户确认 | 失败或回退行为 |
| --- | --- | --- | --- | --- |
| `electron-updater@6.8.3` 官方 | `.deb`、AppImage、RPM、Pacman | 用 `package-type` 选择 updater；`.deb` 下载完整包，调用 `dpkg/apt` | root 直接安装；普通用户走 `pkexec`/sudo 等；确认界面由应用层决定，默认下载和退出安装 | 下载临时文件和缓存有哈希校验与清理；`dpkg` 失败尝试 `apt-get -f`；没有应用级旧版本回滚 |
| Element Desktop | `tar.gz`、`.deb`；构建配置确认发布 `.deb` | Linux `available()` 直接返回 false；只对 macOS/Windows 配置 Electron 自带 updater | Linux 不进入更新流程，因此没有应用内提权或确认逻辑 | Linux 的回退就是不自更新，用户使用外部下载/安装方式 |
| Joplin | AppImage、`.deb` | 更新检查弹窗确认后打开下载 URL；Linux 安装脚本实际下载和替换 `$HOME/.joplin/Joplin.AppImage` | 用户目录安装不需要 root；脚本默认拒绝 root，必须显式 `--allow-root` 才能运行 | 版本比较会避免重复安装和降级；先下载到临时目录，之后删除旧 AppImage 并移动新文件；没有确认到的 `.deb` 应用内安装路径 |
| Beekeeper Studio | Snap、`.deb`、AppImage、RPM、Flatpak、Pacman | `manageUpdates()` 对 Linux 非 AppImage 直接返回；只有 AppImage 走 `electron-updater` | AppImage 使用“下载 / 稍后 / 立即重启”界面；`.deb` 不进入该流程 | Portable 有打开官网手动下载的分支；本次确认的 Linux `.deb` 路径没有独立的提权或回滚实现 |

### 2.1 Element Desktop：发布 `.deb`，但不做 Linux 应用内更新

Element 的构建配置把 Linux 目标设为 `tar.gz` 和 `deb`。[electron-builder.ts](https://github.com/element-hq/element-desktop/blob/bcd84015638697695b50b3e9d3031ba4eecff831/electron-builder.ts#L129-L152)

但其更新入口明确写着 Linux 不支持自动更新，并在 `available()` 中直接返回 `false`；`start()` 也只为 macOS 和 Windows 生成更新地址，Linux 不会设置更新源。[updater.ts](https://github.com/element-hq/element-desktop/blob/bcd84015638697695b50b3e9d3031ba4eecff831/src/updater.ts#L74-L128)

项目自己的更新文档也只说桌面应用能在 macOS 和 Windows 自更新。[docs/updates.md](https://github.com/element-hq/element-desktop/blob/bcd84015638697695b50b3e9d3031ba4eecff831/docs/updates.md#L1-L15)

已确认的结论：Element 的 `.deb` 是发布/安装格式，不是应用内更新格式。Linux 没有可供比较的 root 提权、安装确认或旧版本回退实现；不能从源码推断它对这些情况有额外处理。

### 2.2 Joplin：Linux 实际更新的是用户目录 AppImage

Joplin 的构建配置同时发布 AppImage 和 `.deb`。[package.json](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/packages/app-desktop/package.json#L132-L150)

桌面更新入口从 Joplin 自己的发布地址取版本列表，比较版本后弹窗；用户点击 Download 时打开 `release.downloadUrl` 或 `release.pageUrl`，而不是把 `.deb` 交给应用内安装器。[checkForUpdates.ts](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/packages/app-desktop/checkForUpdates.ts#L27-L42)、[checkForUpdates.ts](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/packages/app-desktop/checkForUpdates.ts#L85-L126)

其 Linux 安装/更新脚本把安装目录默认设为 `$HOME/.joplin`，root 默认被拒绝；脚本先把新版 AppImage 下载到临时目录，之后删除旧 AppImage，移动新版并补执行权限。脚本使用 `set -e` 和错误提示，但源码中没有确认到包管理器提权或应用内 `.deb` 安装流程。[Joplin_install_and_update.sh](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/Joplin_install_and_update.sh#L27-L31)、[Joplin_install_and_update.sh](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/Joplin_install_and_update.sh#L148-L152)、[Joplin_install_and_update.sh](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/Joplin_install_and_update.sh#L228-L245)

另外，Joplin 的构建后处理明确只为 AppImage 生成 SHA-512 文件。[afterAllArtifactBuild.js](https://github.com/laurent22/joplin/blob/2654b33620775080d1d59c552259d41e33dad3d2/packages/app-desktop/afterAllArtifactBuild.js#L8-L31)

已确认的结论：Joplin 采用“用户确认后打开下载地址 + 用户目录 AppImage 替换”的路线，避免了 `.deb` 的 root 安装问题；这不是可直接复用的 `.deb` 应用内自更新方案。

### 2.3 Beekeeper Studio：只给 AppImage 接上 `electron-updater`

Beekeeper 的 Linux 构建配置包含 Snap、`.deb`、AppImage、RPM、Flatpak 和 Pacman，并为 Linux 发布到 GitHub。[electron-builder-config.js](https://github.com/beekeeper-studio/beekeeper-studio/blob/55938d331df2b102aeda57f7a640a98489c7826f/apps/studio/electron-builder-config.js#L168-L200)

运行时代码在 Linux 且不是 AppImage 时直接跳过更新；Snap 也在入口处跳过。只有 AppImage 才会处理 `APPIMAGE` 路径、检查更新、下载和安装。它关闭了自动下载，界面提供 Download、Later 和 Restart Now 三步确认。[update_manager.ts](https://github.com/beekeeper-studio/beekeeper-studio/blob/55938d331df2b102aeda57f7a640a98489c7826f/apps/studio/src/background/update_manager.ts#L11-L99)、[AutoUpdater.vue](https://github.com/beekeeper-studio/beekeeper-studio/blob/55938d331df2b102aeda57f7a640a98489c7826f/apps/studio/src/components/AutoUpdater.vue#L13-L95)

已确认的结论：Beekeeper 的 UI 确认流程值得参考，但它只服务于 AppImage。对 Linux `.deb`，源码没有单独的提权确认、包管理器安装或回滚路径，不能把 AppImage 的行为直接外推到 `.deb`。

## 3. 对 Netcatty Issue #2848 的直接启示

Issue #2848 描述的是“`.deb` 应用检测到新版后仍需手动下载 `.deb` 安装”。[Issue #2848](https://github.com/binaricat/Netcatty/issues/2848)

本工作区固定提交 `3f67ccf3b2766e7757e3d2ca63b1044808a8363c` 中，已经能确认以下事实：

- `autoUpdateBridge.cjs` 把 `APPIMAGE` 识别为 AppImage；否则读取 `resources/package-type`，接受 `deb/rpm/pacman`；无标记时返回不支持。[autoUpdateBridge.cjs](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/electron/bridges/autoUpdateBridge.cjs#L50-L80)
- `electron-builder.config.cjs` 的 Linux 目标包含 `AppImage`、`deb`、`rpm`、`pacman`，发布配置为 GitHub。[electron-builder.config.cjs](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/electron-builder.config.cjs#L257-L305)
- 应用依赖范围是 `electron-updater` `^6.8.3`，锁文件解析到 `6.8.3`；这与上面确认的 `DebUpdater` 实现相符。[package.json](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/package.json#L107-L113)
- 桥接层把 `autoInstallOnAppQuit` 设为 `false`，把检查、下载和安装暴露为显式操作；安装前还会检查未保存编辑。[autoUpdateBridge.cjs](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/electron/bridges/autoUpdateBridge.cjs#L101-L105)、[autoUpdateBridge.cjs](https://github.com/binaricat/Netcatty/blob/3f67ccf3b2766e7757e3d2ca63b1044808a8363c/electron/bridges/autoUpdateBridge.cjs#L386-L565)

因此，后续若要验证 Issue 是否真正完成，最小证据链应是：

1. 从实际 `.deb` 安装包解出 `resources/package-type`，确认内容为 `deb`，同时确认存在 `app-update.yml`；
2. 用对应发布版本检查 `latest-linux.yml` 和 `.deb` 文件名/架构是否匹配；
3. 以普通用户执行一次“检查 → 用户确认下载 → 用户确认重启”，确认提权对话框出现且取消不会让应用退出；
4. 分别验证下载哈希错误、无 `dpkg/apt`、权限取消和依赖修复失败时，界面能保留可见错误并提供手动 Releases 入口；
5. 验证安装失败后不会把“已安装成功”写入 UI 状态，也不把“下载成功”误报成“安装成功”。

这份研究没有执行实际安装包测试，因此不把上述运行时证据当作已满足。

## 来源与版本边界

- Issue：[#2848](https://github.com/binaricat/Netcatty/issues/2848)
- 官方自动更新说明：[electron-builder Auto Update](https://www.electron.build/docs/features/auto-update/)
- 官方 Linux 目标说明：[electron-builder Linux](https://www.electron.build/docs/linux/)
- 官方 API 说明：[electron-updater API](https://www.electron.build/docs/api/electron-updater/)
- 官方源码快照：`electron-updater@6.8.3` 对应提交 [`3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6`](https://github.com/electron-userland/electron-builder/commit/3a3f4396e1c6a390f04afb2c6d6f667a9022f5a6)；`electron-builder@26.11.1` 对应提交 [`103863c143e09c5a4dd3cca24a78302cf1b782e4`](https://github.com/electron-userland/electron-builder/commit/103863c143e09c5a4dd3cca24a78302cf1b782e4)。
- 项目源码快照：Element Desktop [`bcd84015638697695b50b3e9d3031ba4eecff831`](https://github.com/element-hq/element-desktop/commit/bcd84015638697695b50b3e9d3031ba4eecff831)；Joplin [`2654b33620775080d1d59c552259d41e33dad3d2`](https://github.com/laurent22/joplin/commit/2654b33620775080d1d59c552259d41e33dad3d2)；Beekeeper Studio [`55938d331df2b102aeda57f7a640a98489c7826f`](https://github.com/beekeeper-studio/beekeeper-studio/commit/55938d331df2b102aeda57f7a640a98489c7826f)。
