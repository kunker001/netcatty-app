package app.netcatty.data

import app.netcatty.ai.AiSettings
import app.netcatty.session.LiveSessionStore
import app.netcatty.session.TunnelStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class VaultSnapshot(
    val hosts: List<Host>,
    val connections: List<SshConnection>,
)

data class VaultImportSummary(
    val hosts: Int,
    val connections: Int,
    val tunnels: Int,
)

class VaultBackup(
    private val hosts: HostRepository,
    private val tunnels: TunnelStore,
    private val sessions: LiveSessionStore,
    private val onHostsRemoved: (Set<String>) -> Unit = {},
    private val currentAgent: () -> AiSettings = { AiSettings() },
    private val onAgentImported: suspend (AiSettings) -> Unit = {},
) {
    suspend fun exportEncrypted(password: String): ByteArray = withContext(Dispatchers.Default) {
        val snap = hosts.snapshot()
        VaultTransfer.encrypt(
            VaultPayload(
                hosts = snap.hosts,
                connections = snap.connections,
                tunnels = tunnels.rules.value,
                agent = currentAgent(),
            ),
            password,
        )
    }

    suspend fun openEncrypted(bytes: ByteArray, password: String): VaultPayload =
        withContext(Dispatchers.Default) {
            VaultTransfer.decrypt(bytes, password)
        }

    suspend fun commitImport(payload: VaultPayload, replace: Boolean): VaultImportSummary =
        withContext(Dispatchers.Default) {
            val clean = VaultTransfer.sanitize(payload)
            val before = hosts.snapshot()
            hosts.applyImport(clean, if (replace) VaultImportMode.REPLACE else VaultImportMode.MERGE)
            val after = hosts.snapshot()
            val removedHosts = before.hosts.map { it.id }.toSet() - after.hosts.map { it.id }.toSet()
            if (removedHosts.isNotEmpty()) onHostsRemoved(removedHosts)
            val removedConnections = before.connections.map { it.id }.toSet() - after.connections.map { it.id }.toSet()
            removedConnections.forEach(sessions::close)
            tunnels.importRules(
                clean.tunnels,
                replace = replace,
                liveConnectionIds = after.connections.map { it.id }.toSet(),
            )
            clean.agent?.let { onAgentImported(it) }
            VaultImportSummary(clean.hosts.size, clean.connections.size, clean.tunnels.size)
        }
}
