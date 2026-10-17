<p align="center">
  <img src="public/icon.png" alt="Netcatty" width="96" height="96">
</p>

<h1 align="center">Netcatty</h1>

<p align="center">
  <strong>ネイティブ Android SSH クライアント</strong><br/>
  ホスト保管庫 · ライブセッション · 端末 / SFTP · ポート転送 · Catty 運用
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

スマホ向け Netcatty です。Kotlin / Jetpack Compose のネイティブアプリで、Electron のラップではありません。中国語のライト UI。1 台のホストに複数の SSH 接続を持てます。Catty の会話はホストに紐づくので、切断後も履歴を開けます。

詳しくは [English README](./README.md) を見てください。

## スクリーンショット

<p align="center">
  <img src="img/Screenshot_2026-10-17-12-42-47-69_b7dba69508580383bfc6e8bec53e420c.jpg" alt="ホスト一覧" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-00-07_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 新規会話" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-12-15_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty 実行中" width="220">
</p>

<p align="center">
  <img src="img/Screenshot_2026-10-17-12-42-25-70_b7dba69508580383bfc6e8bec53e420c.jpg" alt="Catty コマンド実行" width="220">
  &nbsp;
  <img src="img/Screenshot_2026-10-17-12-42-34-72_b7dba69508580383bfc6e8bec53e420c.jpg" alt="設定" width="220">
</p>

## 機能

- 暗号化ホスト保管庫。ホームは接続中のセッションだけ
- xterm.js 端末：ピンチズーム、点滅カーソル、長押しコピー
- SFTP は `/` を含む全ディレクトリ。内蔵エディタあり
- ローカル / リモート / 動的 SOCKS5 転送
- Catty はホスト単位。通知に実行進捗を出す
- cwd に docker-compose があればコンテナを操作できる

## ビルド

JDK 17+ と Android SDK 35 が必要です。最低 Android 8.0（API 26）。

```powershell
cd android
.\gradlew.bat assembleDebug
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## ライセンス

GPL-3.0。[LICENSE](LICENSE) を参照してください。
