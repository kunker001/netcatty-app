package app.netcatty.ssh

import app.netcatty.session.LiveSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex

data class HostStats(
    val cpuPercent: Int? = null,
    val memPercent: Int? = null,
    val memUsedKb: Long? = null,
    val memTotalKb: Long? = null,
    val diskPercent: Int? = null,
    val diskUsedKb: Long? = null,
    val diskTotalKb: Long? = null,
) {
    val cpuLabel: String get() = cpuPercent?.let { "$it%" } ?: "—"
    val memLabel: String get() = memPercent?.let { "$it%" } ?: "—"
    val diskLabel: String get() = diskPercent?.let { "$it%" } ?: "—"
}

class HostStatsMonitor {
    private val mutex = Mutex()
    private val cpuPrev = mutableMapOf<String, Pair<Long, Long>>()
    private val _stats = MutableStateFlow<Map<String, HostStats>>(emptyMap())
    val stats: StateFlow<Map<String, HostStats>> = _stats.asStateFlow()

    suspend fun refresh(sessions: List<LiveSession>) {
        if (!mutex.tryLock()) return
        try {
            val connected = sessions.filter { it.session.connected }
            val keep = sessions.map { it.id }.toSet()
            cpuPrev.keys.retainAll(keep)
            if (connected.isEmpty()) {
                _stats.value = _stats.value.filterKeys { it in keep }
                return
            }
            val measured = coroutineScope {
                connected.map { live ->
                    async(Dispatchers.IO) {
                        live.id to runCatching { sample(live.id, live.session) }.getOrNull()
                    }
                }.awaitAll()
            }
            val next = measured.mapNotNull { (id, value) -> value?.let { id to it } }.toMap()
            _stats.value = (_stats.value + next).filterKeys { it in keep }
        } finally {
            mutex.unlock()
        }
    }

    private suspend fun sample(id: String, session: SshSession): HostStats {
        val result = session.execLogin(SAMPLE_SCRIPT, timeoutSeconds = 8)
    val text = (result.stdout + "\n" + result.stderr)
    val cpuLine = Regex("""^CPU\s+(\d+)\s+(\d+)\s*$""", RegexOption.MULTILINE).find(text)
    val mem = Regex("""^MEM\s+(\d+)\s+(\d+)\s*$""", RegexOption.MULTILINE).find(text)
    val disk = Regex("""^DISK\s+(\d+)\s+(\d+)\s+(\d+)\s*$""", RegexOption.MULTILINE).find(text)
    val cpuNow = cpuLine?.let { it.groupValues[1].toLong() to it.groupValues[2].toLong() }
    val previous = cpuNow?.let { cpuPrev.put(id, it) }
    val cpuPercent = if (cpuNow != null && previous != null) {
        val dt = (cpuNow.first - previous.first).coerceAtLeast(1L)
        val di = (cpuNow.second - previous.second).coerceAtLeast(0L)
        (((dt - di) * 100L) / dt).toInt().coerceIn(0, 100)
    } else {
        _stats.value[id]?.cpuPercent
    }
    val memTotal = mem?.groupValues?.get(1)?.toLongOrNull()?.takeIf { it > 0 }
    val memAvail = mem?.groupValues?.get(2)?.toLongOrNull()
    val memPercent = if (memTotal != null && memAvail != null) {
        (((memTotal - memAvail).coerceAtLeast(0) * 100L) / memTotal).toInt().coerceIn(0, 100)
    } else {
        null
    }
    val diskTotal = disk?.groupValues?.get(1)?.toLongOrNull()?.takeIf { it > 0 }
    val diskUsed = disk?.groupValues?.get(2)?.toLongOrNull()
    val diskPercent = disk?.groupValues?.get(3)?.toIntOrNull()?.coerceIn(0, 100)
        ?: if (diskTotal != null && diskUsed != null) {
            ((diskUsed * 100L) / diskTotal).toInt().coerceIn(0, 100)
        } else {
            null
        }
    if (cpuPercent == null && memPercent == null && diskPercent == null) {
        error("no stats")
    }
        return HostStats(
            cpuPercent = cpuPercent,
            memPercent = memPercent,
            memUsedKb = if (memTotal != null && memAvail != null) memTotal - memAvail else null,
            memTotalKb = memTotal,
            diskPercent = diskPercent,
            diskUsedKb = diskUsed,
            diskTotalKb = diskTotal,
        )
    }
}

private val SAMPLE_SCRIPT = """
echo CPU ${'$'}(awk '/^cpu /{print ${'$'}2+${'$'}3+${'$'}4+${'$'}5+${'$'}6+${'$'}7+${'$'}8+${'$'}9, ${'$'}5+${'$'}6}' /proc/stat 2>/dev/null)
echo MEM ${'$'}(awk '/MemTotal:/{t=${'$'}2} /MemAvailable:/{a=${'$'}2} /MemFree:/{f=${'$'}2} /Buffers:/{b=${'$'}2} /^Cached:/{c=${'$'}2} END{ if(a+0==0) a=f+b+c; print t+0, a+0 }' /proc/meminfo 2>/dev/null)
echo DISK ${'$'}(df -Pk / 2>/dev/null | awk 'NR==2{gsub("%","",${'$'}5); print ${'$'}2,${'$'}3,${'$'}5}')
""".trimIndent()
