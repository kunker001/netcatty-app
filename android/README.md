# Netcatty for Android

原生 Android SSH 客户端：主机保险库、实时连接、终端、SFTP、Docker Compose，以及绑定主机的 Catty 运维对话。

## 截图

<p align="center">
  <img src="../img/Screenshot_2026-10-17-12-42-47-69_b7dba69508580383bfc6e8bec53e420c.jpg" alt="主机列表" width="240">
  &nbsp;
  <img src="../img/Screenshot_2026-10-17-12-42-00-07_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 新对话" width="240">
  &nbsp;
  <img src="../img/Screenshot_2026-10-17-12-42-12-15_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 处理中" width="240">
</p>

<p align="center">
  <img src="../img/Screenshot_2026-10-17-12-42-25-70_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 执行命令" width="240">
  &nbsp;
  <img src="../img/Screenshot_2026-10-17-12-42-34-72_b7dba69508580383bfc6e8bec53e420c.jpg" alt="设置" width="240">
</p>

| 截图 | 说明 |
| --- | --- |
| 主机列表 | 一台主机可对应多条连接，从这里管理保险库 |
| Catty 新对话 | 对话绑定主机，权限可在观察 / 确认 / 自动之间切换 |
| Catty 处理中 | 提问后显示执行进度，发送按钮变为停止 |
| Catty 执行命令 | 在交互式 shell 里跑命令，步骤会写在对话和通知栏里 |
| 设置 | Catty 模型、命令安全、网络搜索 |

## 功能

- 加密主机保险库（标签、主机、端口、用户、密码或私钥、笔记）
- 首页只显示正在连接的会话；左上角加号选主机再连
- 交互式 SSH 终端（xterm.js）：双指缩放、闪烁光标、长按复制
- SFTP 可浏览全部目录（含 `/`），内置编辑器支持 yml / conf 等高亮与格式化
- 当前目录有 docker-compose 时，可在终端里管理容器
- Catty 运维对话绑定主机：断线后再打开仍能看历史
- 通知栏保活：点通知回到 App；Catty 执行进度会显示在通知里
- 浅色中文界面

打开会话后点 Catty，在设置里填写 OpenAI 兼容的 API Key。权限模式：观察（只建议）、确认（默认）、自动。危险命令仍会被拦截。

## 构建

需要 JDK 17+ 和 Android SDK 35。

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

APK 输出到 `app/build/outputs/apk/debug/app-debug.apk`。

安装到设备或模拟器：

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```
