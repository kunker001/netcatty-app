# Android 工程

应用说明和截图见仓库根目录：

- [简体中文](../README.zh-CN.md)
- [English](../README.md)

这里只放构建命令。

## 构建

需要 JDK 17+ 和 Android SDK 35。最低 Android 8.0（API 26）。包名 `app.netcatty`，版本 0.2.0。

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

APK：`app/build/outputs/apk/debug/app-debug.apk`。

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```
