package app.netcatty.data

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.security.spec.KeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import app.netcatty.ai.AiSettings
import app.netcatty.ai.ensureProfiles
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

fun readBackupBytes(input: InputStream, max: Int = VaultTransfer.MAX_BYTES): ByteArray {
    val buffer = ByteArrayOutputStream()
    val chunk = ByteArray(16 * 1024)
    var total = 0
    while (true) {
        val read = input.read(chunk)
        if (read < 0) break
        total += read
        if (total > max) throw VaultTransferException("备份文件过大")
        buffer.write(chunk, 0, read)
    }
    return buffer.toByteArray()
}

class VaultTransferException(message: String) : Exception(message)

enum class VaultImportMode {
    MERGE,
    REPLACE,
}

@Serializable
data class VaultPayload(
    val version: Int = 1,
    val hosts: List<Host> = emptyList(),
    val connections: List<SshConnection> = emptyList(),
    val tunnels: List<TunnelRule> = emptyList(),
    /** Absent in older backups. Import leaves the local Catty config alone. */
    val agent: AiSettings? = null,
)

@Serializable
private data class VaultEnvelope(
    val app: String,
    val format: Int,
    val kdf: String,
    val iterations: Int,
    val salt: String,
    val iv: String,
    val ciphertext: String,
)

/**
 * Portable password backup. The envelope is JSON; the payload inside is
 * AES-256-GCM with a PBKDF2-HMAC-SHA256 key. Device-bound storage is separate.
 */
object VaultTransfer {
    const val MAX_BYTES = 8 * 1024 * 1024
    private const val FORMAT = 1
    private const val APP = "netcatty"
    private const val KDF = "PBKDF2-HMAC-SHA256"
    private const val ITERATIONS = 210_000
    private const val AAD = "netcatty-vault-v1"

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val random = SecureRandom()

    fun encrypt(payload: VaultPayload, password: String): ByteArray {
        if (password.length < 4) throw VaultTransferException("密码至少 4 位")
        val clean = sanitize(payload)
        if (clean.version != 1) throw VaultTransferException("无法识别的备份文件")
        val salt = ByteArray(16).also { random.nextBytes(it) }
        val iv = ByteArray(12).also { random.nextBytes(it) }
        val key = deriveKey(password, salt, ITERATIONS)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            cipher.updateAAD(AAD.toByteArray(Charsets.UTF_8))
            val plain = json.encodeToString(clean).encodeToByteArray()
            val ciphertext = try {
                cipher.doFinal(plain)
            } finally {
                plain.fill(0)
            }
            return json.encodeToString(
                VaultEnvelope(
                    app = APP,
                    format = FORMAT,
                    kdf = KDF,
                    iterations = ITERATIONS,
                    salt = Base64.getEncoder().encodeToString(salt),
                    iv = Base64.getEncoder().encodeToString(iv),
                    ciphertext = Base64.getEncoder().encodeToString(ciphertext),
                ),
            ).encodeToByteArray()
        } finally {
            key.fill(0)
        }
    }

    fun decrypt(bytes: ByteArray, password: String): VaultPayload {
        if (bytes.size > MAX_BYTES) throw VaultTransferException("备份文件过大")
        if (password.isEmpty()) throw VaultTransferException("请输入密码")
        val envelope = parseEnvelope(bytes)
        if (envelope.app != APP || envelope.format != FORMAT || envelope.kdf != KDF || envelope.iterations != ITERATIONS) {
            throw VaultTransferException("无法识别的备份文件")
        }
        val salt = decode(envelope.salt)
        val iv = decode(envelope.iv)
        val ciphertext = decode(envelope.ciphertext)
        if (salt == null || iv == null || ciphertext == null || salt.size != 16 || iv.size != 12 || ciphertext.size < 16) {
            throw VaultTransferException("无法识别的备份文件")
        }
        val key = deriveKey(password, salt, envelope.iterations)
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
            cipher.updateAAD(AAD.toByteArray(Charsets.UTF_8))
            val plain = try {
                cipher.doFinal(ciphertext)
            } catch (_: GeneralSecurityException) {
                throw VaultTransferException("密码不正确，或文件已损坏")
            }
            try {
                val payload = try {
                    json.decodeFromString<VaultPayload>(plain.toString(Charsets.UTF_8))
                } catch (_: SerializationException) {
                    throw VaultTransferException("密码不正确，或文件已损坏")
                }
                if (payload.version != 1) throw VaultTransferException("无法识别的备份文件")
                return sanitize(payload)
            } finally {
                plain.fill(0)
            }
        } finally {
            key.fill(0)
        }
    }

    fun sanitize(payload: VaultPayload): VaultPayload {
        val hosts = payload.hosts
            .asSequence()
            .filter { it.id.isNotBlank() && it.hostname.isNotBlank() }
            .map {
                it.copy(
                    label = it.label.trim(),
                    hostname = it.hostname.trim(),
                    group = it.group.trim(),
                    notes = it.notes.trimEnd(),
                )
            }
            .associateBy { it.id }
            .values
            .toList()
        val hostIds = hosts.map { it.id }.toSet()
        val connections = payload.connections
            .asSequence()
            .filter { it.id.isNotBlank() && it.hostId in hostIds }
            .map {
                it.copy(
                    label = it.label.trim(),
                    username = it.username.trim(),
                    port = if (it.port in 1..65535) it.port else 22,
                )
            }
            .associateBy { it.id }
            .values
            .toList()
        val connectionIds = connections.map { it.id }.toSet()
        val tunnels = payload.tunnels
            .filter { rule ->
                rule.id.isNotBlank() &&
                    rule.connectionId in connectionIds &&
                    rule.listenPort in 1..65535 &&
                    (rule.kind == TunnelKind.DYNAMIC || rule.targetPort in 1..65535)
            }
            .associateBy { it.id }
            .values
            .toList()
        return VaultPayload(
            version = 1,
            hosts = hosts,
            connections = connections,
            tunnels = tunnels,
            agent = payload.agent?.let(::sanitizeAgent),
        )
    }

    private fun sanitizeAgent(settings: AiSettings): AiSettings {
        val search = settings.webSearch
        return settings.copy(
            providerId = settings.providerId.trim().ifBlank { "openai" },
            baseUrl = settings.baseUrl.trim(),
            model = settings.model.trim(),
            apiKey = settings.apiKey.trim(),
            timeoutSeconds = settings.timeoutSeconds.coerceIn(1, 86_400),
            responseIdleTimeoutSeconds = settings.responseIdleTimeoutSeconds.coerceIn(1, 86_400),
            maxIterations = settings.maxIterations.coerceIn(1, 100),
            commandBlocklist = settings.commandBlocklist
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
                ?.distinct(),
            webSearch = search.copy(
                providerId = search.providerId.trim().ifBlank { "tavily" },
                apiKey = search.apiKey.trim(),
                apiHost = search.apiHost.trim(),
                maxResults = search.maxResults.coerceIn(1, 20),
            ),
        ).ensureProfiles()
    }

    fun merge(
        hosts: List<Host>,
        connections: List<SshConnection>,
        incoming: VaultPayload,
    ): Pair<List<Host>, List<SshConnection>> {
        val hostMap = hosts.associateBy { it.id }.toMutableMap()
        incoming.hosts.forEach { hostMap[it.id] = it }
        val hostIds = hostMap.keys
        val connectionMap = connections.associateBy { it.id }.toMutableMap()
        incoming.connections.filter { it.hostId in hostIds }.forEach { connectionMap[it.id] = it }
        val kept = connectionMap.values.filter { it.hostId in hostIds }
        return hostMap.values.toList() to kept.toList()
    }

    private fun parseEnvelope(bytes: ByteArray): VaultEnvelope {
        val text = bytes.toString(Charsets.UTF_8)
        return runCatching { json.decodeFromString<VaultEnvelope>(text) }.getOrElse {
            throw VaultTransferException("无法识别的备份文件")
        }
    }

    private fun decode(value: String): ByteArray? =
        runCatching { Base64.getDecoder().decode(value) }.getOrNull()

    private fun deriveKey(password: String, salt: ByteArray, iterations: Int): ByteArray {
        val chars = password.toCharArray()
        val spec: KeySpec = PBEKeySpec(chars, salt, iterations, 256)
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                .generateSecret(spec)
                .encoded
        } finally {
            (spec as PBEKeySpec).clearPassword()
            chars.fill('\u0000')
        }
    }
}
