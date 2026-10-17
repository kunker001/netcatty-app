package app.netcatty.ssh

import android.os.Build
import android.system.Os
import android.system.OsConstants
import app.netcatty.data.ConnectSpec
import java.io.FileDescriptor
import java.io.InputStream
import java.net.Socket
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.connection.channel.direct.SessionChannel
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.xfer.FileSystemFile

class SshSession(
    private val scope: CoroutineScope,
    private val onReady: () -> Unit = {},
    private val onClosed: (String?) -> Unit,
) {
    private val lock = Any()
    private val replay = StringBuilder()
    @Volatile private var output: ((String) -> Unit)? = null
    private var client: SSHClient? = null
    private var probeClient: SSHClient? = null
    private var targetSpec: ConnectSpec? = null
    private var session: SessionChannel? = null
    private var shell: Session.Shell? = null
    private var readerJob: Job? = null
    private val closed = AtomicBoolean(false)
    private val started = AtomicBoolean(false)
    private val muteOutput = AtomicBoolean(false)
    private val ptyMutex = Mutex()
    private val channelMutex = Mutex()
    private val probeBuf = StringBuilder()
    @Volatile var cols: Int = 80
    @Volatile var rows: Int = 24
    @Volatile var shellPid: Int? = null
        private set

    val connected: Boolean
        get() = client?.isConnected == true && !closed.get()

    fun connect(target: ConnectSpec) {
        if (!started.compareAndSet(false, true)) return
        targetSpec = target
        scope.launch(Dispatchers.IO) {
            try {
                val ssh = openClient(target)
                val sess = ssh.startSession() as SessionChannel
                sess.allocatePTY("xterm-256color", cols, rows, 0, 0, emptyMap())
                val sh = sess.startShell()
                synchronized(lock) {
                    client = ssh
                    session = sess
                    shell = sh
                }
                startReader(sh.inputStream)
                onReady()
            } catch (error: Exception) {
                onClosed(friendlySshError(error.message) ?: error.javaClass.simpleName)
                closeQuietly()
            }
        }
    }

    fun attachOutput(listener: (String) -> Unit) {
        synchronized(replay) {
            output = listener
            val snap = replay.toString()
            if (snap.isNotEmpty()) listener(snap)
        }
    }

    fun detachOutput() {
        synchronized(replay) { output = null }
    }

    private fun emit(chunk: String) {
        if (muteOutput.get()) {
            synchronized(probeBuf) { probeBuf.append(chunk) }
            return
        }
        synchronized(replay) {
            replay.append(chunk)
            if (replay.length > 200_000) replay.delete(0, replay.length - 160_000)
            runCatching { output?.invoke(chunk) }
        }
    }

    suspend fun execLogin(command: String, timeoutSeconds: Int = 45): ExecResult {
        val wrapped = "sh -lc ${shSingleQuote(command)}"
        return exec(wrapped, timeoutSeconds)
    }

    suspend fun captureShellPid(timeoutSeconds: Int = 8): Int? = withContext(Dispatchers.IO) {
        ptyMutex.withLock {
            if (shellPid != null) return@withLock shellPid
            muteOutput.set(true)
            synchronized(probeBuf) { probeBuf.setLength(0) }
            try {
                writeSync("echo NC_PID=$$\n")
                val deadline = System.currentTimeMillis() + timeoutSeconds.coerceIn(3, 20) * 1000L
                while (System.currentTimeMillis() < deadline) {
                    val added = stripAnsi(synchronized(probeBuf) { probeBuf.toString() })
                    val match = Regex("""NC_PID=(\d+)""").find(added)
                    if (match != null) {
                        val pid = match.groupValues[1].toInt()
                        shellPid = pid
                        delay(200)
                        return@withLock pid
                    }
                    delay(80)
                }
                null
            } finally {
                muteOutput.set(false)
                synchronized(probeBuf) { probeBuf.setLength(0) }
            }
        }
    }

    suspend fun exec(command: String, timeoutSeconds: Int = 60): ExecResult = withContext(Dispatchers.IO) {
        channelMutex.withLock {
            if (closed.get()) error("SSH is not connected")
            val ssh = try {
                ensureProbeClient()
            } catch (error: Exception) {
                closeProbe()
                throw error
            }
            var sess: Session? = null
            var cmd: Session.Command? = null
            try {
                sess = ssh.startSession()
                cmd = sess.exec(command)
                val commandRef = cmd
                coroutineScope {
                    val stdout = async {
                        runCatching { commandRef.inputStream.readBytes().toString(Charsets.UTF_8) }.getOrDefault("")
                    }
                    val stderr = async {
                        runCatching { commandRef.errorStream.readBytes().toString(Charsets.UTF_8) }.getOrDefault("")
                    }
                    commandRef.join(timeoutSeconds.coerceIn(5, 60).toLong(), TimeUnit.SECONDS)
                    ExecResult(
                        stdout = stdout.await(),
                        stderr = stderr.await(),
                        exitCode = commandRef.exitStatus,
                        timedOut = commandRef.exitStatus == null,
                    )
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                closeProbe()
                throw error
            } finally {
                runCatching { cmd?.close() }
                runCatching { sess?.close() }
            }
        }
    }

    fun replaySnapshot(): String = synchronized(replay) { replay.toString() }

    suspend fun runInShell(command: String, timeoutSeconds: Int = 60): ExecResult = withContext(Dispatchers.IO) {
        ptyMutex.withLock {
            runInShellLocked(command, timeoutSeconds)
        }
    }

    private suspend fun runInShellLocked(command: String, timeoutSeconds: Int): ExecResult {
        val token = "nc${System.nanoTime().toString(36)}"
        val endMark = "__NC_END_${token}:"
        val before = replaySnapshot().length
        val safe = command.trim().replace("\r", "")
        writeSync("# [Catty] $safe\n")
        writeSync("$safe\n")
        writeSync("echo $endMark\$?__\n")
        val deadline = System.currentTimeMillis() + timeoutSeconds.coerceIn(5, 180) * 1000L
        while (System.currentTimeMillis() < deadline) {
            val added = addedSince(before)
            val idx = added.indexOf(endMark)
            if (idx >= 0) {
                val after = added.substring(idx + endMark.length)
                val match = Regex("""^(\d+)__""").find(after)
                if (match != null) {
                    val code = match.groupValues[1].toIntOrNull()
                    val body = stripAnsi(added.substring(0, idx)).trimEnd()
                    return ExecResult(
                        stdout = body.take(12_000),
                        stderr = "",
                        exitCode = code,
                        timedOut = false,
                    )
                }
            }
            delay(80)
        }
        writeSync("\u0003")
        delay(150)
        return ExecResult(
            stdout = stripAnsi(addedSince(before)).trimEnd(),
            stderr = "",
            exitCode = null,
            timedOut = true,
        )
    }

    fun write(data: String) {
        scope.launch(Dispatchers.IO) {
            runCatching { writeSync(data) }
        }
    }

    private fun writeSync(data: String) {
        val out = synchronized(lock) { shell?.outputStream } ?: error("SSH is not connected")
        out.write(data.toByteArray(Charsets.UTF_8))
        out.flush()
    }

    private fun addedSince(before: Int): String {
        val snap = replaySnapshot()
        return if (snap.length > before) snap.substring(before) else ""
    }

    fun resize(nextCols: Int, nextRows: Int) {
        cols = nextCols.coerceAtLeast(20)
        rows = nextRows.coerceAtLeast(8)
        scope.launch(Dispatchers.IO) {
            val current = synchronized(lock) { session }
            runCatching { current?.changeWindowDimensions(cols, rows, 0, 0) }
        }
    }

    fun openSftp(): SFTPClient {
        val ssh = synchronized(lock) { client } ?: error("SSH is not connected")
        return ssh.newSFTPClient()
    }

    fun download(remotePath: String, localFile: java.io.File) {
        openSftp().use { sftp ->
            sftp.get(remotePath, FileSystemFile(localFile))
        }
    }

    fun upload(localFile: java.io.File, remotePath: String) {
        openSftp().use { sftp ->
            sftp.put(FileSystemFile(localFile), remotePath)
        }
    }

    fun disconnect() {
        if (closed.compareAndSet(false, true)) {
            onClosed(null)
            closeQuietly()
        }
    }

    private fun startReader(input: InputStream) {
        readerJob = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(32 * 1024)
            var misses = 0
            try {
                while (!closed.get()) {
                    val read = try {
                        input.read(buffer)
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        if (closed.get()) break
                        val alive = synchronized(lock) { client?.isConnected == true }
                        if (!alive) {
                            if (closed.compareAndSet(false, true)) {
                                onClosed(friendlySshError(error.message))
                            }
                            break
                        }
                        // A channel read can throw while the SSH transport is still up
                        // (window adjust, a background exec racing the shell). That used
                        // to mark the whole session failed and close a shell the user
                        // could still open.
                        misses += 1
                        delay((200L * misses).coerceAtMost(2_000L))
                        continue
                    }
                    misses = 0
                    if (read < 0) break
                    if (read == 0) continue
                    emit(String(buffer, 0, read, Charsets.UTF_8))
                }
                if (closed.compareAndSet(false, true)) onClosed(null)
            } finally {
                if (closed.get()) closeQuietly()
            }
        }
    }

    private fun openClient(target: ConnectSpec): SSHClient = dialSsh(target)

    private fun ensureProbeClient(): SSHClient {
        val existing = probeClient
        if (existing != null && existing.isConnected) return existing
        val target = targetSpec ?: error("SSH is not connected")
        val ssh = openClient(target)
        probeClient = ssh
        return ssh
    }

    private fun closeProbe() {
        val ssh = probeClient
        probeClient = null
        runCatching { ssh?.disconnect() }
    }

    private fun closeQuietly() {
        readerJob?.cancel()
        closeProbe()
        synchronized(lock) {
            runCatching { shell?.close() }
            runCatching { session?.close() }
            runCatching { client?.close() }
            shell = null
            session = null
            client = null
        }
    }
}

data class ExecResult(
    val stdout: String,
    val stderr: String,
    val exitCode: Int?,
    val timedOut: Boolean = false,
)

private fun stripAnsi(value: String): String =
    value.replace(Regex("\u001B\\[[0-9;?]*[A-Za-z]"), "").replace(Regex("\u001B\\].*?\u0007"), "")

fun friendlySshError(message: String?): String? {
    val text = message?.trim().orEmpty()
    if (text.isEmpty()) return message
    val lower = text.lowercase()
    return when {
        "connection abort" in lower || "connection reset" in lower || "broken pipe" in lower -> "连接中断，请重试"
        "timed out" in lower || "timeout" in lower || "connection refused" in lower || "failed to connect" in lower -> "连接超时或被拒绝"
        "auth fail" in lower || "authentication" in lower || "permission denied" in lower -> "认证失败"
        "unknownhost" in lower || "unable to resolve" in lower -> "无法解析主机名"
        else -> text
    }
}

internal fun enableSocketKeepAlive(ssh: SSHClient) {
    var cls: Class<*>? = ssh.javaClass
    while (cls != null) {
        val type = cls
        val field = runCatching { type.getDeclaredField("socket") }.getOrNull()
        if (field != null) {
            field.isAccessible = true
            runCatching {
                (field.get(ssh) as? Socket)?.apply {
                    keepAlive = true
                    tcpNoDelay = true
                    tuneTcpKeepAlive(this)
                }
            }
            return
        }
        cls = type.superclass
    }
}

private const val TCP_KEEPIDLE = 4
private const val TCP_KEEPINTVL = 5
private const val TCP_KEEPCNT = 6

private fun tuneTcpKeepAlive(socket: Socket) {
    if (Build.VERSION.SDK_INT < 29) return
    val fd = socketFileDescriptor(socket) ?: return
    runCatching {
        // Linux TCP keepalive options. The platform default idle time is two hours,
        // which is long enough for Android to drop a quiet session.
        Os.setsockoptInt(fd, OsConstants.IPPROTO_TCP, TCP_KEEPIDLE, 45)
        Os.setsockoptInt(fd, OsConstants.IPPROTO_TCP, TCP_KEEPINTVL, 15)
        Os.setsockoptInt(fd, OsConstants.IPPROTO_TCP, TCP_KEEPCNT, 3)
    }
}

private fun socketFileDescriptor(socket: Socket): FileDescriptor? {
    val impl = runCatching {
        Socket::class.java.getDeclaredField("impl").apply { isAccessible = true }.get(socket)
    }.getOrNull() ?: return null
    var type: Class<*>? = impl.javaClass
    while (type != null) {
        val field = runCatching { type.getDeclaredField("fd") }.getOrNull()
        if (field != null) {
            field.isAccessible = true
            return field.get(impl) as? FileDescriptor
        }
        type = type.superclass
    }
    return null
}

fun shSingleQuote(value: String): String =
    "'" + value.replace("'", "'\"'\"'") + "'"

fun escapeJsString(value: String): String = buildString {
    value.forEach { ch ->
        when (ch) {
            '\\' -> append("\\\\")
            '\'' -> append("\\'")
            '"' -> append("\\\"")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\u2028' -> append("\\u2028")
            '\u2029' -> append("\\u2029")
            else -> append(ch)
        }
    }
}
