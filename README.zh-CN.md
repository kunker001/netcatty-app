<p align="center">
  <img src="public/icon.png" alt="Netcatty" width="96" height="96">
</p>

<h1 align="center">Netcatty</h1>

<p align="center">
  <strong>原生 Android SSH 客户端</strong><br/>
  主机保险库 · 实时会话 · 终端 / SFTP · 端口转发 · Catty 运维
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white">
  &nbsp;
  <img alt="Version" src="https://img.shields.io/badge/Version-0.2.0-blue?style=for-the-badge">
  &nbsp;
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-GPL--3.0-green?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja-JP.md">日本語</a>
</p>

---

给手机用的 Netcatty：原生 Kotlin / Jetpack Compose，不是桌面版套壳。中文浅色界面，一台主机可以开多条 SSH 连接。Catty 对话绑在主机上，断线后再打开也能看历史。

## 截图

<p align="center">
  <img src="img/Screenshot_2026-10-17-12-42-47-69_b7dba69508580383bfc6e8bec53e420c.jpg" alt="主机列表" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-00-07_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 新对话" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-12-15_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 处理中" width="220">
</p>

<p align="center">
  <img src="img/Screenshot_2026-10-17-12-42-25-70_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 执行命令" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-34-72_b7dba69508580383bfc6e8bec53e420c.jpg" alt="设置" width="220">
</p>

| 画面 | 说明 |
| --- | --- |
| 主机列表 | 一台主机可对应多条连接，从保险库管理 |
| Catty 新对话 | 对话绑定主机；权限可在观察 / 确认 / 自动之间切换 |
| Catty 处理中 | 提问后显示进度，发送按钮变为停止 |
| Catty 执行命令 | 在交互式 shell 里跑命令，步骤写在对话和通知栏 |
| 设置 | Catty 模型、命令安全、网络搜索 |

## 功能

### 主机与连接

- 加密保险库：标签、主机、端口、用户、密码或私钥、笔记
- 首页只显示正在连接的会话；左上角加号选主机再连
- 连接列表显示延迟、CPU / 内存 / 磁盘，以及 Catty 是否在执行
- 一台主机可以同时开多条 SSH 连接

### 终端

- xterm.js 交互式 SSH 终端
- 双指缩放（字号有上下限）、闪烁光标、长按选择复制
- 当前目录有 docker-compose 时，可直接管理容器（启停、重启、暂停、日志、终端）

### SFTP

- 浏览全部目录，包括 `/`
- 内置编辑器，yml / conf 等常见文件可高亮和格式化
- 把当前路径定位到终端

### 端口转发

- 本地转发、远程转发、动态 SOCKS5
- 可随 App 自动启动；后台保活通知可点回隧道列表

### Catty 运维

- 对话绑定主机，不跟某条 SSH 连接绑死
- 权限：观察（只建议）、确认、自动
- 命令在交互式 shell 里执行，步骤可见
- 可配置 OpenAI 兼容模型、命令黑名单、网络搜索
- 执行中通知栏显示进度；点通知回到对应 Catty 或终端

## 使用

1. 打开 **主机**，添加一台机器（密码或私钥）。
2. 回到连接列表，点 **+** 选主机连接。
3. 在终端里打开 SFTP、Docker、端口转发，或进入 Catty。
4. 首次用 Catty：到 **设置** 填写 OpenAI 兼容的 API 地址和 Key，需要时刷新模型列表。

危险命令仍会被安全规则拦截。切到后台时，有会话或隧道会显示保活通知。

## 构建

需要 JDK 17+、Android SDK 35。最低系统 Android 8.0（API 26）。

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

APK 在 `android/app/build/outputs/apk/debug/app-debug.apk`。

```powershell
adb install -r android\app\build\outputs\apk\debug\app-debug.apk
```

更细的 Android 工程说明见 [`android/README.md`](android/README.md)。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 语言 / UI | Kotlin、Jetpack Compose、Material 3 |
| SSH / SFTP | sshj 0.39、BouncyCastle |
| 终端 | WebView + xterm.js |
| 保险库 | EncryptedFile（AES-256-GCM） |
| Catty | OpenAI 兼容 API、OkHttp |
| 包名 / 版本 | `app.netcatty` · 0.2.0 |

## 和桌面版的关系

桌面版 Netcatty 是 Electron 工作区，见 [binaricat/Netcatty](https://github.com/binaricat/Netcatty)。这个仓库里的 App 是另外写的原生 Android 客户端：交互按手机重做，并带上 Catty 运维。

## 协议

GPL-3.0，详见 [LICENSE](LICENSE)。
