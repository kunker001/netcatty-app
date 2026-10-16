package app.netcatty.ssh

import android.os.SystemClock
import app.netcatty.data.ConnectSpec
import java.net.InetSocketAddress
import java.net.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

enum class NetQuality {
    GOOD,
    FAIR,
    POOR,
    UNKNOWN,
}

data class HostPing(
    val rttMs: Long? = null,
    val quality: NetQuality = NetQuality.UNKNOWN,
) {
    val label: String
        get() = when {
            quality == NetQuality.UNKNOWN && rttMs == null -> "检测中"
            rttMs == null -> "超时"
            else -> "${rttMs} ms"
        }
}

class HostPingMonitor {
    private val mutex = Mutex()
    private val _pings = MutableStateFlow<Map<String, HostPing>>(emptyMap())
    val pings: StateFlow<Map<String, HostPing>> = _pings.asStateFlow()

    suspend fun refresh(specs: List<ConnectSpec>, skipHostIds: Set<String> = emptySet()) {
        mutex.withLock {
            val unique = specs.distinctBy { it.hostId }
            val keep = unique.map { it.hostId }.toSet()
            val pending = unique.filter { it.hostId !in skipHostIds }
            if (pending.isEmpty()) {
                _pings.value = _pings.value.filterKeys { it in keep }
                return
            }
            val measured = coroutineScope {
                pending.map { spec ->
                    async(Dispatchers.IO) {
                        val rtt = probe(spec.hostname, spec.port)
                        spec.hostId to HostPing(rttMs = rtt, quality = qualityOf(rtt))
                    }
                }.awaitAll()
            }
            _pings.value = (_pings.value + measured.toMap()).filterKeys { it in keep }
        }
    }

    companion object {
        fun qualityOf(rttMs: Long?): NetQuality = when {
            rttMs == null -> NetQuality.POOR
            rttMs < 80 -> NetQuality.GOOD
            rttMs < 200 -> NetQuality.FAIR
            else -> NetQuality.POOR
        }
    }
}

private suspend fun probe(hostname: String, port: Int, timeoutMs: Int = 2500): Long? =
    withContext(Dispatchers.IO) {
        val start = SystemClock.elapsedRealtime()
        runCatching {
            Socket().use { socket ->
                socket.connect(InetSocketAddress(hostname, port), timeoutMs)
            }
            SystemClock.elapsedRealtime() - start
        }.getOrNull()
    }
