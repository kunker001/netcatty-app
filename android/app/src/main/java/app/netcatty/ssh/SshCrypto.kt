package app.netcatty.ssh

import java.security.Security
import javax.crypto.KeyAgreement
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.SecurityUtils
import org.bouncycastle.jce.provider.BouncyCastleProvider

object SshCrypto {
    fun install() {
        Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
        Security.insertProviderAt(BouncyCastleProvider(), 1)
        SecurityUtils.setRegisterBouncyCastle(false)
        SecurityUtils.setSecurityProvider(BouncyCastleProvider.PROVIDER_NAME)
    }

    fun client(): SSHClient {
        val config = DefaultConfig()
        if (!hasX25519()) {
            config.keyExchangeFactories = config.keyExchangeFactories.filterNot {
                it.name.contains("curve25519", ignoreCase = true)
            }
        }
        return SSHClient(config)
    }

    private fun hasX25519(): Boolean = runCatching {
        KeyAgreement.getInstance("X25519", BouncyCastleProvider.PROVIDER_NAME)
        true
    }.getOrDefault(false)
}
