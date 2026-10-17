package app.netcatty.ssh

import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import net.schmizz.sshj.connection.channel.direct.DirectConnection

/**
 * Local forward accept loop. One rejected direct-tcpip (the server says
 * "open failed" when it cannot reach the target) closes that socket only.
 */
internal class LocalForwardRelay(
    private val server: ServerSocket,
    private val targetHost: String,
    private val targetPort: Int,
    private val openChannel: (host: String, port: Int) -> DirectConnection,
    private val onConnectError: (String?) -> Unit,
) : AutoCloseable {
    private val clients = mutableSetOf<Socket>()
    private val pool: ExecutorService = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "netcatty-local-forward").apply { isDaemon = true }
    }
    @Volatile private var open = true

    fun listen() {
        while (open && !server.isClosed) {
            val socket = try {
                server.accept()
            } catch (error: Exception) {
                if (!open || server.isClosed) break
                continue
            }
            socket.tcpNoDelay = true
            synchronized(clients) { clients.add(socket) }
            pool.execute {
                try {
                    pump(socket)
                } finally {
                    synchronized(clients) { clients.remove(socket) }
                    runCatching { socket.close() }
                }
            }
        }
    }

    override fun close() {
        open = false
        runCatching { server.close() }
        val openClients = synchronized(clients) { clients.toList() }
        openClients.forEach { runCatching { it.close() } }
        pool.shutdownNow()
    }

    private fun pump(socket: Socket) {
        val channel = try {
            // newDirectConnection reports the originator as "localhost". Sending the
            // bind address (especially 0.0.0.0) makes some servers reject the channel
            // with "open failed" before they even try the target.
            openChannel(targetHost, targetPort)
        } catch (error: Exception) {
            onConnectError(forwardFailure(targetHost, targetPort, error))
            return
        }
        onConnectError(null)
        val down = Thread({ pipe(channel.inputStream, socket.getOutputStream()) }, "netcatty-fwd-down")
        down.isDaemon = true
        down.start()
        pipe(socket.getInputStream(), channel.outputStream)
        runCatching { channel.close() }
        runCatching { down.join(1_000) }
    }

    private fun pipe(from: InputStream, to: OutputStream) {
        val buffer = ByteArray(16 * 1024)
        try {
            while (true) {
                val read = from.read(buffer)
                if (read < 0) break
                to.write(buffer, 0, read)
                to.flush()
            }
        } catch (_: Exception) {
        } finally {
            runCatching { to.close() }
        }
    }
}

internal fun forwardFailure(targetHost: String, targetPort: Int, error: Exception): String {
    val text = error.message.orEmpty().lowercase()
    val where = "$targetHost:$targetPort"
    return when {
        "administratively" in text || "prohibited" in text -> "服务器禁止转发到 $where"
        "open failed" in text || "connect failed" in text -> "服务器连不上 $where"
        else -> "转发到 $where 失败：${tunnelError(error)}"
    }
}
