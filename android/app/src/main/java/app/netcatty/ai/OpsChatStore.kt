package app.netcatty.ai

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.File
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

data class OpsExecution(
    val hostId: String,
    val awaitingConfirm: Boolean,
    val title: String = "",
    val step: String = "",
) {
    val label: String get() = if (awaitingConfirm) "AI 等待确认" else "AI 执行中"
}

class OpsConversation(
    val id: String,
    val createdAt: Long,
    initialMode: PermissionMode,
    initialTitle: String = "新对话",
    initialUpdatedAt: Long = createdAt,
) {
    var title by mutableStateOf(initialTitle)
    var updatedAt by mutableStateOf(initialUpdatedAt)
    val items = mutableStateListOf<ChatItem>()
    var busy by mutableStateOf(false)
        private set
    var pending by mutableStateOf<PendingCommand?>(null)
        private set
    var permissionMode by mutableStateOf(initialMode)
    var agent: OpsAgent? = null
    var job: Job? = null
    var llmHistory: List<JsonObject> = emptyList()
    var onActivity: () -> Unit = {}

    fun preview(): String = title.ifBlank { "新对话" }

    fun markBusy(value: Boolean) {
        busy = value
        if (!value) pending = null
        onActivity()
    }

    fun markPending(value: PendingCommand?) {
        pending = value
        onActivity()
    }

    fun stop() {
        if (!busy) return
        pending?.gate?.complete(false)
        job?.cancel()
        job = null
        markBusy(false)
    }

    fun pause() {
        job?.cancel()
        job = null
        pending?.gate?.complete(false)
        pending = null
        busy = false
        agent = null
        onActivity()
    }
}

data class PendingCommand(
    val command: String,
    val reason: String,
    val gate: CompletableDeferred<Boolean>,
)

class OpsChatBucket(
    val hostId: String,
    private val defaultMode: PermissionMode,
    private val persist: () -> Unit,
) {
    val conversations = mutableStateListOf<OpsConversation>()
    var currentId by mutableStateOf<String?>(null)
        private set

    fun current(): OpsConversation {
        val id = currentId
        val found = conversations.firstOrNull { it.id == id }
        if (found != null) return found
        return newConversation()
    }

    fun newConversation(): OpsConversation {
        val reusable = conversations.firstOrNull { it.items.isEmpty() && !it.busy }
        if (reusable != null) {
            currentId = reusable.id
            persist()
            return reusable
        }
        val conv = wire(
            OpsConversation(
                id = UUID.randomUUID().toString(),
                createdAt = System.currentTimeMillis(),
                initialMode = defaultMode,
            ),
        )
        conversations.add(0, conv)
        currentId = conv.id
        persist()
        return conv
    }

    fun open(id: String) {
        if (conversations.none { it.id == id }) return
        currentId = id
        persist()
    }

    fun delete(id: String) {
        val conv = conversations.firstOrNull { it.id == id } ?: return
        conv.pause()
        conversations.remove(conv)
        if (currentId == id) {
            currentId = conversations.firstOrNull()?.id
            if (currentId == null) newConversation()
        }
        persist()
    }

    fun pauseAll() {
        conversations.forEach { it.pause() }
        persist()
    }

    internal fun restore(current: String?, loaded: List<OpsConversation>) {
        conversations.clear()
        conversations.addAll(loaded.map(::wire))
        currentId = current?.takeIf { id -> loaded.any { it.id == id } } ?: loaded.firstOrNull()?.id
    }

    private fun wire(conv: OpsConversation): OpsConversation {
        conv.onActivity = persist
        return conv
    }
}

class OpsChatStore(
    context: Context,
    private val scope: CoroutineScope,
) {
    private val dir = File(context.applicationContext.filesDir, "ops-chats").also { it.mkdirs() }
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        classDiscriminator = "kind"
    }
    private val mutex = Mutex()
    private val buckets = mutableMapOf<String, OpsChatBucket>()
    private val _executions = MutableStateFlow<List<OpsExecution>>(emptyList())
    val executions: StateFlow<List<OpsExecution>> = _executions.asStateFlow()

    fun bucket(
        hostId: String,
        defaultMode: PermissionMode,
        legacyIds: List<String> = emptyList(),
    ): OpsChatBucket {
        buckets[hostId]?.let { return it }
        val bucket = OpsChatBucket(hostId, defaultMode) { persist(hostId) }
        loadHost(hostId, legacyIds)?.let { saved ->
            bucket.restore(
                saved.currentId,
                saved.conversations.map { it.toConversation() },
            )
        }
        buckets[hostId] = bucket
        persist(hostId)
        return bucket
    }

    fun persist(hostId: String) {
        publishExecutions()
        val bucket = buckets[hostId] ?: return
        val snapshot = bucket.toPersisted()
        scope.launch(Dispatchers.IO) {
            mutex.withLock {
                runCatching {
                    fileFor(hostId).writeText(json.encodeToString(snapshot))
                }
            }
        }
    }

    fun pause(hostId: String) {
        buckets[hostId]?.pauseAll()
        publishExecutions()
    }

    fun deleteHost(hostId: String) {
        buckets.remove(hostId)?.pauseAll()
        runCatching { fileFor(hostId).delete() }
        publishExecutions()
    }

    private fun publishExecutions() {
        _executions.value = buckets.values.mapNotNull { bucket ->
            val conv = bucket.conversations.firstOrNull { it.busy } ?: return@mapNotNull null
            val pending = conv.pending
            val lastTool = conv.items.lastOrNull { it is ChatItem.Tool } as? ChatItem.Tool
            val step = when {
                pending != null -> "等待确认：${pending.command}"
                lastTool?.running == true -> lastTool.detail.ifBlank { lastTool.name }
                lastTool != null -> lastTool.detail.ifBlank { lastTool.name }
                else -> "正在思考…"
            }
            OpsExecution(
                hostId = bucket.hostId,
                awaitingConfirm = pending != null,
                title = conv.title,
                step = step.replace('\n', ' ').trim().take(120),
            )
        }
    }

    private fun loadHost(hostId: String, legacyIds: List<String>): PersistedBucket? {
        loadFile(hostId)?.let { return it }
        val parts = legacyIds.mapNotNull(::loadFile)
        if (parts.isEmpty()) return null
        val merged = parts.flatMap { it.conversations }.distinctBy { it.id }
            .sortedByDescending { it.updatedAt }
        return PersistedBucket(
            currentId = parts.first().currentId,
            conversations = merged,
        )
    }

    private fun loadFile(id: String): PersistedBucket? {
        val file = fileFor(id)
        if (!file.exists()) return null
        return runCatching {
            json.decodeFromString<PersistedBucket>(file.readText())
        }.getOrNull()
    }

    private fun fileFor(id: String): File {
        val safe = id.replace(Regex("[^A-Za-z0-9._-]"), "_")
        return File(dir, "$safe.json")
    }
}

@Serializable
private data class PersistedBucket(
    val currentId: String? = null,
    val conversations: List<PersistedConversation> = emptyList(),
)

@Serializable
private data class PersistedConversation(
    val id: String,
    val createdAt: Long,
    val updatedAt: Long,
    val title: String,
    val permissionMode: PermissionMode,
    val items: List<ChatItem> = emptyList(),
    val llmHistory: List<JsonObject> = emptyList(),
)

private fun OpsChatBucket.toPersisted(): PersistedBucket = PersistedBucket(
    currentId = currentId,
    conversations = conversations.map { conv ->
        PersistedConversation(
            id = conv.id,
            createdAt = conv.createdAt,
            updatedAt = conv.updatedAt,
            title = conv.title,
            permissionMode = conv.permissionMode,
            items = conv.items.toList(),
            llmHistory = conv.agent?.snapshotHistory() ?: conv.llmHistory,
        )
    },
)

private fun PersistedConversation.toConversation(): OpsConversation {
    val conv = OpsConversation(
        id = id,
        createdAt = createdAt,
        initialMode = permissionMode,
        initialTitle = title,
        initialUpdatedAt = updatedAt,
    )
    conv.items.addAll(items)
    conv.llmHistory = llmHistory
    return conv
}

fun relativeTime(timestamp: Long): String {
    val delta = (System.currentTimeMillis() - timestamp).coerceAtLeast(0)
    return when {
        delta < 60_000 -> "刚刚"
        delta < 3_600_000 -> "${delta / 60_000} 分钟前"
        delta < 86_400_000 -> "${delta / 3_600_000} 小时前"
        else -> "${delta / 86_400_000} 天前"
    }
}
