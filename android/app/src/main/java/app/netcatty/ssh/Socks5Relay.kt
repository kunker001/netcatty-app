package app.netcatty.ssh

import java.io.EOFException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import net.schmizz.sshj.connection.channel.direct.DirectConnection

/**
 * Minimal SOCKS5 server. CONNECT is forwarded by opening a direct-tcpip channel.
 * No authentication: bind it to 127.0.0.1 unless the user explicitly chooses otherwise.
 */
internal class Socks5Relay(
    private val server: ServerSocket,
    private val openChannel: (host: String, port: Int) -> DirectConnection,
) : AutoCloseable {
    private val clients = mutableSetOf<Socket>()
    private val pool: ExecutorService = Executors.newCachedThreadPool()
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
                    handle(socket)
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

    private fun handle(socket: Socket) {
        socket.soTimeout = 10_000
        val input = socket.getInputStream()
        val output = socket.getOutputStream()
        val version = input.read()
        val methodCount = input.read()
        if (version != 5 || methodCount < 0) return
        if (methodCount > 0) input.readFully(ByteArray(methodCount))
        output.write(byteArrayOf(5, 0))
        output.flush()

        val header = ByteArray(4)
        input.readFully(header)
        if (header[0] != 5.toByte()) return
        val command = header[1].toInt() and 0xff
        val kind = header[3].toInt() and 0xff
        val host = readAddress(input, kind)
        val portBytes = ByteArray(2)
        input.readFully(portBytes)
        val port = ((portBytes[0].toInt() and 0xff) shl 8) or (portBytes[1].toInt() and 0xff)
        if (command != 1 || host.isNullOrBlank() || port !in 1..65535) {
            writeReply(output, if (command == 1) REPLY_GENERAL else REPLY_COMMAND)
            return
        }
        val channel = try {
            openChannel(host, port)
        } catch (_: Exception) {
            writeReply(output, REPLY_REFUSED)
            return
        }
        writeReply(output, REPLY_OK)
        socket.soTimeout = 0
        val down = Thread {
            pipe(channel.inputStream, output)
        }
        down.isDaemon = true
        down.start()
        pipe(input, channel.outputStream)
        runCatching { channel.close() }
        runCatching { down.join(1_000) }
    }

    private fun readAddress(input: InputStream, kind: Int): String? = when (kind) {
        1 -> addressText(input, 4)
        3 -> {
            val length = input.read()
            if (length <= 0) null
            else {
                val name = ByteArray(length)
                input.readFully(name)
                String(name, Charsets.UTF_8)
            }
        }
        4 -> addressText(input, 16)
        else -> null
    }

    private fun addressText(input: InputStream, size: Int): String {
        val addr = ByteArray(size)
        input.readFully(addr)
        return InetAddress.getByAddress(addr).hostAddress ?: ""
    }

    private fun writeReply(output: OutputStream, status: Int) {
        output.write(
            byteArrayOf(
                5,
                status.toByte(),
                0,
                1,
                0,
                0,
                0,
                0,
                0,
                0,
            ),
        )
        output.flush()
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

    private fun InputStream.readFully(buffer: ByteArray) {
        var offset = 0
        while (offset < buffer.size) {
            val read = read(buffer, offset, buffer.size - offset)
            if (read < 0) throw EOFException()
            offset += read
        }
    }

    private companion object {
        const val REPLY_OK = 0
        const val REPLY_GENERAL = 1
        const val REPLY_REFUSED = 5
        const val REPLY_COMMAND = 7
    }
}
