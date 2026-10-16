package app.netcatty.ai

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

data class WebSearchHit(
    val title: String,
    val url: String,
    val content: String,
)

object WebSearch {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()
    private val media = "application/json; charset=utf-8".toMediaType()

    suspend fun search(config: WebSearchConfig, query: String, maxResults: Int): List<WebSearchHit> =
        withContext(Dispatchers.IO) {
            val q = query.trim()
            require(q.isNotEmpty()) { "缺少搜索词" }
            require(config.ready) { "网络搜索未启用或未配置完整。请到设置 → 网络搜索。" }
            val limit = maxResults.coerceIn(1, 20)
            val hits = when (config.providerId) {
                "tavily" -> searchTavily(config, q, limit)
                "exa" -> searchExa(config, q, limit)
                "bocha" -> searchBocha(config, q, limit)
                "zhipu" -> searchZhipu(config, q)
                "searxng" -> searchSearxng(config, q)
                else -> error("不支持的搜索供应商：${config.providerId}")
            }
            hits.filter { it.title.isNotBlank() || it.url.isNotBlank() || it.content.isNotBlank() }
                .take(limit)
        }

    private fun searchTavily(config: WebSearchConfig, query: String, maxResults: Int): List<WebSearchHit> {
            val body = """{"query":${quote(query)},"max_results":$maxResults,"search_depth":"basic"}"""
        val data = postJson(
            "${config.resolveHost()}/search",
            mapOf("Authorization" to "Bearer ${config.apiKey.trim()}"),
            body,
        )
        return data.arr("results").map { item ->
            WebSearchHit(
                title = item.str("title"),
                url = item.str("url"),
                content = item.str("content"),
            )
        }
    }

    private fun searchExa(config: WebSearchConfig, query: String, maxResults: Int): List<WebSearchHit> {
        val body = """{"query":${quote(query)},"numResults":$maxResults,"contents":{"text":true}}"""
        val data = postJson(
            "${config.resolveHost()}/search",
            mapOf("x-api-key" to config.apiKey.trim()),
            body,
        )
        return data.arr("results").map { item ->
            WebSearchHit(
                title = item.str("title"),
                url = item.str("url"),
                content = item.str("text"),
            )
        }
    }

    private fun searchBocha(config: WebSearchConfig, query: String, maxResults: Int): List<WebSearchHit> {
        val body = """{"query":${quote(query)},"count":$maxResults,"summary":true}"""
        val data = postJson(
            "${config.resolveHost()}/v1/web-search",
            mapOf("Authorization" to "Bearer ${config.apiKey.trim()}"),
            body,
        )
        return data.obj("webPages").arr("value").map { item ->
            WebSearchHit(
                title = item.str("name"),
                url = item.str("url"),
                content = item.str("summary").ifBlank { item.str("snippet") },
            )
        }
    }

    private fun searchZhipu(config: WebSearchConfig, query: String): List<WebSearchHit> {
        val body = """{"search_query":${quote(query)},"search_engine":"search_std"}"""
        val data = postJson(
            "${config.resolveHost()}/web_search",
            mapOf("Authorization" to "Bearer ${config.apiKey.trim()}"),
            body,
        )
        return data.arr("search_result").map { item ->
            WebSearchHit(
                title = item.str("title"),
                url = item.str("link"),
                content = item.str("content"),
            )
        }
    }

    private fun searchSearxng(config: WebSearchConfig, query: String): List<WebSearchHit> {
        val host = config.resolveHost()
        require(host.isNotBlank()) { "SearXNG 需要填写 API 地址" }
        val url = "$host/search?q=${java.net.URLEncoder.encode(query, "UTF-8")}&format=json"
        val data = getJson(url)
        return data.arr("results").map { item ->
            WebSearchHit(
                title = item.str("title"),
                url = item.str("url"),
                content = item.str("content"),
            )
        }
    }

    private fun postJson(url: String, headers: Map<String, String>, body: String): JsonObject {
        val builder = Request.Builder()
            .url(url)
            .addHeader("Content-Type", "application/json")
            .post(body.toRequestBody(media))
        headers.forEach { (key, value) -> if (value.isNotBlank()) builder.addHeader(key, value) }
        return execute(builder.build())
    }

    private fun getJson(url: String): JsonObject {
        val request = Request.Builder().url(url).get().build()
        return execute(request)
    }

    private fun execute(request: Request): JsonObject {
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                error(text.take(240).ifBlank { "搜索失败 HTTP ${response.code}" })
            }
            return runCatching { json.parseToJsonElement(text).jsonObject }
                .getOrElse { error("搜索接口返回无法解析") }
        }
    }

    private fun quote(value: String): String = JsonPrimitive(value).toString()

    private fun JsonObject.str(key: String): String =
        this[key]?.jsonPrimitive?.contentOrNull.orEmpty()

    private fun JsonObject.obj(key: String): JsonObject =
        this[key]?.jsonObject ?: JsonObject(emptyMap())

    private fun JsonObject.arr(key: String): List<JsonObject> =
        runCatching { this[key]?.jsonArray }.getOrNull()
            ?.mapNotNull { runCatching { it.jsonObject }.getOrNull() }
            .orEmpty()
}

fun formatSearchHits(hits: List<WebSearchHit>): String {
    if (hits.isEmpty()) return "没有搜索结果。"
    return hits.mapIndexed { index, hit ->
        buildString {
            append("${index + 1}. ${hit.title.ifBlank { "(无标题)" }}")
            if (hit.url.isNotBlank()) append("\n${hit.url}")
            if (hit.content.isNotBlank()) append("\n${hit.content.take(500)}")
        }
    }.joinToString("\n\n")
}
