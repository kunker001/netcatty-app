package app.netcatty.data

import android.content.Context
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class TunnelRepository(context: Context) {
    private val appContext = context.applicationContext
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }
    private val masterKey = MasterKey.Builder(appContext)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val file = File(appContext.filesDir, "tunnels.json")

    suspend fun load(): List<TunnelRule> = withContext(Dispatchers.IO) { read() }

    suspend fun replace(rules: List<TunnelRule>) = withContext(Dispatchers.IO) {
        write(rules.sortedBy { it.createdAt })
    }

    private fun read(): List<TunnelRule> {
        if (!file.exists()) return emptyList()
        val text = runCatching {
            encrypted().openFileInput().use { it.readBytes().decodeToString() }
        }.getOrNull() ?: return emptyList()
        return runCatching { json.decodeFromString<TunnelFile>(text).rules }
            .getOrDefault(emptyList())
            .sortedBy { it.createdAt }
    }

    private fun write(rules: List<TunnelRule>) {
        val bytes = json.encodeToString(TunnelFile(rules = rules)).encodeToByteArray()
        if (file.exists()) file.delete()
        encrypted().openFileOutput().use { it.write(bytes) }
    }

    private fun encrypted(): EncryptedFile =
        EncryptedFile.Builder(
            appContext,
            file,
            masterKey,
            EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB,
        ).build()
}

@Serializable
private data class TunnelFile(
    val version: Int = 1,
    val rules: List<TunnelRule> = emptyList(),
)
