# Android 工程

应用说明和截图见仓库根目录：

- [简体中文](../README.zh-CN.md)
- [English](../README.md)

GitHub Actions 会在推送 `v0.2.0` 这类版本 tag、或推到 `master` / `main` 时编译 debug APK。产物在对应 workflow 的 Artifacts 里，也可以在 Actions 里手动跑 **android**。

这里只放本地构建命令。

## 构建

需要 JDK 17+ 和 Android SDK 35。最低 Android 8.0（API 26）。包名 `app.netcatty`，版本 0.2.3。

`github` 构建带应用内更新。`fdroid` 构建没有安装器，给 F-Droid 用。推送 `v0.2.3` 这种和 `versionName` 一致的 tag 时，Actions 会签出两个 release APK 并放到 GitHub Release：`netcatty-<version>.apk` 是 F-Droid 对照包，`netcatty-<version>-github.apk` 是带更新器的包。签名密钥放在仓库 Secrets，不进 git。

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleGithubDebug
```

APK：`app/build/outputs/apk/github/debug/app-github-debug.apk`。

```powershell
adb install -r app\build\outputs\apk\github\debug\app-github-debug.apk
```

发布签名只在本机 `keystore.properties`（照 `keystore.properties.example`）或环境变量 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD` 齐全时启用。F-Droid 的构建配方在 `fdroid/app.netcatty.yml`，商店文案在仓库根目录 `fastlane/metadata/android/`。
