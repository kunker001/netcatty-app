package app.netcatty.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.netcatty.BuildConfig
import java.io.File
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request

const val GITHUB_REPO = "kunker001/netcatty-app"

data class AppRelease(
    val version: String,
    val tag: String,
    val notes: String,
    val pageUrl: String,
    val apkName: String,
    val apkUrl: String,
    val apkBytes: Long,
)

class AppUpdateException(message: String) : Exception(message)

class AppUpdater(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("app-update", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    fun currentVersion(): String = BuildConfig.VERSION_NAME

    fun selfUpdateEnabled(): Boolean = BuildConfig.SELF_UPDATE

    fun shouldAutoCheck(): Boolean {
        if (!selfUpdateEnabled()) return false
        val last = prefs.getLong(KEY_LAST_CHECK, 0L)
        return System.currentTimeMillis() - last >= AUTO_CHECK_MS
    }

    fun markChecked() {
        prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply()
    }

    fun skippedVersion(): String? = prefs.getString(KEY_SKIPPED, null)?.ifBlank { null }

    fun skip(version: String) {
        prefs.edit().putString(KEY_SKIPPED, version).apply()
    }

    suspend fun fetchLatest(): AppRelease? = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("https://api.github.com/repos/$GITHUB_REPO/releases/latest")
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "Netcatty-Android/${currentVersion()}")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.code == 404) return@withContext null
            if (!response.isSuccessful) {
                throw AppUpdateException("检查更新失败（HTTP ${response.code}）")
            }
            val parsed = runCatching { json.decodeFromString<GithubRelease>(body) }
                .getOrElse { throw AppUpdateException("无法解析 GitHub Release") }
            parsed.toAppRelease()
        }
    }

    suspend fun newerRelease(): AppRelease? {
        val latest = fetchLatest() ?: return null
        return if (compareSemver(latest.version, currentVersion()) > 0) latest else null
    }

    suspend fun download(
        release: AppRelease,
        onProgress: (Float) -> Unit = {},
    ): File = withContext(Dispatchers.IO) {
        if (!selfUpdateEnabled()) throw AppUpdateException("此版本由 F-Droid 更新")
        val request = Request.Builder()
            .url(release.apkUrl)
            .header("User-Agent", "Netcatty-Android/${currentVersion()}")
            .header("Accept", "application/octet-stream")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw AppUpdateException("下载失败（HTTP ${response.code}）")
            }
            val body = response.body ?: throw AppUpdateException("下载失败：空文件")
            val total = body.contentLength().takeIf { it > 0 } ?: release.apkBytes
            val dir = File(appContext.cacheDir, "updates").apply { mkdirs() }
            val dest = File(dir, "netcatty-update.apk")
            dest.outputStream().use { out ->
                val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
                var readTotal = 0L
                body.byteStream().use { input ->
                    while (true) {
                        val n = input.read(buffer)
                        if (n <= 0) break
                        out.write(buffer, 0, n)
                        readTotal += n
                        if (total > 0) {
                            onProgress((readTotal.toFloat() / total.toFloat()).coerceIn(0f, 1f))
                        }
                    }
                }
            }
            if (dest.length() < 1_024) {
                dest.delete()
                throw AppUpdateException("下载失败：文件过小")
            }
            onProgress(1f)
            dest
        }
    }

    fun needsInstallPermission(): Boolean {
        return Build.VERSION.SDK_INT >= 26 && !appContext.packageManager.canRequestPackageInstalls()
    }

    fun openInstallPermissionSettings() {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${appContext.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        appContext.startActivity(intent)
    }

    fun install(file: File) {
        if (!selfUpdateEnabled()) throw AppUpdateException("此版本由 F-Droid 更新")
        if (!file.isFile) throw AppUpdateException("安装包不存在")
        val uri = FileProvider.getUriForFile(appContext, "${appContext.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.startActivity(intent)
    }
}

fun compareSemver(left: String, right: String): Int {
    val a = parseSemver(left)
    val b = parseSemver(right)
    for (i in 0 until maxOf(a.core.size, b.core.size)) {
        val av = a.core.getOrElse(i) { 0 }
        val bv = b.core.getOrElse(i) { 0 }
        if (av != bv) return av.compareTo(bv)
    }
    return when {
        a.pre == null && b.pre == null -> 0
        a.pre == null -> 1
        b.pre == null -> -1
        else -> a.pre.compareTo(b.pre)
    }
}

private fun parseSemver(raw: String): Semver {
    val trimmed = raw.trim().removePrefix("v").removePrefix("V")
    val cut = trimmed.indexOf('+').let { if (it >= 0) trimmed.substring(0, it) else trimmed }
    val dash = cut.indexOf('-')
    val core = (if (dash >= 0) cut.substring(0, dash) else cut)
        .split('.')
        .map { it.toIntOrNull() ?: 0 }
        .ifEmpty { listOf(0) }
    val pre = if (dash >= 0) cut.substring(dash + 1) else null
    return Semver(core, pre)
}

private data class Semver(val core: List<Int>, val pre: String?)

@Serializable
private data class GithubRelease(
    @SerialName("tag_name") val tagName: String = "",
    val name: String? = null,
    val body: String? = null,
    @SerialName("html_url") val htmlUrl: String = "",
    val prerelease: Boolean = false,
    val assets: List<GithubAsset> = emptyList(),
)

@Serializable
private data class GithubAsset(
    val name: String = "",
    @SerialName("browser_download_url") val browserDownloadUrl: String = "",
    val size: Long = 0,
)

private fun GithubRelease.toAppRelease(): AppRelease? {
    if (prerelease) return null
    val apk = assets.firstOrNull {
        it.name.endsWith("-github.apk", ignoreCase = true) && it.browserDownloadUrl.isNotBlank()
    } ?: return null
    val version = tagName.trim().removePrefix("v").removePrefix("V").ifBlank {
        name?.trim().orEmpty().removePrefix("v").removePrefix("V")
    }
    if (version.isBlank()) return null
    return AppRelease(
        version = version,
        tag = tagName.ifBlank { "v$version" },
        notes = body.orEmpty().trim(),
        pageUrl = htmlUrl,
        apkName = apk.name,
        apkUrl = apk.browserDownloadUrl,
        apkBytes = apk.size,
    )
}

private const val KEY_LAST_CHECK = "last-check-ms"
private const val KEY_SKIPPED = "skipped-version"
private const val AUTO_CHECK_MS = 12L * 60 * 60 * 1000
