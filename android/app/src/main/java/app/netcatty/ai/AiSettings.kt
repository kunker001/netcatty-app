package app.netcatty.ai

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
enum class PermissionMode {
    OBSERVER,
    CONFIRM,
    AUTO,
}

data class ProviderPreset(
    val id: String,
    val label: String,
    val baseUrl: String,
    val model: String,
)

val PROVIDER_PRESETS = listOf(
    ProviderPreset("openai", "OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"),
    ProviderPreset("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-chat"),
    ProviderPreset("qwen", "Qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen-plus"),
    ProviderPreset("kimi", "Kimi", "https://api.moonshot.cn/v1", "moonshot-v1-auto"),
    ProviderPreset("google", "Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"),
    ProviderPreset("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai/gpt-4o-mini"),
    ProviderPreset("ollama", "Ollama", "http://127.0.0.1:11434/v1", "llama3.1"),
    ProviderPreset("custom", "自定义（OpenAI 兼容）", "https://api.openai.com/v1", "gpt-4o-mini"),
)

fun PermissionMode.labelZh(): String = when (this) {
    PermissionMode.OBSERVER -> "观察"
    PermissionMode.CONFIRM -> "确认"
    PermissionMode.AUTO -> "自动"
}

data class WebSearchProviderPreset(
    val id: String,
    val name: String,
    val defaultApiHost: String,
    val requiresApiKey: Boolean,
)

val WEB_SEARCH_PRESETS = listOf(
    WebSearchProviderPreset("tavily", "Tavily", "https://api.tavily.com", true),
    WebSearchProviderPreset("exa", "Exa", "https://api.exa.ai", true),
    WebSearchProviderPreset("bocha", "Bocha", "https://api.bochaai.com", true),
    WebSearchProviderPreset("zhipu", "智谱", "https://open.bigmodel.cn/api/paas/v4", true),
    WebSearchProviderPreset("searxng", "SearXNG", "", false),
)

@Serializable
data class WebSearchConfig(
    val enabled: Boolean = false,
    val providerId: String = "tavily",
    val apiKey: String = "",
    val apiHost: String = "",
    val maxResults: Int = 5,
) {
    val preset: WebSearchProviderPreset
        get() = WEB_SEARCH_PRESETS.firstOrNull { it.id == providerId } ?: WEB_SEARCH_PRESETS.first()

    fun resolveHost(): String = apiHost.trim().trimEnd('/').ifBlank { preset.defaultApiHost }

    val ready: Boolean
        get() {
            if (!enabled) return false
            if (preset.requiresApiKey && apiKey.isBlank()) return false
            val host = resolveHost()
            if (providerId == "searxng" && host.isBlank()) return false
            if (host.isNotBlank()) {
                val ok = runCatching { java.net.URI(host).toURL() }.isSuccess
                if (!ok) return false
            }
            return true
        }
}

@Serializable
data class AiSettings(
    val providerId: String = "openai",
    val baseUrl: String = "https://api.openai.com/v1",
    val model: String = "gpt-4o-mini",
    val apiKey: String = "",
    val permissionMode: PermissionMode = PermissionMode.CONFIRM,
    val timeoutSeconds: Int = 60,
    val responseIdleTimeoutSeconds: Int = 120,
    val maxIterations: Int = 8,
    val commandBlocklist: List<String>? = null,
    val webSearch: WebSearchConfig = WebSearchConfig(),
) {
    val configured: Boolean
        get() = apiKey.isNotBlank() && model.isNotBlank() && baseUrl.isNotBlank()

    val preset: ProviderPreset
        get() = PROVIDER_PRESETS.firstOrNull { it.id == providerId } ?: PROVIDER_PRESETS.last()
}

class AiSettingsStore(context: Context) {
    private val appContext = context.applicationContext
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val mutex = Mutex()
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val file = File(appContext.filesDir, "ai-settings.json")
    private val _settings = MutableStateFlow(AiSettings())
    val settings: StateFlow<AiSettings> = _settings.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        mutex.withLock {
            _settings.value = read()
        }
    }

    suspend fun save(next: AiSettings) = withContext(Dispatchers.IO) {
        mutex.withLock {
            persist(next)
            _settings.value = next
        }
    }

    private fun read(): AiSettings {
        if (!file.exists()) return AiSettings()
        return runCatching {
            encrypted()
                .openFileInput()
                .use { json.decodeFromString<AiSettings>(it.readBytes().decodeToString()) }
        }.getOrDefault(AiSettings())
    }

    private fun persist(value: AiSettings) {
        val bytes = json.encodeToString(value).encodeToByteArray()
        if (file.exists()) file.delete()
        encrypted().openFileOutput().use { it.write(bytes) }
    }

    private fun encrypted(): EncryptedFile =
        EncryptedFile.Builder(
            appContext,
            file,
            masterKey,
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()
}
