package app.netcatty.data

import kotlinx.serialization.Serializable

@Serializable
enum class TunnelKind {
    LOCAL,
    REMOTE,
    DYNAMIC,
}

@Serializable
data class TunnelRule(
    val id: String,
    val connectionId: String,
    val label: String = "",
    val kind: TunnelKind = TunnelKind.LOCAL,
    /** Phone bind address for local/dynamic. Address the SSH server binds for remote. */
    val bindHost: String = "127.0.0.1",
    val listenPort: Int,
    /** Destination host. Unused for dynamic SOCKS. */
    val targetHost: String = "127.0.0.1",
    val targetPort: Int = 0,
    val autoStart: Boolean = false,
    val createdAt: Long = System.currentTimeMillis(),
) {
    fun title(): String = label.ifBlank {
        when (kind) {
            TunnelKind.LOCAL -> "本地 $listenPort"
            TunnelKind.REMOTE -> "远程 $listenPort"
            TunnelKind.DYNAMIC -> "动态 $listenPort"
        }
    }

    fun kindLabel(): String = when (kind) {
        TunnelKind.LOCAL -> "本地转发"
        TunnelKind.REMOTE -> "远程转发"
        TunnelKind.DYNAMIC -> "动态代理"
    }

    fun endpointLine(): String = when (kind) {
        TunnelKind.LOCAL -> "$bindHost:$listenPort → $targetHost:$targetPort"
        TunnelKind.REMOTE -> "服务器 $bindHost:$listenPort → 本机 $targetHost:$targetPort"
        TunnelKind.DYNAMIC -> "SOCKS5 $bindHost:$listenPort"
    }
}

fun validateTunnel(
    connectionId: String,
    listenPort: Int,
    kind: TunnelKind,
    bindHost: String,
    targetHost: String,
    targetPort: Int,
): String? {
    if (connectionId.isBlank()) return "请选择一条连接"
    if (listenPort !in 1..65535) return "监听端口必须是 1-65535"
    if (bindHost != "127.0.0.1" && bindHost != "0.0.0.0") return "绑定地址只能是 127.0.0.1 或 0.0.0.0"
    if (kind == TunnelKind.DYNAMIC) return null
    if (targetHost.isBlank()) return "请填写目标主机"
    if (targetPort !in 1..65535) return "目标端口必须是 1-65535"
    return null
}
