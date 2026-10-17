package app.netcatty.ssh

import app.netcatty.data.ConnectSpec
import app.netcatty.data.TunnelKind
import app.netcatty.data.TunnelRule
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.forwarded.RemotePortForwarder
import net.schmizz.sshj.connection.channel.forwarded.SocketForwardingConnectListener
import net.schmizz.sshj.transport.DisconnectListener

/**
 * Runs tunnel rules on dedicated SSH clients. Rules for the same connection share
 * one dial, and that dial closes when its last rule stops.
 */
internal class TunnelEngine {
    private val lock = Any()
    private val dials = HashMap<String, Dial>()
    private val handles = HashMap<String, Handle>()
    private val reaper: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "netcatty-tunnel-reaper").apply { isDaemon = true }
    }

    fun open(
        rule: TunnelRule,
        spec: ConnectSpec,
        onDown: (String) -> Unit,
        onConnectError: (String?) -> Unit = {},
    ) {
        synchronized(lock) {
            if (handles.containsKey(rule.id)) return
        }
        val dial = acquireDial(spec)
        var handle: Handle? = null
        try {
            handle = bind(dial.ssh, rule, onDown, onConnectError)
            synchronized(lock) {
                if (dials[spec.connectionId] !== dial || !dial.ssh.isConnected) {
                    error("SSH 连接已断开")
                }
                handles[rule.id] = handle
                dial.rules.add(rule.id)
            }
            handle.start()
        } catch (error: Exception) {
            handle?.let { runCatching { it.close() } }
            synchronized(lock) { handles.remove(rule.id) }
            releaseRule(spec.connectionId, rule.id)
            throw error
        }
    }

    fun close(ruleId: String) {
        val handle = synchronized(lock) { handles.remove(ruleId) } ?: return
        handle.markStopped()
        runCatching { handle.close() }
        releaseRule(handle.connectionId, ruleId)
    }

    fun isOpen(ruleId: String): Boolean = synchronized(lock) { handles.containsKey(ruleId) }

    private fun acquireDial(spec: ConnectSpec): Dial {
        synchronized(lock) {
            val existing = dials[spec.connectionId]
            if (existing != null && existing.ssh.isConnected && !existing.closing.get()) return existing
        }
        val ssh = dialSsh(spec)
        val dial = Dial(ssh)
        ssh.transport.setDisconnectListener(DisconnectListener { _, message ->
            dropConnection(spec.connectionId, friendlySshError(message) ?: "SSH 连接已断开")
        })
        synchronized(lock) {
            val raced = dials[spec.connectionId]
            if (raced != null && raced.ssh.isConnected && !raced.closing.get()) {
                dial.closing.set(true)
                reaper.execute { runCatching { ssh.disconnect() } }
                return raced
            }
            dials[spec.connectionId] = dial
        }
        return dial
    }

    private fun bind(
        ssh: SSHClient,
        rule: TunnelRule,
        onDown: (String) -> Unit,
        onConnectError: (String?) -> Unit,
    ): Handle = when (rule.kind) {
        TunnelKind.LOCAL -> {
            val server = boundSocket(rule.bindHost, rule.listenPort)
            val relay = LocalForwardRelay(
                server = server,
                targetHost = rule.targetHost,
                targetPort = rule.targetPort,
                openChannel = { host, port -> ssh.newDirectConnection(host, port) },
                onConnectError = onConnectError,
            )
            listeningHandle(rule, onDown, closer = { relay.close() }) {
                relay.listen()
            }
        }
        TunnelKind.DYNAMIC -> {
            val server = boundSocket(rule.bindHost, rule.listenPort)
            val relay = Socks5Relay(server) { host, port -> ssh.newDirectConnection(host, port) }
            listeningHandle(rule, onDown, closer = { relay.close() }) {
                relay.listen()
            }
        }
        TunnelKind.REMOTE -> {
            val forward = ssh.remotePortForwarder.bind(
                RemotePortForwarder.Forward(rule.bindHost, rule.listenPort),
                SocketForwardingConnectListener(InetSocketAddress(rule.targetHost, rule.targetPort)),
            )
            Handle(rule.id, rule.connectionId, onDown) {
                runCatching { ssh.remotePortForwarder.cancel(forward) }
            }
        }
    }

    private fun listeningHandle(
        rule: TunnelRule,
        onDown: (String) -> Unit,
        closer: () -> Unit,
        listen: () -> Unit,
    ): Handle = Handle(rule.id, rule.connectionId, onDown, closer).apply {
        loop = {
            try {
                listen()
                if (!stopped.get()) drop(rule.id, "隧道已停止")
            } catch (error: Exception) {
                if (!stopped.get()) drop(rule.id, tunnelError(error))
            }
        }
    }

    private fun drop(ruleId: String, message: String) {
        val handle = synchronized(lock) { handles.remove(ruleId) } ?: return
        handle.markStopped()
        reaper.execute {
            runCatching { handle.close() }
            releaseRule(handle.connectionId, ruleId)
            handle.onDown(message)
        }
    }

    private fun dropConnection(connectionId: String, message: String) {
        val ids = synchronized(lock) {
            val dial = dials[connectionId] ?: return
            if (dial.closing.get()) return
            dial.rules.toList()
        }
        ids.forEach { drop(it, message) }
    }

    private fun releaseRule(connectionId: String, ruleId: String) {
        val ssh = synchronized(lock) {
            val dial = dials[connectionId] ?: return
            dial.rules.remove(ruleId)
            if (dial.rules.isNotEmpty()) return
            dials.remove(connectionId)
            dial.closing.set(true)
            dial.ssh
        }
        reaper.execute { runCatching { ssh.disconnect() } }
    }

    private fun boundSocket(host: String, port: Int): ServerSocket {
        val server = ServerSocket()
        server.reuseAddress = true
        server.bind(InetSocketAddress(host, port))
        return server
    }

    private class Dial(
        val ssh: SSHClient,
        val rules: MutableSet<String> = mutableSetOf(),
        val closing: AtomicBoolean = AtomicBoolean(false),
    )

    private class Handle(
        val ruleId: String,
        val connectionId: String,
        val onDown: (String) -> Unit,
        private val closer: () -> Unit,
    ) {
        val stopped = AtomicBoolean(false)
        var loop: (() -> Unit)? = null

        fun start() {
            val body = loop ?: return
            Thread(body, "netcatty-tunnel-$ruleId").apply {
                isDaemon = true
                start()
            }
        }

        fun markStopped() {
            stopped.set(true)
        }

        fun close() {
            closer()
        }
    }
}

internal fun tunnelError(error: Exception): String {
    val text = error.message.orEmpty()
    val lower = text.lowercase()
    return when {
        "eaddrinuse" in lower || "address already in use" in lower -> "端口已被占用"
        "permission denied" in lower && "bind" in lower -> "没有权限监听该端口"
        else -> friendlySshError(text) ?: error.javaClass.simpleName
    }
}
