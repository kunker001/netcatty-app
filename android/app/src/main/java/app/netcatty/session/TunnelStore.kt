package app.netcatty.session

import app.netcatty.data.ConnectSpec
import app.netcatty.data.TunnelRepository
import app.netcatty.data.TunnelRule
import app.netcatty.ssh.TunnelEngine
import app.netcatty.ssh.tunnelError
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class TunnelPhase {
    STOPPED,
    STARTING,
    ACTIVE,
    ERROR,
}

data class TunnelStatus(
    val phase: TunnelPhase,
    val error: String? = null,
)

class TunnelStore(
    private val repository: TunnelRepository,
    private val scope: CoroutineScope,
    private val specOf: (String) -> ConnectSpec?,
) {
    private val engine = TunnelEngine()
    private val generations = HashMap<String, Int>()
    private val autostarted = AtomicBoolean(false)
    private val _rules = MutableStateFlow<List<TunnelRule>>(emptyList())
    private val _status = MutableStateFlow<Map<String, TunnelStatus>>(emptyMap())

    val rules: StateFlow<List<TunnelRule>> = _rules.asStateFlow()
    val status: StateFlow<Map<String, TunnelStatus>> = _status.asStateFlow()

    suspend fun load() {
        _rules.value = repository.load()
    }

    fun autostart() {
        if (!autostarted.compareAndSet(false, true)) return
        _rules.value.filter { it.autoStart }.forEach { start(it) }
    }

    fun isRunning(id: String): Boolean {
        val phase = _status.value[id]?.phase
        return phase == TunnelPhase.ACTIVE || phase == TunnelPhase.STARTING
    }

    fun activeCount(): Int = _rules.value.count { isRunning(it.id) }

    fun start(rule: TunnelRule) {
        val phase = _status.value[rule.id]?.phase
        if (phase == TunnelPhase.ACTIVE || phase == TunnelPhase.STARTING) return
        val spec = specOf(rule.connectionId)
        if (spec == null) {
            _status.update { it + (rule.id to TunnelStatus(TunnelPhase.ERROR, "连接已不存在")) }
            return
        }
        val gen = bump(rule.id)
        _status.update { it + (rule.id to TunnelStatus(TunnelPhase.STARTING)) }
        scope.launch(Dispatchers.IO) {
            try {
                engine.open(
                    rule,
                    spec,
                    onDown = { message ->
                        scope.launch {
                            if (generation(rule.id) != gen) return@launch
                            _status.update { it + (rule.id to TunnelStatus(TunnelPhase.ERROR, message)) }
                        }
                    },
                    onConnectError = { message ->
                        scope.launch {
                            if (generation(rule.id) != gen) return@launch
                            _status.update { state ->
                                val current = state[rule.id] ?: return@update state
                                if (current.phase != TunnelPhase.ACTIVE && current.phase != TunnelPhase.STARTING) {
                                    state
                                } else {
                                    state + (rule.id to current.copy(error = message))
                                }
                            }
                        }
                    },
                )
                if (generation(rule.id) != gen) {
                    engine.close(rule.id)
                    return@launch
                }
                if (!engine.isOpen(rule.id)) return@launch
                _status.update { state ->
                    if (generation(rule.id) != gen || !engine.isOpen(rule.id)) {
                        state
                    } else if (state[rule.id]?.phase == TunnelPhase.ERROR) {
                        state
                    } else {
                        state + (rule.id to TunnelStatus(TunnelPhase.ACTIVE))
                    }
                }
            } catch (error: Exception) {
                if (generation(rule.id) != gen) return@launch
                engine.close(rule.id)
                _status.update { it + (rule.id to TunnelStatus(TunnelPhase.ERROR, tunnelError(error))) }
            }
        }
    }

    fun stop(id: String) {
        bump(id)
        engine.close(id)
        _status.update { it + (id to TunnelStatus(TunnelPhase.STOPPED)) }
    }

    suspend fun save(rule: TunnelRule) {
        stop(rule.id)
        val next = (_rules.value.filterNot { it.id == rule.id } + rule).sortedBy { it.createdAt }
        _rules.value = next
        _status.update { it - rule.id }
        repository.replace(next)
    }

    suspend fun delete(id: String) {
        stop(id)
        val next = _rules.value.filterNot { it.id == id }
        _rules.value = next
        _status.update { it - id }
        repository.replace(next)
    }

    suspend fun importRules(incoming: List<TunnelRule>, replace: Boolean, liveConnectionIds: Set<String>) {
        val accepted = incoming.filter { it.id.isNotBlank() && it.connectionId in liveConnectionIds }
        val next = if (replace) {
            accepted
        } else {
            val merged = _rules.value.associateBy { it.id }.toMutableMap()
            accepted.forEach { merged[it.id] = it }
            merged.values.filter { it.connectionId in liveConnectionIds }
        }.sortedBy { it.createdAt }
        val previous = _rules.value.associateBy { it.id }
        val stopIds = previous.filter { (id, rule) -> next.firstOrNull { it.id == id } != rule }.keys
        stopIds.forEach { stop(it) }
        _rules.value = next
        _status.update { it - stopIds }
        repository.replace(next)
    }

    suspend fun removeConnections(ids: Set<String>) {
        if (ids.isEmpty()) return
        val gone = _rules.value.filter { it.connectionId in ids }.map { it.id }
        gone.forEach { stop(it) }
        val next = _rules.value.filterNot { it.connectionId in ids }
        _rules.value = next
        _status.update { it - gone.toSet() }
        repository.replace(next)
    }

    private fun bump(id: String): Int = synchronized(generations) {
        val next = (generations[id] ?: 0) + 1
        generations[id] = next
        next
    }

    private fun generation(id: String): Int = synchronized(generations) { generations[id] ?: 0 }
}
