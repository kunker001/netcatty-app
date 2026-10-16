package app.netcatty.data

import kotlinx.serialization.Serializable

@Serializable
enum class AuthMethod {
    PASSWORD,
    KEY,
}

@Serializable
data class Host(
    val id: String,
    val label: String,
    val hostname: String,
    val group: String = "",
    val notes: String = "",
    val createdAt: Long = System.currentTimeMillis(),
) {
    val title: String
        get() = label.ifBlank { hostname }

    fun notePreview(maxChars: Int = 80): String? {
        val first = notes.trim().lineSequence().firstOrNull { it.isNotBlank() } ?: return null
        return if (first.length <= maxChars) first else first.take(maxChars - 1) + "…"
    }
}

@Serializable
data class SshConnection(
    val id: String,
    val hostId: String,
    val label: String = "",
    val port: Int = 22,
    val username: String,
    val authMethod: AuthMethod = AuthMethod.PASSWORD,
    val password: String = "",
    val privateKey: String = "",
    val passphrase: String = "",
    val pinned: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val lastConnectedAt: Long? = null,
) {
    fun title(host: Host?): String {
        val own = label.ifBlank { username }
        val hostTitle = host?.title.orEmpty()
        return if (hostTitle.isBlank() || hostTitle == own) own else "$own · $hostTitle"
    }

    fun connectionLine(host: Host?): String = buildString {
        if (username.isNotBlank()) append(username).append('@')
        append(host?.hostname.orEmpty())
        if (port != 22) append(':').append(port)
    }
}

data class ConnectSpec(
    val connectionId: String,
    val hostId: String,
    val title: String,
    val hostname: String,
    val port: Int,
    val username: String,
    val authMethod: AuthMethod,
    val password: String,
    val privateKey: String,
    val passphrase: String,
    val notes: String,
    val group: String,
) {
    val connectionLine: String
        get() = buildString {
            if (username.isNotBlank()) append(username).append('@')
            append(hostname)
            if (port != 22) append(':').append(port)
        }
}

@Serializable
internal data class LegacyHost(
    val id: String,
    val label: String = "",
    val hostname: String,
    val port: Int = 22,
    val username: String = "",
    val authMethod: AuthMethod = AuthMethod.PASSWORD,
    val password: String = "",
    val privateKey: String = "",
    val passphrase: String = "",
    val group: String = "",
    val notes: String = "",
    val pinned: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
    val lastConnectedAt: Long? = null,
)
