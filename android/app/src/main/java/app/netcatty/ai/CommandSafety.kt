package app.netcatty.ai

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class CommandSafety(context: Context) {
    val defaultPatterns: List<String>
    @Volatile private var compiled: List<Regex> = emptyList()

    init {
        val raw = context.assets.open("command-blocklist.json").bufferedReader().use { it.readText() }
        val table = Json { ignoreUnknownKeys = true }.decodeFromString<BlocklistFile>(raw)
        defaultPatterns = table.common + table.posixNative + table.posix + table.powershell
        apply(null)
    }

    fun apply(blocklist: List<String>?) {
        val source = blocklist ?: defaultPatterns
        compiled = source.mapNotNull { pattern ->
            val trimmed = pattern.trim()
            if (trimmed.isEmpty()) null
            else runCatching { trimmed.toRegex(RegexOption.IGNORE_CASE) }.getOrNull()
        }
    }

    fun denyReason(command: String): String? {
        val text = command.trim()
        if (text.isBlank()) return "命令为空"
        if (compiled.none { it.containsMatchIn(text) }) return null
        return "安全策略已拦截该命令"
    }
}

@Serializable
private data class BlocklistFile(
    val common: List<String> = emptyList(),
    val posixNative: List<String> = emptyList(),
    val posix: List<String> = emptyList(),
    val powershell: List<String> = emptyList(),
)
