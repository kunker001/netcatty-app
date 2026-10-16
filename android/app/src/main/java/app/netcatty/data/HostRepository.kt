package app.netcatty.data

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import java.io.File
import java.util.UUID
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

class HostRepository(context: Context) {
    private val appContext = context.applicationContext
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val mutex = Mutex()
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val vaultFile = File(appContext.filesDir, "vault.json")

    private val _hosts = MutableStateFlow<List<Host>>(emptyList())
    val hosts: StateFlow<List<Host>> = _hosts.asStateFlow()

    private val _connections = MutableStateFlow<List<SshConnection>>(emptyList())
    val connections: StateFlow<List<SshConnection>> = _connections.asStateFlow()

    suspend fun load() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val vault = readVault()
            _hosts.value = vault.hosts.sortedHosts()
            _connections.value = vault.connections.sortedConns()
        }
    }

    fun host(id: String): Host? = _hosts.value.firstOrNull { it.id == id }

    fun connection(id: String): SshConnection? = _connections.value.firstOrNull { it.id == id }

    fun connectionsFor(hostId: String): List<SshConnection> =
        _connections.value.filter { it.hostId == hostId }

    fun spec(connectionId: String): ConnectSpec? {
        val conn = connection(connectionId) ?: return null
        val host = host(conn.hostId) ?: return null
        return ConnectSpec(
            connectionId = conn.id,
            hostId = host.id,
            title = conn.title(host),
            hostname = host.hostname,
            port = conn.port,
            username = conn.username,
            authMethod = conn.authMethod,
            password = conn.password,
            privateKey = conn.privateKey,
            passphrase = conn.passphrase,
            notes = host.notes,
            group = host.group,
        )
    }

    suspend fun upsertHost(host: Host): Host = withContext(Dispatchers.IO) {
        mutex.withLock {
            val next = host.copy(
                id = host.id.ifBlank { UUID.randomUUID().toString() },
                label = host.label.trim(),
                hostname = host.hostname.trim(),
                group = host.group.trim(),
                notes = host.notes.trimEnd(),
            )
            val updated = _hosts.value.filterNot { it.id == next.id }.plus(next).sortedHosts()
            persist(updated, _connections.value)
            _hosts.value = updated
            next
        }
    }

    suspend fun deleteHost(id: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val hosts = _hosts.value.filterNot { it.id == id }
            val connections = _connections.value.filterNot { it.hostId == id }
            persist(hosts, connections)
            _hosts.value = hosts
            _connections.value = connections
        }
    }

    suspend fun upsertConnection(connection: SshConnection): SshConnection = withContext(Dispatchers.IO) {
        mutex.withLock {
            require(connection.hostId.isNotBlank()) { "缺少主机" }
            val next = connection.copy(
                id = connection.id.ifBlank { UUID.randomUUID().toString() },
                label = connection.label.trim(),
                username = connection.username.trim(),
            )
            val updated = _connections.value.filterNot { it.id == next.id }.plus(next).sortedConns()
            persist(_hosts.value, updated)
            _connections.value = updated
            next
        }
    }

    suspend fun deleteConnection(id: String) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val updated = _connections.value.filterNot { it.id == id }
            persist(_hosts.value, updated)
            _connections.value = updated
        }
    }

    suspend fun togglePin(connectionId: String) {
        val current = connection(connectionId) ?: return
        upsertConnection(current.copy(pinned = !current.pinned))
    }

    suspend fun markConnected(connectionId: String) {
        val current = connection(connectionId) ?: return
        upsertConnection(current.copy(lastConnectedAt = System.currentTimeMillis()))
    }

    private fun List<Host>.sortedHosts(): List<Host> =
        sortedWith(compareBy<Host> { it.group.lowercase() }.thenBy { it.title.lowercase() })

    private fun List<SshConnection>.sortedConns(): List<SshConnection> =
        sortedWith(
            compareByDescending<SshConnection> { it.pinned }
                .thenByDescending { it.lastConnectedAt ?: 0L }
                .thenBy { it.label.ifBlank { it.username }.lowercase() },
        )

    private fun readVault(): VaultFile {
        if (!vaultFile.exists()) return VaultFile()
        val text = runCatching {
            encryptedFile()
                .openFileInput()
                .use { it.readBytes().decodeToString() }
        }.getOrNull() ?: return VaultFile()
        val current = runCatching { json.decodeFromString<VaultFile>(text) }.getOrNull()
        if (current != null && current.version >= 2) return current.copy(
            hosts = current.hosts.sortedHosts(),
            connections = current.connections.sortedConns(),
        )
        val legacy = runCatching { json.decodeFromString<LegacyVaultFile>(text) }.getOrNull()
            ?: return VaultFile()
        val migrated = migrate(legacy.hosts)
        persist(migrated.hosts, migrated.connections)
        return migrated
    }

    private fun migrate(legacy: List<LegacyHost>): VaultFile {
        val hosts = legacy.map { old ->
            Host(
                id = old.id,
                label = old.label,
                hostname = old.hostname,
                group = old.group,
                notes = old.notes,
                createdAt = old.createdAt,
            )
        }
        val connections = legacy.map { old ->
            SshConnection(
                id = old.id,
                hostId = old.id,
                label = old.label.ifBlank { old.username },
                port = old.port,
                username = old.username,
                authMethod = old.authMethod,
                password = old.password,
                privateKey = old.privateKey,
                passphrase = old.passphrase,
                pinned = old.pinned,
                createdAt = old.createdAt,
                lastConnectedAt = old.lastConnectedAt,
            )
        }
        return VaultFile(version = 2, hosts = hosts.sortedHosts(), connections = connections.sortedConns())
    }

    private fun persist(hosts: List<Host>, connections: List<SshConnection>) {
        val bytes = json.encodeToString(VaultFile(2, hosts, connections)).encodeToByteArray()
        if (vaultFile.exists()) vaultFile.delete()
        encryptedFile().openFileOutput().use { it.write(bytes) }
    }

    private fun encryptedFile(): EncryptedFile =
        EncryptedFile.Builder(
            appContext,
            vaultFile,
            masterKey,
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()
}

@Serializable
private data class VaultFile(
    val version: Int = 1,
    val hosts: List<Host> = emptyList(),
    val connections: List<SshConnection> = emptyList(),
)

@Serializable
private data class LegacyVaultFile(val hosts: List<LegacyHost> = emptyList())
