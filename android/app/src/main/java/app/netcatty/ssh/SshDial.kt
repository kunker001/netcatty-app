package app.netcatty.ssh

import app.netcatty.data.AuthMethod
import app.netcatty.data.ConnectSpec
import java.security.MessageDigest
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.keyprovider.KeyProvider

/** Opens an authenticated SSH client. Shells and tunnels share this dial. */
internal fun dialSsh(target: ConnectSpec): SSHClient {
    val ssh = SshCrypto.client()
    ssh.addHostKeyVerifier(AcceptThenRememberVerifier)
    ssh.connectTimeout = 15_000
    // The heartbeater thread only starts during connect, and only if the
    // interval is already set. An idle session otherwise sits silent until
    // Android or the router drops it.
    ssh.connection.keepAlive.keepAliveInterval = 15
    ssh.connect(target.hostname, target.port)
    enableSocketKeepAlive(ssh)
    authenticate(ssh, target)
    return ssh
}

private fun authenticate(ssh: SSHClient, target: ConnectSpec) {
    when (target.authMethod) {
        AuthMethod.PASSWORD -> ssh.authPassword(target.username, target.password)
        AuthMethod.KEY -> ssh.authPublickey(target.username, loadKey(ssh, target))
    }
}

private fun loadKey(ssh: SSHClient, target: ConnectSpec): KeyProvider {
    val pem = target.privateKey.trim()
    require(pem.isNotBlank()) { "缺少私钥" }
    val passwordFinder = if (target.passphrase.isBlank()) {
        null
    } else {
        object : net.schmizz.sshj.userauth.password.PasswordFinder {
            override fun reqPassword(resource: net.schmizz.sshj.userauth.password.Resource<*>?) =
                target.passphrase.toCharArray()

            override fun shouldRetry(resource: net.schmizz.sshj.userauth.password.Resource<*>?) = false
        }
    }
    return ssh.loadKeys(pem, null, passwordFinder)
}

private object AcceptThenRememberVerifier : HostKeyVerifier {
    private val seen = mutableMapOf<String, String>()

    override fun verify(hostname: String, port: Int, key: java.security.PublicKey): Boolean {
        val fingerprint = sha256(key.encoded)
        val slot = "$hostname:$port"
        val previous = seen[slot]
        return if (previous == null) {
            seen[slot] = fingerprint
            true
        } else {
            previous == fingerprint
        }
    }

    override fun findExistingAlgorithms(hostname: String, port: Int): MutableList<String> = mutableListOf()

    private fun sha256(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }
}
