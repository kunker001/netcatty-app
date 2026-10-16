# Netcatty for Android

SSH vault, terminal, SFTP, and Catty ops chat for Android.

## Features

- Encrypted host vault (label, host, port, user, password or private key)
- Interactive SSH terminal (xterm.js)
- Extra keys: Esc, Tab, Ctrl, arrows
- Basic SFTP browse / upload / download
- Catty AI ops: diagnose the connected host, confirm commands, run them on a separate SSH exec channel
- Midnight theme aligned with desktop Netcatty

Open a session, tap the sparkle icon, then set an OpenAI-compatible API key in Settings. Permission modes: Observer (suggest only), Confirm (default), Auto. Destructive commands stay blocked.

## Build

Requires JDK 17+ and Android SDK 35.

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
cd android
.\gradlew.bat assembleDebug
```

The APK is written to `app/build/outputs/apk/debug/app-debug.apk`.

Install on a device or emulator:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk
```
