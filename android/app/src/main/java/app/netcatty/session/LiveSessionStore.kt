package app.netcatty.session

import app.netcatty.data.ConnectSpec
import app.netcatty.ssh.SshSession
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

enum class LiveStatus {
    CONNECTING,
    CONNECTED,
    FAILED,
}

data class LiveSession(
    val id: String,
    val spec: ConnectSpec,
    val session: SshSession,
    val status: LiveStatus,
    val error: String? = null,
)

class LiveSessionStore(
    private val scope: CoroutineScope,
    private val onRemoved: (String) -> Unit = {},
) {
    private val _sessions = MutableStateFlow<List<LiveSession>>(emptyList())
    val sessions: StateFlow<List<LiveSession>> = _sessions.asStateFlow()

    fun get(id: String): LiveSession? = _sessions.value.firstOrNull { it.id == id }

    fun start(spec: ConnectSpec): LiveSession {
        get(spec.connectionId)?.let { existing ->
            if (existing.status != LiveStatus.FAILED) return existing
            close(existing.id)
        }
        lateinit var live: LiveSession
        val ssh = SshSession(
            scope = scope,
            onReady = {
                _sessions.update { list ->
                    list.map {
                        if (it.id == spec.connectionId) it.copy(status = LiveStatus.CONNECTED, error = null) else it
                    }
                }
            },
            onClosed = { reason ->
                if (reason == null) {
                    _sessions.update { list -> list.filterNot { it.id == spec.connectionId } }
                    onRemoved(spec.hostId)
                } else {
                    _sessions.update { list ->
                        list.map {
                            if (it.id == spec.connectionId) {
                                it.copy(status = LiveStatus.FAILED, error = reason)
                            } else {
                                it
                            }
                        }
                    }
                }
            },
        )
        live = LiveSession(
            id = spec.connectionId,
            spec = spec,
            session = ssh,
            status = LiveStatus.CONNECTING,
        )
        _sessions.update { list -> list.filterNot { it.id == live.id } + live }
        ssh.connect(spec)
        return live
    }

    fun close(id: String) {
        val current = get(id) ?: return
        current.session.disconnect()
        _sessions.update { list -> list.filterNot { it.id == id } }
        onRemoved(current.spec.hostId)
    }

    fun updateHostNotes(hostId: String, notes: String) {
        _sessions.update { list ->
            list.map { live ->
                if (live.spec.hostId == hostId) live.copy(spec = live.spec.copy(notes = notes)) else live
            }
        }
    }
}
