package app.netcatty.ai

import app.netcatty.data.ConnectSpec
import app.netcatty.ssh.SshSession
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

sealed class OpsEvent {
    data class AssistantDelta(val text: String) : OpsEvent()
    data class ToolStarted(val name: String, val detail: String) : OpsEvent()
    data class ToolFinished(val name: String, val detail: String, val ok: Boolean) : OpsEvent()
    data class Failed(val message: String) : OpsEvent()
}

class OpsAgent(
    private val target: ConnectSpec,
    private val session: SshSession,
    private val safety: CommandSafety,
    private val readContext: suspend (Int) -> String,
    private val confirm: suspend (command: String, reason: String) -> Boolean,
    private val onEvent: (OpsEvent) -> Unit,
    initialMode: PermissionMode,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val history = mutableListOf<JsonObject>()
    var permissionMode: PermissionMode = initialMode
        private set
    private var settings: AiSettings? = null

    init {
        history += systemMessage(buildOpsSystemPrompt(target, permissionMode, false))
    }

    fun setPermissionMode(mode: PermissionMode) {
        if (permissionMode == mode) return
        permissionMode = mode
        refreshSystemPrompt()
    }

    private fun refreshSystemPrompt() {
        if (history.isEmpty()) return
        history[0] = systemMessage(
            buildOpsSystemPrompt(target, permissionMode, settings?.webSearch?.ready == true),
        )
    }

    fun snapshotHistory(): List<JsonObject> = history.toList()

    fun restoreHistory(messages: List<JsonObject>) {
        if (messages.isEmpty()) return
        history.clear()
        history.addAll(messages)
    }

    suspend fun send(userText: String, settings: AiSettings) {
        this.settings = settings
        val prompt = userText.trim()
        if (prompt.isBlank()) return
        if (!settings.configured) {
            onEvent(OpsEvent.Failed("请先在设置里填写 API Key。"))
            return
        }
        if (session.connected.not()) {
            onEvent(OpsEvent.Failed("SSH 尚未连接。"))
            return
        }
        history += userMessage(prompt)
        refreshSystemPrompt()
        val client = LlmClient(settings, opsToolsJson(settings.webSearch.ready))
        try {
            repeat(settings.maxIterations.coerceIn(1, 100)) { step ->
                val turn = client.complete(history.toList())
                if (!turn.content.isNullOrBlank()) {
                    onEvent(OpsEvent.AssistantDelta(turn.content))
                }
                if (turn.toolCalls.isEmpty()) return
                history += assistantMessage(turn.content, turn.toolCalls)
                turn.toolCalls.forEach { call ->
                    val result = runTool(call)
                    history += toolMessage(call.id, result)
                }
                if (step == settings.maxIterations - 1) {
                    onEvent(OpsEvent.Failed("Stopped after ${settings.maxIterations} tool rounds."))
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            onEvent(OpsEvent.Failed(error.message ?: error.javaClass.simpleName))
        }
    }

    private suspend fun runTool(call: ToolCall): String {
        val args = runCatching { json.parseToJsonElement(call.arguments).jsonObject }
            .getOrDefault(JsonObject(emptyMap()))
        return when (call.name) {
            "get_environment" -> {
                onEvent(OpsEvent.ToolStarted(call.name, target.connectionLine))
                val text = environment()
                onEvent(OpsEvent.ToolFinished(call.name, text, true))
                text
            }
            "terminal_read_context" -> {
                val maxLines = args["maxLines"]?.jsonPrimitive?.intOrNull ?: 80
                onEvent(OpsEvent.ToolStarted(call.name, "last $maxLines lines"))
                val text = readContext(maxLines).ifBlank { "（终端缓冲区为空）" }
                onEvent(OpsEvent.ToolFinished(call.name, text.take(400), true))
                text.take(MAX_TOOL_CHARS)
            }
            "terminal_execute" -> execute(args)
            "web_search" -> searchWeb(args)
            else -> "Unknown tool: ${call.name}"
        }
    }

    private suspend fun searchWeb(args: JsonObject): String {
        val query = args["query"]?.jsonPrimitive?.contentOrNull.orEmpty().trim()
        val maxResults = args["maxResults"]?.jsonPrimitive?.intOrNull
            ?: settings?.webSearch?.maxResults
            ?: 5
        val config = settings?.webSearch
        if (config == null || !config.ready) {
            val text = "网络搜索未启用或未配置完整。请到设置 → 网络搜索。"
            onEvent(OpsEvent.ToolFinished("web_search", text, false))
            return text
        }
        onEvent(OpsEvent.ToolStarted("web_search", query))
        return try {
            val hits = WebSearch.search(config, query, maxResults)
            val text = formatSearchHits(hits)
            onEvent(OpsEvent.ToolFinished("web_search", text.take(500), true))
            text.take(MAX_TOOL_CHARS)
        } catch (error: Exception) {
            val message = error.message ?: error.javaClass.simpleName
            onEvent(OpsEvent.ToolFinished("web_search", message, false))
            "web search failed: $message"
        }
    }

    private suspend fun execute(args: JsonObject): String {
        val command = args["command"]?.jsonPrimitive?.contentOrNull.orEmpty().trim()
        val reason = args["reason"]?.jsonPrimitive?.contentOrNull.orEmpty().ifBlank { command }
        if (command.isBlank()) return "Missing command"
        safety.denyReason(command)?.let { denied ->
            onEvent(OpsEvent.ToolFinished("terminal_execute", denied, false))
            return denied
        }
        if (permissionMode == PermissionMode.OBSERVER) {
            val text = "观察模式：未执行命令。\n建议：$command\n$reason"
            onEvent(OpsEvent.ToolFinished("terminal_execute", text, true))
            return text
        }
        if (permissionMode == PermissionMode.CONFIRM) {
            val allowed = confirm(command, reason)
            if (!allowed) {
                onEvent(OpsEvent.ToolFinished("terminal_execute", "用户拒绝：$command", false))
                return "用户拒绝了命令：$command"
            }
        }
        onEvent(OpsEvent.ToolStarted("terminal_execute", "在终端执行：$command"))
        return try {
            val result = session.runInShell(command, settings?.timeoutSeconds ?: 60)
            val text = buildString {
                append("shell exit=${result.exitCode ?: "?"}")
                if (result.timedOut) append(" timed_out=true")
                if (result.stdout.isNotBlank()) {
                    append("\n")
                    append(result.stdout.take(MAX_TOOL_CHARS))
                } else {
                    append("\n(no output)")
                }
            }
            onEvent(OpsEvent.ToolFinished("terminal_execute", text.take(500), result.exitCode == 0 || result.exitCode == null))
            text
        } catch (error: Exception) {
            val message = error.message ?: error.javaClass.simpleName
            onEvent(OpsEvent.ToolFinished("terminal_execute", message, false))
            "exec failed: $message"
        }
    }

    private fun environment(): String = buildString {
        appendLine("connected=${session.connected}")
        appendLine("label=${target.title}")
        appendLine("target=${target.connectionLine}")
        appendLine("username=${target.username}")
        appendLine("hostname=${target.hostname}")
        appendLine("port=${target.port}")
        appendLine("group=${target.group}")
        appendLine("permissionMode=${permissionMode.name.lowercase()}")
        appendLine("protocol=ssh")
    }

    companion object {
        private const val MAX_TOOL_CHARS = 12_000
    }
}
