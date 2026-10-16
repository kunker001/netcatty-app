package app.netcatty.ai

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

@Serializable
data class ToolCall(
    val id: String,
    val name: String,
    val arguments: String,
)

data class LlmTurn(
    val content: String?,
    val toolCalls: List<ToolCall>,
)

class LlmClient(private val settings: AiSettings, private val toolsJson: String) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
    }
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(settings.responseIdleTimeoutSeconds.coerceIn(5, 86_400).toLong(), TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    suspend fun complete(messages: List<JsonObject>): LlmTurn = withContext(Dispatchers.IO) {
        val root = settings.baseUrl.trim().trimEnd('/')
        val url = if (root.endsWith("/chat/completions")) root else "$root/chat/completions"
        val body = buildJsonObject {
            put("model", JsonPrimitive(settings.model.trim()))
            put("messages", JsonArray(messages))
            put("tools", json.parseToJsonElement(toolsJson))
            put("tool_choice", JsonPrimitive("auto"))
        }
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer ${settings.apiKey.trim()}")
            .addHeader("Content-Type", "application/json")
            .post(json.encodeToString(body).toRequestBody(JSON))
            .build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                error(extractError(text).ifBlank { "LLM HTTP ${response.code}" })
            }
            parseTurn(text)
        }
    }

    private fun parseTurn(text: String): LlmTurn {
        val root = json.parseToJsonElement(text).jsonObject
        val message = root["choices"]
            ?.jsonArray
            ?.firstOrNull()
            ?.jsonObject
            ?.get("message")
            ?.jsonObject
            ?: error("LLM response missing choices[0].message")
        val content = message["content"]?.let { element ->
            when (element) {
                is JsonNull -> null
                is JsonPrimitive -> element.contentOrNull
                else -> element.toString()
            }?.takeIf { it.isNotBlank() }
        }
        val toolCalls = message["tool_calls"]?.jsonArray.orEmpty().mapNotNull { item ->
            val obj = item.jsonObject
            val fn = obj["function"]?.jsonObject ?: return@mapNotNull null
            ToolCall(
                id = obj["id"]?.jsonPrimitive?.contentOrNull ?: "call_${fn["name"]}",
                name = fn["name"]?.jsonPrimitive?.content.orEmpty(),
                arguments = fn["arguments"]?.jsonPrimitive?.contentOrNull ?: "{}",
            )
        }.filter { it.name.isNotBlank() }
        return LlmTurn(content = content, toolCalls = toolCalls)
    }

    private fun extractError(text: String): String {
        return runCatching {
            json.parseToJsonElement(text).jsonObject["error"]
                ?.jsonObject
                ?.get("message")
                ?.jsonPrimitive
                ?.content
        }.getOrNull().orEmpty().ifBlank { text.take(400) }
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

suspend fun fetchLlmModels(baseUrl: String, apiKey: String): List<String> = withContext(Dispatchers.IO) {
    val root = baseUrl.trim().trimEnd('/')
    require(root.isNotBlank()) { "请先填写接口地址" }
    val url = if (root.endsWith("/models")) root else "$root/models"
    val builder = Request.Builder()
        .url(url)
        .get()
        .addHeader("Content-Type", "application/json")
    val key = apiKey.trim()
    if (key.isNotBlank()) builder.addHeader("Authorization", "Bearer $key")
    val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()
    http.newCall(builder.build()).execute().use { response ->
        val text = response.body?.string().orEmpty()
        if (!response.isSuccessful) {
            val message = runCatching {
                modelsJson.parseToJsonElement(text).jsonObject["error"]
                    ?.jsonObject
                    ?.get("message")
                    ?.jsonPrimitive
                    ?.content
            }.getOrNull().orEmpty().ifBlank { text.take(240) }
            error(message.ifBlank { "获取模型失败 HTTP ${response.code}" })
        }
        parseModelIds(text)
    }
}

private val modelsJson = Json { ignoreUnknownKeys = true }

private fun parseModelIds(text: String): List<String> {
    val root = modelsJson.parseToJsonElement(text).jsonObject
    val rows = root["data"]?.jsonArray
        ?: root["models"]?.jsonArray
        ?: error("接口没有返回模型列表")
    val ids = rows.mapNotNull { item ->
        val obj = item.jsonObject
        obj["id"]?.jsonPrimitive?.contentOrNull
            ?: obj["name"]?.jsonPrimitive?.contentOrNull
    }.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    if (ids.isEmpty()) error("模型列表为空")
    val chatFirst = listOf(
        "gpt", "o1", "o3", "o4", "chat", "claude", "gemini", "qwen", "deepseek",
        "llama", "mistral", "kimi", "moonshot", "glm", "yi-", "command",
    )
    return ids.sortedWith(
        compareBy<String> { id ->
            val lower = id.lowercase()
            if (chatFirst.any { token -> lower.contains(token) }) 0 else 1
        }.thenBy { it.lowercase() },
    )
}

fun userMessage(text: String): JsonObject = buildJsonObject {
    put("role", JsonPrimitive("user"))
    put("content", JsonPrimitive(text))
}

fun systemMessage(text: String): JsonObject = buildJsonObject {
    put("role", JsonPrimitive("system"))
    put("content", JsonPrimitive(text))
}

fun assistantMessage(content: String?, toolCalls: List<ToolCall>): JsonObject = buildJsonObject {
    put("role", JsonPrimitive("assistant"))
    if (!content.isNullOrBlank()) put("content", JsonPrimitive(content))
    if (toolCalls.isNotEmpty()) {
        put(
            "tool_calls",
            buildJsonArray {
                toolCalls.forEach { call ->
                    add(
                        buildJsonObject {
                            put("id", JsonPrimitive(call.id))
                            put("type", JsonPrimitive("function"))
                            put(
                                "function",
                                buildJsonObject {
                                    put("name", JsonPrimitive(call.name))
                                    put("arguments", JsonPrimitive(call.arguments))
                                },
                            )
                        },
                    )
                }
            },
        )
    }
}

fun toolMessage(callId: String, content: String): JsonObject = buildJsonObject {
    put("role", JsonPrimitive("tool"))
    put("tool_call_id", JsonPrimitive(callId))
    put("content", JsonPrimitive(content))
}
