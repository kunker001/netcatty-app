<p align="center">
  <img src="public/icon.png" alt="Netcatty" width="96" height="96">
</p>

<h1 align="center">Netcatty</h1>

<p align="center">
  <strong>原生 Android SSH 用戶端</strong><br/>
  主機保險庫 · 即時連線 · 終端機 / SFTP · 連接埠轉發 · Catty 維運
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

給手機用的 Netcatty：原生 Kotlin / Jetpack Compose，不是桌面版套殼。中文淺色介面，一台主機可以開多條 SSH 連線。Catty 對話綁在主機上，斷線後再打開也能看歷史。

完整說明見 [簡體中文 README](./README.zh-CN.md)。

## 截圖

<p align="center">
  <img src="img/Screenshot_2026-10-17-12-42-47-69_b7dba69508580383bfc6e8bec53e420c.jpg" alt="主機列表" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-00-07_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 新對話" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-12-15_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 處理中" width="220">
</p>

<p align="center">
  <img src="img/Screenshot_2026-10-17-12-42-25-70_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 執行命令" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-34-72_b7dba69508580383bfc6e8bec53e420c.jpg" alt="設定" width="220">
</p>

## 功能摘要

- 加密主機保險庫；首頁只顯示正在連線的工作階段
- xterm.js 終端機：雙指縮放、閃爍游標、長按複製
- SFTP 可瀏覽全部目錄（含 `/`），內建編輯器
- 本機 / 遠端 / 動態 SOCKS5 轉發
- Catty 維運對話綁定主機；通知欄顯示執行進度
- 目前目錄有 docker-compose 時可管理容器

## 建置

需要 JDK 17+、Android SDK 35。最低系統 Android 8.0（API 26）。

```powershell
cd android
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## 授權

GPL-3.0，詳見 [LICENSE](LICENSE)。
